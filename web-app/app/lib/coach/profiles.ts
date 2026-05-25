import 'server-only';

import { SYSTEM_PROMPT } from '@/app/lib/system-prompt';
import { DEFAULT_COACH_MODEL } from '@/app/lib/openrouter';
import { V5B_CONFIG } from '@/app/lib/coach/retriever';
import { REFLECTIVE_PROMPT } from '@/app/lib/coach/prompts/reflective';
import { GROUNDED_PROMPT } from '@/app/lib/coach/prompts/grounded';
import { JOE_VOICED_PROMPT } from '@/app/lib/coach/prompts/joe-voiced';
// E-054 — the id union + display metadata live in the client-safe
// `profiles-meta.ts` so the selector UI (a client component) can read labels/
// blurbs without pulling in the server-only prompts. This module is the
// SERVER side: it attaches the prompts + model + retrieval substrate on top of
// that metadata. Single source of truth for ids/labels/order is profiles-meta.
import {
  COACH_PROFILE_META,
  type CoachProfileId,
} from '@/app/lib/coach/profiles-meta';

// Re-export the client-safe metadata pieces so existing server-side importers
// of `profiles.ts` (e.g. the route's resolver wiring) keep one import site.
export {
  COACH_PROFILE_META,
  COACH_PROFILE_ORDER,
  DEFAULT_COACH_PROFILE_ID,
  isCoachProfileId,
  type CoachProfileId,
  type CoachProfileMeta,
} from '@/app/lib/coach/profiles-meta';
import {
  DEFAULT_COACH_PROFILE_ID,
  isCoachProfileId,
} from '@/app/lib/coach/profiles-meta';

// E-053 — coach-profile abstraction (the DATA LAYER for G-014).
//
// G-014 tunes the coach's *authority* (how much substance it shares) by
// offering four selectable variants in the deployed web app, all on the SAME
// v5b guided-walk retrieval substrate, so the system prompt is the ONLY
// variable. This module is that registry. E-054 wires the chat route + a
// selector UI to look a profile up by id from the request and use its
// `systemPrompt` / `coachModel` / `retrievalParams` in place of the currently
// hardcoded SYSTEM_PROMPT / DEFAULT_COACH_MODEL / V5B_CONFIG.
//
// This experiment lands ONLY the registry and the prompts. It deliberately
// does NOT touch the chat route (that is E-054's job — avoid clobbering a
// concurrent QA/deploy). The route keeps working exactly as today until E-054
// refactors it to read from here.
//
// Design note — why retrievalParams is held constant across all four:
// G-014's correctness section pins retrieval to the v5b substrate so the
// felt-authority difference the vibe-check measures is attributable to the
// prompt and nothing else (mirrors the G-009 one-variable-per-iteration
// discipline). All four profiles therefore reference the SAME `V5B_CONFIG`
// object. The field is kept per-profile (rather than global) so a future
// experiment can vary retrieval per variant without reshaping the registry.

/** Retrieval parameters for a coach turn. Shape mirrors `V5B_CONFIG` in
 *  `retriever.ts` (the values the route's `runRetrieval` currently bakes in).
 *  All four G-014 profiles share the v5b values; the field exists so the
 *  registry can express a per-profile override later without a refactor. */
export type RetrievalParams = {
  walkerModel: string;
  seedModel: string;
  kMax: number;
  stepBudget: number;
  maxEdgesPerStep: number;
  walkerVariant: 'v5b';
};

export type CoachProfile = {
  /** Stable id used in the request payload and SQLite per-message tag. */
  id: CoachProfileId;
  /** Short display label for the selector control. */
  label: string;
  /** One-phrase description for a subtitle / hover (G-014 nice-to-have). */
  blurb: string;
  /** The full system prompt for this variant (SAFETY FIRST + body intact). */
  systemPrompt: string;
  /** Coach (answer-generation) model. Held at the v5b default across variants. */
  coachModel: string;
  /** Retrieval substrate. Held at V5B_CONFIG across all four variants. */
  retrievalParams: RetrievalParams;
};

// All four variants share the exact v5b retrieval substrate. Reference the
// SAME object so there is provably one source of truth for the retrieval
// values and the "system prompt is the only variable" invariant is visible.
const V5B_RETRIEVAL: RetrievalParams = V5B_CONFIG;

/**
 * The four authority-spectrum profiles, ordered passive → assertive:
 *
 *   v5b        — baseline / control. Pure curious questioning. The deployed
 *                prompt the REQ-001 vibe-check found hollow. Kept verbatim as
 *                the comparison anchor (imports SYSTEM_PROMPT directly, so it
 *                is byte-identical to the deployed default — no drift risk).
 *   reflective — mild. Names a read/reflection back as a statement before or
 *                instead of asking. Lowest risk.
 *   grounded   — medium. Offers a frame/distinction as a statement, takes a
 *                gentle stance. The "earn trust by sharing substance" sweet
 *                spot.
 *   joe-voiced — high. Direct observations, gentle challenge, welcomes
 *                resistance out loud, Joe's signature moves. Closest to
 *                in-person Joe; highest risk of tipping into interpretation/
 *                advice (the variant prompts restate the guardrails hardest).
 */
// label + blurb are sourced from COACH_PROFILE_META (the client-safe single
// source of truth) so the selector UI and the server registry can never show
// different text for the same id. Only the server-only fields (systemPrompt /
// coachModel / retrievalParams) are attached here.
export const COACH_PROFILES: Record<CoachProfileId, CoachProfile> = {
  v5b: {
    ...COACH_PROFILE_META.v5b,
    systemPrompt: SYSTEM_PROMPT,
    coachModel: DEFAULT_COACH_MODEL,
    retrievalParams: V5B_RETRIEVAL,
  },
  reflective: {
    ...COACH_PROFILE_META.reflective,
    systemPrompt: REFLECTIVE_PROMPT,
    coachModel: DEFAULT_COACH_MODEL,
    retrievalParams: V5B_RETRIEVAL,
  },
  grounded: {
    ...COACH_PROFILE_META.grounded,
    systemPrompt: GROUNDED_PROMPT,
    coachModel: DEFAULT_COACH_MODEL,
    retrievalParams: V5B_RETRIEVAL,
  },
  'joe-voiced': {
    ...COACH_PROFILE_META['joe-voiced'],
    systemPrompt: JOE_VOICED_PROMPT,
    coachModel: DEFAULT_COACH_MODEL,
    retrievalParams: V5B_RETRIEVAL,
  },
};

/** Resolve a (possibly untrusted, possibly undefined) id to a profile,
 *  falling back to the default. E-054's route calls this with the request
 *  field; it never throws, so a bad client payload degrades gracefully
 *  rather than 500-ing. */
export function resolveCoachProfile(id: unknown): CoachProfile {
  return isCoachProfileId(id)
    ? COACH_PROFILES[id]
    : COACH_PROFILES[DEFAULT_COACH_PROFILE_ID];
}
