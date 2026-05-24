// WikiRepository backed by `readWikiAsset()` (runtime-agnostic — local fs
// on Node, ASSETS binding on Cloudflare Workers). SERVER-ONLY.
//
// Reads from web-app/content/wiki/ (produced by E-039's ingestion script
// and, on Cloudflare, copied into the assets bundle by E-046's
// scripts/prebuild-cf.ts). The ingest manifest at .ingest-manifest.json
// carries the slug→category map and the broken-link inventory; we read
// it once and cache in memory.
//
// Page bodies are read lazily on demand. The corpus is 2,376 files and
// stays under a few MB compressed, but eagerly reading every file at boot
// would inflate cold-start and the wiki view only needs one page per
// request. The slug index, on the other hand, is hot (every wikilink
// resolution touches it) and is loaded once.

import 'server-only';
import type {
  FindWikiCriteria,
  IngestManifest,
  SlugIndex,
  WikiCategory,
  WikiPage,
  WikiPageRef,
  WikiRepository,
} from './types';
import { parseFrontmatter } from './frontmatter';
import { readWikiAsset } from '../runtime/wiki-asset-reader';

const VALID_CATEGORIES: ReadonlySet<WikiCategory> = new Set<WikiCategory>([
  'anti-patterns',
  'applications',
  'concepts',
  'concerns',
  'distinctions',
  'examples',
  'frameworks',
  'moves',
  'patterns',
  'practices',
  'principles',
  'questions',
  'reads',
]);

export class FsWikiRepository implements WikiRepository {
  // Cached parsed manifest. The manifest changes only when E-039 re-runs
  // (out-of-process), so an in-process cache is correct for the lifetime
  // of a Next.js server instance. Restarting the dev server picks up a
  // re-ingest automatically.
  private manifestPromise: Promise<IngestManifest> | null = null;
  private slugIndexPromise: Promise<SlugIndex> | null = null;
  private brokenLinksPromise: Promise<Set<string>> | null = null;

  // contentRoot is now informational only — the actual reads go through
  // `readWikiAsset()` which handles Node-vs-Cloudflare runtime detection.
  // Kept in the constructor signature for backwards compat with the
  // container that wires it; tests can still pass a custom root via the
  // WIKI_ROOT env var rather than the constructor argument.
  constructor(private readonly contentRoot: string) {
    void this.contentRoot; // suppress unused-warning while keeping the arg
  }

  async find(criteria: FindWikiCriteria = {}): Promise<WikiPage[]> {
    // Singleton lookup is the hot path (every wiki route render). Short-
    // circuit it to a single file read.
    if (criteria.slug && !criteria.query) {
      const page = await this.readPageBySlug(criteria.slug);
      if (!page) return [];
      if (criteria.category && page.category !== criteria.category) return [];
      return [page];
    }
    // Bulk/filtered scan. Walk the list once and apply the criteria.
    // Used by future search/sitemap features; the catch-all route does
    // not hit this path today.
    const refs = await this.list({ category: criteria.category });
    const results: WikiPage[] = [];
    let skipped = 0;
    for (const ref of refs) {
      if (criteria.limit && results.length >= criteria.limit) break;
      const page = await this.readPageBySlug(ref.slug);
      if (!page) continue;
      if (criteria.query) {
        const q = criteria.query.toLowerCase();
        const hit =
          page.title.toLowerCase().includes(q) ||
          page.body.toLowerCase().includes(q);
        if (!hit) continue;
      }
      if (criteria.offset && skipped < criteria.offset) {
        skipped += 1;
        continue;
      }
      results.push(page);
    }
    return results;
  }

  async list(
    criteria: { category?: WikiCategory; limit?: number } = {},
  ): Promise<WikiPageRef[]> {
    const manifest = await this.getManifest();
    const refs: WikiPageRef[] = [];
    for (const [filePath, info] of Object.entries(manifest.files)) {
      const slash = filePath.indexOf('/');
      if (slash === -1) continue;
      const cat = filePath.slice(0, slash) as WikiCategory;
      const slug = filePath.slice(slash + 1);
      if (!VALID_CATEGORIES.has(cat)) continue;
      if (criteria.category && cat !== criteria.category) continue;
      refs.push({ slug, category: cat, title: info.title });
      if (criteria.limit && refs.length >= criteria.limit) break;
    }
    // Stable order: title-ascending. Categories sort independently per
    // call (the consumer is the index page which groups by category).
    refs.sort((a, b) => a.title.localeCompare(b.title));
    return refs;
  }

  async getSlugIndex(): Promise<SlugIndex> {
    if (this.slugIndexPromise) return this.slugIndexPromise;
    this.slugIndexPromise = (async () => {
      const manifest = await this.getManifest();
      const idx: SlugIndex = new Map();
      for (const [filePath, info] of Object.entries(manifest.files)) {
        const slash = filePath.indexOf('/');
        if (slash === -1) continue;
        const cat = filePath.slice(0, slash) as WikiCategory;
        const slug = filePath.slice(slash + 1);
        if (!VALID_CATEGORIES.has(cat)) continue;
        idx.set(slug, { category: cat, title: info.title });
      }
      return idx;
    })();
    return this.slugIndexPromise;
  }

  async getBrokenLinks(): Promise<Set<string>> {
    if (this.brokenLinksPromise) return this.brokenLinksPromise;
    this.brokenLinksPromise = (async () => {
      const manifest = await this.getManifest();
      // Set of "category/slug → target" pairs would let us be precise per
      // source, but the renderer only needs to know "is this target
      // broken?" since the same slug is broken from every source if it
      // doesn't exist. Set of broken targets is sufficient.
      const broken = new Set<string>();
      for (const entry of manifest.broken_links) {
        broken.add(entry.target.toLowerCase());
      }
      return broken;
    })();
    return this.brokenLinksPromise;
  }

  private async getManifest(): Promise<IngestManifest> {
    if (this.manifestPromise) return this.manifestPromise;
    this.manifestPromise = (async () => {
      const raw = await readWikiAsset('.ingest-manifest.json');
      if (raw === null) {
        throw new Error(
          '.ingest-manifest.json not found; run `bun run ingest` (or, on Cloudflare, ensure prebuild-cf copied content/wiki into the assets bundle).',
        );
      }
      return JSON.parse(raw) as IngestManifest;
    })();
    return this.manifestPromise;
  }

  private async readPageBySlug(slug: string): Promise<WikiPage | null> {
    // Lookup the category from the slug index, then read the file. Slugs
    // are globally unique (R-018 verified 0 collisions) so this is a
    // deterministic single-file read.
    const idx = await this.getSlugIndex();
    const entry = idx.get(slug);
    if (!entry) return null;
    const raw = await readWikiAsset(`${entry.category}/${slug}.md`);
    if (raw === null) {
      // File listed in manifest but missing on disk / in assets. Treat as
      // not-found rather than throwing; the route handler will render a
      // 404.
      return null;
    }
    const parsed = parseFrontmatter(raw);
    const related = Array.isArray(parsed.frontmatter.related)
      ? (parsed.frontmatter.related as string[])
      : [];
    return {
      slug,
      category: entry.category,
      title: entry.title,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      related,
    };
  }
}
