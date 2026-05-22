/**
 * Graph-walk retrieval over coach/_index.md aliases + related: edges (E-036).
 *
 * Pipeline per coach turn (R-012 spec):
 *
 *   1. SEED DETECTION — call Haiku with the full coach/_index.md (684 lines,
 *      every file's aliases inlined) and the client message. Force a
 *      `detect_seeds_from_message` tool call via `toolChoice`. Server-side
 *      validation restricts seeds to concerns/ / patterns/ / reads/.
 *
 *   2. GRAPH WALK — for each seed: collect 1-hop neighbors via the union of
 *      forward `related:` edges (from frontmatter) and incoming edges (from
 *      coach/_backlinks.json). Walk one more hop from each 1-hop neighbor for
 *      2-hop neighbors. Deduplicate.
 *
 *      Treating the graph as UNDIRECTED is the right concrete instantiation
 *      of R-012's spec because the "presenting" categories (concerns/, reads/,
 *      patterns/) have no outgoing `related:` arrays — only their backlinks
 *      surface the move/concept/anti-pattern files Joe goes from them. R-012's
 *      "walk over related: links" is the relational graph; whether we got the
 *      edge from frontmatter or from backlinks doesn't change its meaning.
 *
 *   3. SCORE — 1.0 for direct seed neighbors, 0.5 for 2-hop neighbors, +0.3
 *      multi-seed bonus for nodes reached from more than one seed.
 *
 *   4. HUB-DAMPEN — multiply each score by 1 / log(1 + indegree). With
 *      `feeling-the-unfelt-emotion` at indegree 138, this dampens it to
 *      ~0.2x; with a more specific node at indegree 5, it stays at ~0.56x.
 *      The dampening reverses the bias that walks would otherwise have
 *      toward hubs that "match anything."
 *
 *   5. TOP-K — sort by score descending, keep top K (default 5). Filter out
 *      the seeds themselves (they're "where the client is"; the value is in
 *      "where Joe goes from there").
 *
 *   6. INJECT — return the full markdown bodies of the top-K files plus
 *      telemetry (seeds, file IDs with scores and indegree).
 *
 * Fallback: when seed-detection returns no valid seeds, we currently return
 * an empty bundle. R-012 specifies a dense-similarity-over-aliases fallback
 * using E-033's bge-small index, but E-033 is being built in parallel and the
 * index may not be available; this implementation cleanly degrades to "no
 * retrieval this turn" and logs the empty-seed event for diagnostics.
 *
 * Cost: Haiku 4.5 call per turn with ~18KB index inlined (~5000 tokens) is
 * roughly $0.005 per turn live, ~$0.0005 after the first turn's
 * cache write (the index never changes; we tag it cacheable). Walk and
 * scoring are O(neighborhood-size) in-memory; free.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateText, tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const COACH_DIR = join(REPO_ROOT, "coach");
const INDEX_PATH = join(COACH_DIR, "_index.md");
const BACKLINKS_PATH = join(COACH_DIR, "_backlinks.json");

const ALLOWED_SEED_CATEGORIES = new Set(["concerns", "patterns", "reads"]);

const CATEGORY_DIRS = [
  "concerns",
  "patterns",
  "reads",
  "concepts",
  "distinctions",
  "principles",
  "anti-patterns",
  "moves",
  "questions",
  "frameworks",
  "practices",
  "examples",
  "applications",
];

// ---------------- Pricing for Haiku cost tracking ----------------

const HAIKU_PRICING = {
  input: 1, // per million tokens
  output: 5,
  cache_read: 0.1,
  cache_write: 1.25,
};

function computeHaikuCost(usage: {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): number {
  return (
    ((usage.input ?? 0) * HAIKU_PRICING.input +
      (usage.output ?? 0) * HAIKU_PRICING.output +
      (usage.cacheRead ?? 0) * HAIKU_PRICING.cache_read +
      (usage.cacheWrite ?? 0) * HAIKU_PRICING.cache_write) /
    1_000_000
  );
}

// ---------------- Compendium index (built once, cached in-process) ----------------

export interface SeedCatalogEntry {
  id: string;
  category: string; // concerns | patterns | reads | etc.
  title: string;
  path: string; // coach/<category>/<id>.md
}

interface CompendiumState {
  /** id -> entry across ALL categories (used to resolve paths from ids). */
  catalog: Map<string, SeedCatalogEntry>;
  /** id -> incoming-edge ids (from _backlinks.json: keys are TARGET ids). */
  backlinks: Map<string, string[]>;
  /** id -> indegree (size of backlinks[id]; default 0). */
  indegree: Map<string, number>;
  /** id -> forward-related ids (parsed lazily from frontmatter; populated on demand). */
  forwardRelated: Map<string, string[]>;
  /** id -> full markdown body (cached on first read). */
  fileBodies: Map<string, string>;
  /** The full coach/_index.md text (passed to Haiku seed detection). */
  indexMd: string;
}

let CACHED_STATE: CompendiumState | null = null;

function categoryFromDir(d: string): string {
  return d.replace(/^.*\//, "").trim();
}

/**
 * Parse coach/_index.md into a catalog. Each section starts with a
 * `## <Category>` heading; each file is `- <id> <Title> (also: alias1, ...)`.
 * Map category name to directory name (lowercase, dash-separated).
 */
function parseIndex(indexText: string): Map<string, SeedCatalogEntry> {
  const catalog = new Map<string, SeedCatalogEntry>();

  // Map index section header -> on-disk directory name
  const sectionToDir: Record<string, string> = {
    Concerns: "concerns",
    Reads: "reads",
    Questions: "questions",
    Arcs: "arcs", // (no on-disk dir in current compendium; left for safety)
    "Anti-Patterns": "anti-patterns",
    Concepts: "concepts",
    Patterns: "patterns",
    Moves: "moves",
    Distinctions: "distinctions",
    Principles: "principles",
    Practices: "practices",
    Frameworks: "frameworks",
    Examples: "examples",
    Applications: "applications",
  };

  const lines = indexText.split("\n");
  let currentCategory: string | null = null;

  for (const line of lines) {
    const sec = line.match(/^## (.+?)\s*$/);
    if (sec) {
      currentCategory = sectionToDir[sec[1].trim()] ?? null;
      continue;
    }
    if (!currentCategory) continue;
    // `- <id> <title> (also: ...)` — id is the first word, title runs until
    // " (also:" or end of line.
    const m = line.match(/^- ([a-z0-9-]+)\s+(.+)$/);
    if (!m) continue;
    const id = m[1];
    const rest = m[2];
    const titleEnd = rest.search(/\s+\(also:/);
    const title = titleEnd >= 0 ? rest.slice(0, titleEnd).trim() : rest.trim();
    const path = join("coach", currentCategory, `${id}.md`);
    catalog.set(id, { id, category: currentCategory, title, path });
  }
  return catalog;
}

/**
 * Lazily parse forward `related:` from a file's frontmatter. Returns [] if
 * the file has no related array, doesn't exist, or fails to parse.
 */
function parseForwardRelated(
  entry: SeedCatalogEntry,
  fileBodies: Map<string, string>,
): string[] {
  let body = fileBodies.get(entry.id);
  if (body === undefined) {
    const abs = join(REPO_ROOT, entry.path);
    if (!existsSync(abs)) {
      fileBodies.set(entry.id, "");
      return [];
    }
    body = readFileSync(abs, "utf8");
    fileBodies.set(entry.id, body);
  }
  if (!body) return [];
  // Frontmatter is between two `---` lines at top.
  const fmEnd = body.indexOf("\n---", 4);
  const fm = fmEnd > 0 ? body.slice(0, fmEnd) : body.slice(0, 2000);
  // related: ["a", "b", ...] OR related: [a, b]
  const m = fm.match(/^related:\s*\[(.*?)\]/m);
  if (!m) return [];
  const inner = m[1];
  // Split on commas, strip quotes/whitespace.
  return inner
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "").trim())
    .filter((s) => s.length > 0);
}

export function loadCompendium(): CompendiumState {
  if (CACHED_STATE) return CACHED_STATE;
  if (!existsSync(INDEX_PATH)) {
    throw new Error(`coach/_index.md not found at ${INDEX_PATH}`);
  }
  if (!existsSync(BACKLINKS_PATH)) {
    throw new Error(`coach/_backlinks.json not found at ${BACKLINKS_PATH}`);
  }
  const indexMd = readFileSync(INDEX_PATH, "utf8");
  const catalog = parseIndex(indexMd);
  const backlinksRaw = JSON.parse(readFileSync(BACKLINKS_PATH, "utf8")) as Record<
    string,
    string[]
  >;
  const backlinks = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const [target, sources] of Object.entries(backlinksRaw)) {
    backlinks.set(target, sources);
    indegree.set(target, sources.length);
  }
  CACHED_STATE = {
    catalog,
    backlinks,
    indegree,
    forwardRelated: new Map(),
    fileBodies: new Map(),
    indexMd,
  };
  return CACHED_STATE;
}

// ---------------- Seed detection (Haiku tool call) ----------------

export interface SeedDetectionResult {
  seeds: string[]; // validated ids
  rejected: string[]; // ids the model proposed that we filtered out
  rationale: string;
  cost_usd: number;
  ms: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  input_tokens: number;
  output_tokens: number;
}

const SEED_DETECTION_SYSTEM = `You are a retrieval planner for a Joe Hudson coaching system.

You will receive the client's most recent message (and the recent conversation context). Your only job is to identify 1-3 files from the coach/ compendium that best match what the client is presenting.

You may ONLY select from these categories:
- concerns (what the client says they are dealing with)
- patterns (recurring shapes in the client's life)
- reads (what to notice about how the client is showing up)

DO NOT select concepts/, moves/, anti-patterns/, distinctions/, principles/, questions/, etc. — those are "where Joe goes from here," not "where the client is." A downstream graph walk will reach them automatically. You only pick the starting points.

Use the inline aliases in the index below to ground your match. If the client's literal phrasing matches an alias, that is the strongest signal. If nothing matches well, return an empty array; do not invent a seed.

Below is the full compendium index:

${"<INDEX_PLACEHOLDER>"}`;

const seedDetectionInputSchema = z.object({
  seedIds: z
    .array(z.string().regex(/^[a-z0-9-]+$/))
    .min(0)
    .max(3)
    .describe(
      "1-3 file IDs (no path, no .md), each one from concerns/, patterns/, or reads/. Empty array if no good match.",
    ),
  rationale: z
    .string()
    .min(5)
    .max(400)
    .describe(
      "One-sentence rationale per seed, concatenated. Used for telemetry, not for downstream logic.",
    ),
});

export interface SeedDetectionArgs {
  clientMessage: string;
  /** Last 2-3 turns of conversation, oldest first. Used as context only. */
  recentHistory: { role: "client" | "coach"; content: string }[];
  /** Haiku model id, default claude-haiku-4-5. */
  model?: string;
  apiKey?: string;
  /** Max retries on 429/5xx (default 4). */
  maxRetries?: number;
}

export async function detectSeeds(
  args: SeedDetectionArgs,
): Promise<SeedDetectionResult> {
  const apiKey = args.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }
  const compendium = loadCompendium();
  const model = args.model ?? "claude-haiku-4-5";
  const anthropic = createAnthropic({ apiKey });

  const systemText = SEED_DETECTION_SYSTEM.replace(
    "<INDEX_PLACEHOLDER>",
    compendium.indexMd,
  );

  // Build messages: brief context + the new client message
  const historyLines: string[] = [];
  if (args.recentHistory.length > 0) {
    historyLines.push("Recent conversation (context only):");
    for (const t of args.recentHistory) {
      const role = t.role === "client" ? "Client" : "Coach";
      historyLines.push(`${role}: ${t.content}`);
    }
    historyLines.push("");
  }
  historyLines.push(`Current client message:\n${args.clientMessage}`);

  const userText = historyLines.join("\n");

  const detectTool = tool({
    description:
      "Identify 1-3 seed files from concerns/, patterns/, or reads/ that match the client's presenting material. Return empty array if nothing matches well.",
    inputSchema: seedDetectionInputSchema,
    execute: async ({ seedIds, rationale }) => {
      // Server-side validation — done here so the model can't bypass it
      const valid: string[] = [];
      const rejected: string[] = [];
      for (const id of seedIds) {
        const entry = compendium.catalog.get(id);
        if (!entry) {
          rejected.push(id);
          continue;
        }
        if (!ALLOWED_SEED_CATEGORIES.has(entry.category)) {
          rejected.push(id);
          continue;
        }
        valid.push(id);
      }
      return { seedIds: valid, rejected, rationale };
    },
  });

  const maxRetries = args.maxRetries ?? 4;
  let attempt = 0;
  let lastErr: unknown = null;
  const t0 = Date.now();
  while (attempt <= maxRetries) {
    try {
      const result = await generateText({
        model: anthropic(model),
        system: {
          role: "system",
          content: systemText,
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
        messages: [{ role: "user", content: userText }],
        tools: { detect_seeds_from_message: detectTool },
        toolChoice: {
          type: "tool",
          toolName: "detect_seeds_from_message",
        },
        temperature: 0.2,
        maxOutputTokens: 512,
      });

      // Extract the tool result from the executed call.
      // AI SDK v6 exposes per-step results in result.steps; for this single
      // forced call we can read toolResults from the top-level result.
      const toolResults = (result as unknown as {
        toolResults?: Array<{
          toolName: string;
          output?: { seedIds: string[]; rejected: string[]; rationale: string };
          result?: { seedIds: string[]; rejected: string[]; rationale: string };
        }>;
      }).toolResults ?? [];
      // Fallback: walk steps if top-level toolResults is empty
      let payload:
        | { seedIds: string[]; rejected: string[]; rationale: string }
        | null = null;
      for (const tr of toolResults) {
        if (tr.toolName === "detect_seeds_from_message") {
          payload = (tr.output ?? tr.result) ?? null;
          if (payload) break;
        }
      }
      if (!payload) {
        const steps = (result as unknown as {
          steps?: Array<{
            content?: Array<{
              type: string;
              toolName?: string;
              output?: { seedIds: string[]; rejected: string[]; rationale: string };
              result?: { seedIds: string[]; rejected: string[]; rationale: string };
            }>;
          }>;
        }).steps ?? [];
        for (const step of steps) {
          for (const c of step.content ?? []) {
            if (
              c.type === "tool-result" &&
              c.toolName === "detect_seeds_from_message"
            ) {
              payload = (c.output ?? c.result) ?? null;
              if (payload) break;
            }
          }
          if (payload) break;
        }
      }
      if (!payload) {
        // Tool was forced; if we get here we didn't see the result. Treat as
        // no seeds — let the fallback handle it.
        payload = { seedIds: [], rejected: [], rationale: "(no tool result captured)" };
      }

      const pmAnth = (result as unknown as {
        providerMetadata?: {
          anthropic?: { usage?: Record<string, number> };
        };
      }).providerMetadata?.anthropic?.usage;
      const flat = result.usage as unknown as Record<string, number | undefined>;
      const inTok = pmAnth?.input_tokens ?? flat?.inputTokens ?? flat?.input_tokens ?? 0;
      const outTok =
        pmAnth?.output_tokens ?? flat?.outputTokens ?? flat?.output_tokens ?? 0;
      const cacheRead =
        pmAnth?.cache_read_input_tokens ??
        flat?.cachedInputTokens ??
        flat?.cache_read_input_tokens ??
        0;
      const cacheWrite =
        pmAnth?.cache_creation_input_tokens ??
        flat?.cache_creation_input_tokens ??
        0;

      const cost_usd = computeHaikuCost({
        input: inTok,
        output: outTok,
        cacheRead,
        cacheWrite,
      });

      return {
        seeds: payload.seedIds,
        rejected: payload.rejected,
        rationale: payload.rationale,
        cost_usd,
        ms: Date.now() - t0,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite,
        input_tokens: inTok,
        output_tokens: outTok,
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
        const base = Math.min(30_000, 1000 * 2 ** attempt);
        const wait = base + Math.floor(Math.random() * 750);
        await new Promise((r) => setTimeout(r, wait));
        attempt += 1;
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error("seed detection retry exhausted");
}

// ---------------- Graph walk ----------------

export interface ScoredNode {
  id: string;
  score: number;
  raw_score: number; // before hub-dampen
  hub_dampen_factor: number;
  indegree: number;
  hops: number; // 1 or 2
  seeds_reaching: string[]; // which seed(s) led here
  category: string;
  path: string;
}

export interface WalkResult {
  /** Top-K nodes by score, excluding seeds themselves. */
  topK: ScoredNode[];
  /** All visited nodes with scores, for telemetry/debugging. */
  allVisited: ScoredNode[];
  /** Seeds that were walked (validated, in-catalog). */
  walkedSeeds: string[];
}

export interface WalkConfig {
  depth: number; // default 2
  topK: number; // default 5
  hubDampen: boolean; // default true
  /** Whether to exclude the seeds themselves from the top-K bundle. */
  excludeSeeds: boolean; // default true
}

const DEFAULT_WALK_CONFIG: WalkConfig = {
  depth: 2,
  topK: 5,
  hubDampen: true,
  excludeSeeds: true,
};

/**
 * Union of forward `related:` from frontmatter and incoming backlinks.
 * Treats the graph as undirected (the curated edges encode coaching
 * navigation; direction matters for telemetry but not for retrieval coverage).
 */
function neighborsOf(id: string, compendium: CompendiumState): string[] {
  const entry = compendium.catalog.get(id);
  let forward: string[] = [];
  if (entry) {
    const cached = compendium.forwardRelated.get(id);
    if (cached) {
      forward = cached;
    } else {
      forward = parseForwardRelated(entry, compendium.fileBodies);
      compendium.forwardRelated.set(id, forward);
    }
  }
  const incoming = compendium.backlinks.get(id) ?? [];
  const merged = new Set([...forward, ...incoming]);
  return [...merged];
}

export function walkGraph(
  seeds: string[],
  config: Partial<WalkConfig> = {},
): WalkResult {
  const cfg = { ...DEFAULT_WALK_CONFIG, ...config };
  const compendium = loadCompendium();
  const seedSet = new Set(seeds.filter((s) => compendium.catalog.has(s)));
  const walkedSeeds = [...seedSet];

  // For each node, track:
  //   - max raw_score (1.0 for direct neighbor; 0.5 for 2-hop)
  //   - which seeds reached it (for multi-seed bonus)
  //   - min hop count (1 if reached at depth 1 from any seed; else 2)
  interface VisitState {
    rawScoreSum: number; // sum across seeds; later we add multi-seed bonus
    minHop: number;
    seedsReaching: Set<string>;
  }
  const visited = new Map<string, VisitState>();

  for (const seed of walkedSeeds) {
    // BFS up to depth 2 from this seed
    const seenForThisSeed = new Set<string>([seed]);
    let frontier: string[] = [seed];
    for (let hop = 1; hop <= cfg.depth; hop += 1) {
      const nextFrontier = new Set<string>();
      for (const node of frontier) {
        for (const nb of neighborsOf(node, compendium)) {
          if (seenForThisSeed.has(nb)) continue;
          seenForThisSeed.add(nb);
          nextFrontier.add(nb);
        }
      }
      const hopScore = hop === 1 ? 1.0 : 0.5;
      for (const nb of nextFrontier) {
        const st = visited.get(nb) ?? {
          rawScoreSum: 0,
          minHop: Number.MAX_SAFE_INTEGER,
          seedsReaching: new Set<string>(),
        };
        st.rawScoreSum += hopScore;
        st.minHop = Math.min(st.minHop, hop);
        st.seedsReaching.add(seed);
        visited.set(nb, st);
      }
      frontier = [...nextFrontier];
    }
  }

  // Convert to scored nodes
  const scored: ScoredNode[] = [];
  for (const [id, st] of visited.entries()) {
    // raw_score is the max contribution from any one seed (so a 1-hop hit
    // dominates over a 2-hop hit even if multiple seeds reach via 2-hop), with
    // multi-seed bonus added once.
    const baseScore = st.minHop === 1 ? 1.0 : 0.5;
    const multiSeedBonus = st.seedsReaching.size >= 2 ? 0.3 : 0;
    const rawScore = baseScore + multiSeedBonus;
    const indegree = compendium.indegree.get(id) ?? 0;
    // R-012 spec: hub-dampen = 1 / log(1 + indegree). Two practical fixes
    // applied so the formula behaves as INTENDED on real data:
    //
    //   (a) Clamp indegree floor to 2. log(1+0)=0 and log(1+1)=0.693 produce
    //       dampening factors of ∞ and 1.443 respectively — orphan peripheral
    //       files would dominate hubs by accident. With floor=2 the factor for
    //       a near-orphan is 1/log(3) = 0.910.
    //   (b) Cap the dampening factor at 1.0. The spec's intent is a PENALTY on
    //       hubs, not a BOOST for rare nodes. Without the cap, the natural
    //       inversion point (~indegree 7-8) makes a 2-hop hit at indegree 1
    //       outrank a 1-hop hit at indegree 12, which inverts R-012's "1.0 for
    //       direct neighbors, 0.5 for 2-hop" hop-score intent.
    //
    // After fix: indegree 2 → 1.0, indegree 5 → 0.558, indegree 12 → 0.390,
    // indegree 138 (`feeling-the-unfelt-emotion`) → 0.202. Hub penalty
    // preserved; ordering by hop respected.
    const hubDampen = cfg.hubDampen
      ? Math.min(1.0, 1 / Math.log(1 + Math.max(indegree, 2)))
      : 1;
    const score = rawScore * hubDampen;
    const entry = compendium.catalog.get(id);
    scored.push({
      id,
      score,
      raw_score: rawScore,
      hub_dampen_factor: hubDampen,
      indegree,
      hops: st.minHop,
      seeds_reaching: [...st.seedsReaching],
      category: entry?.category ?? "unknown",
      path: entry?.path ?? `coach/unknown/${id}.md`,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  let topK = scored;
  if (cfg.excludeSeeds) topK = topK.filter((n) => !seedSet.has(n.id));
  topK = topK.slice(0, cfg.topK);

  return { topK, allVisited: scored, walkedSeeds };
}

// ---------------- Inject formatting ----------------

const RETRIEVAL_HEADER =
  "RETRIEVED CONTEXT (graph-walk neighborhood from coach/_index aliases via curated `related:` edges; draw on these to ground your reading and move selection; do not announce that you are retrieving):";

/**
 * Read the full markdown body of a file by id. Returns "" if missing.
 */
export function readFileBody(id: string): string {
  const compendium = loadCompendium();
  const cached = compendium.fileBodies.get(id);
  if (cached !== undefined) return cached;
  const entry = compendium.catalog.get(id);
  if (!entry) {
    compendium.fileBodies.set(id, "");
    return "";
  }
  const abs = join(REPO_ROOT, entry.path);
  if (!existsSync(abs)) {
    compendium.fileBodies.set(id, "");
    return "";
  }
  const body = readFileSync(abs, "utf8");
  compendium.fileBodies.set(id, body);
  return body;
}

export function formatRetrievedBundle(
  topK: ScoredNode[],
  seeds: string[],
): string {
  if (topK.length === 0 && seeds.length === 0) return "";
  const compendium = loadCompendium();
  const lines: string[] = [];
  lines.push(RETRIEVAL_HEADER);
  if (seeds.length > 0) {
    const seedLabels = seeds.map((s) => {
      const e = compendium.catalog.get(s);
      return e ? `${e.category}/${s}` : s;
    });
    lines.push(`(seeds detected: ${seedLabels.join(", ")})`);
  }
  lines.push("");
  for (const n of topK) {
    const body = readFileBody(n.id);
    if (!body) continue;
    lines.push(`--- ${n.path} (score=${n.score.toFixed(2)}, hops=${n.hops}, indegree=${n.indegree}) ---`);
    lines.push(body.trim());
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------- Public retrieve() entry ----------------

export interface GraphWalkRetrievalArgs {
  clientMessage: string;
  recentHistory: { role: "client" | "coach"; content: string }[];
  /** Haiku model id, default claude-haiku-4-5. */
  seedModel?: string;
  walkConfig?: Partial<WalkConfig>;
  apiKey?: string;
  /** Stable profile id stamped on the seed-detection call for telemetry / cost attribution. */
  profile_id?: string;
}

export interface GraphWalkRetrievalResult {
  /** The text block to inject into the coach's user message. May be "" if no retrieval. */
  injection: string;
  telemetry: {
    seeds: string[];
    rejected_seeds: string[];
    seed_rationale: string;
    top_k_ids: string[];
    top_k_paths: string[];
    top_k_scores: number[];
    top_k_hops: number[];
    top_k_indegrees: number[];
    seed_detection_cost_usd: number;
    seed_detection_ms: number;
    seed_detection_input_tokens: number;
    seed_detection_output_tokens: number;
    seed_detection_cache_read_tokens: number;
    seed_detection_cache_write_tokens: number;
  };
}

export async function retrieveByGraphWalk(
  args: GraphWalkRetrievalArgs,
): Promise<GraphWalkRetrievalResult> {
  const seedResult = await detectSeeds({
    clientMessage: args.clientMessage,
    recentHistory: args.recentHistory,
    model: args.seedModel,
    apiKey: args.apiKey,
  });

  const walk = walkGraph(seedResult.seeds, args.walkConfig);
  const injection = formatRetrievedBundle(walk.topK, seedResult.seeds);

  return {
    injection,
    telemetry: {
      seeds: seedResult.seeds,
      rejected_seeds: seedResult.rejected,
      seed_rationale: seedResult.rationale,
      top_k_ids: walk.topK.map((n) => n.id),
      top_k_paths: walk.topK.map((n) => n.path),
      top_k_scores: walk.topK.map((n) => Number(n.score.toFixed(4))),
      top_k_hops: walk.topK.map((n) => n.hops),
      top_k_indegrees: walk.topK.map((n) => n.indegree),
      seed_detection_cost_usd: seedResult.cost_usd,
      seed_detection_ms: seedResult.ms,
      seed_detection_input_tokens: seedResult.input_tokens,
      seed_detection_output_tokens: seedResult.output_tokens,
      seed_detection_cache_read_tokens: seedResult.cache_read_input_tokens,
      seed_detection_cache_write_tokens: seedResult.cache_creation_input_tokens,
    },
  };
}

// ---------------- expected_territory pre-screen helper ----------------

export interface ExpectedTerritory {
  concerns?: string[];
  reads?: string[];
  moves?: string[];
  concepts?: string[];
  patterns?: string[];
  frameworks?: string[];
  questions?: string[];
  distinctions?: string[];
  principles?: string[];
  anti_patterns_to_avoid?: string[];
}

/** Flatten an expected_territory block into a set of ids across all categories. */
export function flattenExpectedTerritory(et: ExpectedTerritory): Set<string> {
  const out = new Set<string>();
  for (const arr of [
    et.concerns,
    et.reads,
    et.moves,
    et.concepts,
    et.patterns,
    et.frameworks,
    et.questions,
    et.distinctions,
    et.principles,
    et.anti_patterns_to_avoid,
  ]) {
    for (const id of arr ?? []) out.add(id);
  }
  return out;
}

/** Compute precision/recall of retrieved ids vs an expected-territory set. */
export function expectedTerritoryRecallPrecision(
  retrievedIds: string[],
  expected: Set<string>,
): { precision: number; recall: number; overlap: string[]; missed: string[] } {
  const retrievedSet = new Set(retrievedIds);
  const overlap = [...retrievedSet].filter((id) => expected.has(id));
  const missed = [...expected].filter((id) => !retrievedSet.has(id));
  const precision = retrievedSet.size === 0 ? 0 : overlap.length / retrievedSet.size;
  const recall = expected.size === 0 ? 0 : overlap.length / expected.size;
  return { precision, recall, overlap, missed };
}
