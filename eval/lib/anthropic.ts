/**
 * Anthropic SDK wrapper with caching, cost tracking, and retry.
 *
 * - Single shared client.
 * - All calls go through `complete()` which: hashes the request, checks the
 *   file cache, falls through to the API on miss, records cost.
 * - The Anthropic Messages API supports PROMPT CACHING via `cache_control:
 *   { type: "ephemeral" }` markers on system text blocks. The wrapper accepts
 *   `system` as either a plain string (no caching) or a structured array of
 *   text blocks (cacheable). The cost tracker reads
 *   `cache_creation_input_tokens` and `cache_read_input_tokens` from the
 *   response usage and bills accordingly.
 * - Cost log is JSONL per run, written by the runner; this module exposes the
 *   call record.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ResponseCache } from "./cache.ts";

// Pricing per million tokens, per Anthropic docs (verified 2026-05-22).
// Cache write is 1.25x base (5m TTL); cache read is 0.1x base.
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

/**
 * System block shape that supports prompt caching. The Anthropic SDK accepts
 * `system` as either a string or an array of these blocks. Adding a
 * `cache_control` marker on a block tells Anthropic to cache that block (and
 * everything before it) for 5 minutes.
 */
export type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
};

export interface CallRecord {
  model: string;
  purpose: string; // "client" | "coach" | "judge:dim:<id>" | "judge:safety"
  cached: boolean; // local file cache hit (not Anthropic prompt cache)
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  ms: number;
}

function computeCost(
  model: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  },
): number {
  const p = PRICING[model] ?? PRICING["claude-sonnet-4-5"];
  const inToks = usage.input_tokens ?? 0;
  const outToks = usage.output_tokens ?? 0;
  const cr = usage.cache_read_input_tokens ?? 0;
  const cw = usage.cache_creation_input_tokens ?? 0;
  return (
    (inToks * p.input) / 1_000_000 +
    (outToks * p.output) / 1_000_000 +
    (cr * p.cache_read) / 1_000_000 +
    (cw * p.cache_write) / 1_000_000
  );
}

export class AnthropicWrapper {
  private client: Anthropic;
  private cache: ResponseCache;
  callLog: CallRecord[] = [];

  constructor(apiKey: string, cache: ResponseCache) {
    this.client = new Anthropic({ apiKey });
    this.cache = cache;
  }

  async complete(args: {
    purpose: string;
    model: string;
    /** Plain string OR structured blocks for prompt caching. */
    system: string | SystemBlock[];
    messages: { role: "user" | "assistant"; content: string }[];
    temperature?: number;
    max_tokens: number;
    extraSalt?: string;
  }): Promise<{ text: string; record: CallRecord }> {
    // Hash key: include system content but normalize structured shape so the
    // same prompt with and without cache_control markers hashes identically
    // (the cache_control marker does not change the model output).
    const systemForHash =
      typeof args.system === "string"
        ? args.system
        : args.system.map((b) => b.text).join("\n---SYSTEM-BLOCK---\n");

    const key = this.cache.key({
      model: args.model,
      system: systemForHash,
      messages: args.messages,
      extra: args.extraSalt ?? `t=${args.temperature ?? 1}|max=${args.max_tokens}`,
    });

    const t0 = Date.now();
    const cached = this.cache.get(key);
    if (cached) {
      const text = extractText(cached.response as Anthropic.Message);
      const record: CallRecord = {
        model: args.model,
        purpose: args.purpose,
        cached: true,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cost_usd: 0,
        ms: Date.now() - t0,
      };
      this.callLog.push(record);
      return { text, record };
    }

    // Live call with retry on 429 / 5xx / 529 (overloaded).
    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt < 6) {
      try {
        const response = await this.client.messages.create({
          model: args.model,
          system: args.system as Anthropic.Messages.MessageCreateParams["system"],
          messages: args.messages,
          temperature: args.temperature ?? 1.0,
          max_tokens: args.max_tokens,
        });

        const rawUsage = response.usage as unknown as Record<string, number | undefined>;
        const usage = {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          cache_read_input_tokens: rawUsage.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens: rawUsage.cache_creation_input_tokens ?? 0,
        };

        this.cache.put(key, args.model, response, usage);

        const text = extractText(response);
        const record: CallRecord = {
          model: args.model,
          purpose: args.purpose,
          cached: false,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
          cost_usd: computeCost(args.model, usage),
          ms: Date.now() - t0,
        };
        this.callLog.push(record);
        return { text, record };
      } catch (e: any) {
        lastErr = e;
        const status = e?.status ?? e?.response?.status;
        // 429 rate-limited, 503/529 overloaded, 5xx general server.
        if (status === 429 || status === 503 || status === 529 || (status && status >= 500)) {
          // Exponential backoff with jitter: 1s, 2s, 4s, 8s, 16s, 32s.
          const wait = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
          await new Promise((r) => setTimeout(r, wait));
          attempt += 1;
          continue;
        }
        throw e;
      }
    }
    throw lastErr ?? new Error("retry exhausted");
  }

  totalCost(): number {
    return this.callLog.reduce((acc, r) => acc + r.cost_usd, 0);
  }
}

function extractText(msg: Anthropic.Message | any): string {
  if (!msg?.content) return "";
  const parts = Array.isArray(msg.content) ? msg.content : [];
  return parts
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text)
    .join("")
    .trim();
}
