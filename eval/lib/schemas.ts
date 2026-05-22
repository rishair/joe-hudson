/**
 * Zod schemas for YAML artifacts the harness loads at runtime.
 *
 * Design note: predecessor experiments (E-019, E-020, E-021, E-022, E-027) have
 * each individually validated their own YAML files against richer schemas in
 * their own validation passes. The harness re-validates ONLY the fields it
 * actually reads/uses at runtime so a typo in a load-time critical field fails
 * loudly at load time rather than producing silent NaN/undefined behavior mid-run.
 *
 * Per E-023 success criterion: "Zod schemas reject malformed YAML at load time
 * (verified by deliberately corrupting a profile and confirming the error
 * message names the field)".
 */
import { z } from "zod";

// ---------------- Profile (E-020 / R-009 schema, harness-needed fields) ----------------

export const PersonaSchema = z.object({
  age_range: z.string(),
  rough_situation: z.string(),
  speech_register: z.string(),
});

export const EmotionalStateSchema = z.object({
  primary: z.string(),
  underneath: z.string(),
  somatic_signature: z.string(),
});

export const SessionLengthSchema = z.object({
  target_turns: z.number().int().positive(),
  min_turns: z.number().int().positive(),
  max_turns: z.number().int().positive(),
});

export const ExpectedTerritorySchema = z
  .object({
    concerns: z.array(z.string()).optional().default([]),
    reads: z.array(z.string()).optional().default([]),
    moves: z.array(z.string()).optional().default([]),
    concepts: z.array(z.string()).optional().default([]),
    patterns: z.array(z.string()).optional().default([]),
    frameworks: z.array(z.string()).optional().default([]),
    questions: z.array(z.string()).optional().default([]),
    distinctions: z.array(z.string()).optional().default([]),
    principles: z.array(z.string()).optional().default([]),
    anti_patterns_to_avoid: z.array(z.string()).optional().default([]),
  })
  .passthrough();

export const TrapSchema = z.object({
  description: z.string(),
  anti_pattern_ref: z.string().optional().default(""),
  why_wrong: z.string().optional().default(""),
});

export const SafetyDisclosureSchema = z
  .object({
    // turn_window can be a string "5-7" or a plain integer; coerce to string.
    turn_window: z.union([z.string(), z.number()]).optional().transform((v) =>
      v === undefined ? undefined : String(v),
    ),
    disclosure_type: z.string().optional(),
    disclosure: z.string().optional(),
    text_hint: z.string().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

/**
 * In the actual E-027 crisis profiles, `safety_hard_fails` is an object with
 * `primary` and `secondary` arrays of criterion IDs. In other profiles, the
 * field is absent or empty. We accept either shape.
 */
export const SafetyHardFailsSchema = z.union([
  z.array(z.string()),
  z
    .object({
      primary: z.array(z.string()).optional().default([]),
      secondary: z.array(z.string()).optional().default([]),
    })
    .passthrough(),
]);

export const ProfileSchema = z
  .object({
    id: z.string(),
    concern_ref: z.union([z.string(), z.record(z.string())]),
    scenario_type: z.enum([
      "happy_path",
      "resistance",
      "crisis",
      "edge_case",
      "red_herring",
    ]),
    schema_version: z.string().optional(),
    opening_statements: z.array(z.string()).min(1),
    persona: PersonaSchema,
    emotional_state: EmotionalStateSchema,
    resistance_patterns: z.array(z.string()),
    initial_stance: z.string(),
    mid_conversation_resistance: z.string(),
    breakthrough_condition: z.string(),
    traps: z.array(TrapSchema),
    expected_territory: ExpectedTerritorySchema,
    golden_path: z.array(z.string()),
    visible_to_judge: z.boolean().optional().default(true),
    visible_to_client_llm: z.boolean().optional().default(false),
    session_length: SessionLengthSchema,
    client_exits_when: z.array(z.string()),
    // safety_relevant is a boolean flag at top level in real profiles;
    // safety_disclosures and safety_hard_fails are siblings, not nested under it.
    safety_relevant: z.boolean().optional(),
    safety_disclosures: z.array(SafetyDisclosureSchema).optional().default([]),
    safety_hard_fails: SafetyHardFailsSchema.optional(),
    meta_test_kind: z.string().optional(),
    red_herring_scoring: z.unknown().optional(),
  })
  .passthrough();

export type Profile = z.infer<typeof ProfileSchema>;

// ---------------- Rubric (E-019, harness-needed fields) ----------------

export const RubricScaleAnchorSchema = z.object({
  label: z.string(),
  anchor: z.string(),
});

export const RubricFewShotSchema = z
  .object({
    score: z.number(),
    excerpt: z.string(),
    rationale: z.string(),
    source: z.string().optional(),
  })
  .passthrough();

export const RubricSchema = z
  .object({
    dimension_id: z.string(),
    name: z.string(),
    definition: z.string(),
    scale: z.object({
      "1": RubricScaleAnchorSchema,
      "2": RubricScaleAnchorSchema,
      "3": RubricScaleAnchorSchema,
    }),
    key_signals: z.array(z.string()),
    reference_files: z.array(z.string()).optional().default([]),
    few_shot_examples: z.array(RubricFewShotSchema).optional().default([]),
    exclusions: z.array(z.string()).optional().default([]),
    independence_notes: z.string().optional().default(""),
    judge_guidance: z.string(),
    version: z.number().optional(),
  })
  .passthrough();

export type Rubric = z.infer<typeof RubricSchema>;

// ---------------- Safety criteria (E-027, harness-needed fields) ----------------

export const SafetyCriterionSchema = z
  .object({
    id: z.string(),
    severity: z.enum(["critical", "high"]),
    description: z.string(),
    trigger_signals: z.array(z.string()),
    pass_behavior: z.string(),
    fail_behavior: z.string(),
    do_not_flag_if: z.array(z.string()),
    detection_prompt: z.string(),
    evidence_required: z.array(z.string()).optional().default([]),
  })
  .passthrough();

export const SafetyFileSchema = z
  .object({
    schema_version: z.number().optional(),
    criteria: z.array(SafetyCriterionSchema),
  })
  .passthrough();

export type SafetyCriterion = z.infer<typeof SafetyCriterionSchema>;

// ---------------- Methodology checklist (E-022, summary-only structure) ----------------

export const MethodologyEntrySchema = z
  .object({
    id: z.string(),
    source_file: z.string().optional(),
    text: z.string().optional(),
    aliases: z.array(z.string()).optional().default([]),
    appropriate_when: z.array(z.string()).optional().default([]),
    appropriate_naming_when: z.array(z.string()).optional().default([]),
    inappropriate_when: z.array(z.string()).optional().default([]),
    not_when: z.array(z.string()).optional().default([]),
    negative_example: z.string().optional(),
  })
  .passthrough();

export const MethodologyFileSchema = z
  .object({
    version: z.number().optional(),
    questions: z.array(MethodologyEntrySchema).optional().default([]),
    reads: z.array(MethodologyEntrySchema).optional().default([]),
    moves: z.array(MethodologyEntrySchema).optional().default([]),
    frameworks: z.array(MethodologyEntrySchema).optional().default([]),
  })
  .passthrough();

export type MethodologyFile = z.infer<typeof MethodologyFileSchema>;

// ---------------- Anti-pattern tests (E-021, summary-only structure) ----------------

export const AntiPatternTestSchema = z
  .object({
    test_id: z.string(),
    anti_pattern_id: z.string(),
    anti_pattern_file: z.string().optional(),
    title: z.string(),
    why_ai_prone: z.string().optional().default(""),
    judge_instructions: z.string().optional().default(""),
  })
  .passthrough();

export type AntiPatternTest = z.infer<typeof AntiPatternTestSchema>;

// ---------------- Coach config (this experiment, new file format) ----------------

export const CoachConfigSchema = z.object({
  id: z.string(),
  description: z.string().optional().default(""),
  model: z.string(),
  system_prompt: z.string(),
  temperature: z.number().min(0).max(1).optional().default(1.0),
  max_tokens_per_turn: z.number().int().positive().optional().default(1024),
});

export type CoachConfig = z.infer<typeof CoachConfigSchema>;

// ---------------- Judge config (this experiment, new file format) ----------------

export const JudgeConfigSchema = z.object({
  model: z.string().default("claude-opus-4-5"),
  temperature: z.number().min(0).max(1).default(0),
  max_tokens: z.number().int().positive().default(2048),
});

export type JudgeConfig = z.infer<typeof JudgeConfigSchema>;

// ---------------- Client LLM config ----------------

export const ClientConfigSchema = z.object({
  model: z.string().default("claude-sonnet-4-5"),
  temperature: z.number().min(0).max(1).default(0.7),
  max_tokens: z.number().int().positive().default(1024),
});

export type ClientConfig = z.infer<typeof ClientConfigSchema>;
