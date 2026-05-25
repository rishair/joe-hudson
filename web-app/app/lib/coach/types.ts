import type { UIMessage } from 'ai';

// E-043 — per R-016 Answer 3. The chat UI needs per-message resource
// attribution; AI SDK v5+ canonical transport is a custom typed data part
// attached to the assistant message. Defining `CoachUIMessage` here as the
// shared persistence + transport type lets E-041's repositories and E-044's
// modal both consume the same shape.

export type ResourceAttribution = {
  /** Files the walker actually KEPT in the bundle (i.e. the citation set). */
  resources: Array<{
    /** Bare slug, e.g. "limiting-belief". Globally unique per R-018. */
    slug: string;
    /** Compendium category, e.g. "concepts". */
    category: string;
    /** Display label (file H1 or filename). */
    title: string;
    /** Per-file rationale from the walker telemetry. */
    walker_reason: string;
  }>;
  /** Seeds detected by the Haiku seed-detection step (1-3 slugs). */
  seeds: string[];
  /** Walker model id used for this turn. */
  walker_model: string;
  /** Total retrieval cost in USD (seed-detection + walker steps). */
  total_cost_usd: number;
  /** Number of walker steps executed this turn. */
  step_count: number;
  /** Why the walk stopped. */
  stop_reason:
    | 'bundle_full'
    | 'frontier_empty'
    | 'step_budget_exhausted'
    | 'no_seeds';
};

/**
 * Progressive-streaming progress event. Emitted as a `data-progress` UI part
 * while the retrieval pipeline is running (seed-detection + walker loop +
 * coach compose), so the user gets incremental visible feedback during the
 * ~10-25s retrieval window instead of staring at a silent spinner.
 *
 * Stages, in the order they fire on the happy path:
 *   - 'analyzing'  → seed-detection has started (reads what the user wrote)
 *   - 'retrieving' → seed-detection finished; we have N starting points
 *   - 'walking'    → walker step N of M is in flight
 *   - 'composing'  → retrieval done, coach streamText is about to start
 *
 * The safety-regen path also emits 'composing' events with different messages
 * ('Considering safety', 'Regenerating with stronger safety reminder', etc.)
 * so the user doesn't sit silent on the slow crisis-handling branch.
 *
 * The client renders the LATEST progress event as a small inline status line
 * that gets replaced once text-deltas start arriving.
 */
export type ProgressEvent = {
  stage: 'analyzing' | 'retrieving' | 'walking' | 'composing';
  message: string;
  step?: number;
  total_steps?: number;
};

// R-016 Answer 3: the typed-data-parts shape. AI SDK v5+ requires data-part
// names be the keys of the DATA_PARTS object; the wire form becomes
// `data-resources` / `data-progress`. E-041's byte-equality round-trip handles
// persistence transparently because the part lives inside UIMessage.parts.
//
// `progress` is added for E-047 (progressive streaming). Progress parts are
// transient during streaming and could be filtered on persistence, but
// keeping them in the message is harmless (small JSON payload) and lets the
// resource-modal hook ignore them by type. The byte-equality round-trip
// continues to hold.
//
// `variant` is added for E-054 (G-014 coach-version selector). The route
// emits a `data-variant` part on each assistant message naming which coach
// profile produced it. Because data parts live inside UIMessage.parts, the
// byte-equality round-trip (E-041) persists the tag transparently with NO
// schema change — a reloaded conversation shows which variant answered each
// turn. This is the G-014 "persistence tagging" nice-to-have, done the cheap
// way (a data part, not a SQLite column).
export type CoachUIMessage = UIMessage<
  // no per-message metadata for v1
  never,
  // data-parts map: keys become `data-<key>` parts on the wire.
  {
    resources: ResourceAttribution;
    progress: ProgressEvent;
    variant: VariantTag;
  }
>;

/** Tag identifying which coach profile produced an assistant message.
 *  Emitted by the route as a `data-variant` part (E-054). Kept loose (`id` is
 *  a plain string) so this type does not need to import the server-only
 *  profile registry; the id is one of the four CoachProfileId values. */
export type VariantTag = {
  /** Coach profile id, e.g. 'v5b' | 'reflective' | 'grounded' | 'joe-voiced'. */
  id: string;
  /** Display label for the variant (so a reloaded message can show it without
   *  a registry lookup). */
  label: string;
};
