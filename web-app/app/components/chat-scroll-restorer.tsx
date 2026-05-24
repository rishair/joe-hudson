'use client';

// Reads the `?scrollToMessage=<msgId>` URL param on mount, scrolls the
// element with id `msg-<msgId>` into view, and replaces the URL to clear
// the param. Per R-017 §7: this is the "Back to chat at message N" return
// path when a wiki page reached via "Expand to full" calls
// router.push('/?scrollToMessage=' + msgId).
//
// Why a separate component: the chat page (app/page.tsx) is owned by
// E-040 today and will be expanded by E-041 (persistence) and E-044
// (resource modal). Carving the scroll behavior into its own component
// keeps it touch-free for those sibling experiments — they only need to
// ensure each rendered assistant message has `id="msg-<messageId>"` (a
// single attribute) for this component to work.

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

export function ChatScrollRestorer(): null {
  const router = useRouter();
  const params = useSearchParams();
  const target = params.get('scrollToMessage');

  useEffect(() => {
    if (!target) return;
    // requestAnimationFrame so the messages have laid out before we try
    // to scroll to one. Two RAFs to play nicely with React's batching on
    // initial mount; the message DOM is committed by then.
    let cancelled = false;
    const tryScroll = (attempts: number): void => {
      if (cancelled) return;
      const el = document.getElementById(`msg-${target}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Clear the param so a refresh doesn't re-scroll. router.replace
        // updates the URL without a navigation.
        router.replace('/');
      } else if (attempts > 0) {
        requestAnimationFrame(() => tryScroll(attempts - 1));
      } else {
        // Message not found (e.g. persistence is loading async). Clear
        // the param anyway so we don't leak the scroll target into bookmarks.
        router.replace('/');
      }
    };
    requestAnimationFrame(() => tryScroll(20));
    return (): void => {
      cancelled = true;
    };
    // Only react to the target ID, not the router instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return null;
}
