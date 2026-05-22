#!/usr/bin/env bun
/**
 * Smoke test for guided-walk.ts. Runs ONE retrieval against a synthetic
 * client message and prints the bundle + per-step telemetry. Confirms the
 * algorithm completes, the walker makes structured decisions, the bundle
 * stays small, and there are no infinite loops.
 *
 * Usage:
 *   bun run coach-app/retrieval/_smoke_guided_walk.ts [--model claude-haiku-4-5|claude-sonnet-4-6]
 *
 * Cost: ~$0.005-0.02 per run depending on walker model.
 */

import { retrieveByGuidedWalk } from "./guided-walk.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let model = "claude-haiku-4-5";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--model") model = args[++i];
  }
  console.error(`Smoke test: guided-walk with walker=${model}\n`);

  // A canonical "presenting concern" prompt that should pull seeds from
  // concerns/ — pleasing-others / authority freeze / etc.
  const clientMessage =
    "I freeze around my boss. It's like I'm seven again with my dad. I want to figure out what's underneath it.";

  const t0 = Date.now();
  const result = await retrieveByGuidedWalk({
    clientMessage,
    recentHistory: [],
    walkerModel: model,
    profile_id: "smoke",
  });
  const ms = Date.now() - t0;

  console.error(`Done in ${ms}ms`);
  console.error(`Stop reason: ${result.telemetry.stop_reason}`);
  console.error(`Step count: ${result.telemetry.step_count}`);
  console.error(`Bundle size: ${result.telemetry.bundle_ids.length}`);
  console.error(`Acceptance rate: ${(result.telemetry.bundle_acceptance_rate * 100).toFixed(0)}%`);
  console.error(`Seeds: ${JSON.stringify(result.telemetry.seeds)}`);
  console.error(`Seed cost: $${result.telemetry.seed_detection_cost_usd.toFixed(5)}`);
  console.error(`Walker cost: $${result.telemetry.walker_total_cost_usd.toFixed(5)}`);
  console.error(`Total retrieval cost: $${result.telemetry.total_cost_usd.toFixed(5)}\n`);

  console.error("BUNDLE:");
  for (let i = 0; i < result.telemetry.bundle_ids.length; i += 1) {
    console.error(`  ${i + 1}. ${result.telemetry.bundle_paths[i]}`);
    console.error(`     reason: ${result.telemetry.bundle_reasons[i]}`);
  }
  console.error("");

  console.error("STEPS:");
  for (const s of result.telemetry.steps) {
    const tag = s.kept_in_bundle ? "[KEEP]" : "[SKIP]";
    console.error(
      `  step ${s.step} ${tag} ${s.file_path} (${s.candidate_edges.length} edges→ followed ${s.edges_followed.length})`,
    );
    console.error(`    bundle_reason: ${s.decision.bundle_reason}`);
    console.error(`    follow_reason: ${s.decision.follow_reason}`);
    if (s.edges_followed.length > 0) {
      console.error(`    followed: ${s.edges_followed.join(", ")}`);
    }
  }

  console.error("");
  console.error("INJECTION PREVIEW (first 400 chars):");
  console.error(result.injection.slice(0, 400) + (result.injection.length > 400 ? "..." : ""));
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
