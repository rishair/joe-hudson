#!/usr/bin/env bun
/**
 * Compute expected_territory precision/recall from a results directory's
 * retrieval_telemetry. Designed for retrieval experiments E-033/E-036/E-037
 * to validate R-012's free pre-screen.
 *
 * Usage:
 *   bun run eval/lib/expected-territory-analysis.ts <results-dir>
 *
 * Output: per-profile recall@K and per-turn recall stats, plus aggregate.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import * as YAML from "yaml";
import { flattenExpectedTerritory } from "../../coach-app/retrieval/graph-walk.ts";

interface ConversationFile {
  profile_id: string;
  coach_config_id: string;
  retrieval_telemetry?: Array<{
    turn: number;
    strategy: string;
    payload: {
      seeds?: string[];
      top_k_ids?: string[];
      top_k_paths?: string[];
    } & Record<string, unknown>;
  }>;
}

function main() {
  const resultsDir = resolve(process.argv[2] ?? "");
  if (!resultsDir || !existsSync(resultsDir)) {
    console.error(`Usage: bun run eval/lib/expected-territory-analysis.ts <results-dir>`);
    process.exit(2);
  }
  const root = resolve(import.meta.dir, "..", "..");
  const profilesDir = join(root, "eval", "profiles");

  const conversationFiles = readdirSync(resultsDir)
    .filter((f) => f.startsWith("conversation.") && f.endsWith(".json"))
    .map((f) => join(resultsDir, f));

  if (conversationFiles.length === 0) {
    console.error(`No conversation.*.json files in ${resultsDir}`);
    process.exit(2);
  }

  console.log(
    `\nexpected_territory analysis for ${conversationFiles.length} conversations in ${resultsDir}`,
  );
  console.log("=".repeat(80));

  let totalProfiles = 0;
  let totalReachableSum = 0;
  let totalExpectedSum = 0;
  let cumulativeRecallSum = 0;
  let perTurnMeanRecallSum = 0;
  let perTurnRecallAt5Sum = 0;
  let allTurnsCount = 0;

  const rows: Array<{
    profile: string;
    expectedSize: number;
    cumRecall: number;
    perTurnMeanRecall: number;
    perTurnRecallAt5: number;
    cumOverlap: string[];
  }> = [];

  for (const cf of conversationFiles) {
    const conv = JSON.parse(readFileSync(cf, "utf8")) as ConversationFile;
    if (!conv.retrieval_telemetry || conv.retrieval_telemetry.length === 0) {
      continue;
    }

    // Resolve profile YAML
    const profileId = conv.profile_id;
    // Strip "client-" prefix used in profile IDs
    const profileFile = join(profilesDir, profileId.replace(/^client-/, "") + ".yaml");
    if (!existsSync(profileFile)) {
      console.error(`  [warn] profile file missing for ${profileId}: ${profileFile}`);
      continue;
    }
    const profile = YAML.parse(readFileSync(profileFile, "utf8")) as {
      expected_territory: Record<string, string[]>;
    };
    const expected = flattenExpectedTerritory(profile.expected_territory);
    if (expected.size === 0) continue;

    const cumRetrieved = new Set<string>();
    const perTurnRecalls: number[] = [];
    const perTurnRecallsAt5: number[] = [];

    for (const t of conv.retrieval_telemetry) {
      const ids: string[] = (t.payload?.top_k_ids as string[]) ?? [];
      for (const id of ids) cumRetrieved.add(id);
      const overlap = ids.filter((id) => expected.has(id));
      perTurnRecalls.push(overlap.length / expected.size);
      const overlap5 = ids.slice(0, 5).filter((id) => expected.has(id));
      perTurnRecallsAt5.push(overlap5.length / expected.size);
    }
    const cumOverlap = [...cumRetrieved].filter((id) => expected.has(id));
    const cumRecall = cumOverlap.length / expected.size;
    const meanRecall =
      perTurnRecalls.length === 0
        ? 0
        : perTurnRecalls.reduce((a, b) => a + b, 0) / perTurnRecalls.length;
    const meanRecallAt5 =
      perTurnRecallsAt5.length === 0
        ? 0
        : perTurnRecallsAt5.reduce((a, b) => a + b, 0) / perTurnRecallsAt5.length;

    rows.push({
      profile: profileId,
      expectedSize: expected.size,
      cumRecall,
      perTurnMeanRecall: meanRecall,
      perTurnRecallAt5: meanRecallAt5,
      cumOverlap,
    });

    totalProfiles += 1;
    totalExpectedSum += expected.size;
    cumulativeRecallSum += cumRecall;
    perTurnMeanRecallSum += meanRecall;
    perTurnRecallAt5Sum += meanRecallAt5;
    allTurnsCount += perTurnRecalls.length;
  }

  console.log(`\n${"Profile".padEnd(48)} ${"expN".padStart(4)} ${"cumR".padStart(6)} ${"ptR@5".padStart(6)} ptOverlap`);
  console.log("-".repeat(120));
  for (const r of rows) {
    console.log(
      `${r.profile.padEnd(48)} ${String(r.expectedSize).padStart(4)} ${r.cumRecall
        .toFixed(2)
        .padStart(6)} ${r.perTurnRecallAt5.toFixed(2).padStart(6)} ${r.cumOverlap.join(", ").slice(0, 80)}`,
    );
  }

  if (totalProfiles === 0) {
    console.log("\n(no usable conversations with retrieval telemetry and expected territory)");
    return;
  }
  console.log("\nAggregate:");
  console.log(`  Profiles analyzed:           ${totalProfiles}`);
  console.log(`  Mean cumulative recall:      ${(cumulativeRecallSum / totalProfiles).toFixed(3)}`);
  console.log(`  Mean per-turn recall @ K:    ${(perTurnMeanRecallSum / totalProfiles).toFixed(3)}`);
  console.log(`  Mean per-turn recall @ 5:    ${(perTurnRecallAt5Sum / totalProfiles).toFixed(3)}`);
  console.log(`  R-012 40% bar (per-turn @5): ${perTurnRecallAt5Sum / totalProfiles >= 0.4 ? "PASS" : "BELOW"}`);
  console.log(`  Total turns with retrieval:  ${allTurnsCount}`);
}

main();
