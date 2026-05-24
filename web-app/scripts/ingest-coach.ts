#!/usr/bin/env bun
/**
 * ingest-coach.ts — Mirror coach/ into web-app/content/wiki/ with link normalization.
 *
 * Implements E-039 + R-018 (see meta/wiki/experiments/E-039.md, R-018.md).
 *
 * Ownership model (v1 scope):
 * --------------------------
 * web-app/content/wiki/ is FULLY OWNED by this script. Re-running deletes outputs
 * for source files no longer in coach/. Any human-side customizations belong in a
 * separate directory (not implemented in v1). No mixed-mode behavior.
 *
 * The manifest at web-app/content/wiki/.ingest-manifest.json drives idempotency:
 * each source file is hashed (sha256) and the output is skipped when the hash
 * matches. Removed sources are detected by manifest-vs-source diff.
 *
 * Normalization rules implemented (per R-018):
 *   1. Body wikilinks: parse [[target|display]], split anchor, case-fold resolve,
 *      kebab-fold resolve for space-targets, strip category/ prefix, drop pipe
 *      when display == slug, record broken in manifest.broken_links.
 *   2. Frontmatter `related:` arrays: trim, case-fold, kebab-fold, strip
 *      category/ prefix, record broken in manifest.broken_related.
 *   3. Markdown-syntax internal links `[text](relative/path.md)`: rewrite to
 *      [[slug|text]] (or [[slug]] if text==slug).
 *   4. External and image links pass through unchanged.
 *   5. Frontmatter preserved verbatim (except related:).
 *   6. _index.md and _backlinks.json regenerated FROM THE NORMALIZED OUTPUT
 *      (not copied) so they reflect case-fix and kebab-fix normalization.
 *
 * Run:
 *   bun run ingest                  (from web-app/)
 *   bun scripts/ingest-coach.ts     (direct)
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

// -------------------------------- constants ---------------------------------

const REPO_ROOT = join(import.meta.dir, '..', '..');
const SOURCE_DIR = join(REPO_ROOT, 'coach');
const TARGET_DIR = join(REPO_ROOT, 'web-app', 'content', 'wiki');
const MANIFEST_PATH = join(TARGET_DIR, '.ingest-manifest.json');

// The 13 standard category directories (per R-018, "arcs" exists in the
// rebuild-index.sh SECTIONS list but is empty in the current corpus — handle
// gracefully by skipping empty dirs).
const CATEGORIES = [
  'concerns',
  'reads',
  'questions',
  'arcs',
  'anti-patterns',
  'concepts',
  'patterns',
  'moves',
  'distinctions',
  'principles',
  'practices',
  'frameworks',
  'examples',
  'applications',
] as const;

const MANIFEST_VERSION = 1;

// ----------------------------- type definitions -----------------------------

type Category = (typeof CATEGORIES)[number];

interface SourceFile {
  category: Category;
  slug: string;            // basename without .md
  absPath: string;
  relPath: string;         // e.g. "concepts/limiting-belief.md"
}

interface ParsedFile {
  frontmatter: Record<string, unknown>;
  frontmatterRaw: string;  // original lines for rebuild
  frontmatterLines: string[];
  body: string;
}

interface BrokenLink {
  source: string;          // "category/slug" of the file containing the link
  target: string;          // the raw target as authored
  reason: 'no-target';
}

interface Manifest {
  version: number;
  generated_at: string;
  files: Record<string, { source_hash: string; title: string; aliases: string[] }>;
  broken_links: BrokenLink[];
  broken_related: BrokenLink[];
  slug_to_category: Record<string, Category>;
}

// ----------------------------- frontmatter parser ---------------------------

/**
 * Parse a markdown file with YAML-lite frontmatter.
 *
 * The corpus uses inline JSON-style arrays only (`related: ["a", "b"]`) per
 * R-018; no block-list form is supported because none exists. String values
 * may be quoted or bare. Other types pass through as strings.
 */
function parseFrontmatter(content: string): ParsedFile {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, frontmatterRaw: '', frontmatterLines: [], body: content };
  }
  const parts = content.split('---', 3);
  if (parts.length < 3) {
    return { frontmatter: {}, frontmatterRaw: '', frontmatterLines: [], body: content };
  }
  const fmText = parts[1];
  const body = parts.slice(2).join('---').replace(/^\n/, '');

  const fm: Record<string, unknown> = {};
  const lines = fmText.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || !line.includes(':')) continue;
    const colonIdx = line.indexOf(':');
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();

    if (val.startsWith('[') && val.endsWith(']')) {
      // Parse inline JSON-style list. Items are quoted strings.
      const items = Array.from(val.matchAll(/"((?:[^"\\]|\\.)*)"/g)).map((m) =>
        m[1].replace(/\\"/g, '"')
      );
      fm[key] = items;
    } else if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      fm[key] = val.slice(1, -1).replace(/\\"/g, '"');
    } else {
      fm[key] = val;
    }
  }

  return {
    frontmatter: fm,
    frontmatterRaw: fmText,
    frontmatterLines: lines,
    body,
  };
}

// ------------------------------ source enumeration --------------------------

function enumerateSources(): SourceFile[] {
  const sources: SourceFile[] = [];
  for (const category of CATEGORIES) {
    const dir = join(SOURCE_DIR, category);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const fname of readdirSync(dir).sort()) {
      if (!fname.endsWith('.md')) continue;
      if (fname.startsWith('_')) continue; // skip derived files
      const slug = fname.slice(0, -3);
      sources.push({
        category,
        slug,
        absPath: join(dir, fname),
        relPath: `${category}/${fname}`,
      });
    }
  }
  return sources;
}

// ------------------------------ slug resolution -----------------------------

class SlugIndex {
  // canonical (lowercase, kebab) slug -> category
  private byCanonical = new Map<string, Category>();
  // original-case slug -> category (for fast exact hits)
  private byExact = new Map<string, Category>();
  // canonical -> original slug from filesystem (so we know how to render)
  private canonicalToFile = new Map<string, string>();

  constructor(sources: SourceFile[]) {
    for (const s of sources) {
      // Slugs on disk are already lowercase-kebab per the corpus convention.
      // R-018 verified 0 case-only collisions and 0 cross-category collisions.
      const canonical = s.slug.toLowerCase();
      if (this.byCanonical.has(canonical)) {
        const existing = this.byCanonical.get(canonical)!;
        throw new Error(
          `FATAL: duplicate slug "${s.slug}" found in both "${existing}" and "${s.category}". ` +
            `R-018 verified 0 collisions today; this is a new collision that must be resolved at the source. ` +
            `Pick distinct slugs in coach/ before re-running ingestion.`
        );
      }
      this.byCanonical.set(canonical, s.category);
      this.byExact.set(s.slug, s.category);
      this.canonicalToFile.set(canonical, s.slug);
    }
  }

  /** Resolve a raw target string to canonical slug + category, or null if broken. */
  resolve(rawTarget: string): { slug: string; category: Category } | null {
    const trimmed = rawTarget.trim();
    if (!trimmed) return null;

    // Strip leading category/ prefix per Rule 1.3
    const slashIdx = trimmed.indexOf('/');
    const part = slashIdx >= 0 ? trimmed.slice(slashIdx + 1) : trimmed;

    // Exact case match
    if (this.byExact.has(part)) {
      return { slug: part, category: this.byExact.get(part)! };
    }

    // Case-fold (Rule 1.4)
    const lower = part.toLowerCase();
    if (this.byCanonical.has(lower)) {
      return { slug: this.canonicalToFile.get(lower)!, category: this.byCanonical.get(lower)! };
    }

    // Kebab-fold for space-separated targets (Rule 1.5)
    if (part.includes(' ')) {
      const kebab = part.toLowerCase().replace(/\s+/g, '-');
      if (this.byCanonical.has(kebab)) {
        return { slug: this.canonicalToFile.get(kebab)!, category: this.byCanonical.get(kebab)! };
      }
    }

    return null;
  }

  has(slug: string): boolean {
    return this.byCanonical.has(slug.toLowerCase());
  }
}

// ---------------------------- body link normalizer --------------------------

/**
 * Rewrite every `[[...]]` wikilink in body per Rule 1.
 *
 * Records broken links into the accumulator (mutated).
 */
function normalizeBodyWikilinks(
  body: string,
  sourceKey: string,
  index: SlugIndex,
  broken: BrokenLink[]
): string {
  return body.replace(/\[\[([^\]]+)\]\]/g, (_full, inner: string) => {
    // 1.1 split on |
    const pipeIdx = inner.indexOf('|');
    let targetPart = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
    const displayPart =
      pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : null;

    // 1.2 split off anchor
    const hashIdx = targetPart.indexOf('#');
    const anchor = hashIdx >= 0 ? targetPart.slice(hashIdx + 1) : null;
    if (hashIdx >= 0) targetPart = targetPart.slice(0, hashIdx);

    const resolved = index.resolve(targetPart);
    if (!resolved) {
      broken.push({ source: sourceKey, target: inner, reason: 'no-target' });
      // 1.7: leave as-is in output
      return `[[${inner}]]`;
    }

    // 1.6: write canonical form. Never include category/.
    let out = resolved.slug;
    if (anchor !== null) out += `#${anchor}`;
    // Drop redundant pipe when display matches slug exactly
    if (displayPart !== null && displayPart !== resolved.slug) {
      return `[[${out}|${displayPart}]]`;
    }
    return `[[${out}]]`;
  });
}

// ----------------------- markdown-syntax internal links ---------------------

/**
 * Rule 3: Rewrite `[text](relative-or-anchor.md)` to `[[slug|text]]`.
 * External (http://, https://, mailto:, data:) and image (`!`) pass through.
 */
function normalizeMarkdownInternalLinks(body: string, index: SlugIndex): string {
  // Match [text](path) but NOT ![alt](url) — negative lookbehind for !
  return body.replace(
    /(^|[^!])\[([^\]]+)\]\(([^)]+)\)/g,
    (full, lead, text, url) => {
      // External / non-markdown — pass through unchanged
      if (
        /^(https?:|mailto:|data:|tel:|ftp:|#)/i.test(url) ||
        !url.endsWith('.md')
      ) {
        return full;
      }
      // Derive slug from basename without .md
      const basename = url.split('/').pop()!.slice(0, -3);
      const resolved = index.resolve(basename);
      const slug = resolved ? resolved.slug : basename;
      if (text === slug) return `${lead}[[${slug}]]`;
      return `${lead}[[${slug}|${text}]]`;
    }
  );
}

// -------------------------- frontmatter normalizer --------------------------

/**
 * Rule 2 + Rule 5: rebuild frontmatter as-text, normalizing only `related:`.
 *
 * Other lines pass through verbatim to preserve formatting and any unusual
 * keys (the corpus has aliases, tags, sources arrays we don't want to mangle).
 */
function normalizeFrontmatterLines(
  lines: string[],
  sourceKey: string,
  index: SlugIndex,
  broken: BrokenLink[]
): string[] {
  return lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('related:')) return line;
    const colonIdx = line.indexOf(':');
    const valPart = line.slice(colonIdx + 1).trim();
    if (!valPart.startsWith('[') || !valPart.endsWith(']')) return line;

    const items = Array.from(valPart.matchAll(/"((?:[^"\\]|\\.)*)"/g)).map((m) =>
      m[1].replace(/\\"/g, '"')
    );

    const normalized = items.map((item) => {
      const trimmedItem = item.trim();
      // Strip category/ prefix per Rule 2.3
      const slashIdx = trimmedItem.indexOf('/');
      const stripped = slashIdx >= 0 ? trimmedItem.slice(slashIdx + 1) : trimmedItem;

      const resolved = index.resolve(stripped);
      if (!resolved) {
        broken.push({ source: sourceKey, target: trimmedItem, reason: 'no-target' });
        return trimmedItem; // leave as-is when unresolved
      }
      return resolved.slug;
    });

    // Preserve indent before `related:`
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';
    const quoted = normalized.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(', ');
    return `${indent}related: [${quoted}]`;
  });
}

// ------------------------------ file processing -----------------------------

interface ProcessResult {
  sourceKey: string;          // "category/slug" (NO .md)
  outputPath: string;
  contentToWrite: string;
  sourceHash: string;
  title: string;
  aliases: string[];
}

function processFile(
  source: SourceFile,
  index: SlugIndex,
  brokenLinks: BrokenLink[],
  brokenRelated: BrokenLink[]
): ProcessResult {
  const raw = readFileSync(source.absPath, 'utf8');
  const sourceHash = createHash('sha256').update(raw).digest('hex');
  const parsed = parseFrontmatter(raw);
  const sourceKey = `${source.category}/${source.slug}`;

  // Normalize frontmatter lines
  const normalizedFmLines = normalizeFrontmatterLines(
    parsed.frontmatterLines,
    sourceKey,
    index,
    brokenRelated
  );

  // Normalize body: markdown-syntax internal links first, then wikilinks
  let normalizedBody = normalizeMarkdownInternalLinks(parsed.body, index);
  normalizedBody = normalizeBodyWikilinks(normalizedBody, sourceKey, index, brokenLinks);

  // Rebuild file. Re-emit the leading "---", frontmatter content, "---", body.
  let output: string;
  if (parsed.frontmatterRaw !== '') {
    output = `---\n${normalizedFmLines.join('\n').replace(/^\n+|\n+$/g, '')}\n---\n${normalizedBody}`;
    // Preserve trailing newline behavior: if raw ended with newline, keep one.
    if (raw.endsWith('\n') && !output.endsWith('\n')) output += '\n';
  } else {
    output = normalizedBody;
  }

  const title =
    typeof parsed.frontmatter.title === 'string'
      ? parsed.frontmatter.title
      : source.slug;
  const aliases = Array.isArray(parsed.frontmatter.aliases)
    ? (parsed.frontmatter.aliases as string[])
    : [];

  return {
    sourceKey,
    outputPath: join(TARGET_DIR, source.category, `${source.slug}.md`),
    contentToWrite: output,
    sourceHash,
    title,
    aliases,
  };
}

// -------------------------- derived-file regeneration -----------------------

/**
 * Rule 6: regenerate _index.md and _backlinks.json from the NORMALIZED output.
 *
 * Mirrors the algorithm in coach/bin/rebuild-index.sh but reads from TARGET_DIR
 * so case-fixes during normalization are reflected.
 */
function regenerateDerivedFiles(): { totalArticles: number; backlinkTargets: number } {
  const SECTIONS: Array<[string, Category]> = [
    ['Concerns', 'concerns'],
    ['Reads', 'reads'],
    ['Questions', 'questions'],
    ['Arcs', 'arcs'],
    ['Anti-Patterns', 'anti-patterns'],
    ['Concepts', 'concepts'],
    ['Patterns', 'patterns'],
    ['Moves', 'moves'],
    ['Distinctions', 'distinctions'],
    ['Principles', 'principles'],
    ['Practices', 'practices'],
    ['Frameworks', 'frameworks'],
    ['Examples', 'examples'],
    ['Applications', 'applications'],
  ];

  const entriesBySection = new Map<Category, string[]>();
  const backlinks: Record<string, string[]> = {};

  for (const [, dirname_] of SECTIONS) {
    const dirpath = join(TARGET_DIR, dirname_);
    if (!existsSync(dirpath)) {
      entriesBySection.set(dirname_, []);
      continue;
    }
    const fnames = readdirSync(dirpath)
      .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
      .sort();
    const entries: string[] = [];
    for (const fname of fnames) {
      const filepath = join(dirpath, fname);
      const content = readFileSync(filepath, 'utf8');
      const parsed = parseFrontmatter(content);
      if (typeof parsed.frontmatter.id !== 'string') continue;
      const articleId = parsed.frontmatter.id as string;
      const title =
        typeof parsed.frontmatter.title === 'string'
          ? parsed.frontmatter.title
          : articleId;
      const aliases = Array.isArray(parsed.frontmatter.aliases)
        ? (parsed.frontmatter.aliases as string[])
        : [];
      const also = aliases.length > 0 ? ` (also: ${aliases.join(', ')})` : '';
      entries.push(`- ${articleId} ${title}${also}`);

      // Body wikilinks → backlinks (NB: target may include #anchor or |display;
      // strip both so the key is the slug part only)
      for (const match of parsed.body.matchAll(/\[\[([^\]]+)\]\]/g)) {
        let target = match[1];
        const pipe = target.indexOf('|');
        if (pipe >= 0) target = target.slice(0, pipe);
        const hash = target.indexOf('#');
        if (hash >= 0) target = target.slice(0, hash);
        target = target.trim();
        // Strip category/ prefix if present
        const slash = target.indexOf('/');
        if (slash >= 0) target = target.slice(slash + 1);
        if (!target) continue;
        if (!(target in backlinks)) backlinks[target] = [];
        if (!backlinks[target].includes(articleId)) backlinks[target].push(articleId);
      }
    }
    entriesBySection.set(dirname_, entries);
  }

  // Write _index.md
  const indexLines: string[] = ['# Compendium Index'];
  for (const [sectionName, dirname_] of SECTIONS) {
    indexLines.push('', `## ${sectionName}`, '');
    for (const entry of entriesBySection.get(dirname_) ?? []) {
      indexLines.push(entry);
    }
  }
  indexLines.push('', '---', '');
  const totalArticles = Array.from(entriesBySection.values()).reduce(
    (a, e) => a + e.length,
    0
  );
  writeFileSync(join(TARGET_DIR, '_index.md'), indexLines.join('\n') + '\n');
  writeFileSync(
    join(TARGET_DIR, '_backlinks.json'),
    JSON.stringify(backlinks, null, 2) + '\n'
  );

  return { totalArticles, backlinkTargets: Object.keys(backlinks).length };
}

// -------------------------------- main flow ---------------------------------

interface RunOptions {
  /** If set, restrict to this many files (test ramp). */
  limit?: number;
  /** If set, restrict to this single category (test ramp). */
  onlyCategory?: Category;
  verbose?: boolean;
}

function loadManifest(): Manifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function run(options: RunOptions = {}): {
  written: number;
  skipped: number;
  removed: number;
  totalArticles: number;
  brokenLinks: number;
  brokenRelated: number;
  bodyLinkResolveRate: number;
  relatedResolveRate: number;
} {
  const t0 = Date.now();
  ensureDir(TARGET_DIR);

  let sources = enumerateSources();
  if (options.onlyCategory) {
    sources = sources.filter((s) => s.category === options.onlyCategory);
  }
  if (options.limit !== undefined) {
    sources = sources.slice(0, options.limit);
  }

  console.log(`[ingest] enumerated ${sources.length} source files`);

  // Build slug index (will throw on duplicate slug per success criterion)
  const index = new SlugIndex(sources);

  const oldManifest = loadManifest();
  const newFiles: Manifest['files'] = {};
  const brokenLinks: BrokenLink[] = [];
  const brokenRelated: BrokenLink[] = [];

  let written = 0;
  let skipped = 0;
  let totalBodyLinks = 0;
  let totalRelated = 0;

  // Pre-scan to count total body links and related entries for integrity %.
  // We use the raw source counts (per R-018: 34,154 body links, 15,040 related).
  for (const s of sources) {
    const raw = readFileSync(s.absPath, 'utf8');
    const parsed = parseFrontmatter(raw);
    const bodyMatches = parsed.body.match(/\[\[[^\]]+\]\]/g);
    totalBodyLinks += bodyMatches ? bodyMatches.length : 0;
    if (Array.isArray(parsed.frontmatter.related)) {
      totalRelated += (parsed.frontmatter.related as string[]).length;
    }
  }

  for (const source of sources) {
    const result = processFile(source, index, brokenLinks, brokenRelated);
    const prev = oldManifest?.files[result.sourceKey];
    const outputExists = existsSync(result.outputPath);

    if (prev && prev.source_hash === result.sourceHash && outputExists) {
      skipped++;
    } else {
      ensureDir(dirname(result.outputPath));
      writeFileSync(result.outputPath, result.contentToWrite);
      written++;
      if (options.verbose) {
        console.log(`[ingest] wrote ${result.sourceKey}`);
      }
    }

    newFiles[result.sourceKey] = {
      source_hash: result.sourceHash,
      title: result.title,
      aliases: result.aliases,
    };
  }

  // Remove outputs whose source no longer exists.
  let removed = 0;
  if (oldManifest) {
    const newKeys = new Set(Object.keys(newFiles));
    for (const oldKey of Object.keys(oldManifest.files)) {
      if (!newKeys.has(oldKey)) {
        const outPath = join(TARGET_DIR, `${oldKey}.md`);
        if (existsSync(outPath)) {
          rmSync(outPath);
          removed++;
        }
      }
    }
  }

  // Regenerate derived files from the normalized output (Rule 6).
  const derived = regenerateDerivedFiles();

  // Build slug_to_category from the index (for the renderer).
  const slugToCategory: Record<string, Category> = {};
  for (const [key, entry] of Object.entries(newFiles)) {
    const slashIdx = key.indexOf('/');
    const cat = key.slice(0, slashIdx) as Category;
    const slug = key.slice(slashIdx + 1);
    slugToCategory[slug] = cat;
  }

  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    generated_at: new Date().toISOString(),
    files: newFiles,
    broken_links: brokenLinks,
    broken_related: brokenRelated,
    slug_to_category: slugToCategory,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

  // Integrity check from the source-side perspective (numerator: resolved).
  const bodyResolveRate =
    totalBodyLinks > 0
      ? (totalBodyLinks - brokenLinks.length) / totalBodyLinks
      : 1;
  const relatedResolveRate =
    totalRelated > 0
      ? (totalRelated - brokenRelated.length) / totalRelated
      : 1;

  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[ingest] done in ${dt}s`);
  console.log(
    `[ingest] written=${written} skipped=${skipped} removed=${removed} ` +
      `(${sources.length} sources)`
  );
  console.log(
    `[ingest] derived: _index.md (${derived.totalArticles} entries), ` +
      `_backlinks.json (${derived.backlinkTargets} targets)`
  );
  console.log(
    `[ingest] integrity: body=${(bodyResolveRate * 100).toFixed(2)}% ` +
      `(${totalBodyLinks - brokenLinks.length}/${totalBodyLinks}), ` +
      `related=${(relatedResolveRate * 100).toFixed(2)}% ` +
      `(${totalRelated - brokenRelated.length}/${totalRelated})`
  );
  console.log(`[ingest] broken: links=${brokenLinks.length}, related=${brokenRelated.length}`);

  return {
    written,
    skipped,
    removed,
    totalArticles: derived.totalArticles,
    brokenLinks: brokenLinks.length,
    brokenRelated: brokenRelated.length,
    bodyLinkResolveRate: bodyResolveRate,
    relatedResolveRate,
  };
}

// ------------------------------ CLI / entrypoint ----------------------------

const args = process.argv.slice(2);
const opts: RunOptions = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--limit') opts.limit = parseInt(args[++i], 10);
  else if (a === '--only') opts.onlyCategory = args[++i] as Category;
  else if (a === '--verbose' || a === '-v') opts.verbose = true;
  else if (a === '--help' || a === '-h') {
    console.log(
      'Usage: bun scripts/ingest-coach.ts [--limit N] [--only CATEGORY] [--verbose]'
    );
    process.exit(0);
  }
}

const result = run(opts);

// Enforce integrity threshold (97% per R-018 / E-039 success criteria).
// Only enforced for full-corpus runs: subset runs (--limit / --only) by
// definition exclude cross-category targets and will fail the check spuriously.
const INTEGRITY_THRESHOLD = 0.97;
const isFullRun = opts.limit === undefined && opts.onlyCategory === undefined;
if (
  isFullRun &&
  (result.bodyLinkResolveRate < INTEGRITY_THRESHOLD ||
    result.relatedResolveRate < INTEGRITY_THRESHOLD)
) {
  console.error(
    `[ingest] FAIL: integrity below threshold ${INTEGRITY_THRESHOLD * 100}%. ` +
      `body=${(result.bodyLinkResolveRate * 100).toFixed(2)}%, ` +
      `related=${(result.relatedResolveRate * 100).toFixed(2)}%`
  );
  process.exit(2);
}
if (!isFullRun) {
  console.log(
    `[ingest] note: integrity threshold not enforced for subset runs ` +
      `(cross-category targets excluded by --limit/--only)`
  );
}

export { run, parseFrontmatter, SlugIndex, normalizeBodyWikilinks, normalizeMarkdownInternalLinks };
