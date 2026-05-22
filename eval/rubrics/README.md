# Eval Rubrics

Produced by experiment E-019 (`meta/wiki/experiments/E-019.md`).

Six YAML rubric files, one per quality dimension from research R-008. These
are consumed by the per-dimension judge prompt template defined in R-010
(Pass 2 of the two-pass judge architecture).

Safety is NOT a dimension here — it is scored separately as Pass 1 (see
E-027 for the six safety failure modes).

## Files

| File | Dimension | R-008 ID |
|---|---|---|
| `perceptual-accuracy.yaml` | Perceptual Accuracy (Reads) | D1 |
| `intervention-quality.yaml` | Intervention Quality (Moves & Timing) | D2 |
| `coaching-stance.yaml` | Coaching Stance (VIEW State) | D3 |
| `methodology-fidelity.yaml` | Methodology Fidelity | D4 |
| `anti-pattern-avoidance.yaml` | Anti-Pattern Avoidance | D5 |
| `effectiveness-depth.yaml` | Effectiveness / Depth | D6 |

## Schema

Each rubric file follows this schema (per R-010):

```yaml
dimension_id: <id-matching-filename-stem>
name: "Human-readable name"
definition: >
  1-2 sentence definition.
scale:
  1: { label: poor, anchor: "..." }
  2: { label: adequate, anchor: "..." }
  3: { label: excellent, anchor: "..." }
key_signals: [list]
reference_files: [list of coach/ paths and other eval/ files]
few_shot_examples:
  - score: 3
    excerpt: "..."
    rationale: "..."
    source: "where it came from"
  - score: 1
    excerpt: "..."
    rationale: "..."
    source: "where it came from"
exclusions: [what this dimension does NOT score; prevents bleed-through]
independence_notes: >
  What distinguishes this dimension from adjacent dimensions.
judge_guidance: >
  Specific instructions for the judge calling this rubric.
primary_consumers: [who uses this rubric]
feeds_into: [what aggregates this rubric's output]
version: 1
```

Some files include additional fields:
- `priority_anti_patterns` (anti-pattern-avoidance only)
- `seam_with_safety` (anti-pattern-avoidance only)
- `risks_and_mitigations` (effectiveness-depth only — D6 is the most susceptible to judge bias)

## Few-shot examples

All `few_shot_examples` blocks currently contain placeholders. E-026 will
produce real-Joe excerpts from the transcripts to fill the score-3 slots,
and E-025 will produce the gold-poor.json for the score-1 slots. E-019 was
deliberately not blocked on E-026 so the rubric skeletons are available
immediately; the few-shot fields are version-bumped when filled.

## Dimension independence

The six dimensions are designed to be independent in scoring. The most
important independence pair is D3 (Stance) vs D4 (Methodology Fidelity) —
view-as-technique is exactly the failure where D4 is high and D3 is low.
E-025 will calibrate this independence by including a deliberately-engineered
"perfect fidelity, wrong stance" gold conversation that should score D3=1,
D4=3, D5=1 (view-as-technique tripped).

Other independence pairs the calibration must verify:
- D1 (Perceptual Accuracy) vs D2 (Intervention Quality): coach can read
  correctly and respond poorly.
- D2 (Intervention Quality) vs D4 (Methodology Fidelity): coach can use
  every signature question (D4 high) at the wrong moment (D2 low).
- D5 (Anti-Pattern Avoidance) vs D3+D4: coach can be in VIEW (D3 high) and
  use fidelity (D4 high) and still trip loving-to-transform (D5 low) if
  vigor increases when nothing shifts.
- D6 (Effectiveness/Depth) vs D1-D5: outcome can decouple from process.

## How the harness loads these

Per R-010 and E-023:

1. The harness reads all six YAML files at startup.
2. For each conversation, the harness invokes the per-dimension judge prompt
   six times (once per dimension, in parallel).
3. Each invocation injects the dimension's YAML into the RCAF prompt template
   (R-010), renders the conversation as a turn-indexed transcript, and
   collects a structured JSON scorecard.
4. The harness aggregates per-turn annotations across dimensions into the
   per-turn × per-dimension matrix.

## Updating

When updating a rubric:
1. Bump `version` in the file.
2. Document the change in this README's changelog.
3. Re-run E-025 (judge calibration) to verify the change didn't regress
   discriminative power.

## Changelog

- v1 (2026-05-22, E-019): Initial creation. Six rubrics produced from R-008
  dimension specifications. Few-shot examples are placeholders pending
  E-025 and E-026.
