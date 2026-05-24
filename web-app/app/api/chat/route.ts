import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type ModelMessage,
  type UIMessage,
} from 'ai';
import { openrouter, DEFAULT_COACH_MODEL } from '@/app/lib/openrouter';
import { SYSTEM_PROMPT } from '@/app/lib/system-prompt';
import { runRetrieval } from '@/app/lib/coach/retriever';
import {
  preResponseScan,
  postResponseCheck,
  buildSafetyReminder,
  SAFETY_FALLBACK_TEMPLATE,
} from '@/app/lib/coach/safety';
import { checkBudget, recordSpend, getSpentUsd, getBudgetCapUsd } from '@/app/lib/coach/cost-cap';
import type { CoachUIMessage, ResourceAttribution } from '@/app/lib/coach/types';

// Node runtime explicitly — the lifted graph-walk module uses Node-native fs
// and path. Edge would also break the @ai-sdk/anthropic dependency at the
// Anthropic SDK level.
export const runtime = 'nodejs';

// Coach turns with retrieval can take ~10-25s wall-clock (seed-detection +
// 5-8 walker steps + coach generation). Bump the route timeout to accommodate
// the slow tail.
export const maxDuration = 60;

type ChatRequestBody = {
  messages: UIMessage[];
};

// Coach-side message-cost pricing for the running cap tally. Sonnet 4.6 via
// OpenRouter mirrors Anthropic-direct rates ($3/M input, $15/M output, cache
// reads/writes at $0.30 / $3.75 respectively). The walker + seed retrieval
// already counts itself via runRetrieval()'s telemetry; this covers the
// coach turn only.
const COACH_PRICING = {
  input: 3, output: 15, cache_read: 0.3, cache_write: 3.75,
};

// AI SDK v6 usage shape: cache-read/write live under inputTokenDetails. We
// accept the loose shape because the OpenRouter provider sometimes surfaces
// them flat in providerMetadata instead — caller passes either form.
type CoachUsageShape = {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
};

function computeCoachCost(usage: CoachUsageShape): number {
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  // `inputTokens` from AI SDK includes cached tokens. For per-token pricing
  // we want NON-cached input * input-rate + cache-read * cache-read-rate +
  // cache-write * cache-write-rate. Compute non-cached as a clamp to handle
  // providers that report differently.
  const inputTotal = usage.inputTokens ?? 0;
  const nonCachedInput = Math.max(0, inputTotal - cacheRead - cacheWrite);
  return (
    (nonCachedInput * COACH_PRICING.input +
      (usage.outputTokens ?? 0) * COACH_PRICING.output +
      cacheRead * COACH_PRICING.cache_read +
      cacheWrite * COACH_PRICING.cache_write) /
    1_000_000
  );
}

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const text = m.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

function uiMessagesToCoachHistory(
  messages: UIMessage[],
): { role: 'client' | 'coach'; content: string }[] {
  const out: { role: 'client' | 'coach'; content: string }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const text = m.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim();
    if (!text) continue;
    out.push({ role: m.role === 'user' ? 'client' : 'coach', content: text });
  }
  return out;
}

/**
 * Build the coach's `messages` for streamText: identical to convertToModelMessages
 * EXCEPT the most-recent user text is replaced with the augmented form
 * (retrieval injection + optional safety reminder + bare user text).
 *
 * Rationale (per R-016 Answer 1 point 3 / eval/lib/conversation.ts:344-352):
 * the injection is "present-tense" — only this turn's user message sees the
 * augmented form. Older user messages stay bare, so subsequent turns don't
 * double-pay for stale retrievals AND we don't have to mutate the persisted
 * history (E-041's byte-equality round-trip persists what the client sent).
 */
async function buildModelMessages(args: {
  uiMessages: UIMessage[];
  retrievalInjection: string;
  safetyReminder: string;
  userText: string;
}): Promise<ModelMessage[]> {
  const base = await convertToModelMessages(args.uiMessages);
  const augmented = [args.safetyReminder, args.retrievalInjection, args.userText]
    .filter((s) => s.length > 0)
    .join('\n\n');
  // Locate the LAST user message and replace its content with the augmented form.
  for (let i = base.length - 1; i >= 0; i -= 1) {
    if (base[i].role === 'user') {
      const target = { ...base[i], content: augmented } as ModelMessage;
      return [...base.slice(0, i), target, ...base.slice(i + 1)];
    }
  }
  // No user message found — should not happen because the client always
  // appends one before submitting, but fail loud rather than silently coerce.
  throw new Error('No user message found in request payload to augment.');
}

/**
 * Call streamText once, fully drain the resulting UI stream into a buffer,
 * and capture the final answer text + usage so we can post-check safety and
 * track spend. We DO NOT use this for the production stream-to-client path —
 * see the createUIMessageStream block in POST for that — but it's the right
 * shape for the regeneration retry path, where we need to inspect the draft
 * before deciding whether to release it.
 */
async function generateCoachAnswer(args: {
  modelMessages: ModelMessage[];
}): Promise<{ text: string; usd: number }> {
  const result = streamText({
    model: openrouter(DEFAULT_COACH_MODEL),
    system: {
      role: 'system',
      content: SYSTEM_PROMPT,
      providerOptions: {
        // R-016 Answer 2: openrouter provider preserves Anthropic-style
        // cache_control. ~10x prompt-cost reduction at steady state.
        openrouter: { cacheControl: { type: 'ephemeral' } },
      },
    },
    messages: args.modelMessages,
  });
  // Drain by consuming the text-only stream.
  let text = '';
  for await (const delta of result.textStream) {
    text += delta;
  }
  const usage = await result.usage;
  const usd = computeCoachCost((usage ?? {}) as CoachUsageShape);
  recordSpend(usd);
  return { text, usd };
}

export async function POST(req: Request): Promise<Response> {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  if (!Array.isArray(body.messages)) {
    return new Response('messages must be an array', { status: 400 });
  }

  // Cost-cap circuit breaker (E-043 method step 5).
  const budget = checkBudget();
  if (!budget.allowed) {
    return new Response(budget.reason, {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const userText = lastUserText(body.messages);
  if (!userText) {
    return new Response('No user text to respond to', { status: 400 });
  }

  // SAFETY pre-scan on the latest user message (cheap regex; runs first).
  const triggers = preResponseScan(userText);
  const safetyReminder = buildSafetyReminder(triggers);

  // RETRIEVAL — graceful degradation per R-016 Answer 1 point 5. The history
  // we pass excludes the latest user message (it's `clientMessage` instead).
  let retrievalInjection = '';
  let attribution: ResourceAttribution = {
    resources: [],
    seeds: [],
    walker_model: 'claude-sonnet-4-6',
    total_cost_usd: 0,
    step_count: 0,
    stop_reason: 'no_seeds',
  };
  let retrievalError: string | null = null;
  try {
    const history = uiMessagesToCoachHistory(body.messages);
    // Drop the trailing client turn — it IS the clientMessage.
    if (history.length > 0 && history[history.length - 1].role === 'client') {
      history.pop();
    }
    const retrieval = await runRetrieval({
      clientMessage: userText,
      history,
    });
    retrievalInjection = retrieval.injection;
    attribution = retrieval.attribution;
    recordSpend(retrieval.costUsd);
  } catch (err) {
    retrievalError = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[chat] retrieval failed; degrading without injection:', retrievalError);
  }

  // Build coach messages (this is the augmented-user-message form; the
  // persisted history on the client remains bare).
  let modelMessages: ModelMessage[];
  try {
    modelMessages = await buildModelMessages({
      uiMessages: body.messages,
      retrievalInjection,
      safetyReminder,
      userText,
    });
  } catch (err) {
    return new Response(
      err instanceof Error ? err.message : 'Failed to build coach messages',
      { status: 400 },
    );
  }

  // ===========================================================================
  // STREAMING PATH — happy case (no safety regen). The coach answer streams
  // directly to the client. We attach the `data-resources` part BEFORE the
  // text begins so the indicator appears with the message rather than after.
  //
  // Safety POST-check is only meaningful in the regeneration loop (it inspects
  // the COMPLETE draft to decide whether to release it). For the streaming
  // path we trust the v1 prompt + the SAFETY REMINDER appended above to
  // produce a compliant answer. If triggers fired, we ALSO run the slow
  // generate→check→regenerate path below as a second-line guard against
  // crisis-non-recognition. This trades latency for safety on the small
  // fraction of turns where triggers fire.
  // ===========================================================================

  if (triggers.length > 0) {
    // SAFETY-CRITICAL PATH. We generate non-streaming so we can post-check
    // before committing the answer to the client. Slower (~3-8s without
    // streaming) but guarantees we can swap to a fallback if the draft fails
    // the safety check.
    return safetyRegenerationFlow({
      modelMessages,
      triggers,
      attribution,
      retrievalError,
    });
  }

  // HAPPY PATH — stream to the client with attribution attached.
  const stream = createUIMessageStream<CoachUIMessage>({
    execute: async ({ writer }) => {
      // Emit attribution FIRST so the client UI can render the indicator with
      // the message (per R-016 Answer 3 order-of-emission note).
      writer.write({
        type: 'data-resources',
        id: `resources-${Date.now()}`,
        data: attribution,
      });
      const result = streamText({
        model: openrouter(DEFAULT_COACH_MODEL),
        system: {
          role: 'system',
          content: SYSTEM_PROMPT,
          providerOptions: {
            openrouter: { cacheControl: { type: 'ephemeral' } },
          },
        },
        messages: modelMessages,
        onFinish: ({ usage }) => {
          // Record coach-turn cost on the cap. Walker cost already recorded.
          const usd = computeCoachCost((usage ?? {}) as CoachUsageShape);
          const total = recordSpend(usd);
          // eslint-disable-next-line no-console
          console.log(
            `[chat] turn done. coach=$${usd.toFixed(4)} ` +
              `retrieval=$${attribution.total_cost_usd.toFixed(4)} ` +
              `total=$${total.toFixed(4)} / $${getBudgetCapUsd().toFixed(2)}`,
          );
        },
      });
      writer.merge(result.toUIMessageStream<CoachUIMessage>());
    },
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.error('[chat] stream error', err);
      return err instanceof Error ? err.message : 'Unknown error';
    },
  });

  return createUIMessageStreamResponse({ stream });
}

/**
 * Safety regeneration flow: only invoked when preResponseScan returned at
 * least one trigger. We generate the answer non-streaming, post-check it,
 * regenerate once with a stronger reminder if it fails, and fall back to the
 * canned safety template if the regeneration also fails.
 *
 * Latency cost on this branch is ~5-15s before the client sees text — but
 * this branch fires on <1% of turns, and the cost is paid to make sure the
 * crisis-recognition contract is met (G-008 hard-fail).
 */
async function safetyRegenerationFlow(args: {
  modelMessages: ModelMessage[];
  triggers: ReturnType<typeof preResponseScan>;
  attribution: ResourceAttribution;
  retrievalError: string | null;
}): Promise<Response> {
  const { modelMessages, triggers, attribution } = args;
  let answer: { text: string; usd: number } | null = null;
  let lastReason: string | null = null;

  // First attempt — already has the SAFETY REMINDER injected in the user msg.
  try {
    answer = await generateCoachAnswer({ modelMessages });
  } catch (err) {
    lastReason = err instanceof Error ? err.message : String(err);
  }

  if (answer) {
    const check = postResponseCheck({ draft: answer.text, triggers });
    if (!check.ok) {
      lastReason = check.reason;
      // Regenerate ONCE with an even stronger reminder.
      const stronger: ModelMessage[] = [
        ...modelMessages,
        {
          role: 'user',
          content:
            `[SAFETY ESCALATION] Your previous draft failed the post-check: ${check.reason} ` +
            `Try again. You MUST name a specific resource (988, Crisis Text Line / 741741, ` +
            `a therapist, or an equivalent local crisis line) and you MUST ask whether the ` +
            `person is safe right now. Do this BEFORE any coaching move.`,
        },
      ];
      try {
        answer = await generateCoachAnswer({ modelMessages: stronger });
      } catch (err) {
        lastReason = err instanceof Error ? err.message : String(err);
        answer = null;
      }
      if (answer) {
        const recheck = postResponseCheck({ draft: answer.text, triggers });
        if (!recheck.ok) {
          lastReason = recheck.reason;
          // Fall back to the canned safety message.
          const matched = triggers.map((t) => t.matched).join(', ');
          answer = { text: SAFETY_FALLBACK_TEMPLATE(matched), usd: 0 };
          // eslint-disable-next-line no-console
          console.error(
            '[chat] safety regeneration failed twice; serving SAFETY_FALLBACK_TEMPLATE. last reason:',
            lastReason,
          );
        }
      }
    }
  }

  if (!answer) {
    // Total generation failure — serve the canned template so the user is
    // never left without the four required moves.
    const matched = triggers.map((t) => t.matched).join(', ');
    answer = { text: SAFETY_FALLBACK_TEMPLATE(matched), usd: 0 };
    // eslint-disable-next-line no-console
    console.error(
      '[chat] safety regen flow could not produce any draft; serving fallback. reason:',
      lastReason,
    );
  }

  const finalText = answer.text;
  const stream = createUIMessageStream<CoachUIMessage>({
    execute: async ({ writer }) => {
      writer.write({
        type: 'data-resources',
        id: `resources-${Date.now()}`,
        data: attribution,
      });
      // Synthesize a UI message stream that emits the entire answer as text.
      // We bypass streamText here because we already have the final text and
      // want to deliver it as a single block.
      const assistantId = `msg-${Date.now()}`;
      const partId = `text-${Date.now()}`;
      writer.write({ type: 'start', messageId: assistantId } as never);
      writer.write({ type: 'start-step' } as never);
      writer.write({ type: 'text-start', id: partId } as never);
      writer.write({ type: 'text-delta', id: partId, delta: finalText } as never);
      writer.write({ type: 'text-end', id: partId } as never);
      writer.write({ type: 'finish-step' } as never);
      writer.write({ type: 'finish' } as never);
      // eslint-disable-next-line no-console
      console.log(
        `[chat] safety-flow done. spent total $${getSpentUsd().toFixed(4)} / $${getBudgetCapUsd().toFixed(2)}`,
      );
    },
    onError: (err) => (err instanceof Error ? err.message : 'Unknown error'),
  });
  return createUIMessageStreamResponse({ stream });
}
