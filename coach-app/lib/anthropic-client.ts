/**
 * Vercel AI SDK + @ai-sdk/anthropic wrapper for the Joe Hudson AI coach.
 *
 * E-031 SDK-basics spike (per E-031 audit Important #7, replacing the
 * dropped R-013 hard dependency for this baseline experiment).
 *
 * What this module gives the coach:
 *   - A single `generateCoachTurn` function that calls Anthropic via AI SDK's
 *     `generateText`, with prompt caching enabled on the system prompt block.
 *   - 5x exponential backoff on 429 / 503 / 529 / 5xx (mirrors the eval
 *     harness `eval/lib/anthropic.ts` policy for consistency).
 *   - Token + cost telemetry per call, so the coach's CLI can print
 *     per-turn cost in REPL mode and the one-shot JSON output (used by the
 *     eval harness) includes usage.
 *
 * Why AI SDK (Vercel `ai`) instead of raw `@anthropic-ai/sdk`:
 *   - Tool-use ergonomics for E-032 (the v2 retrieval coach with tool calls)
 *     and E-033/E-036 (retrieved context injection). The eval harness uses the
 *     raw SDK because it's a one-shot orchestrator; the coach lives in agent
 *     territory.
 *   - Streaming-friendly: the CLI REPL can stream tokens once we add UX polish.
 *   - Same provider underneath, so cost/caching semantics are unchanged.
 *
 * Prompt caching note:
 *   The system prompt is set with `providerOptions: { anthropic: { cacheControl:
 *   { type: "ephemeral" } } }` per the @ai-sdk/anthropic README. The first turn
 *   pays cache-write cost (1.25x base); subsequent turns of the same
 *   conversation OR subsequent profiles in an eval get cache-read pricing
 *   (0.1x base). For the v1 prompt (~3.1K tokens), this drops amortized
 *   prompt cost from ~$0.01/turn to ~$0.001/turn across a typical 12-turn
 *   conversation.
 */

import { generateText, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

export interface CoachUsage {
  /** Input tokens that hit the model (not served from cache). */
  input_tokens: number;
  /** Output tokens generated. */
  output_tokens: number;
  /** Input tokens served from Anthropic prompt cache (10% pricing). */
  cache_read_input_tokens: number;
  /** Input tokens written to the prompt cache on this call (125% pricing). */
  cache_creation_input_tokens: number;
  /** Total cost in USD computed from the model's per-token rates. */
  cost_usd: number;
  /** Wall-clock ms for this call. */
  ms: number;
}

export interface CoachTurnResult {
  text: string;
  usage: CoachUsage;
  /** Model identifier the call landed on (e.g., claude-sonnet-4-6). */
  model: string;
}

/**
 * Pricing per million tokens, mirrored from `eval/lib/anthropic.ts`. Kept in
 * sync to keep cost reporting consistent across coach and eval. Verified
 * 2026-05-22.
 */
const PRICING: Record<
  string,
  { input: number; output: number; cache_read: number; cache_write: number }
> = {
  "claude-opus-4-7": { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
  "claude-opus-4-6": { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
  "claude-opus-4-5": { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
  "claude-sonnet-4-6": { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  "claude-sonnet-4-5": { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  "claude-haiku-4-5": { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
};

function computeCost(
  model: string,
  inToks: number,
  outToks: number,
  cacheRead: number,
  cacheWrite: number,
): number {
  const p = PRICING[model] ?? PRICING["claude-sonnet-4-6"];
  return (
    (inToks * p.input) / 1_000_000 +
    (outToks * p.output) / 1_000_000 +
    (cacheRead * p.cache_read) / 1_000_000 +
    (cacheWrite * p.cache_write) / 1_000_000
  );
}

export interface GenerateCoachTurnArgs {
  /** Model id, e.g. "claude-sonnet-4-6". */
  model: string;
  /** The full system prompt (already loaded from disk). */
  systemPrompt: string;
  /**
   * Conversation history. The coach itself produces "assistant" turns; the
   * client produces "user" turns. Pass the full multi-turn history; the model
   * sees all of it. The current user message must be the last entry.
   */
  messages: ModelMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Anthropic API key. Defaults to ANTHROPIC_API_KEY env var via provider. */
  apiKey?: string;
}

/**
 * Generate one coach turn. Returns the text + usage breakdown.
 *
 * The system prompt is marked cacheable (5-minute Anthropic ephemeral cache).
 * After the first call the cache_read_input_tokens field will be populated on
 * usage, indicating the prompt was served from cache.
 *
 * Retries 5x on 429 / 503 / 529 / 5xx with exponential backoff capped at 30s.
 */
export async function generateCoachTurn(
  args: GenerateCoachTurnArgs,
): Promise<CoachTurnResult> {
  const apiKey = args.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error(
      "ANTHROPIC_API_KEY not set. Add to .env at repo root or pass apiKey explicitly.",
    );
  }
  const anthropic = createAnthropic({ apiKey });

  // The system prompt is passed via the dedicated `system` option, NOT as a
  // message (AI SDK warns that system-in-messages can enable prompt
  // injection). AI SDK v6's `system` accepts SystemModelMessage, which has
  // a providerOptions field that lets us attach Anthropic cache_control
  // directly to the system block — this is exactly the cache_control shape
  // Anthropic's API expects.
  const systemMessage = {
    role: "system" as const,
    content: args.systemPrompt,
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" as const } },
    },
  };

  const t0 = Date.now();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await generateText({
        model: anthropic(args.model),
        system: systemMessage,
        messages: args.messages,
        temperature: args.temperature ?? 0.7,
        maxOutputTokens: args.maxTokens ?? 1024,
      });

      // AI SDK v6 surfaces provider-specific usage under
      // result.providerMetadata.anthropic.usage. Fall back to the flat usage
      // shape for portability across providers.
      const pmAnth = (result as unknown as {
        providerMetadata?: { anthropic?: { usage?: Record<string, number> } };
      }).providerMetadata?.anthropic?.usage;
      const flat = result.usage as unknown as Record<string, number | undefined>;
      const inTok =
        pmAnth?.input_tokens ?? flat?.inputTokens ?? flat?.input_tokens ?? 0;
      const outTok =
        pmAnth?.output_tokens ?? flat?.outputTokens ?? flat?.output_tokens ?? 0;
      const cacheRead =
        pmAnth?.cache_read_input_tokens ??
        flat?.cachedInputTokens ??
        flat?.cache_read_input_tokens ??
        0;
      const cacheWrite =
        pmAnth?.cache_creation_input_tokens ??
        flat?.cache_creation_input_tokens ??
        0;

      const cost_usd = computeCost(
        args.model,
        inTok,
        outTok,
        cacheRead,
        cacheWrite,
      );
      return {
        text: result.text ?? "",
        model: args.model,
        usage: {
          input_tokens: inTok,
          output_tokens: outTok,
          cache_read_input_tokens: cacheRead,
          cache_creation_input_tokens: cacheWrite,
          cost_usd,
          ms: Date.now() - t0,
        },
      };
    } catch (e: unknown) {
      lastErr = e;
      const err = e as { status?: number; response?: { status?: number } };
      const status = err.status ?? err.response?.status;
      if (
        status === 429 ||
        status === 503 ||
        status === 529 ||
        (status !== undefined && status >= 500)
      ) {
        const base = Math.min(30_000, 1000 * 2 ** attempt);
        const wait = base + Math.floor(Math.random() * 750);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error("retry exhausted");
}
