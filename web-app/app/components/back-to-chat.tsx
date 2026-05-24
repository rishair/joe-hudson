'use client';

// Back-to-chat affordance shown atop a wiki page when the URL carries
// `?fromChat=<msgId>`. Per R-017 §7:
//   - Primary action: router.back() — most users got here via the "expand"
//     button in the resource modal, so the previous history entry is the
//     chat with the right scroll position.
//   - Fallback (when history.length <= 1, e.g. they opened the wiki URL
//     in a new tab): router.push('/?scrollToMessage=' + msgId). The chat
//     page reads `?scrollToMessage=` on mount, scrolls to the message,
//     then clears the param via router.replace.
//
// This component only renders when the param is present. The render is
// driven by useSearchParams, so the component is client-side; the wiki
// page itself stays a server component.

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

export function BackToChat(): React.ReactElement | null {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromChat = searchParams.get('fromChat');

  const onClick = useCallback((): void => {
    if (!fromChat) return;
    // history.length is unreliable across browsers (Chrome includes the
    // initial blank entry; Firefox doesn't). Use a heuristic: if there's
    // no previous entry to go back to, push. The router.back() will be a
    // no-op in that case and the user will be stranded — so the fallback
    // push is the safer default when history is short.
    if (window.history.length > 1 && document.referrer.includes('/')) {
      router.back();
    } else {
      router.push(`/?scrollToMessage=${encodeURIComponent(fromChat)}`);
    }
  }, [fromChat, router]);

  if (!fromChat) return null;

  return (
    <div
      style={{
        padding: '8px 12px',
        background: '#eef2ff',
        border: '1px solid #c7d2fe',
        borderRadius: 8,
        margin: '0 0 16px',
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          color: '#1e40af',
          textDecoration: 'underline',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        ← Back to chat at message {fromChat.slice(0, 8)}
      </button>
    </div>
  );
}
