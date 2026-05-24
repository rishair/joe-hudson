// Barrel exports for the wiki module. Server-only code is gated behind
// 'server-only' inside its own modules; importing from this index from a
// client component will fail-loud at build time.

export type {
  WikiPage,
  WikiPageRef,
  WikiCategory,
  WikiRepository,
  FindWikiCriteria,
  SlugIndex,
  IngestManifest,
} from './types';
export { rewriteWikilinks, BROKEN_LINK_SENTINEL, parseWikilink } from './wikilinks';
export type { WikilinkParts } from './wikilinks';
