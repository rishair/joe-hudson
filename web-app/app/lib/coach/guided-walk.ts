/**
 * Model-guided graph walk over the ingested wiki — lifted from
 * coach-app/retrieval/guided-walk.ts per R-016 Answer 4 (strategy b).
 *
 * Adaptation deltas from the source:
 *   - `REPO_ROOT` removed (now lives in graph-walk.ts via getWikiRoot()).
 *   - `.ts` extension imports replaced with extensionless for Webpack/Turbopack.
 *   - Re-exports + behavior otherwise byte-identical to the E-038 v5b walker.
 *
 * Defaults: walker_variant = "v5b", k_max = 7, step_budget = 8,
 * max_edges_per_step = 4. The web-app passes walker_model = "claude-sonnet-4-6"
 * (E-038 / v5b) via the retriever.
 */

import { generateText, tool } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

import {
  detectSeeds,
  loadCompendium,
  readFileBody,
  type SeedCatalogEntry,
} from './graph-walk';

// ---------------- Walker pricing ----------------

const PRICING: Record<
  string,
  { input: number; output: number; cache_read: number; cache_write: number }
> = {
  'claude-haiku-4-5': { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
  'claude-sonnet-4-6': { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  'claude-opus-4-7': { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
};

function computeCost(
  model: string,
  usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number },
): number {
  const p = PRICING[model] ?? PRICING['claude-haiku-4-5'];
  return (
    ((usage.input ?? 0) * p.input +
      (usage.output ?? 0) * p.output +
      (usage.cacheRead ?? 0) * p.cache_read +
      (usage.cacheWrite ?? 0) * p.cache_write) /
    1_000_000
  );
}

function parseForwardRelated(body: string): string[] {
  if (!body) return [];
  const fmEnd = body.indexOf('\n---', 4);
  const fm = fmEnd > 0 ? body.slice(0, fmEnd) : body.slice(0, 2000);
  const m = fm.match(/^related:\s*\[(.*?)\]/m);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, '').trim())
    .filter((s) => s.length > 0);
}

// ---------------- Per-step decision schema ----------------

const STEP_DECISION_SCHEMA = z.object({
  add_to_bundle: z.boolean().describe(
    "TRUE if this file's content is directly relevant to the client's presenting material — Joe would use it in this turn. FALSE if it's tangentially related, too general (a hub like 'vulnerability' or 'shame-drives-behavior'), or already covered by another bundle file.",
  ),
  bundle_reason: z.string().min(3).max(200).describe(
    "One short sentence: why keep or skip. Concrete reference to the client's situation.",
  ),
  follow_edges: z.array(z.string().regex(/^[a-z0-9-]+$/)).max(8).describe(
    'Subset of the candidate edges (from the candidate_edges list provided) to add to the frontier. Pick edges that are coaching-relevant given what the client has shared. Empty array if none look promising. Max 8.',
  ),
  follow_reason: z.string().min(3).max(200).describe(
    'One short sentence: why these specific edges, or why none.',
  ),
});

type StepDecision = z.infer<typeof STEP_DECISION_SCHEMA>;

interface PerStepTelemetry {
  step: number;
  file_id: string;
  file_path: string;
  category: string;
  candidate_edges: string[];
  decision: StepDecision;
  kept_in_bundle: boolean;
  edges_followed: string[];
  edges_skipped: string[];
  cost_usd: number;
  ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

// ---------------- Walker config ----------------

export type WalkerVariant = 'v5b' | 'depth-aware';

export interface WalkerConfig {
  model: string;
  kMax: number;
  stepBudget: number;
  maxEdgesPerStep: number;
  variant: WalkerVariant;
  apiKey?: string;
  profile_id?: string;
}

const DEFAULT_WALKER_CONFIG: Omit<WalkerConfig, 'apiKey' | 'profile_id'> = {
  model: 'claude-haiku-4-5',
  kMax: 7,
  stepBudget: 8,
  maxEdgesPerStep: 4,
  variant: 'v5b',
};

// ---------------- Walker system prompts ----------------

const WALKER_SYSTEM = `You are a retrieval planner for a Joe Hudson coaching system.

You navigate a hand-curated knowledge graph of AoA coaching content. Each file's frontmatter has a "related:" array of edges to other files. Your job, ONE FILE AT A TIME, is two decisions:

DECISION A (add_to_bundle):
- Add files whose CONTENT (not just topic) is what Joe would actually draw on for the client's specific situation in this turn.
- SKIP files that are too general/hub-like (e.g., "vulnerability", "shame-drives-behavior", "feeling-the-unfelt-emotion" unless directly central to the moment), redundant with a bundle file you already kept, or only tangentially adjacent.
- The bundle is a small smorgasbord (max 7 files). Be selective. The coach reads the whole bundle and chooses what to use; your job is to give them the right shortlist, not a long list.

DECISION B (follow_edges):
- From the CANDIDATE EDGES (already filtered to "not yet visited, not yet in bundle"), choose the ones whose NAMES suggest they would be coaching-relevant given what the client has shared.
- It's fine to follow edges from a file you DIDN'T add to the bundle (it might be a useful waypoint) or to skip edges from one you DID add (you're done with that branch).
- Max 4 per step. Cheaper is better — don't follow edges speculatively.
- Empty array is a valid answer if the edges don't look promising.

Style: terse rationales. One sentence each. Reference the client's situation concretely.`;

const WALKER_SYSTEM_DEPTH_AWARE = `You are a retrieval planner for a Joe Hudson coaching system.

You navigate a hand-curated knowledge graph of AoA coaching content. Each file's frontmatter has a "related:" array of edges to other files. Your job, ONE FILE AT A TIME, is two decisions:

DECISION A (add_to_bundle):
- Add files whose CONTENT (not just topic) is what Joe would actually draw on for the client's specific situation in this turn.
- ALSO add files that could give the coach material to go DEEPER — not only files that name the central concept the client just stated. A file that names the texture underneath (numbness, somatic shutdown, the body's reading, the felt-sense of avoidance, the layer beneath the presenting story) is depth-enabling even when the client has not yet named that texture themselves. Joe routinely needs the layer the client cannot yet see. Keep depth-enabling files.
- A file is also worth keeping if it offers a precise distinction the coach might draw (e.g., "boundary-with-vs-boundary-against", "love-vs-nice") or a specific signature move with a fit-condition the current moment plausibly matches.
- SKIP files that are too general/hub-like (e.g., "vulnerability", "shame-drives-behavior", "feeling-the-unfelt-emotion" unless directly central to the moment), redundant with a bundle file you already kept, or wholly off-topic.
- "Tangentially adjacent" is NOT a sufficient reason to skip — if a file's content names a texture, a layer, a distinction, or a move that the coach could plausibly use in the next 1-3 turns of this conversation, keep it. The bundle is the coach's working set, not a strict relevance shortlist.
- The bundle is a smorgasbord (max 7 files). Aim for breadth-with-discrimination: keep the files the coach might draw on; skip the files that are off-frame or duplicative. When in doubt, lean toward keep — the coach can ignore a file but cannot use one that was not surfaced.

DECISION B (follow_edges):
- From the CANDIDATE EDGES (already filtered to "not yet visited, not yet in bundle"), choose the ones whose NAMES suggest they would be coaching-relevant given what the client has shared.
- It's fine to follow edges from a file you DIDN'T add to the bundle (it might be a useful waypoint) or to skip edges from one you DID add (you're done with that branch).
- Max 4 per step. Cheaper is better — don't follow edges speculatively.
- Empty array is a valid answer if the edges don't look promising.

Style: terse rationales. One sentence each. Reference the client's situation concretely.`;

// ---------------- Walker call ----------------

interface WalkerCallArgs {
  walker: WalkerConfig;
  clientMessage: string;
  recentHistory: { role: 'client' | 'coach'; content: string }[];
  fileId: string;
  filePath: string;
  fileCategory: string;
  fileBody: string;
  candidateEdges: string[];
  bundleSoFar: { id: string; reason: string }[];
}

interface WalkerCallResult extends StepDecision {
  cost_usd: number;
  ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

async function callWalker(args: WalkerCallArgs): Promise<WalkerCallResult> {
  const apiKey = args.walker.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }
  const anthropic = createAnthropic({ apiKey });

  const lines: string[] = [];
  lines.push('CLIENT SITUATION');
  if (args.recentHistory.length > 0) {
    lines.push('Recent conversation:');
    for (const t of args.recentHistory.slice(-4)) {
      const role = t.role === 'client' ? 'Client' : 'Coach';
      lines.push(`${role}: ${t.content}`);
    }
    lines.push('');
  }
  lines.push(`Current client message:\n${args.clientMessage}`);
  lines.push('');

  if (args.bundleSoFar.length > 0) {
    lines.push('BUNDLE SO FAR (already kept by you):');
    for (const b of args.bundleSoFar) {
      lines.push(`- ${b.id}: ${b.reason}`);
    }
    lines.push('');
  } else {
    lines.push('BUNDLE SO FAR: (empty)');
    lines.push('');
  }

  lines.push(`FILE UNDER REVIEW: ${args.filePath} (category=${args.fileCategory})`);
  lines.push('');
  lines.push(args.fileBody.trim().slice(0, 8000));
  lines.push('');

  if (args.candidateEdges.length > 0) {
    lines.push('CANDIDATE EDGES (not yet visited or in bundle):');
    for (const e of args.candidateEdges) lines.push(`- ${e}`);
  } else {
    lines.push('CANDIDATE EDGES: (none — all already visited or in bundle)');
  }

  const userText = lines.join('\n');

  const stepTool = tool({
    description:
      'Return your decision for this file: whether to add it to the retrieval bundle, and which of its candidate edges (if any) to add to the frontier.',
    inputSchema: STEP_DECISION_SCHEMA,
    execute: async (input) => input,
  });

  const t0 = Date.now();
  const maxRetries = 3;
  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt <= maxRetries) {
    try {
      const systemContent =
        args.walker.variant === 'depth-aware' ? WALKER_SYSTEM_DEPTH_AWARE : WALKER_SYSTEM;
      const result = await generateText({
        model: anthropic(args.walker.model),
        system: {
          role: 'system',
          content: systemContent,
          providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
        },
        messages: [{ role: 'user', content: userText }],
        tools: { walker_decision: stepTool },
        toolChoice: { type: 'tool', toolName: 'walker_decision' },
        temperature: 0.2,
        maxOutputTokens: 512,
      });

      let payload: StepDecision | null = null;
      const tryExtract = (
        obj: Record<string, unknown> | undefined,
      ): StepDecision | null => {
        if (!obj) return null;
        const candidate = ((obj as { output?: unknown }).output ??
          (obj as { result?: unknown }).result ??
          (obj as { input?: unknown }).input) as
          | Partial<StepDecision>
          | undefined;
        if (!candidate) return null;
        if (typeof candidate.add_to_bundle !== 'boolean') return null;
        return {
          add_to_bundle: candidate.add_to_bundle,
          bundle_reason:
            typeof candidate.bundle_reason === 'string'
              ? candidate.bundle_reason
              : '(no rationale provided)',
          follow_edges: Array.isArray(candidate.follow_edges)
            ? candidate.follow_edges.filter(
                (s): s is string => typeof s === 'string',
              )
            : [],
          follow_reason:
            typeof candidate.follow_reason === 'string'
              ? candidate.follow_reason
              : '(no rationale provided)',
        };
      };

      const toolResults = (result as unknown as {
        toolResults?: Array<{ toolName: string } & Record<string, unknown>>;
      }).toolResults ?? [];
      for (const tr of toolResults) {
        if (tr.toolName === 'walker_decision') {
          payload = tryExtract(tr);
          if (payload) break;
        }
      }
      if (!payload) {
        const toolCalls = (result as unknown as {
          toolCalls?: Array<{ toolName: string } & Record<string, unknown>>;
        }).toolCalls ?? [];
        for (const tc of toolCalls) {
          if (tc.toolName === 'walker_decision') {
            payload = tryExtract(tc);
            if (payload) break;
          }
        }
      }
      if (!payload) {
        const steps = (result as unknown as {
          steps?: Array<{
            content?: Array<{ type: string; toolName?: string } & Record<string, unknown>>;
          }>;
        }).steps ?? [];
        for (const step of steps) {
          for (const c of step.content ?? []) {
            if (
              (c.type === 'tool-result' || c.type === 'tool-call') &&
              c.toolName === 'walker_decision'
            ) {
              payload = tryExtract(c);
              if (payload) break;
            }
          }
          if (payload) break;
        }
      }
      if (!payload) {
        payload = {
          add_to_bundle: false,
          bundle_reason: '(no walker tool result captured — defensive skip)',
          follow_edges: [],
          follow_reason: '(no walker tool result captured)',
        };
      }

      const pmAnth = (result as unknown as {
        providerMetadata?: { anthropic?: { usage?: Record<string, number> } };
      }).providerMetadata?.anthropic?.usage;
      const flat = result.usage as unknown as Record<string, number | undefined>;
      const inTok = pmAnth?.input_tokens ?? flat?.inputTokens ?? flat?.input_tokens ?? 0;
      const outTok = pmAnth?.output_tokens ?? flat?.outputTokens ?? flat?.output_tokens ?? 0;
      const cacheRead =
        pmAnth?.cache_read_input_tokens ??
        flat?.cachedInputTokens ??
        flat?.cache_read_input_tokens ??
        0;
      const cacheWrite =
        pmAnth?.cache_creation_input_tokens ?? flat?.cache_creation_input_tokens ?? 0;

      const cost_usd = computeCost(args.walker.model, {
        input: inTok,
        output: outTok,
        cacheRead,
        cacheWrite,
      });

      return {
        ...payload,
        cost_usd,
        ms: Date.now() - t0,
        input_tokens: inTok,
        output_tokens: outTok,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite,
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
        const base = Math.min(15_000, 1000 * 2 ** attempt);
        const wait = base + Math.floor(Math.random() * 500);
        await new Promise((r) => setTimeout(r, wait));
        attempt += 1;
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error('walker call retry exhausted');
}

// ---------------- Public retrieve() ----------------

export interface GuidedWalkRetrievalArgs {
  clientMessage: string;
  recentHistory: { role: 'client' | 'coach'; content: string }[];
  walkerModel?: string;
  seedModel?: string;
  walkerVariant?: WalkerVariant;
  kMax?: number;
  stepBudget?: number;
  maxEdgesPerStep?: number;
  apiKey?: string;
  profile_id?: string;
}

export interface GuidedWalkRetrievalResult {
  injection: string;
  telemetry: {
    seeds: string[];
    rejected_seeds: string[];
    seed_rationale: string;
    bundle_ids: string[];
    bundle_paths: string[];
    bundle_reasons: string[];
    steps: PerStepTelemetry[];
    walker_model: string;
    walker_variant: WalkerVariant;
    seed_detection_cost_usd: number;
    walker_total_cost_usd: number;
    total_cost_usd: number;
    seed_detection_input_tokens: number;
    seed_detection_output_tokens: number;
    seed_detection_cache_read_tokens: number;
    seed_detection_cache_write_tokens: number;
    walker_total_input_tokens: number;
    walker_total_output_tokens: number;
    walker_total_cache_read_tokens: number;
    walker_total_cache_write_tokens: number;
    seed_detection_ms: number;
    walker_total_ms: number;
    step_count: number;
    bundle_acceptance_rate: number;
    stop_reason: 'bundle_full' | 'frontier_empty' | 'step_budget_exhausted' | 'no_seeds';
  };
}

const RETRIEVAL_HEADER =
  'RETRIEVED CONTEXT (model-guided graph navigation; a Haiku/Sonnet walker chose these files from coach/ as a small smorgasbord for this turn; draw on them to ground your reading and move selection; do not announce that you are retrieving):';

export async function retrieveByGuidedWalk(
  args: GuidedWalkRetrievalArgs,
): Promise<GuidedWalkRetrievalResult> {
  const walker: WalkerConfig = {
    model: args.walkerModel ?? DEFAULT_WALKER_CONFIG.model,
    kMax: args.kMax ?? DEFAULT_WALKER_CONFIG.kMax,
    stepBudget: args.stepBudget ?? DEFAULT_WALKER_CONFIG.stepBudget,
    maxEdgesPerStep: args.maxEdgesPerStep ?? DEFAULT_WALKER_CONFIG.maxEdgesPerStep,
    variant: args.walkerVariant ?? DEFAULT_WALKER_CONFIG.variant,
    apiKey: args.apiKey,
    profile_id: args.profile_id,
  };

  const seedResult = await detectSeeds({
    clientMessage: args.clientMessage,
    recentHistory: args.recentHistory,
    model: args.seedModel ?? 'claude-haiku-4-5',
    apiKey: args.apiKey,
  });

  const compendium = await loadCompendium();

  if (seedResult.seeds.length === 0) {
    return {
      injection: '',
      telemetry: {
        seeds: [],
        rejected_seeds: seedResult.rejected,
        seed_rationale: seedResult.rationale,
        bundle_ids: [],
        bundle_paths: [],
        bundle_reasons: [],
        steps: [],
        walker_model: walker.model,
        walker_variant: walker.variant,
        seed_detection_cost_usd: seedResult.cost_usd,
        walker_total_cost_usd: 0,
        total_cost_usd: seedResult.cost_usd,
        seed_detection_input_tokens: seedResult.input_tokens,
        seed_detection_output_tokens: seedResult.output_tokens,
        seed_detection_cache_read_tokens: seedResult.cache_read_input_tokens,
        seed_detection_cache_write_tokens: seedResult.cache_creation_input_tokens,
        walker_total_input_tokens: 0,
        walker_total_output_tokens: 0,
        walker_total_cache_read_tokens: 0,
        walker_total_cache_write_tokens: 0,
        seed_detection_ms: seedResult.ms,
        walker_total_ms: 0,
        step_count: 0,
        bundle_acceptance_rate: 0,
        stop_reason: 'no_seeds',
      },
    };
  }

  const frontier: string[] = [...seedResult.seeds];
  const visited = new Set<string>();
  const inFrontier = new Set<string>(seedResult.seeds);
  const bundle: { id: string; reason: string }[] = [];
  const bundleSet = new Set<string>();
  const steps: PerStepTelemetry[] = [];

  let stopReason: 'bundle_full' | 'frontier_empty' | 'step_budget_exhausted' =
    'frontier_empty';

  let walkerTotalCost = 0;
  let walkerInTok = 0;
  let walkerOutTok = 0;
  let walkerCacheRead = 0;
  let walkerCacheWrite = 0;
  let walkerTotalMs = 0;

  for (let step = 0; step < walker.stepBudget; step += 1) {
    if (bundle.length >= walker.kMax) {
      stopReason = 'bundle_full';
      break;
    }
    if (frontier.length === 0) {
      stopReason = 'frontier_empty';
      break;
    }

    const nextId = frontier.shift()!;
    inFrontier.delete(nextId);
    if (visited.has(nextId)) continue;
    visited.add(nextId);

    const entry: SeedCatalogEntry | undefined = compendium.catalog.get(nextId);
    if (!entry) {
      continue;
    }
    const body = await readFileBody(nextId);
    if (!body) {
      continue;
    }

    const forward = parseForwardRelated(body);
    const incoming = compendium.backlinks.get(nextId) ?? [];
    const allEdges = new Set<string>([...forward, ...incoming]);
    const candidateEdges: string[] = [];
    for (const e of allEdges) {
      if (visited.has(e)) continue;
      if (inFrontier.has(e)) continue;
      if (bundleSet.has(e)) continue;
      if (!compendium.catalog.has(e)) continue;
      candidateEdges.push(e);
    }
    candidateEdges.sort();
    const candidatePresented = candidateEdges.slice(0, 30);

    const dec = await callWalker({
      walker,
      clientMessage: args.clientMessage,
      recentHistory: args.recentHistory,
      fileId: nextId,
      filePath: entry.path,
      fileCategory: entry.category,
      fileBody: body,
      candidateEdges: candidatePresented,
      bundleSoFar: bundle,
    });

    walkerTotalCost += dec.cost_usd;
    walkerInTok += dec.input_tokens;
    walkerOutTok += dec.output_tokens;
    walkerCacheRead += dec.cache_read_input_tokens;
    walkerCacheWrite += dec.cache_creation_input_tokens;
    walkerTotalMs += dec.ms;

    const candidateSet = new Set(candidatePresented);
    const edgesFollowed = dec.follow_edges.filter((e) => candidateSet.has(e));
    const edgesSkipped = candidatePresented.filter((e) => !edgesFollowed.includes(e));

    let kept = dec.add_to_bundle;
    if (kept && bundle.length >= walker.kMax) {
      kept = false;
    }
    if (kept) {
      bundle.push({ id: nextId, reason: dec.bundle_reason });
      bundleSet.add(nextId);
    }

    for (const e of edgesFollowed) {
      if (!visited.has(e) && !inFrontier.has(e) && !bundleSet.has(e)) {
        frontier.push(e);
        inFrontier.add(e);
      }
    }

    steps.push({
      step,
      file_id: nextId,
      file_path: entry.path,
      category: entry.category,
      candidate_edges: candidatePresented,
      decision: {
        add_to_bundle: dec.add_to_bundle,
        bundle_reason: dec.bundle_reason,
        follow_edges: dec.follow_edges,
        follow_reason: dec.follow_reason,
      },
      kept_in_bundle: kept,
      edges_followed: edgesFollowed,
      edges_skipped: edgesSkipped,
      cost_usd: dec.cost_usd,
      ms: dec.ms,
      input_tokens: dec.input_tokens,
      output_tokens: dec.output_tokens,
      cache_read_input_tokens: dec.cache_read_input_tokens,
      cache_creation_input_tokens: dec.cache_creation_input_tokens,
    });
  }

  if (steps.length >= walker.stepBudget && bundle.length < walker.kMax && frontier.length > 0) {
    stopReason = 'step_budget_exhausted';
  }
  if (bundle.length >= walker.kMax) stopReason = 'bundle_full';
  if (frontier.length === 0 && bundle.length < walker.kMax) stopReason = 'frontier_empty';

  const lines: string[] = [];
  if (bundle.length > 0) {
    lines.push(RETRIEVAL_HEADER);
    const seedLabels = seedResult.seeds.map((s) => {
      const e = compendium.catalog.get(s);
      return e ? `${e.category}/${s}` : s;
    });
    lines.push(`(seeds detected: ${seedLabels.join(', ')})`);
    lines.push('');
    for (const b of bundle) {
      const e = compendium.catalog.get(b.id);
      const path = e?.path ?? `unknown/${b.id}.md`;
      const body = await readFileBody(b.id);
      if (!body) continue;
      lines.push(`--- ${path} (walker_reason: ${b.reason}) ---`);
      lines.push(body.trim());
      lines.push('');
    }
  }
  const injection = lines.join('\n');

  const acceptanceRate =
    steps.length === 0
      ? 0
      : steps.filter((s) => s.kept_in_bundle).length / steps.length;

  return {
    injection,
    telemetry: {
      seeds: seedResult.seeds,
      rejected_seeds: seedResult.rejected,
      seed_rationale: seedResult.rationale,
      bundle_ids: bundle.map((b) => b.id),
      bundle_paths: bundle.map(
        (b) => compendium.catalog.get(b.id)?.path ?? `unknown/${b.id}.md`,
      ),
      bundle_reasons: bundle.map((b) => b.reason),
      steps,
      walker_model: walker.model,
      walker_variant: walker.variant,
      seed_detection_cost_usd: seedResult.cost_usd,
      walker_total_cost_usd: walkerTotalCost,
      total_cost_usd: seedResult.cost_usd + walkerTotalCost,
      seed_detection_input_tokens: seedResult.input_tokens,
      seed_detection_output_tokens: seedResult.output_tokens,
      seed_detection_cache_read_tokens: seedResult.cache_read_input_tokens,
      seed_detection_cache_write_tokens: seedResult.cache_creation_input_tokens,
      walker_total_input_tokens: walkerInTok,
      walker_total_output_tokens: walkerOutTok,
      walker_total_cache_read_tokens: walkerCacheRead,
      walker_total_cache_write_tokens: walkerCacheWrite,
      seed_detection_ms: seedResult.ms,
      walker_total_ms: walkerTotalMs,
      step_count: steps.length,
      bundle_acceptance_rate: acceptanceRate,
      stop_reason: stopReason,
    },
  };
}
