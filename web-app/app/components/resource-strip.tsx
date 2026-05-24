'use client';

// E-044 — per-assistant-message "N sources" indicator.
//
// Renders a single subtle line beneath an assistant message when its
// `data-resources` part has at least one resource. Click → opens the
// resource modal focused on the first resource.
//
// Per R-017 §8 the visual treatment is intentionally restrained — small
// gray text, single line, doesn't interrupt the conversational flow.
//
// Empty resources (e.g., pre-retrieval intro messages or messages where
// retrieval failed and the graceful-degradation path served no attribution)
// render NOTHING — we explicitly do not show "0 sources" as that would call
// attention to the absence.

import React from 'react';
import type { UIMessage } from 'ai';
import type { CoachUIMessage } from '../lib/coach/types';
import { extractResources } from '../lib/state/use-resource-modal';

export type ResourceStripProps = {
  message: UIMessage | CoachUIMessage;
  onOpen: (messageId: string, firstSlug: string) => void;
};

export function ResourceStrip({
  message,
  onOpen,
}: ResourceStripProps): React.ReactElement | null {
  const attribution = extractResources(message);
  if (!attribution || attribution.resources.length === 0) {
    return null;
  }
  const count = attribution.resources.length;
  const firstSlug = attribution.resources[0].slug;

  return (
    <button
      type="button"
      onClick={() => onOpen(message.id, firstSlug)}
      aria-label={`Show ${count} source${count === 1 ? '' : 's'} used for this message`}
      style={stripStyle}
    >
      <span aria-hidden="true" style={iconStyle}>
        ◇
      </span>
      <span>
        {count} source{count === 1 ? '' : 's'}
      </span>
      <span aria-hidden="true" style={chevronStyle}>
        ›
      </span>
    </button>
  );
}

const stripStyle: React.CSSProperties = {
  marginTop: 8,
  padding: '4px 0',
  background: 'transparent',
  border: 'none',
  color: '#666',
  fontSize: 12,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'inherit',
  textAlign: 'left',
};

const iconStyle: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.7,
};

const chevronStyle: React.CSSProperties = {
  fontSize: 14,
  opacity: 0.6,
  lineHeight: 1,
};
