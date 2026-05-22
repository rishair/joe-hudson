/**
 * Aggregation utilities.
 *
 * - Build the per-turn × per-dimension matrix (the iteration artifact).
 * - Aggregate per-conversation scorecard.
 * - Aggregate per-run summary across all conversations.
 */

import type { DimensionScore, SafetyScreen } from "./judge.ts";
import type { ConversationResult, Turn } from "./conversation.ts";
import type { CallRecord } from "./anthropic.ts";

export interface ConversationScorecard {
  profile_id: string;
  coach_config_id: string;
  scenario_type?: string;
  termination: ConversationResult["termination"];
  termination_reason: string;
  turn_count: number;
  safety: SafetyScreen;
  /** Aggregate pass/fail = safety_pass && no judge errors. */
  aggregate_pass: boolean;
  /** Dimension scores, indexed by dimension_id. */
  dimensions: DimensionScore[];
  /**
   * Per-turn × per-dimension matrix. matrix[turnNumber][dimensionId] =
   * { polarity, annotation }
   */
  per_turn_matrix: Record<
    string, // turn number (as string for JSON friendliness)
    Record<string, { polarity: "+" | "-" | "neutral"; annotation: string }>
  >;
  judge_errors: { dimension: string; message: string }[];
  /** Cost and runtime for this conversation only. */
  cost_summary: {
    total_calls: number;
    cached_calls: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
    total_ms: number;
  };
}

export function buildScorecard(args: {
  conversation: ConversationResult;
  scenario_type: string | undefined;
  safety: SafetyScreen;
  dimensions: DimensionScore[];
  judge_errors: { dimension: string; message: string }[];
  judge_call_records: CallRecord[];
}): ConversationScorecard {
  const matrix: ConversationScorecard["per_turn_matrix"] = {};
  for (const dim of args.dimensions) {
    for (const ann of dim.turn_annotations) {
      const key = String(ann.turn);
      if (!matrix[key]) matrix[key] = {};
      matrix[key][dim.dimension] = {
        polarity: ann.polarity,
        annotation: ann.annotation,
      };
    }
  }

  const allCalls = [...args.conversation.call_records, ...args.judge_call_records];

  const cost_summary = summarizeCalls(allCalls);

  const aggregate_pass = args.safety.safety_pass && args.judge_errors.length === 0;

  return {
    profile_id: args.conversation.profile_id,
    coach_config_id: args.conversation.coach_config_id,
    scenario_type: args.scenario_type,
    termination: args.conversation.termination,
    termination_reason: args.conversation.termination_reason,
    turn_count: args.conversation.turns.length,
    safety: args.safety,
    aggregate_pass,
    dimensions: args.dimensions,
    per_turn_matrix: matrix,
    judge_errors: args.judge_errors,
    cost_summary,
  };
}

export function summarizeCalls(records: CallRecord[]): ConversationScorecard["cost_summary"] {
  return {
    total_calls: records.length,
    cached_calls: records.filter((r) => r.cached).length,
    total_input_tokens: records.reduce((a, r) => a + r.input_tokens, 0),
    total_output_tokens: records.reduce((a, r) => a + r.output_tokens, 0),
    total_cost_usd: records.reduce((a, r) => a + r.cost_usd, 0),
    total_ms: records.reduce((a, r) => a + r.ms, 0),
  };
}

export interface RunSummary {
  run_id: string;
  coach_config_id: string;
  judge_model: string;
  started_at: string;
  finished_at: string;
  total_profiles: number;
  scorecards: ConversationScorecard[];
  per_dimension_means: Record<string, { mean: number; count: number }>;
  safety_pass_rate: number;
  aggregate_pass_rate: number;
  total_cost_usd: number;
  total_calls: number;
  total_cached_calls: number;
  wall_clock_ms: number;
}

export function summarizeRun(args: {
  run_id: string;
  coach_config_id: string;
  judge_model: string;
  started_at: string;
  finished_at: string;
  scorecards: ConversationScorecard[];
  wall_clock_ms: number;
}): RunSummary {
  const perDim: Record<string, { sum: number; count: number }> = {};
  let totalCost = 0;
  let totalCalls = 0;
  let cached = 0;
  let safetyPasses = 0;
  let aggregatePasses = 0;

  for (const sc of args.scorecards) {
    for (const d of sc.dimensions) {
      if (!perDim[d.dimension]) perDim[d.dimension] = { sum: 0, count: 0 };
      perDim[d.dimension].sum += d.score;
      perDim[d.dimension].count += 1;
    }
    totalCost += sc.cost_summary.total_cost_usd;
    totalCalls += sc.cost_summary.total_calls;
    cached += sc.cost_summary.cached_calls;
    if (sc.safety.safety_pass) safetyPasses += 1;
    if (sc.aggregate_pass) aggregatePasses += 1;
  }

  const per_dimension_means: RunSummary["per_dimension_means"] = {};
  for (const [k, v] of Object.entries(perDim)) {
    per_dimension_means[k] = {
      mean: v.count > 0 ? Number((v.sum / v.count).toFixed(3)) : 0,
      count: v.count,
    };
  }

  return {
    run_id: args.run_id,
    coach_config_id: args.coach_config_id,
    judge_model: args.judge_model,
    started_at: args.started_at,
    finished_at: args.finished_at,
    total_profiles: args.scorecards.length,
    scorecards: args.scorecards,
    per_dimension_means,
    safety_pass_rate: args.scorecards.length > 0 ? safetyPasses / args.scorecards.length : 0,
    aggregate_pass_rate: args.scorecards.length > 0 ? aggregatePasses / args.scorecards.length : 0,
    total_cost_usd: Number(totalCost.toFixed(4)),
    total_calls: totalCalls,
    total_cached_calls: cached,
    wall_clock_ms: args.wall_clock_ms,
  };
}
