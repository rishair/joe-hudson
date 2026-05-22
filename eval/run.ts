#!/usr/bin/env bun
/**
 * E-023: Multi-turn eval harness for the Joe Hudson AI coach.
 *
 * Subcommands:
 *   bun run eval/run.ts smoke              -- run smoke test (2 profiles)
 *   bun run eval/run.ts full               -- run full suite (all profiles)
 *   bun run eval/run.ts validate-schemas   -- load every artifact via Zod
 *   bun run eval/run.ts corrupt-test       -- prove malformed YAML fails loudly
 *   bun run eval/run.ts score-gold         -- E-025 judge calibration on gold convos
 *
 * Options for smoke / full:
 *   --coach <path>          path to coach config YAML (default: eval/coach-configs/naive-aoa.yaml)
 *   --profiles <ids>        comma-separated profile IDs (smoke only; defaults vary)
 *   --judge-model <name>    override judge model (default: claude-opus-4-5)
 *   --client-model <name>   override client model (default: claude-sonnet-4-5)
 *   --max-turns <n>         override per-conversation hard cap
 *   --concurrency <n>       judge call concurrency (default: 6)
 *   --no-cache              disable cache for this run (still writes new entries)
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, unlinkSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import pLimit from "p-limit";

import { ResponseCache } from "./lib/cache.ts";
import { AnthropicWrapper } from "./lib/anthropic.ts";
import {
  loadAllProfiles,
  loadAllRubrics,
  loadSafetyCriteria,
  loadMethodologyChecklist,
  loadAllAntiPatternTests,
  loadGoldExchanges,
  loadCoachConfig,
  loadClientPromptTemplate,
  loadProfile,
} from "./lib/loaders.ts";
import { runConversation } from "./lib/conversation.ts";
import { buildRetriever, shutdownRetrieverSingletons } from "./lib/retrieval-adapter.ts";
import { scoreConversation } from "./lib/judge.ts";
import { buildScorecard, summarizeRun } from "./lib/aggregate.ts";
import type { Profile, ClientConfig, JudgeConfig } from "./lib/schemas.ts";
import {
  loadHandCraftedCalibration,
  adaptGoldExchangesToCalibration,
  resolveProfile,
  scoreCalibrationItem,
  aggregateCalibration,
  computeSelfConsistency,
  type CalibrationScorecard,
} from "./lib/calibration.ts";

// ---------------- Paths ----------------

const ROOT = resolve(import.meta.dir, "..");
const PATHS = {
  profiles: join(ROOT, "eval", "profiles"),
  rubrics: join(ROOT, "eval", "rubrics"),
  safetyCriteria: join(ROOT, "eval", "safety-criteria.yaml"),
  methodology: join(ROOT, "eval", "checklists", "methodology.yaml"),
  antiPatterns: join(ROOT, "eval", "anti-pattern-tests"),
  goldExchanges: join(ROOT, "eval", "gold-exchanges"),
  clientTemplate: join(ROOT, "eval", "client-prompt-template.md"),
  results: join(ROOT, "eval", "results"),
  cache: join(ROOT, "eval", "cache"),
  coachConfigDefault: join(ROOT, "eval", "coach-configs", "naive-aoa.yaml"),
  calibrationConvs: join(ROOT, "eval", "calibration", "conversations"),
  calibrationResults: join(ROOT, "eval", "calibration", "results"),
};

// ---------------- CLI parsing ----------------

interface CliOpts {
  cmd: string;
  coachConfigPath: string;
  profileIds: string[];
  judgeModel?: string;
  clientModel?: string;
  maxTurns?: number;
  concurrency: number;
  useCache: boolean;
  outDir?: string;
  /** score-gold only: how many independent judging runs to perform per item.
   *  >= 2 enables self-consistency reporting. */
  runs: number;
  /** score-gold only: optional comma-separated calibration item IDs to filter to. */
  itemIds: string[];
  /** score-gold only: include real-Joe (E-026) gold exchanges. Default true. */
  includeRealJoe: boolean;
  /** score-gold only: include hand-crafted calibration items. Default true. */
  includeHandCrafted: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const cmd = argv[0] ?? "smoke";
  const opts: CliOpts = {
    cmd,
    coachConfigPath: PATHS.coachConfigDefault,
    profileIds: [],
    concurrency: 6,
    useCache: true,
    runs: 2,
    itemIds: [],
    includeRealJoe: true,
    includeHandCrafted: true,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--coach") opts.coachConfigPath = argv[++i];
    else if (a === "--profiles") opts.profileIds = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--judge-model") opts.judgeModel = argv[++i];
    else if (a === "--client-model") opts.clientModel = argv[++i];
    else if (a === "--max-turns") opts.maxTurns = Number(argv[++i]);
    else if (a === "--concurrency") opts.concurrency = Number(argv[++i]);
    else if (a === "--out") opts.outDir = argv[++i];
    else if (a === "--no-cache") opts.useCache = false;
    else if (a === "--runs") opts.runs = Math.max(1, Number(argv[++i]));
    else if (a === "--items") opts.itemIds = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--only-hand-crafted") opts.includeRealJoe = false;
    else if (a === "--only-real-joe") opts.includeHandCrafted = false;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      printHelp();
      process.exit(2);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: bun run eval/run.ts <subcommand> [options]

Subcommands:
  smoke              Run 2 default profiles end-to-end
  full               Run all profiles
  validate-schemas   Load all artifacts through Zod; exit non-zero on failure
  corrupt-test       Write a corrupted profile and confirm Zod rejects it
  score-gold         E-025 judge calibration: score gold conversations and
                     compare to expected_scores. Runs each item N times
                     (default 2) for self-consistency.

Options (for smoke/full):
  --coach <path>          coach config YAML (default: eval/coach-configs/naive-aoa.yaml)
  --profiles <ids>        comma-separated profile IDs (overrides default selection)
  --judge-model <name>    judge model (default: claude-opus-4-7)
  --client-model <name>   client model (default: claude-sonnet-4-6)
  --max-turns <n>         override per-conversation hard turn cap
  --concurrency <n>       judge call concurrency (default: 6)
  --no-cache              disable cache hits (still writes entries)
  --out <dir>             results output directory (default: eval/results/<run-id>)

Options (for score-gold):
  --runs <n>              independent judging runs per item (default 2; >=2 enables self-consistency)
  --items <ids>           comma-separated calibration item IDs to score
  --only-hand-crafted     skip E-026 real-Joe gold exchanges
  --only-real-joe         skip hand-crafted calibration conversations
  --judge-model <name>    judge model (default: claude-opus-4-7)
  --concurrency <n>       judge call concurrency (default: 6)
  --no-cache              disable cache hits (still writes entries)
  --out <dir>             results output directory (default: eval/calibration/results/<run-id>)
`);
}

// ---------------- Subcommands ----------------

function ensureApiKey(): string {
  // Bun auto-loads .env from cwd. Fall back to standard env.
  const key = (Bun.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY not set. Add it to .env at repo root or export in shell.",
    );
  }
  return key;
}

function makeRunId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function cmdValidateSchemas(): Promise<number> {
  console.log("Validating all eval artifacts via Zod...");
  const profiles = loadAllProfiles(PATHS.profiles);
  console.log(`  profiles:     ${profiles.length} loaded`);
  const rubrics = loadAllRubrics(PATHS.rubrics);
  console.log(`  rubrics:      ${rubrics.length} loaded`);
  const safety = loadSafetyCriteria(PATHS.safetyCriteria);
  console.log(`  safety:       ${safety.length} criteria loaded`);
  const methodology = loadMethodologyChecklist(PATHS.methodology);
  const mTotal =
    (methodology.questions?.length ?? 0) +
    (methodology.reads?.length ?? 0) +
    (methodology.moves?.length ?? 0) +
    (methodology.frameworks?.length ?? 0);
  console.log(`  methodology:  ${mTotal} entries (q/r/m/f)`);
  const antiPatterns = loadAllAntiPatternTests(PATHS.antiPatterns);
  console.log(`  anti-patts:   ${antiPatterns.length} loaded`);
  const golds = loadGoldExchanges(PATHS.goldExchanges);
  console.log(`  gold:         ${golds.length} loaded`);
  const tpl = loadClientPromptTemplate(PATHS.clientTemplate);
  console.log(`  client tpl:   ${tpl.length} chars`);
  const coach = loadCoachConfig(PATHS.coachConfigDefault);
  console.log(`  coach config: ${coach.id} (model=${coach.model})`);
  console.log("All schemas validated successfully.");
  return 0;
}

async function cmdCorruptTest(): Promise<number> {
  // Make a copy of a profile, corrupt it by removing a required field, attempt
  // to load it, confirm Zod throws an error naming the field. Then clean up.
  const sample = join(PATHS.profiles, "happy-am-i-selfish-001.yaml");
  const tmp = join(PATHS.profiles, "__corrupt_test__.yaml");
  try {
    const raw = readFileSync(sample, "utf8");
    // Corrupt: rename `breakthrough_condition:` to `breakthroug_condition:` to
    // simulate a typo. This is a required field — Zod must fail.
    const corrupted = raw.replace(/^breakthrough_condition:/m, "breakthroug_condition:");
    if (corrupted === raw) {
      throw new Error("Could not corrupt sample profile (regex did not match)");
    }
    writeFileSync(tmp, corrupted, "utf8");
    let err: Error | null = null;
    try {
      loadProfile(tmp);
    } catch (e: any) {
      err = e;
    }
    if (!err) {
      console.error("FAIL: Zod did not reject the corrupted profile.");
      return 1;
    }
    const msg = String(err.message);
    if (!/breakthrough_condition/.test(msg)) {
      console.error(`FAIL: Zod error does not name 'breakthrough_condition'.\nGot: ${msg}`);
      return 1;
    }
    console.log("PASS: Zod rejected the corrupted profile at load time and named the missing field.");
    console.log("  --- error message ---");
    console.log("  " + msg.split("\n").join("\n  "));
    return 0;
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

async function cmdRun(opts: CliOpts, mode: "smoke" | "full"): Promise<number> {
  // Load everything.
  const allProfiles = loadAllProfiles(PATHS.profiles);
  const rubrics = loadAllRubrics(PATHS.rubrics);
  const safetyCriteria = loadSafetyCriteria(PATHS.safetyCriteria);
  const goldExchanges = loadGoldExchanges(PATHS.goldExchanges);
  const clientTemplate = loadClientPromptTemplate(PATHS.clientTemplate);
  const coachConfig = loadCoachConfig(opts.coachConfigPath);

  // Light schema sanity on the methodology checklist & anti-patterns (loaded
  // even if not directly consumed by the current judge prompt; future
  // dimension-aware passes will reference them).
  loadMethodologyChecklist(PATHS.methodology);
  loadAllAntiPatternTests(PATHS.antiPatterns);

  console.log(`Loaded ${allProfiles.length} profiles, ${rubrics.length} rubrics, ${safetyCriteria.length} safety criteria, ${goldExchanges.length} gold exchanges.`);

  let chosenProfiles: Profile[];
  if (opts.profileIds.length > 0) {
    chosenProfiles = allProfiles.filter((p) => opts.profileIds.includes(p.id));
    const missing = opts.profileIds.filter((id) => !chosenProfiles.find((p) => p.id === id));
    if (missing.length > 0) {
      console.error(`ERROR: requested profile IDs not found: ${missing.join(", ")}`);
      console.error(`Available IDs:\n  ${allProfiles.map((p) => p.id).join("\n  ")}`);
      return 2;
    }
  } else if (mode === "smoke") {
    // Default smoke selection: one happy_path + one resistance.
    const happy = allProfiles.find((p) => p.scenario_type === "happy_path");
    const resistance = allProfiles.find((p) => p.scenario_type === "resistance");
    chosenProfiles = [happy, resistance].filter((p): p is Profile => Boolean(p));
    if (chosenProfiles.length < 2) {
      console.error("Could not assemble default smoke selection.");
      return 2;
    }
  } else {
    chosenProfiles = allProfiles;
  }

  console.log(`Mode: ${mode}. Coach: ${coachConfig.id} (${coachConfig.model}). Profiles (${chosenProfiles.length}):`);
  for (const p of chosenProfiles) {
    console.log(`  - ${p.id} (${p.scenario_type})`);
  }

  const judgeConfig: JudgeConfig = {
    model: opts.judgeModel ?? "claude-opus-4-7",
    temperature: 0,
    max_tokens: 2048,
  };
  const clientConfig: ClientConfig = {
    model: opts.clientModel ?? "claude-sonnet-4-6",
    temperature: 0.7,
    max_tokens: 1024,
  };
  console.log(`Judge model:  ${judgeConfig.model}`);
  console.log(`Client model: ${clientConfig.model}`);

  // Set up API + cache.
  const apiKey = ensureApiKey();
  const runId = makeRunId();
  const outDir = opts.outDir ?? join(PATHS.results, runId);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // Cache: if --no-cache, point at a throwaway directory so reads always miss
  // but writes still happen (so a second run with cache enabled benefits).
  const cacheDir = opts.useCache ? PATHS.cache : join(PATHS.cache, "__nocache_throwaway__");
  const cache = new ResponseCache(cacheDir);
  const api = new AnthropicWrapper(apiKey, cache);

  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const profileLimit = pLimit(3); // 3 conversations in flight at once

  // Build the retriever once from the coach config; reuse for every profile.
  // Returns undefined when retrieval.strategy === "none".
  const retriever = buildRetriever(coachConfig);
  if (retriever) {
    console.log(
      `Retrieval enabled: strategy=${coachConfig.retrieval.strategy}, trigger=${coachConfig.trigger_policy}`,
    );
  }

  const scorecardsPromises = chosenProfiles.map((profile) =>
    profileLimit(async () => {
      console.log(`[${profile.id}] starting conversation...`);
      const convStart = Date.now();
      const conv = await runConversation({
        api,
        profile,
        coachConfig,
        clientConfig,
        clientTemplate,
        hardMaxTurns: opts.maxTurns,
        retriever,
      });
      console.log(
        `[${profile.id}] conversation done in ${Math.round((Date.now() - convStart) / 1000)}s, ${conv.turns.length} turns, termination=${conv.termination}.`,
      );

      const judgeStart = Date.now();
      const { safety, dimensions, errors } = await scoreConversation({
        api,
        judgeConfig,
        rubrics,
        criteria: safetyCriteria,
        profile,
        turns: conv.turns,
        goldExchanges,
        concurrency: opts.concurrency,
      });
      // Attribute judge calls by stamped profile_id, not a positional slice.
      // Positional slicing triple-counts in parallel because other workers'
      // calls land in the slice window (E-029 dead-end). With each call
      // record now carrying its profile_id we filter precisely.
      const judgeRecords = api.callLog.filter(
        (r) => r.profile_id === profile.id && r.purpose.startsWith("judge:"),
      );
      console.log(
        `[${profile.id}] judging done in ${Math.round((Date.now() - judgeStart) / 1000)}s. safety_pass=${safety.safety_pass}, dims_scored=${dimensions.length}, errors=${errors.length}.`,
      );

      const scorecard = buildScorecard({
        conversation: conv,
        scenario_type: profile.scenario_type,
        safety,
        dimensions,
        judge_errors: errors,
        judge_call_records: judgeRecords,
      });

      // Write scorecard immediately so we have partial output if something dies.
      writeFileSync(
        join(outDir, `scorecard.${profile.id}.json`),
        JSON.stringify(scorecard, null, 2),
        "utf8",
      );
      // Also write the raw conversation for later inspection.
      writeFileSync(
        join(outDir, `conversation.${profile.id}.json`),
        JSON.stringify(conv, null, 2),
        "utf8",
      );

      return scorecard;
    }),
  );

  const scorecards = await Promise.all(scorecardsPromises);
  // Tear down any retrieval singletons (e.g., the persistent Python embedding
  // subprocess spawned by the embedding strategy). Safe no-op for strategies
  // that don't allocate singletons.
  await shutdownRetrieverSingletons();
  const finishedAt = new Date().toISOString();
  const wallClock = Date.now() - t0;

  const summary = summarizeRun({
    run_id: runId,
    coach_config_id: coachConfig.id,
    judge_model: judgeConfig.model,
    started_at: startedAt,
    finished_at: finishedAt,
    scorecards,
    wall_clock_ms: wallClock,
  });

  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  // Write cost log as JSONL (per-call) for granular inspection.
  const costLog = api.callLog
    .map((r) => JSON.stringify(r))
    .join("\n");
  writeFileSync(join(outDir, "cost_log.jsonl"), costLog, "utf8");

  // Print a brief summary table to console.
  console.log("\n========== RUN SUMMARY ==========");
  console.log(`Run ID:                ${runId}`);
  console.log(`Coach:                 ${coachConfig.id} (${coachConfig.model})`);
  console.log(`Judge:                 ${judgeConfig.model}`);
  console.log(`Profiles:              ${summary.total_profiles}`);
  console.log(`Wall clock:            ${Math.round(wallClock / 1000)}s`);
  console.log(`Total API calls:       ${summary.total_calls} (${summary.total_cached_calls} cached)`);
  console.log(`Total cost (USD):      $${summary.total_cost_usd.toFixed(4)}`);
  console.log(`Safety pass rate:      ${(summary.safety_pass_rate * 100).toFixed(0)}%`);
  console.log(`Aggregate pass rate:   ${(summary.aggregate_pass_rate * 100).toFixed(0)}%`);
  console.log(`Per-dimension means:`);
  for (const [dim, agg] of Object.entries(summary.per_dimension_means)) {
    console.log(`  ${dim.padEnd(28)} ${agg.mean.toFixed(2)} (n=${agg.count})`);
  }
  console.log(`Output:                ${outDir}`);
  console.log(`Local cache:           hits=${cache.hits} misses=${cache.misses}`);

  // Anthropic prompt-cache statistics (separate from local file cache).
  const liveCalls = api.callLog.filter((r) => !r.cached);
  const totCacheRead = liveCalls.reduce((a, r) => a + r.cache_read_input_tokens, 0);
  const totCacheWrite = liveCalls.reduce((a, r) => a + r.cache_creation_input_tokens, 0);
  const totUncachedIn = liveCalls.reduce((a, r) => a + r.input_tokens, 0);
  console.log(`Anthropic prompt cache: read=${totCacheRead.toLocaleString()} tokens  write=${totCacheWrite.toLocaleString()} tokens  uncached_input=${totUncachedIn.toLocaleString()} tokens`);

  return 0;
}

// ---------------- score-gold (E-025) ----------------

async function cmdScoreGold(opts: CliOpts): Promise<number> {
  // Load everything the judge needs (no client, no coach — we score existing
  // conversations).
  const rubrics = loadAllRubrics(PATHS.rubrics);
  const safetyCriteria = loadSafetyCriteria(PATHS.safetyCriteria);
  const goldExchanges = loadGoldExchanges(PATHS.goldExchanges);
  const allProfiles = loadAllProfiles(PATHS.profiles);

  // Load calibration conversations.
  const handCrafted = opts.includeHandCrafted
    ? loadHandCraftedCalibration(PATHS.calibrationConvs)
    : [];
  const realJoe = opts.includeRealJoe ? adaptGoldExchangesToCalibration(goldExchanges) : [];
  let items = [...handCrafted, ...realJoe];

  if (opts.itemIds.length > 0) {
    const wanted = new Set(opts.itemIds);
    items = items.filter((i) => wanted.has(i.id));
    if (items.length === 0) {
      console.error(`No calibration items match --items: ${opts.itemIds.join(",")}`);
      console.error(`Available IDs:\n  ${[...handCrafted, ...realJoe].map((i) => i.id).join("\n  ")}`);
      return 2;
    }
  }

  console.log(`E-025 Calibration: ${items.length} items, ${opts.runs} run(s) each.`);
  console.log(`Loaded ${rubrics.length} rubrics, ${safetyCriteria.length} safety criteria, ${goldExchanges.length} gold exchanges, ${allProfiles.length} profiles.`);
  for (const i of items) {
    console.log(`  - ${i.id} (${i.kind}) profile_ref=${i.profile_ref ?? "(synthesized)"}`);
  }

  const judgeConfig: JudgeConfig = {
    model: opts.judgeModel ?? "claude-opus-4-7",
    temperature: 0,
    max_tokens: 2048,
  };
  console.log(`Judge model: ${judgeConfig.model}`);

  const apiKey = ensureApiKey();
  const runId = makeRunId();
  const outDir = opts.outDir ?? join(PATHS.calibrationResults, runId);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const cacheDir = opts.useCache ? PATHS.cache : join(PATHS.cache, "__nocache_throwaway__");
  const cache = new ResponseCache(cacheDir);
  const api = new AnthropicWrapper(apiKey, cache);

  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // For each run (1..opts.runs), score every item. Within a run, we score
  // items sequentially (each item's safety+dimension judges parallelize
  // internally), to keep concurrency bounded.
  const allScorecards: CalibrationScorecard[][] = [];

  for (let runIdx = 1; runIdx <= opts.runs; runIdx++) {
    const runLabel = `run-${runIdx}`;
    console.log(`\n========== ${runLabel} ==========`);
    const runScorecards: CalibrationScorecard[] = [];
    for (const item of items) {
      // Resolve the profile to use as judge context.
      let profile: Profile;
      try {
        profile = resolveProfile(item, allProfiles, PATHS.profiles);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[${item.id}] could not resolve profile: ${msg}`);
        continue;
      }

      const itemStart = Date.now();
      try {
        const { scorecard, rawSafety, rawDimensions } = await scoreCalibrationItem({
          item,
          profile,
          api,
          judgeConfig,
          rubrics,
          criteria: safetyCriteria,
          goldExchanges,
          runLabel,
          concurrency: opts.concurrency,
          // Cache-bust per run so successive runs hit the API fresh.
          cacheBust: opts.runs > 1 ? `cal:${runLabel}` : undefined,
        });
        runScorecards.push(scorecard);

        // Per-item summary line.
        const dt = Math.round((Date.now() - itemStart) / 1000);
        const meanActual = scorecard.dimension_deltas.length > 0
          ? (scorecard.dimension_deltas.reduce((a, d) => a + d.actual, 0) / scorecard.dimension_deltas.length).toFixed(2)
          : "n/a";
        const meanExpected = scorecard.dimension_deltas.length > 0
          ? (scorecard.dimension_deltas.reduce((a, d) => a + d.expected, 0) / scorecard.dimension_deltas.length).toFixed(2)
          : "n/a";
        const safetyTag = scorecard.safety_match.matches ? "safety:OK" : "safety:MISMATCH";
        console.log(`[${runLabel}] ${item.id.padEnd(46)} mean=${meanActual} exp=${meanExpected} ${safetyTag} dt=${dt}s`);

        // Write per-item per-run scorecard.
        writeFileSync(
          join(outDir, `score.${runLabel}.${item.id}.json`),
          JSON.stringify(
            {
              ...scorecard,
              raw_safety_screen: rawSafety,
              raw_dimension_scores: rawDimensions,
            },
            null,
            2,
          ),
          "utf8",
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[${runLabel}] ${item.id} ERROR: ${msg}`);
      }
    }
    allScorecards.push(runScorecards);
  }

  const finishedAt = new Date().toISOString();
  const wallClock = Date.now() - t0;

  // Aggregate per-run.
  const perRunReports = allScorecards.map((scs) => aggregateCalibration(scs));

  // Self-consistency between run 1 and run 2 if available.
  const selfConsistency = allScorecards.length >= 2
    ? computeSelfConsistency(allScorecards[0], allScorecards[1])
    : null;

  // Print a final summary table.
  console.log("\n========== CALIBRATION SUMMARY ==========");
  console.log(`Run ID:                ${runId}`);
  console.log(`Items:                 ${items.length}`);
  console.log(`Independent runs:      ${opts.runs}`);
  console.log(`Wall clock:            ${Math.round(wallClock / 1000)}s`);
  console.log(`Total API calls:       ${api.callLog.length} (${api.callLog.filter((r) => r.cached).length} local-cache hits)`);
  console.log(`Total cost (USD):      $${api.totalCost().toFixed(4)}`);

  for (let i = 0; i < perRunReports.length; i++) {
    const r = perRunReports[i];
    console.log(`\n--- run-${i + 1} report ---`);
    console.log(`  items scored:        ${r.total_items}`);
    console.log(`  dim pairs (item×dim):${r.dimension_tolerance.total_pairs}`);
    console.log(`  rate within ±1:      ${(r.dimension_tolerance.rate_within_1 * 100).toFixed(1)}%`);
    console.log(`  rate exact match:    ${(r.dimension_tolerance.rate_exact * 100).toFixed(1)}%`);
    console.log(`  safety match rate:   ${(r.safety_results.safety_match_rate * 100).toFixed(1)}% (${r.safety_results.safety_match_count}/${r.safety_results.total_safety_relevant})`);
    console.log(`  safety false_pos:    ${r.safety_results.false_positives}   false_neg: ${r.safety_results.false_negatives}   extra_fires: ${r.safety_results.extra_fires_total}   missed_fires: ${r.safety_results.missed_fires_total}`);
    if (r.discrimination.excellent_mean !== null) {
      console.log(`  excellent_mean:      ${r.discrimination.excellent_mean}`);
    }
    if (r.discrimination.ambiguous_mean !== null) {
      console.log(`  ambiguous_mean:      ${r.discrimination.ambiguous_mean}`);
    }
    if (r.discrimination.poor_mean !== null) {
      console.log(`  poor_mean:           ${r.discrimination.poor_mean}`);
    }
    if (r.discrimination.real_joe_mean !== null) {
      console.log(`  real_joe_mean:       ${r.discrimination.real_joe_mean}`);
    }
    if (r.discrimination.spread !== null) {
      console.log(`  spread (excel-poor): ${r.discrimination.spread}`);
    }
    console.log(`  items in tolerance:  ${r.failures_in_expected_range.pass_count}/${r.total_items}`);
    console.log(`  items with >=2 pt dim divergence: ${r.failures_in_expected_range.bad_count}`);
  }

  if (selfConsistency) {
    console.log(`\n--- self-consistency (run-1 vs run-2) ---`);
    console.log(`  dim pairs compared:  ${selfConsistency.total_pairs}`);
    console.log(`  agreement within ±1: ${(selfConsistency.agreement_rate_within_1 * 100).toFixed(1)}%`);
    console.log(`  exact agreement:     ${(selfConsistency.agreement_rate_exact * 100).toFixed(1)}%`);
    console.log(`  safety agreement:    ${(selfConsistency.safety_agreement.rate * 100).toFixed(1)}% (${selfConsistency.safety_agreement.agree}/${selfConsistency.safety_agreement.total})`);
  }

  // Write the full report.
  const report = {
    run_id: runId,
    judge_model: judgeConfig.model,
    started_at: startedAt,
    finished_at: finishedAt,
    wall_clock_ms: wallClock,
    total_cost_usd: Number(api.totalCost().toFixed(4)),
    total_api_calls: api.callLog.length,
    items_scored: items.map((i) => ({ id: i.id, kind: i.kind, profile_ref: i.profile_ref })),
    per_run_reports: perRunReports,
    self_consistency: selfConsistency,
    scorecards_by_run: allScorecards.map((scs, idx) => ({
      run_label: `run-${idx + 1}`,
      scorecards: scs,
    })),
  };
  writeFileSync(join(outDir, "calibration_report.json"), JSON.stringify(report, null, 2), "utf8");

  // Write cost log JSONL.
  const costLog = api.callLog.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(join(outDir, "cost_log.jsonl"), costLog, "utf8");

  console.log(`\nOutput: ${outDir}`);
  console.log(`Local cache: hits=${cache.hits} misses=${cache.misses}`);

  // Anthropic prompt-cache statistics.
  const liveCalls = api.callLog.filter((r) => !r.cached);
  const totCacheRead = liveCalls.reduce((a, r) => a + r.cache_read_input_tokens, 0);
  const totCacheWrite = liveCalls.reduce((a, r) => a + r.cache_creation_input_tokens, 0);
  const totUncachedIn = liveCalls.reduce((a, r) => a + r.input_tokens, 0);
  console.log(`Anthropic prompt cache: read=${totCacheRead.toLocaleString()} tokens  write=${totCacheWrite.toLocaleString()} tokens  uncached_input=${totUncachedIn.toLocaleString()} tokens`);

  return 0;
}

// ---------------- Entry ----------------

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  switch (opts.cmd) {
    case "validate-schemas":
      return await cmdValidateSchemas();
    case "corrupt-test":
      return await cmdCorruptTest();
    case "smoke":
      return await cmdRun(opts, "smoke");
    case "full":
      return await cmdRun(opts, "full");
    case "score-gold":
      return await cmdScoreGold(opts);
    default:
      printHelp();
      return 2;
  }
}

main()
  .then((code) => {
    // Always explicitly exit — retrieval strategies that spawn helper
    // subprocesses (e.g., E-033's Python embedding server) can leave pipes
    // open that prevent the natural event-loop drain.
    process.exit(code);
  })
  .catch((e) => {
    console.error("FATAL:", e?.message ?? e);
    if (e?.stack) console.error(e.stack);
    process.exit(1);
  });
