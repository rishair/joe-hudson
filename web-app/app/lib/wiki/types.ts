// Wiki domain types and repository interface (E-042).
//
// The wiki content lives at web-app/content/wiki/ (produced by E-039's
// ingestion script). Pages are mirrored from coach/ with normalized links;
// the ingest manifest at content/wiki/.ingest-manifest.json carries the
// slug→category map and the broken-link inventory.
//
// Per [[coding-architecture]] we use the four-method Repository shape with
// rich criteria objects. For the wiki this collapses to just `find` because
// the repo is read-only at runtime (writes flow through the ingestion
// script's filesystem output, not through this interface).

export type WikiCategory =
  | 'anti-patterns'
  | 'applications'
  | 'concepts'
  | 'concerns'
  | 'distinctions'
  | 'examples'
  | 'frameworks'
  | 'moves'
  | 'patterns'
  | 'practices'
  | 'principles'
  | 'questions'
  | 'reads';

// A single wiki page parsed from the ingest output. `frontmatter` keeps the
// raw key/value pairs so future surfaces (e.g. the resource modal's
// metadata strip) can read aliases, tags, sources, etc., without re-parsing.
//
// `related` is broken out because it drives the "see also" section at the
// bottom of every page and the right-rail navigation in E-044's modal.
//
// `slug` is the bare slug; `category/slug` is the routable form. The pair
// uniquely identifies a page because R-018 verified 0 slug collisions.
export type WikiPage = {
  slug: string;
  category: WikiCategory;
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
  related: string[];
};

// Lightweight reference returned by category-listing queries; the body is
// expensive to parse so listings skip it.
export type WikiPageRef = {
  slug: string;
  category: WikiCategory;
  title: string;
};

// Slug → {category, title} lookup. Built once from the ingest manifest at
// app boot (or first read). Used by the markdown wikilink processor to
// resolve `[[slug]]` to a full route, and to detect broken links.
export type SlugIndex = Map<string, { category: WikiCategory; title: string }>;

// The on-disk shape of .ingest-manifest.json (produced by E-039 per R-018
// Rule 6). Only the parts we consume are typed; other fields pass through.
export type IngestManifest = {
  version: number;
  generated_at: string;
  files: Record<
    string,
    {
      source_hash: string;
      title: string;
      aliases?: string[];
    }
  >;
  broken_links: Array<{ source: string; target: string; reason: string }>;
  broken_related: Array<{ source: string; target: string; reason: string }>;
  slug_to_category: Record<string, WikiCategory>;
};

export type FindWikiCriteria = {
  // Exact category/slug match (singleton lookup).
  slug?: string;
  // Restrict the result set to a category. Combinable with `query` for
  // intra-category search.
  category?: WikiCategory;
  // Free-text match against title + body (case-insensitive substring).
  // Not used in v1 routes but defined here so a future search bar drops in
  // without an interface change.
  query?: string;
  limit?: number;
  offset?: number;
};

// The WikiRepository owns reads against the ingested wiki content. Per
// [[coding-architecture]] every Repository carries the four-method shape
// even if some methods aren't applicable today; the wiki layer is
// runtime-read-only so create/update/delete are not exposed.
export interface WikiRepository {
  find(criteria?: FindWikiCriteria): Promise<WikiPage[]>;
  // Return only refs (no body) for listings. Cheap; pages are read lazily.
  list(criteria?: { category?: WikiCategory; limit?: number }): Promise<
    WikiPageRef[]
  >;
  // Return the in-memory slug→{category,title} map. Required by the
  // markdown processor at render time to resolve `[[wikilinks]]`.
  getSlugIndex(): Promise<SlugIndex>;
  // The list of broken links from the manifest. The renderer styles these
  // distinctly per R-018 Findings §"Canonical web-app format".
  getBrokenLinks(): Promise<Set<string>>;
}
