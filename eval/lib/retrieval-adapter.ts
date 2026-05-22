/**
 * Adapter between coach-config `retrieval.strategy` and the conversation
 * runner's CoachRetriever interface.
 *
 * Each retrieval strategy lives in `coach-app/retrieval/<strategy>.ts` (the
 * actual algorithms). This module is the thin glue that:
 *   - Reads `coachConfig.retrieval.strategy` and `coachConfig.retrieval.config`
 *   - Imports the right strategy lazily
 *   - Returns a CoachRetriever closure the conversation runner can call per
 *     coach turn
 *
 * Returning `undefined` for `strategy: "none"` lets the runner skip the
 * retrieval branch entirely. The retrieval-cost call records pushed onto
 * `api.callLog` carry a `retrieval:<strategy>:<profile>:t<turn>` purpose so
 * cost reporting separates retrieval from coach/judge spend.
 */

import type { CoachConfig } from "./schemas.ts";
import type { CoachRetriever } from "./conversation.ts";

export function buildRetriever(
  coachConfig: CoachConfig,
): CoachRetriever | undefined {
  const strategy = coachConfig.retrieval.strategy;
  if (strategy === "none") return undefined;

  if (strategy === "graph-walk") {
    return buildGraphWalkRetriever(coachConfig);
  }
  if (strategy === "embedding") {
    return buildEmbeddingRetriever(coachConfig);
  }

  // Other strategies — implemented in their respective experiments. We don't
  // throw because configs MAY arrive that target a strategy this binary
  // doesn't know yet; logging and falling back to none is safer than crashing
  // an eval run. The retriever-not-found path is exercised in
  // experiments that ship before their strategy adapter does.
  console.warn(
    `[retrieval-adapter] coach config strategy=${strategy} has no adapter in this build; conversation will run WITHOUT retrieval.`,
  );
  return undefined;
}

function buildGraphWalkRetriever(coachConfig: CoachConfig): CoachRetriever {
  // Pull config knobs with R-012 defaults
  const cfg = coachConfig.retrieval.config as Record<string, unknown>;
  const walkDepth = (cfg.walk_depth as number | undefined) ?? 2;
  const topK = (cfg.top_k as number | undefined) ?? 5;
  const hubDampenSpec =
    (cfg.hub_dampen as string | boolean | undefined) ?? "log1p_indegree";
  const hubDampen =
    hubDampenSpec === false || hubDampenSpec === "none" ? false : true;
  const seedModel =
    (cfg.seed_model as string | undefined) ?? "claude-haiku-4-5";

  return async ({ profile_id, turn, clientMessage, history }) => {
    // Dynamic import so the eval bundle doesn't load AI SDK unless the
    // strategy is actually used. (Also keeps the eval working when the
    // coach-app symlink/path changes — only graph-walk experiments pay.)
    const mod = await import("../../coach-app/retrieval/graph-walk.ts");
    const t0 = Date.now();
    // Only the most recent 2 turns are needed as context for seed detection
    // (more pollutes the cache and rarely changes the seed).
    const recentHistory = history.slice(-4).map((t) => ({
      role: t.role,
      content: t.content,
    }));
    const result = await mod.retrieveByGraphWalk({
      clientMessage,
      recentHistory,
      seedModel,
      walkConfig: {
        depth: walkDepth,
        topK,
        hubDampen,
      },
      profile_id,
    });
    return {
      injection: result.injection,
      telemetry: result.telemetry,
      cost_usd: result.telemetry.seed_detection_cost_usd,
      ms: Date.now() - t0,
      call_record: {
        model: seedModel,
        input_tokens: result.telemetry.seed_detection_input_tokens,
        output_tokens: result.telemetry.seed_detection_output_tokens,
        cache_read_input_tokens:
          result.telemetry.seed_detection_cache_read_tokens,
        cache_creation_input_tokens:
          result.telemetry.seed_detection_cache_write_tokens,
        cost_usd: result.telemetry.seed_detection_cost_usd,
        ms: result.telemetry.seed_detection_ms,
      },
    };
  };
}

// Note: turn/profile_id is unused but kept for forward compatibility with
// strategies that want to log them. Suppresses lint warnings.
void buildGraphWalkRetriever;

/**
 * E-033 — embedding-based retrieval.
 *
 * R-012 spec: hybrid alias-BM25 + dense (bge-small-en-v1.5) with RRF fusion,
 * one whole file = one document, top-K=5, no reranker. Implemented in
 * `coach-app/retrieval/embeddings.ts`. Pure-dense and BM25-only are smoke-
 * only fallbacks selectable via config.mode.
 *
 * The retriever is built once per eval run (loads the SQLite index + spawns
 * the persistent Python embedding subprocess) and reused for every coach turn
 * across all profiles. Per R-012 the trigger policy defaults to every_turn;
 * the conversation runner enforces the policy from coach config.
 *
 * Cost accounting: embedding retrieval is local-free. The only API cost from
 * retrieval is the inflated coach input — which appears under the regular
 * `coach:...` purpose lines on subsequent coach calls, not as a separate
 * retrieval call. We push a zero-cost call_record purely so retrieval-vs-
 * coach time is visible in telemetry; cost lift attributable to retrieval is
 * computed downstream by diffing against the E-031 baseline coach.
 */

// Lazy singletons — built on first invocation, reused for the entire eval.
let _embIndex: import("../../coach-app/retrieval/embeddings.ts").EmbeddingIndex | null = null;
let _embRetriever: import("../../coach-app/retrieval/embeddings.ts").EmbeddingRetriever | null = null;

function buildEmbeddingRetriever(coachConfig: CoachConfig): CoachRetriever {
  const cfg = coachConfig.retrieval.config as Record<string, unknown>;
  const topK = (cfg.top_k as number | undefined) ?? 5;
  const mode = ((cfg.mode as string | undefined) ?? "hybrid") as
    | "hybrid"
    | "dense"
    | "bm25";
  // Default index location. The coach config may override via `index_path`
  // for experiments that want to swap models without rebuilding the canonical
  // index. The path is resolved relative to the repo root.
  const indexPath = (cfg.index_path as string | undefined) ?? "coach-app/index.db";

  return async ({ profile_id, turn, clientMessage, history }) => {
    void history; // hybrid retrieval queries only the latest client message
    const t0 = Date.now();
    if (!_embRetriever) {
      const mod = await import("../../coach-app/retrieval/embeddings.ts");
      _embIndex = mod.loadEmbeddingIndex(indexPath);
      _embRetriever = new mod.EmbeddingRetriever(_embIndex);
    }
    const mod2 = await import("../../coach-app/retrieval/embeddings.ts");
    const { results, telemetry } = await _embRetriever.retrieve(clientMessage, {
      k: topK,
      mode,
    });
    const injection = mod2.formatRetrievedContext(results);
    const ms = Date.now() - t0;
    return {
      injection,
      telemetry: {
        ...telemetry,
        profile_id,
        turn,
      },
      cost_usd: 0,
      ms,
      // A zero-cost CallRecord so the cost log shows retrieval activity even
      // though no API was called. The expensive coach call that follows
      // records its own cost under `coach:...` purpose.
      call_record: {
        model: `embedding:${_embIndex?.model_name ?? "bge-small-en-v1.5"}`,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cost_usd: 0,
        ms,
      },
    };
  };
}

/**
 * Cleanup hook the eval runner can call at end of run to terminate the
 * persistent embedding subprocess. Safe to call even if the retriever was
 * never built.
 */
export async function shutdownRetrieverSingletons(): Promise<void> {
  if (_embRetriever) {
    try {
      await _embRetriever.shutdown();
    } catch {
      // ignore — already dead
    }
    _embRetriever = null;
    _embIndex = null;
  }
}

void buildEmbeddingRetriever;
