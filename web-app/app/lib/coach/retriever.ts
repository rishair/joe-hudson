import 'server-only';

import { retrieveByGuidedWalk } from './guided-walk';
import { loadCompendium } from './graph-walk';
import type { ResourceAttribution } from './types';

// E-043 / R-016 Answer 1: thin replacement for eval/lib/retrieval-adapter.ts's
// `buildGuidedWalkRetriever`. The multi-strategy switch is gone (the web-app
// only runs v5b in v1). Web-app v5b config baked in: walker = sonnet, seed =
// haiku, k_max = 7, step_budget = 8, max_edges_per_step = 4, variant = v5b.

export const V5B_CONFIG = {
  walkerModel: 'claude-sonnet-4-6',
  seedModel: 'claude-haiku-4-5',
  kMax: 7,
  stepBudget: 8,
  maxEdgesPerStep: 4,
  walkerVariant: 'v5b' as const,
};

export interface RetrievalResult {
  /** The retrieval block to prepend to the user message. May be "" if no seeds. */
  injection: string;
  /** Attribution payload to emit as a `data-resources` part on the assistant message. */
  attribution: ResourceAttribution;
  /** Aggregated retrieval cost (seed + walker) for circuit-breaker accounting. */
  costUsd: number;
  /** Wall-clock retrieval latency for telemetry. */
  ms: number;
}

/**
 * Run v5b retrieval for one coach turn. Slices history to the last 4 turns
 * (matches eval/lib/retrieval-adapter.ts:139). Throws on infrastructure
 * failure (the route handler catches and logs telemetry per R-016 Answer 1
 * point 5).
 */
export async function runRetrieval(args: {
  clientMessage: string;
  history: { role: 'client' | 'coach'; content: string }[];
}): Promise<RetrievalResult> {
  const t0 = Date.now();
  const recentHistory = args.history.slice(-4);
  const result = await retrieveByGuidedWalk({
    clientMessage: args.clientMessage,
    recentHistory,
    walkerModel: V5B_CONFIG.walkerModel,
    seedModel: V5B_CONFIG.seedModel,
    walkerVariant: V5B_CONFIG.walkerVariant,
    kMax: V5B_CONFIG.kMax,
    stepBudget: V5B_CONFIG.stepBudget,
    maxEdgesPerStep: V5B_CONFIG.maxEdgesPerStep,
  });

  const compendium = loadCompendium();
  const attribution: ResourceAttribution = {
    resources: result.telemetry.bundle_ids.map((id, idx) => {
      const entry = compendium.catalog.get(id);
      return {
        slug: id,
        category: entry?.category ?? 'unknown',
        title: entry?.title ?? id,
        walker_reason: result.telemetry.bundle_reasons[idx] ?? '',
      };
    }),
    seeds: result.telemetry.seeds,
    walker_model: result.telemetry.walker_model,
    total_cost_usd: result.telemetry.total_cost_usd,
    step_count: result.telemetry.step_count,
    stop_reason: result.telemetry.stop_reason,
  };

  return {
    injection: result.injection,
    attribution,
    costUsd: result.telemetry.total_cost_usd,
    ms: Date.now() - t0,
  };
}
