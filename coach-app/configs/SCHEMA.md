# Coach config YAML schema

This document is the contract that every `coach-app/configs/<name>.yaml`
must satisfy. Established by E-031 (per G-009 audit Minor #12). Inherited by
E-032 (tool-based), E-033 (embedding), E-036 (graph-walk), and E-037
(hybrid). E-035 (prompt iteration) ships new `v4..v7` configs against this
same shape.

The schema is enforced at load time by Zod in
`eval/lib/schemas.ts` → `CoachConfigSchema` and is consumed by both the eval
harness (`eval/run.ts`) and the coach CLI (`coach-app/run.ts`).

## Fields

```yaml
id: string                    # stable slug, used as coach_config_id in scorecards
description: string           # optional, free text; appears in renderer output
model: string                 # required, e.g. "claude-sonnet-4-6"

# Exactly one of these two:
system_prompt: string         # inline literal (back-compat with E-024 / E-029)
system_prompt_path: string    # path to a versioned prompt file, resolved
                              #   relative to this YAML's directory. The
                              #   loader reads the file and populates
                              #   system_prompt automatically. This is the
                              #   convention used by E-031 onward so prompt
                              #   iterations (v1, v2, ..., v7) live as their
                              #   own files under coach-app/prompts/.

temperature: number           # 0.0 to 1.0, default 1.0 (eval baselines used 1.0;
                              #   coach v1 uses 0.7 — see decision in v1 config)
max_tokens_per_turn: integer  # default 1024; eval baselines used 800

retrieval:                    # required block; default { strategy: none, config: {} }
  strategy: "none" | "tool" | "embedding" | "graph-walk" | "hybrid"
  config: object              # strategy-specific; empty for "none"

trigger_policy:               # default "never". For "none" strategy MUST be "never".
  "every_turn" |              #   R-012 default for all retrieval-equipped
                              #   experiments (apples-to-apples comparison; the
                              #   crisis-pivot risk of first_turn_only justifies
                              #   the default)
  "first_turn_only" |         #   retrieval runs once at conversation start
  "on_topic_shift" |          #   re-retrieves when the client signals a topic
                              #   shift (cost-saving variant for E-032)
  "never"                     #   for `strategy: none` configs
```

### `retrieval.config` per strategy

These shapes are agreed at design time so different retrieval experiments
inherit a consistent surface. The field is `object` in the YAML / `record` in
Zod so each strategy can define its own keys without schema gymnastics.

**`strategy: none`** (E-031) — `config: {}`. No fields read.

**`strategy: tool`** (E-032) — to be finalized in E-032, but the placeholder
shape is:

```yaml
retrieval:
  strategy: tool
  config:
    router_model: claude-haiku-4-5  # cheap model that picks files
    tools:                          # tool catalog produced by R-013
      - read_index
      - read_file
      - follow_related
      - search_by_alias
    max_tool_steps: 6
trigger_policy: every_turn          # R-012 default; E-032 may run on_topic_shift smoke
```

**`strategy: embedding`** (E-033) — finalized in E-033, placeholder:

```yaml
retrieval:
  strategy: embedding
  config:
    embedding_model: bge-small-en-v1.5    # R-012 dense recommendation
    sparse_model: bm25-alias              # R-012 sparse recommendation
    fusion: rrf                            # reciprocal rank fusion
    top_k: 5                               # R-012 recommendation
    seed_filter: [concerns, patterns, reads]
trigger_policy: every_turn
```

**`strategy: graph-walk`** (E-036) — finalized in E-036, placeholder:

```yaml
retrieval:
  strategy: graph-walk
  config:
    seed_model: claude-haiku-4-5          # R-012 seed-detection recommendation
    seed_filter: [concerns, patterns, reads]
    walk_depth: 2                          # R-012 recommendation
    hub_dampen: log1p_indegree             # R-012 hub-dampening rule
    top_k: 5
trigger_policy: every_turn
```

**`strategy: hybrid`** (E-037) — finalized in E-037, placeholder:

```yaml
retrieval:
  strategy: hybrid
  config:
    per_dimension:                         # E-034 result drives this mapping
      perceptual_accuracy: graph-walk
      methodology_fidelity: graph-walk
      coaching_stance: none                # if E-034 finds retrieval hurts D3
      anti_pattern_avoidance: embedding
      effectiveness_depth: embedding
      intervention_quality: tool
    fallback_strategy: graph-walk
trigger_policy: every_turn
```

## Validation

Any config that breaks this schema fails at load time with a Zod error
naming the offending field. Test by:

```bash
bun run eval/run.ts validate-schemas
```

This loads `eval/coach-configs/naive-aoa.yaml` plus the default and exercises
the schema. To validate a specific config:

```bash
bun -e '
  import { loadCoachConfig } from "./eval/lib/loaders.ts";
  console.log(loadCoachConfig("coach-app/configs/v1-no-retrieval.yaml"));
'
```

## Adding a new coach version

1. Create `coach-app/prompts/vN.md` with the new prompt.
2. Create `coach-app/configs/<name>.yaml` referencing it via
   `system_prompt_path: ../prompts/vN.md`.
3. The `id` should be a stable slug (used in scorecards). Suggestion:
   `coach-v<N>-<retrieval-strategy>`.
4. Run a smoke eval first: `bun run eval/run.ts smoke --coach
   coach-app/configs/<name>.yaml`.
5. If smoke shows movement, run full: `bun run eval/run.ts full --coach ...`.
6. Append the result to the iteration log on `meta/wiki/goals/G-009.md`.
