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

// R-016 Answer 3: the typed-data-parts shape. AI SDK v5+ requires data-part
// names be the keys of the DATA_PARTS object; the wire form becomes
// `data-resources`. E-041's byte-equality round-trip handles persistence
// transparently because the part lives inside UIMessage.parts.
export type CoachUIMessage = UIMessage<
  // no per-message metadata for v1
  never,
  // data-parts map: { resources: ResourceAttribution } => 'data-resources' part
  {
    resources: ResourceAttribution;
  }
>;
