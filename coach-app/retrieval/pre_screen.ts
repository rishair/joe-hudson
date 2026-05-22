#!/usr/bin/env bun
/**
 * E-033 free pre-screen (per R-012): for each profile, run the retriever
 * against the opening_statement(s) and against the mid-conversation
 * resistance text, then compute precision/recall of retrieved file IDs
 * against the profile's `expected_territory` block. If averaged recall is
 * below 40%, retrieval has no plausible path to D4 ≥ 2.50; debug before
 * paying for full eval.
 *
 * Usage:
 *   bun run coach-app/retrieval/pre_screen.ts [--mode hybrid|dense|bm25]
 *     [--profiles id1,id2] [--k 5] [--out <path.json>]
 *
 * Output: JSON report with per-profile precision/recall and a headline avg.
 * Also prints a human-readable summary to stderr.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import {
  loadEmbeddingIndex,
  EmbeddingRetriever,
  type RetrievalResult,
} from "./embeddings.ts";

interface ProfileExpected {
  id: string;
  scenario_type: string;
  opening_statements: string[];
  mid_conversation_resistance: string;
  expected_territory: Record<string, string[]>;
  safety_disclosures?: Array<{ disclosure?: string; text_hint?: string }>;
}

function loadProfile(path: string): ProfileExpected {
  const raw = readFileSync(path, "utf8");
  const p = parseYaml(raw) as Record<string, unknown>;
  return {
    id: String(p.id ?? ""),
    scenario_type: String(p.scenario_type ?? ""),
    opening_statements: Array.isArray(p.opening_statements)
      ? (p.opening_statements as string[])
      : [],
    mid_conversation_resistance: String(p.mid_conversation_resistance ?? ""),
    expected_territory: (p.expected_territory as Record<string, string[]>) ?? {},
    safety_disclosures: (p.safety_disclosures as Array<{
      disclosure?: string;
      text_hint?: string;
    }>) ?? [],
  };
}

interface ScreenArgs {
  mode: "hybrid" | "dense" | "bm25";
  profileFilter: string[] | null;
  k: number;
  outPath: string | null;
  indexPath: string;
  profilesDir: string;
}

function parseArgs(argv: string[]): ScreenArgs {
  const out: ScreenArgs = {
    mode: "hybrid",
    profileFilter: null,
    k: 5,
    outPath: null,
    indexPath: "coach-app/index.db",
    profilesDir: "eval/profiles",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") {
      const m = argv[++i];
      if (m !== "hybrid" && m !== "dense" && m !== "bm25")
        throw new Error(`Unknown --mode: ${m}`);
      out.mode = m;
    } else if (a === "--profiles") {
      out.profileFilter = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--k") {
      out.k = Math.max(1, Number(argv[++i]));
    } else if (a === "--out") {
      out.outPath = argv[++i];
    } else if (a === "--index") {
      out.indexPath = argv[++i];
    } else if (a === "--profiles-dir") {
      out.profilesDir = argv[++i];
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: bun run coach-app/retrieval/pre_screen.ts [options]
  --mode hybrid|dense|bm25   (default: hybrid)
  --profiles id1,id2         (filter profiles)
  --k <n>                    top-K per query (default: 5)
  --index <path>             SQLite index (default: coach-app/index.db)
  --profiles-dir <path>      eval profiles dir (default: eval/profiles)
  --out <path>               write JSON report
`);
      process.exit(0);
    }
  }
  return out;
}

/**
 * The expected_territory IDs in profiles are bare slugs like "i-freeze-around-authority"
 * or full slashed paths like "anti-patterns/dont-confuse-embracing-fear-with-inviting-danger".
 * The retriever returns file_id in the form "category/slug". We normalize both sides
 * to the bare slug for comparison (precision/recall on slug match).
 *
 * Inside profiles the field is grouped by category:
 *   concerns: [list of slugs]
 *   reads:    [list of slugs]
 *   moves:    [list of slugs]
 *   concepts: [list of slugs]
 *   patterns: [list of slugs]
 *   questions: [list of strings, NOT slugs — these are query strings, ignored]
 *   anti_patterns_to_avoid: [list of slugs]
 */
function expectedToSlugs(et: Record<string, string[]>): Set<string> {
  const slugs = new Set<string>();
  const KEYS = [
    "concerns",
    "reads",
    "moves",
    "concepts",
    "patterns",
    "distinctions",
    "principles",
    "frameworks",
    "practices",
    "anti_patterns_to_avoid",
  ];
  for (const k of KEYS) {
    const arr = et[k];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item) continue;
      // strip leading "category/" if present
      const slug = item.includes("/") ? item.split("/").pop()! : item;
      // strip ".md" suffix if present
      slugs.add(slug.replace(/\.md$/, ""));
    }
  }
  return slugs;
}

function slugFromFileId(fid: string): string {
  return fid.split("/").pop() ?? fid;
}

interface PerQueryResult {
  query: string;
  query_kind: "opening" | "mid_resistance" | "safety_disclosure";
  retrieved: string[]; // file_ids
  retrieved_slugs: string[];
  hits: string[]; // intersection with expected_territory slugs
  precision: number;
  recall: number;
}

interface PerProfileReport {
  profile_id: string;
  scenario_type: string;
  expected_slugs: string[];
  per_query: PerQueryResult[];
  union_recall: number; // recall when pooling retrievals across all queries
  union_hits: string[];
  avg_precision: number;
  avg_recall: number;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  process.stderr.write(
    `[pre_screen] mode=${args.mode} k=${args.k} index=${args.indexPath}\n`,
  );

  const index = loadEmbeddingIndex(args.indexPath);
  process.stderr.write(
    `[pre_screen] index: ${index.docs.length} docs, model=${index.model_name}\n`,
  );

  const retriever = new EmbeddingRetriever(index);

  const profilesDir = resolve(args.profilesDir);
  let profileFiles = readdirSync(profilesDir).filter((f) => f.endsWith(".yaml"));
  if (args.profileFilter) {
    const wanted = new Set(args.profileFilter);
    profileFiles = profileFiles.filter((f) => {
      const path = join(profilesDir, f);
      const p = loadProfile(path);
      return wanted.has(p.id);
    });
  }

  const reports: PerProfileReport[] = [];
  for (const f of profileFiles) {
    const profile = loadProfile(join(profilesDir, f));
    const expectedSlugs = expectedToSlugs(profile.expected_territory);
    if (expectedSlugs.size === 0) {
      process.stderr.write(
        `[pre_screen] ${profile.id}: empty expected_territory; skipping.\n`,
      );
      continue;
    }

    const queries: Array<{ q: string; kind: PerQueryResult["query_kind"] }> = [];
    // Use the first opening_statement and the mid_conversation_resistance text.
    if (profile.opening_statements[0]) {
      queries.push({
        q: profile.opening_statements[0],
        kind: "opening",
      });
    }
    if (profile.mid_conversation_resistance) {
      queries.push({
        q: profile.mid_conversation_resistance.slice(0, 400),
        kind: "mid_resistance",
      });
    }
    // Add safety disclosures if present (these are crisis-pivot moments).
    if (profile.safety_disclosures) {
      for (const d of profile.safety_disclosures) {
        const text = d.disclosure ?? d.text_hint;
        if (text) {
          queries.push({ q: text.slice(0, 400), kind: "safety_disclosure" });
        }
      }
    }

    const perQuery: PerQueryResult[] = [];
    const unionHits = new Set<string>();
    for (const { q, kind } of queries) {
      const { results } = await retriever.retrieve(q, {
        k: args.k,
        mode: args.mode,
      });
      const retrievedSlugs = results.map((r: RetrievalResult) =>
        slugFromFileId(r.doc.file_id),
      );
      const hits = retrievedSlugs.filter((s) => expectedSlugs.has(s));
      hits.forEach((h) => unionHits.add(h));
      const precision = retrievedSlugs.length
        ? hits.length / retrievedSlugs.length
        : 0;
      const recall = expectedSlugs.size ? hits.length / expectedSlugs.size : 0;
      perQuery.push({
        query: q.slice(0, 200),
        query_kind: kind,
        retrieved: results.map((r) => r.doc.file_id),
        retrieved_slugs: retrievedSlugs,
        hits,
        precision,
        recall,
      });
    }

    const avgPrecision =
      perQuery.reduce((a, b) => a + b.precision, 0) / Math.max(1, perQuery.length);
    const avgRecall =
      perQuery.reduce((a, b) => a + b.recall, 0) / Math.max(1, perQuery.length);
    const unionRecall = unionHits.size / expectedSlugs.size;

    reports.push({
      profile_id: profile.id,
      scenario_type: profile.scenario_type,
      expected_slugs: [...expectedSlugs].sort(),
      per_query: perQuery,
      union_recall: unionRecall,
      union_hits: [...unionHits].sort(),
      avg_precision: avgPrecision,
      avg_recall: avgRecall,
    });

    process.stderr.write(
      `[pre_screen] ${profile.id.padEnd(40)} avg_recall=${(avgRecall * 100).toFixed(1)}%  union_recall=${(unionRecall * 100).toFixed(1)}%  avg_precision=${(avgPrecision * 100).toFixed(1)}%  (expected=${expectedSlugs.size}, queries=${perQuery.length})\n`,
    );
  }

  // Headlines.
  const headline = {
    mode: args.mode,
    k: args.k,
    model: index.model_name,
    profiles: reports.length,
    avg_recall: reports.reduce((a, b) => a + b.avg_recall, 0) / Math.max(1, reports.length),
    avg_union_recall: reports.reduce((a, b) => a + b.union_recall, 0) / Math.max(1, reports.length),
    avg_precision:
      reports.reduce((a, b) => a + b.avg_precision, 0) / Math.max(1, reports.length),
  };

  process.stderr.write("\n========== PRE-SCREEN SUMMARY ==========\n");
  process.stderr.write(`Mode:                ${headline.mode}\n`);
  process.stderr.write(`Profiles:            ${headline.profiles}\n`);
  process.stderr.write(`Avg recall@${args.k}:        ${(headline.avg_recall * 100).toFixed(1)}%\n`);
  process.stderr.write(
    `Avg union recall@${args.k}:  ${(headline.avg_union_recall * 100).toFixed(1)}%  (pooled across opening + mid + disclosures)\n`,
  );
  process.stderr.write(`Avg precision@${args.k}:     ${(headline.avg_precision * 100).toFixed(1)}%\n`);
  process.stderr.write(
    `R-012 gate (recall < 40% averaged):  ${headline.avg_recall < 0.4 ? "FAIL — debug retrieval before full eval" : "PASS"}\n`,
  );

  if (args.outPath) {
    const report = {
      headline,
      reports,
      generated_at: new Date().toISOString(),
    };
    writeFileSync(args.outPath, JSON.stringify(report, null, 2), "utf8");
    process.stderr.write(`Wrote ${args.outPath}\n`);
  }

  await retriever.shutdown();
  return 0;
}

main()
  .then((code) => {
    if (code !== 0) process.exit(code);
  })
  .catch((e) => {
    console.error("FATAL:", (e as Error)?.message ?? e);
    process.exit(1);
  });
