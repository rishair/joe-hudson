import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type ModelMessage,
  type UIMessage,
  type UIMessageStreamWriter,
} from 'ai';
import { openrouter } from '@/app/lib/openrouter';
import { runRetrieval } from '@/app/lib/coach/retriever';
import {
  resolveCoachProfile,
  type CoachProfile,
} from '@/app/lib/coach/profiles';
import {
  preResponseScan,
  postResponseCheck,
  buildSafetyReminder,
  SAFETY_FALLBACK_TEMPLATE,
} from '@/app/lib/coach/safety';
import { checkBudget, recordSpend, getSpentUsd, getBudgetCapUsd } from '@/app/lib/coach/cost-cap';
import type {
  CoachUIMessage,
  ProgressEvent,
  ResourceAttribution,
} from '@/app/lib/coach/types';

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
  /** G-014 (E-054): which coach variant should answer this turn. Optional;
   *  an unknown / missing id resolves to the `v5b` baseline via
   *  `resolveCoachProfile`, so older clients and bad payloads degrade
   *  gracefully rather than 500-ing. */
  coachProfile?: unknown;
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
 * Helper that wraps the progress emission so all stages share the same id
 * shape (`progress-<timestamp>-<seq>`). Each `writer.write` of a `data-*`
 * part is independent — having distinct ids per event makes the client a
 * simple "show the latest progress part" rather than dealing with merging.
 *
 * E-047: this is the single place where progress flows out to the wire. The
 * `runRetrieval` callback funnels here; safety-regen funnels here directly.
 */
function makeProgressEmitter(writer: UIMessageStreamWriter<CoachUIMessage>): {
  emit: (event: ProgressEvent) => void;
} {
  let seq = 0;
  return {
    emit: (event: ProgressEvent) => {
      seq += 1;
      writer.write({
        type: 'data-progress',
        id: `progress-${Date.now()}-${seq}`,
        data: event,
      });
    },
  };
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
  profile: CoachProfile;
}): Promise<{ text: string; usd: number }> {
  const result = streamText({
    model: openrouter(args.profile.coachModel),
    system: {
      role: 'system',
      content: args.profile.systemPrompt,
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

  // G-014 (E-054): pick the coach variant for this turn. `resolveCoachProfile`
  // never throws — an unknown / missing id degrades to the `v5b` baseline, so
  // the four selectable variants ALL flow through the same server path; the
  // system prompt (and, in principle, coach model + retrieval params) is the
  // only thing that changes between them. Retrieval is held at the v5b
  // substrate for all four by construction (E-053: every profile's
  // retrievalParams reference the same V5B_CONFIG), so `runRetrieval` is left
  // unchanged and the prompt is provably the only variable.
  const profile = resolveCoachProfile(body.coachProfile);

  // Cost-cap circuit breaker (E-043 method step 5). Runs before the stream
  // opens so a budget-exceeded user gets a fast 503 rather than a sad SSE.
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

  // E-047 — progressive streaming. The UI message stream opens NOW (before
  // retrieval runs), so the first byte hits the wire in <500ms. Retrieval +
  // safety + coach all run inside `execute`, emitting `data-progress` parts
  // as they go.
  //
  // Order on the wire:
  //   1. data-progress (analyzing)
  //   2. data-progress (retrieving)
  //   3. data-progress (walking, step 1..N)
  //   4. data-resources (final attribution)
  //   5. data-progress (composing) — fires JUST before the text stream
  //   6. text-start / text-delta* / text-end (coach answer)
  //
  // The client renders the LATEST progress part as an inline status line
  // (small gray italic) that disappears once text-delta events arrive.
  const stream = createUIMessageStream<CoachUIMessage>({
    execute: async ({ writer }) => {
      const { emit } = makeProgressEmitter(writer);

      // SAFETY pre-scan on the latest user message (cheap regex; runs first).
      const triggers = preResponseScan(userText);
      const safetyReminder = buildSafetyReminder(triggers);

      // RETRIEVAL — graceful degradation per R-016 Answer 1 point 5. The
      // history we pass excludes the latest user message (it's clientMessage).
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
          onProgress: emit,
        });
        retrievalInjection = retrieval.injection;
        attribution = retrieval.attribution;
        recordSpend(retrieval.costUsd);
      } catch (err) {
        retrievalError = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error('[chat] retrieval failed; degrading without injection:', retrievalError);
      }

      // Build coach messages (augmented-user-message form; the persisted
      // history on the client remains bare).
      let modelMessages: ModelMessage[];
      try {
        modelMessages = await buildModelMessages({
          uiMessages: body.messages,
          retrievalInjection,
          safetyReminder,
          userText,
        });
      } catch (err) {
        // Emit a final progress-like signal and throw so onError formats it.
        throw err instanceof Error ? err : new Error(String(err));
      }

      // Emit attribution BEFORE the text stream so the client UI can render
      // the indicator with the message (per R-016 Answer 3 order-of-emission
      // note). This stays AFTER the walking progress events but BEFORE the
      // composing event, so the indicator appears just before the answer.
      writer.write({
        type: 'data-resources',
        id: `resources-${Date.now()}`,
        data: attribution,
      });

      // G-014 (E-054) — persistence tagging. Emit which coach variant produced
      // this answer as a `data-variant` part. It rides inside the assistant
      // message's `parts`, so E-041's byte-equality round-trip persists it with
      // no schema change; a reloaded conversation shows which variant replied.
      writer.write({
        type: 'data-variant',
        id: `variant-${Date.now()}`,
        data: { id: profile.id, label: profile.label },
      });

      if (triggers.length > 0) {
        // SAFETY-CRITICAL PATH. We generate non-streaming so we can post-check
        // before committing the answer to the client. Slower (~3-8s without
        // streaming) but guarantees we can swap to a fallback if the draft
        // fails the safety check.
        await runSafetyRegenInline({
          writer,
          emit,
          modelMessages,
          triggers,
          profile,
        });
        return;
      }

      // HAPPY PATH — final progress event, then merge in the coach stream.
      emit({ stage: 'composing', message: 'Composing response' });

      const result = streamText({
        model: openrouter(profile.coachModel),
        system: {
          role: 'system',
          content: profile.systemPrompt,
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
            `[chat] turn done. profile=${profile.id} ` +
              `coach=$${usd.toFixed(4)} ` +
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
 * Safety regeneration, inlined into the streaming writer so it emits
 * progress events as it advances. Mirrors the standalone
 * `safetyRegenerationFlow` shape but writes directly to `writer` instead of
 * building a second Response.
 *
 * Order on the wire (in addition to the analyzing/retrieving/walking events
 * already emitted upstream of this call):
 *   - data-progress (composing, 'Considering safety')
 *   - data-progress (composing, 'Regenerating with stronger safety reminder') if first draft fails
 *   - data-progress (composing, 'Serving safety fallback') if regen also fails
 *   - text-start / text-delta (single block) / text-end
 *
 * The final answer is delivered as ONE text-delta (not token-by-token) — we
 * already have the full text and the safety post-check is the load-bearing
 * gate. Streaming token-by-token here would re-introduce the risk of
 * partial-draft non-recognition that the post-check exists to prevent.
 */
async function runSafetyRegenInline(args: {
  writer: UIMessageStreamWriter<CoachUIMessage>;
  emit: (event: ProgressEvent) => void;
  modelMessages: ModelMessage[];
  triggers: ReturnType<typeof preResponseScan>;
  profile: CoachProfile;
}): Promise<void> {
  const { writer, emit, modelMessages, triggers, profile } = args;

  emit({ stage: 'composing', message: 'Considering safety' });

  let answer: { text: string; usd: number } | null = null;
  let lastReason: string | null = null;

  try {
    answer = await generateCoachAnswer({ modelMessages, profile });
  } catch (err) {
    lastReason = err instanceof Error ? err.message : String(err);
  }

  if (answer) {
    const check = postResponseCheck({ draft: answer.text, triggers });
    if (!check.ok) {
      lastReason = check.reason;
      emit({
        stage: 'composing',
        message: 'Regenerating with stronger safety reminder',
      });
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
        answer = await generateCoachAnswer({ modelMessages: stronger, profile });
      } catch (err) {
        lastReason = err instanceof Error ? err.message : String(err);
        answer = null;
      }
      if (answer) {
        const recheck = postResponseCheck({ draft: answer.text, triggers });
        if (!recheck.ok) {
          lastReason = recheck.reason;
          emit({ stage: 'composing', message: 'Serving safety fallback' });
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
    emit({ stage: 'composing', message: 'Serving safety fallback' });
    const matched = triggers.map((t) => t.matched).join(', ');
    answer = { text: SAFETY_FALLBACK_TEMPLATE(matched), usd: 0 };
    // eslint-disable-next-line no-console
    console.error(
      '[chat] safety regen flow could not produce any draft; serving fallback. reason:',
      lastReason,
    );
  }

  const finalText = answer.text;
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
}
