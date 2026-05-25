// E-054 — CLIENT-SAFE coach-profile metadata for the selector UI.
//
// `profiles.ts` is `server-only` (it imports the system prompts + the
// retrieval substrate, neither of which may ship to the browser). The
// selector control in `page.tsx` is a client component, so it cannot import
// `profiles.ts`. This module holds ONLY the display metadata — id, label,
// blurb, and display order — with no prompt text and no server imports, so it
// is safe to import from a `'use client'` file.
//
// SINGLE SOURCE OF TRUTH for the id union + display fields. `profiles.ts`
// imports the id type and the metadata FROM here and attaches the (server-
// only) systemPrompt / coachModel / retrievalParams on top, so the label/blurb
// shown in the selector can never drift from the registry.

/** Stable identifiers for the four authority-spectrum variants. The string
 *  union is the contract the selector UI and the chat route validate against
 *  (an unknown id must fall back to the default rather than 500). */
export type CoachProfileId = 'v5b' | 'reflective' | 'grounded' | 'joe-voiced';

/** The profile served when the request names no variant or an unknown one.
 *  Baseline v5b is the safe default (it is the currently-deployed behavior). */
export const DEFAULT_COACH_PROFILE_ID: CoachProfileId = 'v5b';

/** Profiles in selector display order (passive → assertive). */
export const COACH_PROFILE_ORDER: CoachProfileId[] = [
  'v5b',
  'reflective',
  'grounded',
  'joe-voiced',
];

export type CoachProfileMeta = {
  id: CoachProfileId;
  /** Short display label for the selector control. */
  label: string;
  /** One-phrase description for a subtitle / hover (G-014 nice-to-have). */
  blurb: string;
};

/** Display metadata for each profile, keyed by id. The selector reads this. */
export const COACH_PROFILE_META: Record<CoachProfileId, CoachProfileMeta> = {
  v5b: {
    id: 'v5b',
    label: 'Baseline',
    blurb: 'Pure curious questioning — the original coach.',
  },
  reflective: {
    id: 'reflective',
    label: 'Reflective',
    blurb: 'Names what it notices back to you before asking.',
  },
  grounded: {
    id: 'grounded',
    label: 'Grounded',
    blurb: 'Offers a frame or distinction, takes a gentle stance.',
  },
  'joe-voiced': {
    id: 'joe-voiced',
    label: 'Joe-voiced',
    blurb: 'Direct: makes observations, gently challenges, welcomes resistance.',
  },
};

/** Type guard usable on the client: is an arbitrary value a known profile id? */
export function isCoachProfileId(value: unknown): value is CoachProfileId {
  return typeof value === 'string' && value in COACH_PROFILE_META;
}
