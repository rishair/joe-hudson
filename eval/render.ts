#!/usr/bin/env bun
/**
 * E-030: Legible scorecard renderer for terminal and markdown output.
 *
 * Pure transform: reads JSON written by E-023's harness from a results
 * directory, produces ANSI-colored terminal output and/or a markdown report.
 * No API calls. No env dependencies. Same input always produces same output.
 *
 * Usage:
 *   bun run eval/render.ts <results-dir>
 *   bun run eval/render.ts <results-dir> --markdown <output.md>
 *   bun run eval/render.ts <results-dir-a> <results-dir-b>   # comparison
 *   bun run eval/render.ts <results-dir-a> <results-dir-b> --markdown out.md
 *
 * Notes:
 * - The scorecard JSON schema is what E-023 actually writes (verified against
 *   eval/results/20260522-052720/). Anti-pattern triggers are derived from
 *   negative turn_annotations on the `anti-pattern-avoidance` dimension; the
 *   harness does not emit a separate triggered-anti-patterns list.
 * - The "Lowest-scoring turn" is computed by summing per-dimension polarity at
 *   each turn (- = -1, + = +1, neutral = 0).
 * - Per-turn matrix in the terminal card omits the OVERALL "polarity" sum row;
 *   the matrix cells are the per-turn polarity per dimension as read directly
 *   from `per_turn_matrix` (a dimension/turn pair may be absent — rendered ".").
 */

import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { z } from "zod";

// ============================================================================
// Schemas (validate the E-023 output we actually consume)
// ============================================================================

const PolarityZ = z.enum(["+", "-", "neutral"]);

const TurnAnnotationZ = z.object({
  turn: z.number().int(),
  polarity: PolarityZ,
  annotation: z.string(),
});

const DimensionScoreZ = z
  .object({
    dimension: z.string(),
    score: z.number(),
    rationale: z.string(),
    evidence_turns: z.array(z.number()).optional().default([]),
    turn_annotations: z.array(TurnAnnotationZ).optional().default([]),
    expected_territory_hits: z.array(z.string()).optional().default([]),
    expected_territory_misses: z.array(z.string()).optional().default([]),
    notes: z.string().optional().default(""),
  })
  .passthrough();

const SafetyFailureZ = z
  .object({
    failure_id: z.string(),
    status: z.enum(["pass", "fail", "ambiguous", "not_applicable"]),
    evidence_turns: z.array(z.number()).optional().default([]),
    explanation: z.string().optional().default(""),
  })
  .passthrough();

const SafetyZ = z.object({
  safety_pass: z.boolean(),
  failures: z.array(SafetyFailureZ).optional().default([]),
});

const PerTurnCellZ = z.object({
  polarity: PolarityZ,
  annotation: z.string(),
});

const ScorecardZ = z
  .object({
    profile_id: z.string(),
    coach_config_id: z.string(),
    scenario_type: z.string(),
    termination: z.string(),
    termination_reason: z.string().optional().default(""),
    turn_count: z.number().int(),
    safety: SafetyZ,
    aggregate_pass: z.boolean(),
    dimensions: z.array(DimensionScoreZ),
    // record<turn-string, record<dimension, cell>>
    per_turn_matrix: z.record(z.string(), z.record(z.string(), PerTurnCellZ)),
    judge_errors: z.array(z.unknown()).optional().default([]),
    cost_summary: z
      .object({
        total_calls: z.number().int().optional(),
        cached_calls: z.number().int().optional(),
        total_input_tokens: z.number().optional(),
        total_output_tokens: z.number().optional(),
        total_cost_usd: z.number().optional(),
        total_ms: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const SummaryZ = z
  .object({
    run_id: z.string(),
    coach_config_id: z.string(),
    judge_model: z.string().optional().default(""),
    started_at: z.string().optional().default(""),
    finished_at: z.string().optional().default(""),
    total_profiles: z.number().int(),
    scorecards: z.array(ScorecardZ),
    per_dimension_means: z
      .record(
        z.string(),
        z.object({ mean: z.number(), count: z.number().int() }),
      )
      .optional()
      .default({}),
    safety_pass_rate: z.number().optional().default(0),
    aggregate_pass_rate: z.number().optional().default(0),
    total_cost_usd: z.number().optional().default(0),
    total_calls: z.number().int().optional().default(0),
    total_cached_calls: z.number().int().optional().default(0),
    wall_clock_ms: z.number().optional().default(0),
  })
  .passthrough();

type Scorecard = z.infer<typeof ScorecardZ>;
type Summary = z.infer<typeof SummaryZ>;
type Polarity = z.infer<typeof PolarityZ>;

const ConversationTurnZ = z.object({
  turn: z.number().int(),
  role: z.enum(["coach", "client"]),
  content: z.string(),
});

const ConversationZ = z
  .object({
    profile_id: z.string(),
    coach_config_id: z.string(),
    turns: z.array(ConversationTurnZ),
    termination: z.string().optional(),
    termination_reason: z.string().optional(),
  })
  .passthrough();

type Conversation = z.infer<typeof ConversationZ>;

// ============================================================================
// Constants
// ============================================================================

// Six R-008 dimensions in canonical display order (D1..D6 per the goal page).
const DIMENSIONS: { id: string; short: string; label: string }[] = [
  { id: "perceptual-accuracy", short: "D1", label: "Perceptual Accuracy" },
  { id: "intervention-quality", short: "D2", label: "Intervention Quality" },
  { id: "coaching-stance", short: "D3", label: "Coaching Stance" },
  { id: "methodology-fidelity", short: "D4", label: "Methodology Fidelity" },
  { id: "anti-pattern-avoidance", short: "D5", label: "Anti-Pattern Avoidance" },
  { id: "effectiveness-depth", short: "D6", label: "Effectiveness / Depth" },
];

// ============================================================================
// ANSI helpers
// ============================================================================

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const useColor =
  process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

function c(color: keyof typeof ANSI, s: string): string {
  if (!useColor) return s;
  return `${ANSI[color]}${s}${ANSI.reset}`;
}

function bold(s: string): string {
  return useColor ? `${ANSI.bold}${s}${ANSI.reset}` : s;
}

function dim(s: string): string {
  return useColor ? `${ANSI.dim}${s}${ANSI.reset}` : s;
}

function colorScore(score: number): string {
  // 1 red, 2 yellow, 3 green; fractional means take nearest.
  const s = score.toFixed(score % 1 === 0 ? 0 : 1);
  if (score < 1.5) return c("red", s);
  if (score < 2.5) return c("yellow", s);
  return c("green", s);
}

function scoreBar(score: number): string {
  // 3-cell bar; filled cells colored by the actual score band, empty cells dim.
  // For fractional scores (e.g., 2.5), we floor rather than round so the bar
  // never overstates the score (2.5 → 2 filled cells in the 2-band yellow).
  const filled = Math.max(0, Math.min(3, Math.floor(score)));
  const cells = [0, 1, 2].map((i) => (i < filled ? "▓" : "░"));
  const color: keyof typeof ANSI =
    score < 1.5 ? "red" : score < 2.5 ? "yellow" : "green";
  const head = cells.slice(0, filled).join("");
  const tail = cells.slice(filled).join("");
  return c(color, head) + dim(tail);
}

function colorPolarity(p: Polarity | "."): string {
  if (p === "+") return c("green", "+");
  if (p === "-") return c("red", "-");
  if (p === "neutral") return c("yellow", "~");
  return dim(".");
}

// ============================================================================
// Loaders
// ============================================================================

function loadResultsDir(dir: string): {
  summary: Summary;
  scorecards: Scorecard[];
  conversations: Map<string, Conversation>;
  runId: string;
} {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new Error(`Cannot read results directory '${dir}': ${(err as Error).message}`);
  }

  const conversations = new Map<string, Conversation>();
  const scorecards: Scorecard[] = [];
  let summary: Summary | null = null;

  for (const name of entries) {
    const full = join(dir, name);
    if (!statSync(full).isFile()) continue;

    if (name === "summary.json") {
      const raw = JSON.parse(readFileSync(full, "utf-8"));
      const parsed = SummaryZ.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `summary.json failed schema validation: ${parsed.error.message}`,
        );
      }
      summary = parsed.data;
    } else if (name.startsWith("scorecard.") && name.endsWith(".json")) {
      const raw = JSON.parse(readFileSync(full, "utf-8"));
      const parsed = ScorecardZ.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `${name} failed schema validation: ${parsed.error.message}`,
        );
      }
      scorecards.push(parsed.data);
    } else if (name.startsWith("conversation.") && name.endsWith(".json")) {
      const raw = JSON.parse(readFileSync(full, "utf-8"));
      const parsed = ConversationZ.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `${name} failed schema validation: ${parsed.error.message}`,
        );
      }
      conversations.set(parsed.data.profile_id, parsed.data);
    }
  }

  // If summary missing, synthesize a minimal one from scorecards.
  if (!summary) {
    summary = synthesizeSummary(basename(dir), scorecards);
  }

  // Order scorecards as the summary lists them when possible.
  if (summary.scorecards.length > 0) {
    const order = new Map(
      summary.scorecards.map((s, i) => [s.profile_id, i] as [string, number]),
    );
    scorecards.sort(
      (a, b) =>
        (order.get(a.profile_id) ?? 999) - (order.get(b.profile_id) ?? 999),
    );
  }

  return { summary, scorecards, conversations, runId: summary.run_id };
}

function synthesizeSummary(runId: string, scorecards: Scorecard[]): Summary {
  const dimMeans: Record<string, { mean: number; count: number }> = {};
  for (const d of DIMENSIONS) {
    const scores = scorecards
      .map((sc) => sc.dimensions.find((x) => x.dimension === d.id)?.score)
      .filter((x): x is number => typeof x === "number");
    if (scores.length > 0) {
      dimMeans[d.id] = {
        mean: scores.reduce((a, b) => a + b, 0) / scores.length,
        count: scores.length,
      };
    }
  }
  const safetyPass = scorecards.filter((s) => s.safety.safety_pass).length;
  const aggPass = scorecards.filter((s) => s.aggregate_pass).length;
  const totalCost = scorecards.reduce(
    (a, s) => a + (s.cost_summary?.total_cost_usd ?? 0),
    0,
  );
  const totalCalls = scorecards.reduce(
    (a, s) => a + (s.cost_summary?.total_calls ?? 0),
    0,
  );
  return {
    run_id: runId,
    coach_config_id: scorecards[0]?.coach_config_id ?? "(unknown)",
    judge_model: "",
    started_at: "",
    finished_at: "",
    total_profiles: scorecards.length,
    scorecards,
    per_dimension_means: dimMeans,
    safety_pass_rate: scorecards.length ? safetyPass / scorecards.length : 0,
    aggregate_pass_rate: scorecards.length ? aggPass / scorecards.length : 0,
    total_cost_usd: totalCost,
    total_calls: totalCalls,
    total_cached_calls: 0,
    wall_clock_ms: 0,
  };
}

// ============================================================================
// Derived helpers
// ============================================================================

function dimScoreOf(sc: Scorecard, dimId: string): number | null {
  const d = sc.dimensions.find((x) => x.dimension === dimId);
  return d ? d.score : null;
}

function overallScore(sc: Scorecard): number {
  const scores = DIMENSIONS.map((d) => dimScoreOf(sc, d.id)).filter(
    (x): x is number => typeof x === "number",
  );
  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function weakestDimensions(sc: Scorecard): string[] {
  // Returns dimension IDs tied for the lowest score, but only when there is
  // actual variance among dimensions. If every dimension scored the same, no
  // dimension is "weakest" — the marker would be noise.
  const present = DIMENSIONS.map((d) => ({
    id: d.id,
    score: dimScoreOf(sc, d.id),
  })).filter((x): x is { id: string; score: number } => x.score !== null);
  if (present.length === 0) return [];
  const min = Math.min(...present.map((p) => p.score));
  const max = Math.max(...present.map((p) => p.score));
  if (min === max) return [];
  return present.filter((p) => p.score === min).map((p) => p.id);
}

function sortedTurnKeys(sc: Scorecard): number[] {
  return Object.keys(sc.per_turn_matrix)
    .map((k) => parseInt(k, 10))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
}

function polarityAt(
  sc: Scorecard,
  turn: number,
  dimId: string,
): Polarity | "." {
  const row = sc.per_turn_matrix[String(turn)];
  if (!row) return ".";
  const cell = row[dimId];
  if (!cell) return ".";
  return cell.polarity;
}

function annotationAt(
  sc: Scorecard,
  turn: number,
  dimId: string,
): string | null {
  const row = sc.per_turn_matrix[String(turn)];
  if (!row) return null;
  const cell = row[dimId];
  return cell ? cell.annotation : null;
}

function turnPolaritySum(sc: Scorecard, turn: number): number {
  let sum = 0;
  for (const d of DIMENSIONS) {
    const p = polarityAt(sc, turn, d.id);
    if (p === "+") sum += 1;
    else if (p === "-") sum -= 1;
  }
  return sum;
}

function turnNegativeCount(sc: Scorecard, turn: number): number {
  let n = 0;
  for (const d of DIMENSIONS) {
    if (polarityAt(sc, turn, d.id) === "-") n += 1;
  }
  return n;
}

function lowestScoringTurn(
  sc: Scorecard,
): { turn: number; negatives: number; sum: number } | null {
  const turns = sortedTurnKeys(sc);
  if (turns.length === 0) return null;
  let best: { turn: number; negatives: number; sum: number } | null = null;
  for (const t of turns) {
    const negatives = turnNegativeCount(sc, t);
    const sum = turnPolaritySum(sc, t);
    if (
      best === null ||
      negatives > best.negatives ||
      (negatives === best.negatives && sum < best.sum)
    ) {
      best = { turn: t, negatives, sum };
    }
  }
  if (best && best.negatives === 0) return null; // no turn went negative
  return best;
}

/**
 * Anti-pattern triggers: derived from the negative turn_annotations on the
 * `anti-pattern-avoidance` dimension. The harness does not emit a structured
 * `triggered: [{name, turns}]` block, so we extract from the annotation text
 * and group by turn.
 */
function antiPatternTriggers(
  sc: Scorecard,
): { description: string; turns: number[] }[] {
  const apDim = sc.dimensions.find((d) => d.dimension === "anti-pattern-avoidance");
  if (!apDim) return [];
  const negatives = apDim.turn_annotations.filter((a) => a.polarity === "-");
  // Each negative annotation is one trigger occurrence. We group identical
  // annotation texts (rare but possible) into one row with multiple turns.
  const byKey = new Map<string, { description: string; turns: number[] }>();
  for (const ann of negatives) {
    const key = ann.annotation;
    const existing = byKey.get(key);
    if (existing) {
      existing.turns.push(ann.turn);
    } else {
      byKey.set(key, { description: ann.annotation, turns: [ann.turn] });
    }
  }
  return [...byKey.values()];
}

function totalAnnotatedCoachTurns(sc: Scorecard): number {
  // Approximate "turns the AP dimension had a chance to score" as turns where
  // the AP dimension annotated at all. Used for the "X of Y" denominator.
  const apDim = sc.dimensions.find((d) => d.dimension === "anti-pattern-avoidance");
  if (!apDim) return 0;
  return apDim.turn_annotations.length;
}

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= n) return flat;
  return flat.slice(0, n - 1) + "…";
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function ms(n: number): string {
  if (n <= 0) return "—";
  const s = n / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = (s - m * 60).toFixed(0);
  return `${m}m ${r}s`;
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

// ============================================================================
// Terminal rendering
// ============================================================================

function renderTerminalCard(
  sc: Scorecard,
  conversations: Map<string, Conversation>,
  runDir: string,
): string {
  const lines: string[] = [];
  const overall = overallScore(sc);
  const weakest = new Set(weakestDimensions(sc));

  // Header
  lines.push(
    bold(
      `=== profile: ${sc.profile_id} (${sc.scenario_type}) ===`,
    ),
  );

  // Safety screen line
  const safetyTag = sc.safety.safety_pass
    ? c("green", "PASS")
    : c("red", "FAIL");
  lines.push(`  Safety screen: ${safetyTag}`);
  if (!sc.safety.safety_pass) {
    for (const f of sc.safety.failures) {
      if (f.status === "fail") {
        lines.push(
          `    ${c("red", "✗")} ${f.failure_id}: ${truncate(f.explanation, 90)}`,
        );
      }
    }
  }

  // Termination note (if not normal max_turns / client exit)
  if (sc.termination === "error") {
    lines.push(
      `  ${c("yellow", "⚠")} Conversation terminated early: ${truncate(
        sc.termination_reason,
        100,
      )}`,
    );
  } else if (sc.termination !== "max_turns") {
    lines.push(
      `  ${dim("note:")} ${sc.termination} — ${truncate(sc.termination_reason, 100)}`,
    );
  }

  lines.push("");
  lines.push(`  ${bold("Scores")} (1=poor, 2=adequate, 3=excellent):`);

  // Per-dimension lines (always render all six in canonical order; missing → "—")
  for (const d of DIMENSIONS) {
    const score = dimScoreOf(sc, d.id);
    if (score === null) {
      lines.push(`    ${d.short} ${d.label.padEnd(25)} ${dim("—   ---")}`);
      continue;
    }
    const tag = weakest.has(d.id) ? `   ${c("red", "<-- weakest")}` : "";
    lines.push(
      `    ${d.short} ${d.label.padEnd(25)} ${colorScore(score)}  ${scoreBar(score)}${tag}`,
    );
  }
  lines.push(
    `    ${" ".repeat(3)}${"OVERALL".padEnd(25)} ${colorScore(overall)}`,
  );

  // Per-turn matrix
  lines.push("");
  lines.push(`  ${bold("Per-turn matrix")} (rows=dimensions, cols=turns):`);
  const turns = sortedTurnKeys(sc);
  if (turns.length === 0) {
    lines.push(`    ${dim("(no per-turn data)")}`);
  } else {
    const header =
      "        " + turns.map((t) => `T${t}`.padStart(3)).join(" ");
    lines.push(dim(header));
    for (const d of DIMENSIONS) {
      const row = turns
        .map((t) => colorPolarity(polarityAt(sc, t, d.id)).padStart(3))
        .join(" ");
      lines.push(`    ${d.short}  ${row}`);
    }
  }

  // Anti-patterns triggered
  const triggers = antiPatternTriggers(sc);
  const denom = totalAnnotatedCoachTurns(sc);
  lines.push("");
  if (triggers.length === 0) {
    lines.push(
      `  ${bold("Anti-patterns triggered")}: ${c("green", "0")}${
        denom ? ` of ${denom}` : ""
      }`,
    );
  } else {
    const total = triggers.reduce((a, t) => a + t.turns.length, 0);
    lines.push(
      `  ${bold("Anti-patterns triggered")}: ${c("red", String(total))}${
        denom ? ` of ${denom}` : ""
      }`,
    );
    for (const t of triggers) {
      const turnsStr = t.turns.map((n) => `T${n}`).join(", ");
      lines.push(`    - ${truncate(t.description, 90)}  ${dim(`(${turnsStr})`)}`);
    }
  }

  // Lowest-scoring turn (if any went negative)
  const low = lowestScoringTurn(sc);
  lines.push("");
  if (low) {
    lines.push(
      `  ${bold("Lowest-scoring turn")}: T${low.turn} (${low.negatives} of ${DIMENSIONS.length} dimensions went negative)`,
    );
    const conv = conversations.get(sc.profile_id);
    if (conv) {
      const coachTurn = conv.turns.find(
        (t) => t.turn === low.turn && t.role === "coach",
      );
      if (coachTurn) {
        lines.push(
          `    Coach @ T${low.turn}: "${truncate(coachTurn.content, 100)}"`,
        );
      }
    }
    // First negative annotation at that turn as "Why"
    for (const d of DIMENSIONS) {
      if (polarityAt(sc, low.turn, d.id) === "-") {
        const a = annotationAt(sc, low.turn, d.id);
        if (a) {
          lines.push(`    Why (${d.short}): ${truncate(a, 110)}`);
          break;
        }
      }
    }
  } else {
    lines.push(
      `  ${bold("Lowest-scoring turn")}: ${dim("(no turn scored negative)")}`,
    );
  }

  // Pointer to detail file (if conversation file exists)
  const convPath = join(runDir, `conversation.${sc.profile_id}.json`);
  lines.push("");
  lines.push(`  See full conversation: ${dim(convPath)}`);

  return lines.join("\n");
}

function renderTerminalAggregate(summary: Summary): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(bold("=== AGGREGATE ==="));
  lines.push(
    `  Run: ${summary.run_id}    Coach: ${summary.coach_config_id}    Judge: ${summary.judge_model || "(n/a)"}`,
  );
  lines.push(
    `  Profiles: ${summary.total_profiles}    Safety pass: ${pct(summary.safety_pass_rate)}    Aggregate pass: ${pct(summary.aggregate_pass_rate)}`,
  );
  lines.push(
    `  Total cost: ${usd(summary.total_cost_usd)}    Calls: ${summary.total_calls}    Wall: ${ms(summary.wall_clock_ms)}`,
  );
  lines.push("");
  lines.push(`  ${bold("Per-dimension means")}:`);
  for (const d of DIMENSIONS) {
    const m = summary.per_dimension_means[d.id];
    if (!m) continue;
    lines.push(
      `    ${d.short} ${d.label.padEnd(25)} ${colorScore(m.mean)}  ${scoreBar(m.mean)}  ${dim(`(n=${m.count})`)}`,
    );
  }

  // Anti-pattern trigger rate across the run.
  const triggerRates = new Map<string, number>();
  let triggeredProfiles = 0;
  for (const sc of summary.scorecards) {
    const triggers = antiPatternTriggers(sc);
    if (triggers.length > 0) triggeredProfiles += 1;
    for (const t of triggers) {
      triggerRates.set(t.description, (triggerRates.get(t.description) ?? 0) + 1);
    }
  }
  lines.push("");
  lines.push(
    `  ${bold("Profiles with any anti-pattern trigger")}: ${triggeredProfiles} of ${summary.total_profiles}`,
  );
  if (triggerRates.size > 0) {
    const top = [...triggerRates.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    for (const [desc, n] of top) {
      lines.push(`    - ${truncate(desc, 90)}  ${dim(`(×${n})`)}`);
    }
  }

  return lines.join("\n");
}

function renderTerminal(
  summary: Summary,
  scorecards: Scorecard[],
  conversations: Map<string, Conversation>,
  runDir: string,
): string {
  const parts: string[] = [];
  for (const sc of scorecards) {
    parts.push(renderTerminalCard(sc, conversations, runDir));
    parts.push("");
  }
  parts.push(renderTerminalAggregate(summary));
  return parts.join("\n");
}

// ============================================================================
// Markdown rendering
// ============================================================================

function mdScoreEmoji(score: number): string {
  if (score < 1.5) return "🔴";
  if (score < 2.5) return "🟡";
  return "🟢";
}

function mdPolarity(p: Polarity | "."): string {
  if (p === "+") return "+";
  if (p === "-") return "−";
  if (p === "neutral") return "~";
  return "·";
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderMarkdown(
  summary: Summary,
  scorecards: Scorecard[],
  conversations: Map<string, Conversation>,
): string {
  const lines: string[] = [];

  // 1. Run header
  lines.push(`# Eval run: ${summary.run_id}`);
  lines.push("");
  lines.push(`- **Coach config:** \`${summary.coach_config_id}\``);
  lines.push(`- **Judge model:** \`${summary.judge_model || "(n/a)"}\``);
  if (summary.started_at) lines.push(`- **Started:** ${summary.started_at}`);
  if (summary.finished_at) lines.push(`- **Finished:** ${summary.finished_at}`);
  lines.push(`- **Profiles:** ${summary.total_profiles}`);
  lines.push(`- **Safety pass rate:** ${pct(summary.safety_pass_rate)}`);
  lines.push(`- **Aggregate pass rate:** ${pct(summary.aggregate_pass_rate)}`);
  lines.push(`- **Total cost:** ${usd(summary.total_cost_usd)}`);
  lines.push(`- **Total API calls:** ${summary.total_calls}`);
  if (summary.wall_clock_ms > 0)
    lines.push(`- **Wall clock:** ${ms(summary.wall_clock_ms)}`);
  lines.push("");

  // 2. Aggregate scorecard table: rows = profiles, cols = dimensions
  lines.push(`## Aggregate scorecard`);
  lines.push("");
  const header = [
    "Profile",
    "Scenario",
    ...DIMENSIONS.map((d) => d.short),
    "Overall",
    "Safety",
  ];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const sc of scorecards) {
    const row = [`[${sc.profile_id}](#${anchor(sc.profile_id)})`, sc.scenario_type];
    for (const d of DIMENSIONS) {
      const s = dimScoreOf(sc, d.id);
      row.push(s === null ? "—" : `${mdScoreEmoji(s)} ${s}`);
    }
    const ov = overallScore(sc);
    row.push(`${mdScoreEmoji(ov)} ${ov.toFixed(1)}`);
    row.push(sc.safety.safety_pass ? "🟢 pass" : "🔴 FAIL");
    lines.push(`| ${row.join(" | ")} |`);
  }
  // Bottom row: per-dimension mean
  const meanRow: string[] = ["**Mean**", "—"];
  for (const d of DIMENSIONS) {
    const m = summary.per_dimension_means[d.id];
    meanRow.push(m ? `${mdScoreEmoji(m.mean)} ${m.mean.toFixed(2)}` : "—");
  }
  const overallMean =
    DIMENSIONS.map((d) => summary.per_dimension_means[d.id]?.mean ?? 0).reduce(
      (a, b) => a + b,
      0,
    ) / DIMENSIONS.length;
  meanRow.push(`${mdScoreEmoji(overallMean)} ${overallMean.toFixed(2)}`);
  meanRow.push("—");
  lines.push(`| ${meanRow.join(" | ")} |`);
  lines.push("");

  // 3. Anti-pattern trigger heatmap (rows=profiles, cols=turns 1..N)
  const maxTurns = Math.max(
    1,
    ...scorecards.map((sc) => {
      const ts = sortedTurnKeys(sc);
      return ts.length === 0 ? 0 : ts[ts.length - 1];
    }),
  );
  lines.push(`## Anti-pattern trigger heatmap`);
  lines.push("");
  lines.push(
    `Cells show the AP-avoidance dimension polarity per turn (+ avoided, − triggered, ~ neutral, · n/a).`,
  );
  lines.push("");
  const hHeader = [
    "Profile",
    ...Array.from({ length: maxTurns }, (_, i) => `T${i + 1}`),
    "Triggers",
  ];
  lines.push(`| ${hHeader.join(" | ")} |`);
  lines.push(`| ${hHeader.map(() => "---").join(" | ")} |`);
  for (const sc of scorecards) {
    const row: string[] = [`[${sc.profile_id}](#${anchor(sc.profile_id)})`];
    for (let t = 1; t <= maxTurns; t += 1) {
      row.push(mdPolarity(polarityAt(sc, t, "anti-pattern-avoidance")));
    }
    const trigCount = antiPatternTriggers(sc).reduce(
      (a, x) => a + x.turns.length,
      0,
    );
    row.push(trigCount === 0 ? "0" : `**${trigCount}**`);
    lines.push(`| ${row.join(" | ")} |`);
  }
  lines.push("");

  // 4. Safety screen results
  lines.push(`## Safety screen results`);
  lines.push("");
  lines.push(`| Profile | Result | Failed criteria | Notes |`);
  lines.push(`| --- | --- | --- | --- |`);
  for (const sc of scorecards) {
    const failed = sc.safety.failures.filter((f) => f.status === "fail");
    const failList = failed.map((f) => f.failure_id).join(", ") || "—";
    const notes =
      failed.length > 0
        ? mdEscape(failed.map((f) => f.explanation).join(" | "))
        : "—";
    const result = sc.safety.safety_pass ? "🟢 pass" : "🔴 FAIL";
    lines.push(
      `| ${sc.profile_id} | ${result} | ${failList} | ${notes} |`,
    );
  }
  lines.push("");

  // 5. Per-profile detail
  lines.push(`## Per-profile detail`);
  lines.push("");
  for (const sc of scorecards) {
    lines.push(`### ${sc.profile_id}`);
    lines.push("");
    lines.push(
      `<a id="${anchor(sc.profile_id)}"></a>`,
    );
    lines.push("");
    lines.push(
      `**Scenario:** ${sc.scenario_type}   **Turns:** ${sc.turn_count}   **Termination:** \`${sc.termination}\`   **Safety:** ${sc.safety.safety_pass ? "🟢 pass" : "🔴 FAIL"}`,
    );
    lines.push("");
    if (sc.termination !== "max_turns" && sc.termination_reason) {
      lines.push(`> Termination note: ${mdEscape(sc.termination_reason)}`);
      lines.push("");
    }

    // Dimension scores with rationale
    lines.push(`#### Dimension scores`);
    lines.push("");
    lines.push(`| Dim | Score | Rationale |`);
    lines.push(`| --- | --- | --- |`);
    for (const d of DIMENSIONS) {
      const ds = sc.dimensions.find((x) => x.dimension === d.id);
      if (!ds) {
        lines.push(`| ${d.short} ${d.label} | — | (not scored) |`);
        continue;
      }
      lines.push(
        `| ${d.short} ${d.label} | ${mdScoreEmoji(ds.score)} ${ds.score} | ${mdEscape(truncate(ds.rationale, 280))} |`,
      );
    }
    lines.push("");

    // Per-turn matrix
    const turns = sortedTurnKeys(sc);
    if (turns.length > 0) {
      lines.push(`#### Per-turn matrix`);
      lines.push("");
      const hdr = ["Dim", ...turns.map((t) => `T${t}`)];
      lines.push(`| ${hdr.join(" | ")} |`);
      lines.push(`| ${hdr.map(() => "---").join(" | ")} |`);
      for (const d of DIMENSIONS) {
        const row = [d.short];
        for (const t of turns) row.push(mdPolarity(polarityAt(sc, t, d.id)));
        lines.push(`| ${row.join(" | ")} |`);
      }
      lines.push("");
    }

    // Conversation transcript with inline judge annotations
    const conv = conversations.get(sc.profile_id);
    if (conv) {
      lines.push(`<details><summary>Full conversation with annotations</summary>`);
      lines.push("");
      for (const t of conv.turns) {
        lines.push(`**Turn ${t.turn} — ${t.role}:**`);
        lines.push("");
        // Quote the content
        for (const line of t.content.split("\n")) {
          lines.push(`> ${line}`);
        }
        lines.push("");
        // Inline judge annotations at this turn (one per dimension that scored it)
        const row = sc.per_turn_matrix[String(t.turn)];
        if (row) {
          const dims = Object.keys(row).sort();
          for (const dimId of dims) {
            const d = DIMENSIONS.find((x) => x.id === dimId);
            const short = d ? d.short : dimId;
            const cell = row[dimId];
            lines.push(
              `> _${short} ${mdPolarity(cell.polarity)}_ — ${mdEscape(cell.annotation)}`,
            );
          }
          lines.push("");
        }
      }
      lines.push(`</details>`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function anchor(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

// ============================================================================
// Comparison rendering
// ============================================================================

function renderComparisonTerminal(
  a: { summary: Summary; scorecards: Scorecard[] },
  b: { summary: Summary; scorecards: Scorecard[] },
): string {
  const lines: string[] = [];
  lines.push(
    bold(
      `=== COMPARISON: ${a.summary.run_id} (A) vs ${b.summary.run_id} (B) ===`,
    ),
  );
  lines.push(
    `  A: coach=${a.summary.coach_config_id}   profiles=${a.summary.total_profiles}   cost=${usd(a.summary.total_cost_usd)}`,
  );
  lines.push(
    `  B: coach=${b.summary.coach_config_id}   profiles=${b.summary.total_profiles}   cost=${usd(b.summary.total_cost_usd)}`,
  );
  lines.push("");

  // Per-dimension delta table
  lines.push(`  ${bold("Per-dimension means (A vs B):")}`);
  lines.push(
    `    ${"Dimension".padEnd(28)} ${"A".padStart(5)}  ${"B".padStart(5)}  ${"Δ".padStart(7)}`,
  );
  for (const d of DIMENSIONS) {
    const ma = a.summary.per_dimension_means[d.id]?.mean ?? null;
    const mb = b.summary.per_dimension_means[d.id]?.mean ?? null;
    const ad = ma === null ? "—" : ma.toFixed(2);
    const bd = mb === null ? "—" : mb.toFixed(2);
    let delta = "—";
    if (ma !== null && mb !== null) {
      const d2 = mb - ma;
      const sign = d2 > 0 ? "+" : "";
      const colored =
        d2 > 0 ? c("green", `${sign}${d2.toFixed(2)}`)
        : d2 < 0 ? c("red", d2.toFixed(2))
        : dim("0.00");
      delta = colored;
    }
    lines.push(
      `    ${d.label.padEnd(28)} ${ad.padStart(5)}  ${bd.padStart(5)}  ${delta.padStart(7)}`,
    );
  }
  lines.push("");

  // Anti-pattern trigger rate delta
  const apA = a.scorecards.reduce(
    (n, sc) => n + (antiPatternTriggers(sc).length > 0 ? 1 : 0),
    0,
  );
  const apB = b.scorecards.reduce(
    (n, sc) => n + (antiPatternTriggers(sc).length > 0 ? 1 : 0),
    0,
  );
  lines.push(
    `  ${bold("Profiles with any AP trigger")}: A=${apA}/${a.summary.total_profiles}   B=${apB}/${b.summary.total_profiles}`,
  );
  lines.push("");

  // Profiles where A and B diverge most (overlap by profile_id only)
  const aByProfile = new Map(a.scorecards.map((s) => [s.profile_id, s]));
  const divergences: { profile_id: string; aOv: number; bOv: number; delta: number }[] = [];
  for (const sb of b.scorecards) {
    const sa = aByProfile.get(sb.profile_id);
    if (!sa) continue;
    const aOv = overallScore(sa);
    const bOv = overallScore(sb);
    divergences.push({
      profile_id: sb.profile_id,
      aOv,
      bOv,
      delta: bOv - aOv,
    });
  }
  divergences.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  if (divergences.length > 0) {
    lines.push(`  ${bold("Largest per-profile overall deltas (B − A):")}`);
    for (const d of divergences.slice(0, 5)) {
      const sign = d.delta > 0 ? "+" : "";
      const colored =
        d.delta > 0
          ? c("green", `${sign}${d.delta.toFixed(2)}`)
          : d.delta < 0
          ? c("red", d.delta.toFixed(2))
          : dim("0.00");
      lines.push(
        `    ${d.profile_id.padEnd(48)} A=${d.aOv.toFixed(2)}  B=${d.bOv.toFixed(2)}  Δ=${colored}`,
      );
    }
    lines.push("");
    const onlyA = a.scorecards.filter(
      (s) => !b.scorecards.find((x) => x.profile_id === s.profile_id),
    );
    const onlyB = b.scorecards.filter(
      (s) => !a.scorecards.find((x) => x.profile_id === s.profile_id),
    );
    if (onlyA.length || onlyB.length) {
      lines.push(
        dim(
          `  (profiles only in A: ${onlyA.length}; only in B: ${onlyB.length})`,
        ),
      );
    }
  } else {
    lines.push(dim(`  (no overlapping profiles between A and B)`));
  }
  return lines.join("\n");
}

function renderComparisonMarkdown(
  a: { summary: Summary; scorecards: Scorecard[] },
  b: { summary: Summary; scorecards: Scorecard[] },
): string {
  const lines: string[] = [];
  lines.push(`# Eval comparison: ${a.summary.run_id} vs ${b.summary.run_id}`);
  lines.push("");
  lines.push(
    `- **A:** \`${a.summary.coach_config_id}\` (${a.summary.total_profiles} profiles, ${usd(a.summary.total_cost_usd)})`,
  );
  lines.push(
    `- **B:** \`${b.summary.coach_config_id}\` (${b.summary.total_profiles} profiles, ${usd(b.summary.total_cost_usd)})`,
  );
  lines.push("");

  lines.push(`## Per-dimension means`);
  lines.push("");
  lines.push(`| Dimension | A | B | Δ (B − A) |`);
  lines.push(`| --- | --- | --- | --- |`);
  for (const d of DIMENSIONS) {
    const ma = a.summary.per_dimension_means[d.id]?.mean;
    const mb = b.summary.per_dimension_means[d.id]?.mean;
    const aStr = ma === undefined ? "—" : ma.toFixed(2);
    const bStr = mb === undefined ? "—" : mb.toFixed(2);
    let deltaStr = "—";
    if (ma !== undefined && mb !== undefined) {
      const d2 = mb - ma;
      const sign = d2 > 0 ? "+" : "";
      deltaStr = `${d2 === 0 ? "" : sign}${d2.toFixed(2)}`;
    }
    lines.push(`| ${d.short} ${d.label} | ${aStr} | ${bStr} | ${deltaStr} |`);
  }
  lines.push("");

  // Per-profile diff
  const aByProfile = new Map(a.scorecards.map((s) => [s.profile_id, s]));
  const rows: { profile_id: string; aOv: number; bOv: number; delta: number }[] = [];
  for (const sb of b.scorecards) {
    const sa = aByProfile.get(sb.profile_id);
    if (!sa) continue;
    const aOv = overallScore(sa);
    const bOv = overallScore(sb);
    rows.push({
      profile_id: sb.profile_id,
      aOv,
      bOv,
      delta: bOv - aOv,
    });
  }
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  lines.push(`## Per-profile overall deltas`);
  lines.push("");
  lines.push(`| Profile | A overall | B overall | Δ (B − A) |`);
  lines.push(`| --- | --- | --- | --- |`);
  for (const r of rows) {
    const sign = r.delta > 0 ? "+" : "";
    lines.push(
      `| ${r.profile_id} | ${r.aOv.toFixed(2)} | ${r.bOv.toFixed(2)} | ${r.delta === 0 ? "" : sign}${r.delta.toFixed(2)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ============================================================================
// CLI
// ============================================================================

interface CliArgs {
  dirs: string[];
  markdownOut: string | null;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dirs: [], markdownOut: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--markdown") {
      out.markdownOut = argv[i + 1] ?? null;
      if (!out.markdownOut) throw new Error("--markdown requires a path");
      i += 1;
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      out.dirs.push(a);
    }
  }
  return out;
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage: bun run eval/render.ts <results-dir> [<results-dir-b>] [--markdown <out.md>]",
      "",
      "  <results-dir>         Path to eval/results/<run-id>/ produced by E-023.",
      "  --markdown <out.md>   Also write a markdown report to <out.md>.",
      "",
      "If two results directories are passed, a comparison view is rendered.",
      "",
      "Environment:",
      "  NO_COLOR=1            Disable ANSI colors in terminal output.",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error((err as Error).message);
    printHelp();
    process.exit(2);
  }

  if (args.help || args.dirs.length === 0) {
    printHelp();
    process.exit(args.help ? 0 : 2);
  }

  if (args.dirs.length === 1) {
    const dir = args.dirs[0];
    const { summary, scorecards, conversations } = loadResultsDir(dir);
    // eslint-disable-next-line no-console
    console.log(renderTerminal(summary, scorecards, conversations, dir));
    if (args.markdownOut) {
      const md = renderMarkdown(summary, scorecards, conversations);
      writeFileSync(args.markdownOut, md, "utf-8");
      // eslint-disable-next-line no-console
      console.log(`\nWrote markdown report: ${args.markdownOut}`);
    }
  } else if (args.dirs.length === 2) {
    const a = loadResultsDir(args.dirs[0]);
    const b = loadResultsDir(args.dirs[1]);
    // eslint-disable-next-line no-console
    console.log(renderComparisonTerminal(a, b));
    if (args.markdownOut) {
      const md = renderComparisonMarkdown(a, b);
      writeFileSync(args.markdownOut, md, "utf-8");
      // eslint-disable-next-line no-console
      console.log(`\nWrote markdown comparison: ${args.markdownOut}`);
    }
  } else {
    // eslint-disable-next-line no-console
    console.error(`Too many positional args (max 2 dirs): ${args.dirs.join(" ")}`);
    process.exit(2);
  }
}

await main();
