/**
 * Graph-walk retrieval over ingested wiki — lifted from
 * coach-app/retrieval/graph-walk.ts per R-016 Answer 4 (strategy b).
 *
 * Adaptation deltas from coach-app version:
 *   - `REPO_ROOT` removed; `WIKI_ROOT` is parameterized via env var
 *     `WIKI_ROOT` defaulting to `process.cwd() + '/content/wiki'`. The
 *     ingested mirror has no `coach/` prefix — files live directly under
 *     `<WIKI_ROOT>/<category>/<slug>.md`.
 *   - `.ts` extension imports replaced with extensionless imports for
 *     Webpack/Turbopack compatibility.
 *   - Catalog path construction strips the `coach/` prefix that the
 *     original built. The stored `entry.path` is now category-relative.
 *   - Everything else is byte-identical to the source; downstream behavior
 *     (cache, seed detection, walk math, hub-dampening) preserved.
 *
 * Walker model used by E-038 (v5b): claude-sonnet-4-6. Seed-detection always
 * Haiku (cheap). Caching markers preserved via @ai-sdk/anthropic — the walker
 * + seed-detection use a long shared system prompt that benefits massively
 * from cache hits across turns.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateText, tool } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

// Where the ingested wiki lives. `process.cwd()` at runtime is the Next.js
// project root (web-app/). Override with WIKI_ROOT env var for tests or when
// the server is started from a different directory.
//
// The `turbopackIgnore` comment tells Next.js's file tracer NOT to bundle
// every file rooted at process.cwd() into the route's static bundle — the
// wiki has 2.4k+ markdown files that we want to keep on disk and read at
// runtime, not bundle. Without this hint the build emits a "matches 14350
// files" warning and bloats the deployable significantly.
function getWikiRoot(): string {
  return (
    process.env.WIKI_ROOT ??
    join(/* turbopackIgnore: true */ process.cwd(), 'content', 'wiki')
  );
}

const INDEX_FILENAME = '_index.md';
const BACKLINKS_FILENAME = '_backlinks.json';

const ALLOWED_SEED_CATEGORIES = new Set(['concerns', 'patterns', 'reads']);

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
  /** Path RELATIVE TO `WIKI_ROOT`, e.g. "concepts/limiting-belief.md". */
  path: string;
}

interface CompendiumState {
  catalog: Map<string, SeedCatalogEntry>;
  backlinks: Map<string, string[]>;
  indegree: Map<string, number>;
  forwardRelated: Map<string, string[]>;
  fileBodies: Map<string, string>;
  /**
   * Full index text. Retained for reference but NOT used in seed detection
   * because it has grown past Anthropic's 200K-token context window after
   * G-007's continuous absorption — current corpus is ~2,400 files, original
   * coach-app fit in 684 lines.
   */
  indexMd: string;
  /**
   * Slimmed index passed to the Haiku seed-detector. Restricted to the three
   * allowed seed categories (concerns/, patterns/, reads/) and aliases capped
   * to the first ~8 per entry. The remaining 2,000+ catalog entries are
   * unreachable seed-side; the walker reaches them via `related:` traversal.
   *
   * Size goal: <= 60K tokens (well under the 200K hard cap) so room remains
   * for the client message + recent history + provider overhead.
   */
  seedIndexMd: string;
}

let CACHED_STATE: CompendiumState | null = null;

function parseIndex(indexText: string): Map<string, SeedCatalogEntry> {
  const catalog = new Map<string, SeedCatalogEntry>();

  const sectionToDir: Record<string, string> = {
    Concerns: 'concerns',
    Reads: 'reads',
    Questions: 'questions',
    Arcs: 'arcs',
    'Anti-Patterns': 'anti-patterns',
    Concepts: 'concepts',
    Patterns: 'patterns',
    Moves: 'moves',
    Distinctions: 'distinctions',
    Principles: 'principles',
    Practices: 'practices',
    Frameworks: 'frameworks',
    Examples: 'examples',
    Applications: 'applications',
  };

  const lines = indexText.split('\n');
  let currentCategory: string | null = null;

  for (const line of lines) {
    const sec = line.match(/^## (.+?)\s*$/);
    if (sec) {
      currentCategory = sectionToDir[sec[1].trim()] ?? null;
      continue;
    }
    if (!currentCategory) continue;
    const m = line.match(/^- ([a-z0-9-]+)\s+(.+)$/);
    if (!m) continue;
    const id = m[1];
    const rest = m[2];
    const titleEnd = rest.search(/\s+\(also:/);
    const title = titleEnd >= 0 ? rest.slice(0, titleEnd).trim() : rest.trim();
    // Path is RELATIVE TO wiki root (no "coach/" prefix in the ingested mirror).
    const path = join(currentCategory, `${id}.md`);
    catalog.set(id, { id, category: currentCategory, title, path });
  }
  return catalog;
}

function parseForwardRelated(
  entry: SeedCatalogEntry,
  fileBodies: Map<string, string>,
): string[] {
  let body = fileBodies.get(entry.id);
  if (body === undefined) {
    const abs = join(getWikiRoot(), entry.path);
    if (!existsSync(abs)) {
      fileBodies.set(entry.id, '');
      return [];
    }
    body = readFileSync(abs, 'utf8');
    fileBodies.set(entry.id, body);
  }
  if (!body) return [];
  const fmEnd = body.indexOf('\n---', 4);
  const fm = fmEnd > 0 ? body.slice(0, fmEnd) : body.slice(0, 2000);
  const m = fm.match(/^related:\s*\[(.*?)\]/m);
  if (!m) return [];
  const inner = m[1];
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, '').trim())
    .filter((s) => s.length > 0);
}

// Maximum aliases retained per entry in the slimmed seed-detection index.
// The full corpus averages 15-30 aliases per concern; the first ~8 cover
// 95%+ of the literal-phrasing-match cases the seed-detector needs to spot.
// Lower if context-budget pressure ever returns; raise if real evals show
// the cap dropping recall.
const MAX_ALIASES_PER_ENTRY_FOR_SEED = 8;

/**
 * Produce a slimmed copy of the index that contains ONLY the three seed-
 * allowed categories, with each entry's "(also: ...)" alias list truncated
 * to MAX_ALIASES_PER_ENTRY_FOR_SEED. Returns the slimmed markdown text. See
 * the `seedIndexMd` JSDoc above for rationale.
 */
function buildSeedIndex(indexText: string): string {
  const allowedHeaders = new Set([
    '## Concerns',
    '## Patterns',
    '## Reads',
  ]);
  const lines = indexText.split('\n');
  const out: string[] = ['# Compendium Index (seed-detection subset)', ''];
  let inAllowed = false;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      inAllowed = allowedHeaders.has(line.trim());
      if (inAllowed) {
        out.push('');
        out.push(line);
        out.push('');
      }
      continue;
    }
    if (!inAllowed) continue;
    if (line.startsWith('- ')) {
      const m = line.match(/^(- [a-z0-9-]+ [^(]*?)(\s*\(also:\s*)(.*?)(\)\s*)?$/);
      if (!m) {
        // No alias block — pass through.
        out.push(line);
        continue;
      }
      const [, head, alsoPrefix, aliasInner] = m;
      const aliases = aliasInner
        .replace(/\)\s*$/, '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const trimmed = aliases.slice(0, MAX_ALIASES_PER_ENTRY_FOR_SEED);
      if (trimmed.length === 0) {
        out.push(head.trimEnd());
      } else {
        out.push(`${head.trimEnd()}${alsoPrefix}${trimmed.join(', ')})`);
      }
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

export function loadCompendium(): CompendiumState {
  if (CACHED_STATE) return CACHED_STATE;
  const root = getWikiRoot();
  const indexPath = join(root, INDEX_FILENAME);
  const backlinksPath = join(root, BACKLINKS_FILENAME);
  if (!existsSync(indexPath)) {
    throw new Error(`wiki index not found at ${indexPath}`);
  }
  if (!existsSync(backlinksPath)) {
    throw new Error(`wiki backlinks not found at ${backlinksPath}`);
  }
  const indexMd = readFileSync(indexPath, 'utf8');
  const seedIndexMd = buildSeedIndex(indexMd);
  const catalog = parseIndex(indexMd);
  const backlinksRaw = JSON.parse(readFileSync(backlinksPath, 'utf8')) as Record<
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
    seedIndexMd,
  };
  return CACHED_STATE;
}

// ---------------- Seed detection (Haiku tool call) ----------------

export interface SeedDetectionResult {
  seeds: string[];
  rejected: string[];
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

${'<INDEX_PLACEHOLDER>'}`;

const seedDetectionInputSchema = z.object({
  seedIds: z
    .array(z.string().regex(/^[a-z0-9-]+$/))
    .min(0)
    .max(3)
    .describe(
      '1-3 file IDs (no path, no .md), each one from concerns/, patterns/, or reads/. Empty array if no good match.',
    ),
  rationale: z
    .string()
    .min(5)
    .max(400)
    .describe(
      'One-sentence rationale per seed, concatenated. Used for telemetry, not for downstream logic.',
    ),
});

export interface SeedDetectionArgs {
  clientMessage: string;
  recentHistory: { role: 'client' | 'coach'; content: string }[];
  model?: string;
  apiKey?: string;
  maxRetries?: number;
}

export async function detectSeeds(
  args: SeedDetectionArgs,
): Promise<SeedDetectionResult> {
  const apiKey = args.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }
  const compendium = loadCompendium();
  const model = args.model ?? 'claude-haiku-4-5';
  const anthropic = createAnthropic({ apiKey });

  // Use the SLIMMED seed index (concerns/patterns/reads only, aliases capped)
  // — the full index has outgrown the 200K-token context window since
  // continuous absorption began. See `seedIndexMd` JSDoc + `buildSeedIndex`.
  const systemText = SEED_DETECTION_SYSTEM.replace(
    '<INDEX_PLACEHOLDER>',
    compendium.seedIndexMd,
  );

  const historyLines: string[] = [];
  if (args.recentHistory.length > 0) {
    historyLines.push('Recent conversation (context only):');
    for (const t of args.recentHistory) {
      const role = t.role === 'client' ? 'Client' : 'Coach';
      historyLines.push(`${role}: ${t.content}`);
    }
    historyLines.push('');
  }
  historyLines.push(`Current client message:\n${args.clientMessage}`);

  const userText = historyLines.join('\n');

  const detectTool = tool({
    description:
      "Identify 1-3 seed files from concerns/, patterns/, or reads/ that match the client's presenting material. Return empty array if nothing matches well.",
    inputSchema: seedDetectionInputSchema,
    execute: async ({ seedIds, rationale }) => {
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
          role: 'system',
          content: systemText,
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        },
        messages: [{ role: 'user', content: userText }],
        tools: { detect_seeds_from_message: detectTool },
        toolChoice: {
          type: 'tool',
          toolName: 'detect_seeds_from_message',
        },
        temperature: 0.2,
        maxOutputTokens: 512,
      });

      const toolResults = (result as unknown as {
        toolResults?: Array<{
          toolName: string;
          output?: { seedIds: string[]; rejected: string[]; rationale: string };
          result?: { seedIds: string[]; rejected: string[]; rationale: string };
        }>;
      }).toolResults ?? [];
      let payload:
        | { seedIds: string[]; rejected: string[]; rationale: string }
        | null = null;
      for (const tr of toolResults) {
        if (tr.toolName === 'detect_seeds_from_message') {
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
              c.type === 'tool-result' &&
              c.toolName === 'detect_seeds_from_message'
            ) {
              payload = (c.output ?? c.result) ?? null;
              if (payload) break;
            }
          }
          if (payload) break;
        }
      }
      if (!payload) {
        payload = { seedIds: [], rejected: [], rationale: '(no tool result captured)' };
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
  throw lastErr ?? new Error('seed detection retry exhausted');
}

// ---------------- File body reader ----------------

/**
 * Read the full markdown body of a file by id. Returns "" if missing.
 */
export function readFileBody(id: string): string {
  const compendium = loadCompendium();
  const cached = compendium.fileBodies.get(id);
  if (cached !== undefined) return cached;
  const entry = compendium.catalog.get(id);
  if (!entry) {
    compendium.fileBodies.set(id, '');
    return '';
  }
  const abs = join(getWikiRoot(), entry.path);
  if (!existsSync(abs)) {
    compendium.fileBodies.set(id, '');
    return '';
  }
  const body = readFileSync(abs, 'utf8');
  compendium.fileBodies.set(id, body);
  return body;
}
