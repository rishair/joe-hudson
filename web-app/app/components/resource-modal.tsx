'use client';

// E-044 — resource-attribution modal.
//
// Renders a native HTML <dialog> portaled to #modal-root (added once in
// app/layout.tsx). Visible when the URL carries ?resourceModal=<msgId>;
// reads/writes that state via useResourceModal() (nuqs-backed).
//
// Layout (R-017 §8): 65% left, 35% right, ~90vw × 85vh, max 1400px wide.
//   Left  = focused resource's wiki entry, rendered via <WikiRenderer
//           linkBehavior="in-modal" onLinkClick={focus}>
//   Right = list of resource cards from the assistant message's
//           data-resources part. Click → focus(slug). Currently-focused
//           card has a left border + tinted background. aria-current="true".
//
// Native <dialog> handles focus-trap, escape-to-close, ARIA modal role,
// backdrop, and inert-rest-of-page semantics for free. We add:
//   - aria-labelledby on the dialog pointing to the left-panel title h2
//   - aria-live="polite" region announcing focus changes
//   - Escape/click-outside → close()
//   - "Expand" header button → router.push('/wiki/<cat>/<slug>?fromChat=<msgId>')
//     after closing the modal (per R-017 §7)
//
// Resource page bodies are fetched via /api/wiki/page on focus change. We
// cache results in a per-mount Map so re-clicking a previously-viewed
// resource doesn't re-fetch.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { UIMessage } from 'ai';
import type { CoachUIMessage } from '../lib/coach/types';
import { useResourceModal } from '../lib/state/use-resource-modal';
import { WikiRenderer } from './wiki-renderer';

export type ResourceModalProps = {
  // Pass the same messages array the chat surface is rendering so the
  // modal stays in sync with stream updates / hydration / persistence.
  messages: ReadonlyArray<UIMessage | CoachUIMessage>;
};

type WikiPagePayload = {
  slug: string;
  category: string;
  title: string;
  body: string;
  related: string[];
};

type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading'; slug: string }
  | { kind: 'loaded'; slug: string; page: WikiPagePayload }
  | { kind: 'error'; slug: string; message: string };

export function ResourceModal({
  messages,
}: ResourceModalProps): React.ReactElement | null {
  const router = useRouter();
  const { isOpen, messageId, focusedSlug, resources, focus, close } =
    useResourceModal(messages);

  // The portal target lives in layout.tsx as <div id="modal-root" />. We grab
  // it on mount (after hydration) and re-render once available. SSR-safe
  // because we render null until the ref is populated.
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    setPortalEl(document.getElementById('modal-root'));
  }, []);

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  // Track the element that opened the modal so we can return focus on close.
  const openerRef = useRef<HTMLElement | null>(null);

  // Capture the focused element BEFORE the dialog opens so close() can
  // restore it. The native <dialog> moves focus into the dialog on
  // showModal(); we just need to remember where focus was.
  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = (document.activeElement as HTMLElement | null) ?? null;
  }, [isOpen]);

  // Wire native <dialog>'s open/close to our nuqs-backed state.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (isOpen && !el.open) {
      try {
        el.showModal();
      } catch {
        // Already open or detached. Ignore.
      }
    } else if (!isOpen && el.open) {
      el.close();
    }
  }, [isOpen]);

  // Sync the URL state when the user dismisses the dialog via Escape OR via
  // backdrop click OR via close(). The native <dialog> fires a 'close' event
  // in all these cases; routing it through close() keeps the URL the source
  // of truth.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handler = (): void => {
      // If close() was already called the URL is already cleared; calling
      // again is safe (setQueryState is idempotent on null).
      if (isOpen) {
        void close();
      }
      // Restore focus to whoever opened the dialog.
      if (openerRef.current) {
        try {
          openerRef.current.focus();
        } catch {
          // Element gone (e.g., conversation switched). Fine.
        }
      }
    };
    el.addEventListener('close', handler);
    return (): void => {
      el.removeEventListener('close', handler);
    };
  }, [isOpen, close]);

  // Backdrop click (native <dialog> doesn't dismiss on backdrop by default).
  // The trick: clicking outside the dialog's bounding box hits the dialog
  // ELEMENT itself (because the backdrop is the dialog's ::backdrop), so we
  // detect by comparing event.target to the dialog ref.
  const onDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>): void => {
      if (e.target === dialogRef.current) {
        void close();
      }
    },
    [close],
  );

  // --- Page body fetching ---

  // In-memory cache for fetched page bodies, scoped to this modal instance.
  // We clear it when the messageId changes (different conversation turn ⇒
  // different resource set ⇒ different focus targets likely).
  const pageCache = useRef<Map<string, WikiPagePayload>>(new Map());
  const [fetchState, setFetchState] = useState<FetchState>({ kind: 'idle' });

  useEffect(() => {
    pageCache.current = new Map();
    setFetchState({ kind: 'idle' });
  }, [messageId]);

  useEffect(() => {
    if (!isOpen || !focusedSlug) return;
    const cached = pageCache.current.get(focusedSlug);
    if (cached) {
      setFetchState({ kind: 'loaded', slug: focusedSlug, page: cached });
      return;
    }
    let cancelled = false;
    setFetchState({ kind: 'loading', slug: focusedSlug });
    fetch(`/api/wiki/page?slug=${encodeURIComponent(focusedSlug)}`)
      .then(async (res) => {
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(errBody.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<WikiPagePayload>;
      })
      .then((page) => {
        if (cancelled) return;
        pageCache.current.set(page.slug, page);
        setFetchState({ kind: 'loaded', slug: focusedSlug, page });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setFetchState({ kind: 'error', slug: focusedSlug, message });
      });
    return (): void => {
      cancelled = true;
    };
  }, [isOpen, focusedSlug]);

  // "Expand to full" per R-017 §7: clear the modal state, route to the
  // full wiki page with ?fromChat=<msgId> so the wiki page renders the
  // back-to-chat affordance.
  const onExpand = useCallback((): void => {
    if (!focusedSlug || !messageId) return;
    const cat =
      fetchState.kind === 'loaded' ? fetchState.page.category : null;
    const slug = focusedSlug;
    const target = cat
      ? `/wiki/${cat}/${encodeURIComponent(slug)}?fromChat=${encodeURIComponent(messageId)}`
      : // Fall back to the slug-only URL; the wiki route's slug-index
        // recovery (see app/wiki/[[...slug]]/page.tsx) catches unknown
        // categories. This is best-effort if expand fires before the
        // first fetch lands.
        `/wiki/${encodeURIComponent(slug)}?fromChat=${encodeURIComponent(messageId)}`;
    void close();
    router.push(target);
  }, [focusedSlug, messageId, fetchState, close, router]);

  const onInModalLinkClick = useCallback(
    (slug: string): void => {
      void focus(slug);
    },
    [focus],
  );

  // Live-region announcer for screen readers (R-017 §9).
  const announcement = useMemo(() => {
    if (fetchState.kind === 'loaded') return `Now viewing: ${fetchState.page.title}`;
    if (fetchState.kind === 'loading') return 'Loading resource…';
    if (fetchState.kind === 'error') return `Failed to load resource: ${fetchState.message}`;
    return '';
  }, [fetchState]);

  if (!portalEl) return null;
  if (!isOpen) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      onClick={onDialogClick}
      aria-labelledby="resource-modal-title"
      style={dialogStyle}
    >
      <div style={layoutStyle} onClick={(e) => e.stopPropagation()}>
        {/* LEFT: focused wiki entry */}
        <section style={leftPaneStyle} aria-label="Focused resource">
          <header style={leftHeaderStyle}>
            <h2 id="resource-modal-title" style={leftTitleStyle}>
              {fetchState.kind === 'loaded'
                ? fetchState.page.title
                : focusedSlug ?? 'Resource'}
            </h2>
            <div style={leftHeaderActionsStyle}>
              <button
                type="button"
                onClick={onExpand}
                style={expandButtonStyle}
                aria-label="Open this resource in the full wiki view"
                disabled={!focusedSlug}
              >
                Expand ↗
              </button>
              <button
                type="button"
                onClick={() => void close()}
                style={closeButtonStyle}
                aria-label="Close resource modal"
              >
                ×
              </button>
            </div>
          </header>

          {fetchState.kind === 'loaded' && (
            <div style={leftMetaStyle}>
              {fetchState.page.category} · {fetchState.page.slug}
            </div>
          )}

          <article style={leftBodyStyle}>
            {fetchState.kind === 'loading' && (
              <p style={statusStyle}>Loading…</p>
            )}
            {fetchState.kind === 'error' && (
              <p style={{ ...statusStyle, color: '#b00020' }} role="alert">
                Could not load resource: {fetchState.message}
              </p>
            )}
            {fetchState.kind === 'loaded' && (
              <WikiRenderer
                body={fetchState.page.body}
                linkBehavior="in-modal"
                onLinkClick={onInModalLinkClick}
              />
            )}
          </article>
        </section>

        {/* RIGHT: resource list */}
        <aside style={rightPaneStyle} aria-label="All resources for this message">
          <header style={rightHeaderStyle}>
            <h3 style={rightTitleStyle}>
              Sources used ({resources.length})
            </h3>
          </header>
          <ul style={rightListStyle}>
            {resources.map((r) => {
              const isFocused = r.slug === focusedSlug;
              return (
                <li key={r.slug} style={{ listStyle: 'none' }}>
                  <button
                    type="button"
                    onClick={() => void focus(r.slug)}
                    aria-current={isFocused ? 'true' : undefined}
                    style={{
                      ...resourceCardStyle,
                      background: isFocused ? '#eef4ff' : 'transparent',
                      borderLeft: isFocused
                        ? '3px solid #1a73e8'
                        : '3px solid transparent',
                    }}
                  >
                    <div style={resourceTitleStyle}>{r.title}</div>
                    <div style={resourceCategoryStyle}>{r.category}</div>
                    {r.walker_reason && (
                      <div style={resourceSnippetStyle}>{r.walker_reason}</div>
                    )}
                  </button>
                </li>
              );
            })}
            {resources.length === 0 && (
              <li style={{ listStyle: 'none' }}>
                <p style={statusStyle}>No resources attached to this message.</p>
              </li>
            )}
          </ul>
        </aside>
      </div>

      {/* Screen-reader-only live region. Updates trigger announcement on
          focus change. Visually hidden via off-screen positioning. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={srOnlyStyle}
      >
        {announcement}
      </div>
    </dialog>,
    portalEl,
  );
}

// --- Styles. Inline rather than CSS modules to stay consistent with the
// rest of the web-app's barebones aesthetic (E-040/E-041/E-042/E-045 all
// inline). Tailwind would be the right move once visual polish is a goal.

const dialogStyle: React.CSSProperties = {
  width: '90vw',
  maxWidth: 1400,
  height: '85vh',
  padding: 0,
  border: '1px solid #d0d5dd',
  borderRadius: 12,
  background: '#fff',
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.18)',
  overflow: 'hidden',
};

const layoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '65% 35%',
  height: '100%',
  overflow: 'hidden',
};

const leftPaneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  borderRight: '1px solid #e0e0e0',
  minWidth: 0,
};

const leftHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  padding: '16px 20px 8px',
  gap: 12,
  borderBottom: '1px solid #f0f0f0',
};

const leftTitleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
  margin: 0,
  lineHeight: 1.25,
  flex: 1,
  minWidth: 0,
  overflowWrap: 'break-word',
};

const leftHeaderActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};

const leftMetaStyle: React.CSSProperties = {
  padding: '4px 20px 0',
  fontSize: 12,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const leftBodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '12px 20px 24px',
  color: '#222',
  fontSize: 15,
};

const expandButtonStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  color: '#1a73e8',
  background: '#fff',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const closeButtonStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  fontSize: 22,
  lineHeight: 1,
  background: 'transparent',
  border: 'none',
  color: '#666',
  cursor: 'pointer',
  borderRadius: 6,
};

const rightPaneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: '#fafafa',
  minWidth: 0,
};

const rightHeaderStyle: React.CSSProperties = {
  padding: '16px 16px 8px',
  borderBottom: '1px solid #f0f0f0',
};

const rightTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  margin: 0,
  color: '#444',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const rightListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '8px 0',
  margin: 0,
};

const resourceCardStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '10px 14px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const resourceTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#1a1a1a',
  marginBottom: 2,
  lineHeight: 1.3,
};

const resourceCategoryStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 4,
};

const resourceSnippetStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#555',
  lineHeight: 1.4,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const statusStyle: React.CSSProperties = {
  padding: '12px 0',
  color: '#888',
  fontStyle: 'italic',
};

const srOnlyStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
