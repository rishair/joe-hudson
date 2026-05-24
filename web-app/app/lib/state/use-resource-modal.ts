'use client';

// E-044 — resource-attribution modal state.
//
// Per R-017 §4 and §6, the modal needs three pieces of state per opening:
//   - messageId      → which assistant message owns the resource list
//   - focusedSlug    → which resource is rendered in the left panel
//   - resources[]    → the full list of resources for that message
//
// messageId and focusedSlug are URL state, encoded via nuqs so the URL is
// shareable AND so the browser back button closes the modal naturally
// (each setQueryState({history:'push'}) writes a new history entry).
//
// resources[] is derived: it lives on the assistant message itself as a
// `data-resources` typed UIMessage part (per R-016 Answer 3). Components
// using the modal pass the messages array down to the hook so the lookup
// stays a pure function of (URL state, messages). We don't try to read the
// messages from a global store because useChat scopes them per-conversation,
// and the chat page already has them in scope.

import { useQueryState } from 'nuqs';
import { useMemo } from 'react';
import type { UIMessage } from 'ai';
import type {
  CoachUIMessage,
  ResourceAttribution,
} from '../coach/types';

export type ResourceModalState = {
  isOpen: boolean;
  messageId: string | null;
  focusedSlug: string | null;
  resources: ResourceAttribution['resources'];
  attribution: ResourceAttribution | null;
  open: (messageId: string, focusedSlug: string) => Promise<URLSearchParams>;
  focus: (slug: string) => Promise<URLSearchParams>;
  close: () => Promise<URLSearchParams>;
};

// extractResources walks a single message's parts looking for the data-resources
// part R-016 specified. Returns null if no part is present (e.g. a system or
// user message, or a coach turn that emitted before retrieval was wired). The
// fallback is an empty resource list so callers can render an empty modal state
// gracefully rather than blowing up.
//
// The narrow cast through `unknown` is necessary because UIMessage["parts"] is
// a discriminated union of known part types AND a generic data part shape
// indexed by the data-parts map. TypeScript can't narrow the discriminator
// into the `data` field without a type assertion when the message variable is
// typed as the broad UIMessage; we still validate the shape at runtime by
// checking part.type and presence of a data field.
export function extractResources(
  message: UIMessage | CoachUIMessage | undefined,
): ResourceAttribution | null {
  if (!message) return null;
  for (const part of message.parts) {
    if (part.type !== 'data-resources') continue;
    // Data parts have the shape { type, data, id? } at runtime. The cast
    // is safe because R-016/E-043 guarantees the payload conforms to
    // ResourceAttribution on the wire (server side), and E-041's JSON
    // round-trip preserves it byte-exact through persistence.
    const data = (part as unknown as { data?: ResourceAttribution }).data;
    if (data) return data;
  }
  return null;
}

/**
 * Read-side hook: returns current modal state for the current URL + the
 * passed-in messages array. The messages array is the chat surface's source
 * of truth (useChat output, post-hydration). Callers MUST pass the same
 * array reference they're rendering or the modal contents could go stale.
 */
export function useResourceModal(
  messages: ReadonlyArray<UIMessage | CoachUIMessage>,
): ResourceModalState {
  const [messageId, setMessageId] = useQueryState('resourceModal', {
    history: 'push',
  });
  const [focusedSlug, setFocusedSlug] = useQueryState('focus', {
    history: 'push',
  });

  const { resources, attribution } = useMemo(() => {
    if (!messageId) return { resources: [], attribution: null };
    const msg = messages.find((m) => m.id === messageId);
    const attr = extractResources(msg);
    return {
      resources: attr?.resources ?? [],
      attribution: attr,
    };
  }, [messageId, messages]);

  return {
    isOpen: !!messageId,
    messageId,
    focusedSlug,
    resources,
    attribution,
    open: async (msgId: string, slug: string) => {
      // setQueryState is async (returns a Promise<URLSearchParams>); kick both
      // off in parallel since they're independent.
      const [, sp] = await Promise.all([
        setMessageId(msgId),
        setFocusedSlug(slug),
      ]);
      return sp;
    },
    focus: async (slug: string) => setFocusedSlug(slug),
    close: async () => {
      const [, sp] = await Promise.all([
        setMessageId(null),
        setFocusedSlug(null),
      ]);
      return sp;
    },
  };
}
