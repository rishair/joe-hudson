// Wikilink pre-processor.
//
// Converts Obsidian-style `[[wikilinks]]` in markdown body text into
// standard markdown links the markdown renderer can then render via a
// custom `a` component. R-018 finalized the canonical forms:
//
//   [[slug]]                 → link to /wiki/{category}/{slug}
//   [[slug|display]]         → link to /wiki/{category}/{slug}, text = display
//   [[slug#anchor]]          → link to /wiki/{category}/{slug}#anchor
//   [[slug#anchor|display]]  → same with display text
//
// E-039's ingestion normalized every link in the corpus to one of these
// forms; the renderer does not have to handle category-prefixed or
// uppercase-leading source forms. The slug lookup is a Map<string,
// {category, title}> derived from the ingest manifest.
//
// Broken links (slug not in the index) are encoded with a sentinel href
// `/wiki/_broken/{slug}` so the custom `a` component can detect them and
// render a visibly-broken span instead of a clickable link.

import type { SlugIndex } from './types';

// The sentinel category that flags a broken link target in the rendered
// markdown. Anything with this category in the href is non-navigable.
export const BROKEN_LINK_SENTINEL = '_broken';

// Regex captures `[[...]]` where `...` may contain `|`, `#`, letters,
// digits, hyphens, spaces (though spaces in the corpus are vanishingly
// rare — R-018 found 5 instances). Doesn't allow nested `]]` or `[[`.
//
// Capture groups (1) = the entire inner contents.
const WIKILINK_RE = /\[\[([^\[\]]+?)\]\]/g;

export type WikilinkParts = {
  slug: string;
  anchor: string | null;
  display: string;
};

export function parseWikilink(inner: string): WikilinkParts {
  // Split on `|` to extract optional display. The corpus has at most one
  // pipe per link (verified by R-018).
  const pipe = inner.indexOf('|');
  const targetPart = pipe === -1 ? inner : inner.slice(0, pipe);
  const displayPart = pipe === -1 ? null : inner.slice(pipe + 1);

  // Split on `#` to extract optional anchor.
  const hash = targetPart.indexOf('#');
  const slugRaw = hash === -1 ? targetPart : targetPart.slice(0, hash);
  const anchorRaw = hash === -1 ? null : targetPart.slice(hash + 1);

  const slug = slugRaw.trim();
  const anchor = anchorRaw === null ? null : anchorRaw.trim();
  // Display text defaults to the raw target (slug + optional anchor) so
  // the rendered text matches what an author typed when no pipe is used.
  // Note: we intentionally do NOT default to the page title here — the
  // markdown processor doesn't have title lookups in scope and the slug
  // is a reasonable default per the Obsidian convention.
  const display =
    displayPart !== null ? displayPart.trim() : slug;
  return { slug, anchor, display };
}

// Substitute every [[wikilink]] in `body` with a standard markdown link
// of the form `[display](href)`. The `href` is `/wiki/{category}/{slug}`
// for resolved links or `/wiki/_broken/{slug}` for broken ones. The
// rendered `<a>` is later upgraded by the wiki renderer's custom
// component into a Next.js <Link>, an in-modal button, or a broken span.
export function rewriteWikilinks(body: string, slugIndex: SlugIndex): string {
  return body.replace(WIKILINK_RE, (_full, inner: string) => {
    const { slug, anchor, display } = parseWikilink(inner);
    // Case-fold resolution. R-018 specified this as Rule 1.4. The
    // ingest already canonicalized source links, so the lowercase form
    // is the canonical one to look up.
    const slugLower = slug.toLowerCase();
    const entry =
      slugIndex.get(slug) ?? slugIndex.get(slugLower) ?? null;
    if (!entry) {
      const href = `/wiki/${BROKEN_LINK_SENTINEL}/${encodeURIComponent(slug)}`;
      return `[${escapeMd(display)}](${href})`;
    }
    const anchorPart = anchor ? `#${encodeURIComponent(anchor)}` : '';
    const href = `/wiki/${entry.category}/${encodeURIComponent(slug)}${anchorPart}`;
    return `[${escapeMd(display)}](${href})`;
  });
}

// Escape markdown link-text characters that could re-trigger parsing. The
// most common offender in the corpus is a `]` or `[` inside a piped
// display (display = "see also (link)") — these confuse the markdown
// parser otherwise.
function escapeMd(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1');
}
