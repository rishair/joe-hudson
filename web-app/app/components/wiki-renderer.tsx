'use client';

// WikiRenderer — renders a parsed WikiPage's body as styled markdown with
// custom handling for internal `/wiki/...` links per R-017 §5.
//
// The wikilink pre-processing (Obsidian `[[slug]]` → standard markdown
// link) is done on the server before the body reaches this component
// (see app/lib/wiki/wikilinks.ts). This component is responsible only for:
//   1. Rendering the now-standard markdown via react-markdown + remark-gfm.
//   2. Customizing the `<a>` rendering based on `linkBehavior` and the
//      URL shape:
//        - resolved internal link (`/wiki/{category}/{slug}`) →
//          Next.js <Link> when linkBehavior='route', <button> when
//          linkBehavior='in-modal' (calls onLinkClick(slug))
//        - broken internal link (`/wiki/_broken/{slug}`) →
//          visibly-broken span with tooltip, NOT clickable in either mode
//        - external (anything else) → standard <a target="_blank">

import Link from 'next/link';
import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BROKEN_LINK_SENTINEL } from '../lib/wiki/wikilinks';

export type WikiRendererLinkBehavior = 'route' | 'in-modal';

export type WikiRendererProps = {
  // Wikilink-rewritten markdown body. The caller (a server component)
  // pre-processes the page body via `rewriteWikilinks` so this component
  // never sees raw `[[wikilinks]]`.
  body: string;
  linkBehavior?: WikiRendererLinkBehavior;
  // Required when linkBehavior === 'in-modal'. The slug is extracted from
  // the href (already URL-decoded) and passed to the callback. The
  // wikilink anchor (if any) is preserved on the slug — callers using
  // 'in-modal' typically ignore the anchor since the in-modal panel
  // doesn't have scroll-to-heading semantics in v1.
  onLinkClick?: (slug: string, anchor: string | null) => void;
};

// Parse `/wiki/{category}/{slug}{#anchor?}` or
// `/wiki/_broken/{slug}` into its parts. Returns null for non-internal
// links. Anchor (if present) is returned URL-decoded.
function parseInternalHref(
  href: string,
): { category: string; slug: string; anchor: string | null } | null {
  if (!href.startsWith('/wiki/')) return null;
  // Extract anchor first so the slug split below isn't confused by it.
  const hashIdx = href.indexOf('#');
  const withoutAnchor =
    hashIdx === -1 ? href : href.slice(0, hashIdx);
  const anchor =
    hashIdx === -1 ? null : decodeURIComponent(href.slice(hashIdx + 1));
  const parts = withoutAnchor.slice('/wiki/'.length).split('/');
  if (parts.length !== 2) return null;
  return {
    category: decodeURIComponent(parts[0]),
    slug: decodeURIComponent(parts[1]),
    anchor,
  };
}

export function WikiRenderer({
  body,
  linkBehavior = 'route',
  onLinkClick,
}: WikiRendererProps): React.ReactElement {
  // Build the components map once per render; React's reconciler is fine
  // re-using the same function references because they close over the
  // current props each render.
  const components: Components = {
    a: ({ href, children, ...rest }) => {
      if (!href) {
        return <a {...rest}>{children}</a>;
      }
      const internal = parseInternalHref(href);

      // External link (anything not `/wiki/...`) always opens in a new
      // tab. R-017 §5 says external behavior is the same in both modes.
      if (!internal) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            {...rest}
          >
            {children}
          </a>
        );
      }

      // Broken-link sentinel. Render as a visibly broken span; not
      // clickable in either mode, never throws.
      if (internal.category === BROKEN_LINK_SENTINEL) {
        return (
          <span
            className="wikilink-broken"
            title={`Missing wiki target: ${internal.slug}`}
            style={{
              color: '#b00020',
              textDecoration: 'underline wavy #b00020',
              cursor: 'help',
            }}
          >
            {children}
          </span>
        );
      }

      // In-modal mode: render a button that invokes the callback. We
      // keep the visual styling close to a link so users get the same
      // affordance, but it's semantically a button (preserves
      // accessibility and prevents browser navigation).
      if (linkBehavior === 'in-modal') {
        if (!onLinkClick) {
          // Misconfiguration. Render as a non-clickable span so we don't
          // silently lose the user's click.
          return (
            <span
              style={{ color: '#1a73e8', textDecoration: 'underline' }}
              title="In-modal link without handler"
            >
              {children}
            </span>
          );
        }
        return (
          <button
            type="button"
            onClick={() => onLinkClick(internal.slug, internal.anchor)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: '#1a73e8',
              textDecoration: 'underline',
              cursor: 'pointer',
              font: 'inherit',
              display: 'inline',
            }}
          >
            {children}
          </button>
        );
      }

      // Default ('route') mode: Next.js <Link>. Use the href as-is —
      // it's already encoded by the wikilink rewriter.
      return (
        <Link
          href={href}
          style={{ color: '#1a73e8', textDecoration: 'underline' }}
        >
          {children}
        </Link>
      );
    },
    // Modest styling adjustments to make the rendered markdown readable
    // without a CSS framework. Keep it conservative; visual polish is a
    // later goal.
    h1: ({ children }) => (
      <h1
        style={{
          fontSize: 28,
          fontWeight: 600,
          marginTop: 32,
          marginBottom: 16,
          lineHeight: 1.25,
        }}
      >
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2
        style={{
          fontSize: 22,
          fontWeight: 600,
          marginTop: 28,
          marginBottom: 12,
          lineHeight: 1.3,
        }}
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        style={{
          fontSize: 18,
          fontWeight: 600,
          marginTop: 22,
          marginBottom: 10,
        }}
      >
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p style={{ margin: '0 0 14px', lineHeight: 1.6 }}>{children}</p>
    ),
    blockquote: ({ children }) => (
      <blockquote
        style={{
          margin: '0 0 14px',
          padding: '8px 14px',
          borderLeft: '3px solid #d0d0d0',
          color: '#444',
          fontStyle: 'italic',
          background: '#fafafa',
        }}
      >
        {children}
      </blockquote>
    ),
    ul: ({ children }) => (
      <ul style={{ margin: '0 0 14px', paddingLeft: 24 }}>{children}</ul>
    ),
    ol: ({ children }) => (
      <ol style={{ margin: '0 0 14px', paddingLeft: 24 }}>{children}</ol>
    ),
    li: ({ children }) => (
      <li style={{ marginBottom: 4, lineHeight: 1.55 }}>{children}</li>
    ),
    code: ({ children }) => (
      <code
        style={{
          background: '#f4f4f4',
          padding: '1px 5px',
          borderRadius: 4,
          fontSize: '0.92em',
          fontFamily:
            'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
        }}
      >
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre
        style={{
          background: '#f4f4f4',
          padding: 12,
          borderRadius: 6,
          overflowX: 'auto',
          fontSize: 13,
          margin: '0 0 14px',
        }}
      >
        {children}
      </pre>
    ),
    hr: () => (
      <hr
        style={{
          border: 0,
          borderTop: '1px solid #e0e0e0',
          margin: '24px 0',
        }}
      />
    ),
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {body}
    </ReactMarkdown>
  );
}
