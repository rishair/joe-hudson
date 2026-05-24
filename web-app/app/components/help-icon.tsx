'use client';

import { useCallback } from 'react';

// E-045 help icon. Sits in the top-right corner of the app shell. Dispatches
// a window 'open-welcome' event that the Welcome component subscribes to.
// Using a window event rather than prop-drilling state keeps Welcome and
// HelpIcon as independent siblings of layout.tsx; no shared parent needs to
// know either exists.

export function HelpIcon(): React.ReactElement {
  const onClick = useCallback((): void => {
    window.dispatchEvent(new Event('open-welcome'));
  }, []);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open welcome and help"
      title="About this project"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: '1px solid #d0d0d0',
        background: '#fff',
        color: '#555',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        zIndex: 10,
      }}
    >
      ?
    </button>
  );
}
