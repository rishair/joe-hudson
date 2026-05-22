# Gold-Standard Joe Hudson Coaching Exchanges

Produced by experiment E-026 (`meta/wiki/experiments/E-026.md`).

Seven multi-turn coaching exchanges extracted from real Joe Hudson coaching
sessions in `transcripts/`. These serve THREE roles in the eval pipeline:

1. **Positive controls for judge calibration (E-025).** The eval must score
   these exchanges highly. If it doesn't, the rubrics are wrong — they are
   penalizing actual Joe behavior that the rubric authors did not anticipate.

2. **Few-shot examples for the judge prompt (R-010, E-019).** Per-dimension
   rubric YAML files have `few_shot_examples` slots that are currently
   placeholders. The score-3 slots will be filled with the dimension-relevant
   turn-ranges from these gold exchanges.

3. **Reality check for the rubrics.** Reading these exchanges should confirm
   that the eval scores what real coaching looks like, not an abstraction
   of it.

## Files

| File | What it demonstrates | Primary dimensions tested |
|---|---|---|
| `gold-joe-001-blank-space.json` | Reading a freeze state and honoring dissociation as wisdom (paradoxical instruction) | D1 Perceptual Accuracy, D3 Coaching Stance, D5 Anti-Pattern Avoidance |
| `gold-joe-002-social-anxiety.json` | Signature questions deployed back-to-back; using live anxiety as the material | D2 Intervention Quality, D4 Methodology Fidelity, D6 Effectiveness/Depth |
| `gold-joe-003-trust-intuition.json` | Framework application: `decisions-are-emotional` and dissolving the deciding-vs-flowing duality | D4 Methodology Fidelity, D1 Perceptual Accuracy |
| `gold-joe-004-anti-pattern-avoidance.json` | Refusing to be the validator; using mortality and self-deprecation to disable the scorecard | D5 Anti-Pattern Avoidance, D3 Coaching Stance, D2 Intervention Quality |
| `gold-joe-005-resistance-navigation.json` | Holding an experiment through six different resistance moves; naming each without fighting it | D2 Intervention Quality, D3 Coaching Stance, D5 Anti-Pattern Avoidance |
| `gold-joe-006-enjoy-the-now.json` | Refusing to "love to transform"; client slows Joe down and Joe meets it with "Okay"; enjoying the feeling rather than fixing it | D5 Anti-Pattern Avoidance, D3 Coaching Stance |
| `gold-joe-007-mirror-the-judgment.json` | Turning every externalized judgment into a question about the client; `how-is-that-not-true-about-you` deployed live | D2 Intervention Quality, D4 Methodology Fidelity, D3 Coaching Stance |

## Schema

Each file is a JSON object with these top-level keys:

- `id`: stable identifier
- `title`: one-line summary of what this exchange demonstrates
- `source_transcript`: filename in `transcripts/`
- `source_path`: relative path from repo root
- `source_turn_range_in_original`: which lines of the source transcript this came from
- `context`: 1-2 paragraphs explaining the situation and why this exchange is valuable
- `primary_demonstrates`: the dimensions and methodology pieces this is the best example of
- `turns`: array of `{turn, role, content}` objects. `role` is "client" or "coach".
- `demonstrates`: structured map of which `coach/` IDs the exchange exercises
  - `reads`, `moves`, `questions`, `concepts`, `principles`, `anti_patterns_avoided`, `frameworks`
- `key_moves_per_turn`: array of annotations on specific turns
- `expected_scores`: per-dimension expected scores (1-3) with rationale
- `safety_screen_expected`: `{safety_pass, notes}` — what the safety judge should return
- `calibration_notes`: `{why_this_is_a_gold_score_3, what_the_judge_should_be_alert_to, negative_signal_if_present}`
- `provenance`: extraction metadata

## How to use these in the judge prompt

Per R-010, the per-dimension judge prompt has a `few_shot_examples` section.
For each rubric YAML file in `../rubrics/`, fill the `score: 3` few-shot slot
with a turn range from one of these gold exchanges. The rationale field of
the few-shot block should be drawn from the relevant entry in
`key_moves_per_turn` and the dimension-specific section of `expected_scores`.

For E-025 (judge calibration):

1. Run the full per-dimension judge against each gold exchange.
2. Score the judge against `expected_scores`. Discrepancies > 1 score point
   are red flags. Discrepancies of exactly 1 (e.g., judge says 2, expected 3)
   are yellow flags requiring investigation.
3. Verify `safety_screen_expected` matches the safety judge's output.
4. Run the same judge twice on the same exchange to measure self-consistency.

For E-019 (rubrics): the `negative_signal_if_present` field in each gold
exchange tells you what to watch for when a particular rubric over-penalizes
correct Joe behavior.

## Extraction principles

- **Verbatim where possible**: turns are reproduced as close to the source as
  possible. Light cleanup of repetitions and false starts is allowed; content
  changes are not.
- **No reconstruction**: every turn is from the actual transcript. Nothing
  is invented or paraphrased.
- **Self-contained**: each exchange stands on its own — the client's concern,
  the coach's reads/moves, and the resolution (where present) are all within
  the excerpt.
- **Different signatures**: the seven exchanges deliberately cover different
  facets of Joe's methodology so that the few-shot pool spans the rubric
  space. The corpus over-indexes on the two hardest dimensions:
  - D5 Anti-Pattern Avoidance: 004 (refusing to be the validator), 006
    (refusing to be the fixer) — and 005 implicitly (refusing to fight
    resistance).
  - Resistance navigation: 005 (intelligent verbal resistance to an
    experiment), 007 (externalized-blame resistance to inquiry).
  This over-coverage is deliberate. These are the dimensions on which AI
  coaches fail most often, so calibration needs more positive controls here.

## What's NOT in this set (deliberate omissions)

- **A "negative" exchange (gold-poor)** — that is E-025's responsibility, not
  E-026's. E-026 gives the positive controls. E-025 will hand-craft or
  curate the negative controls.
- **A safety-failure exchange** — E-027 produces the safety failure mode
  catalog; the safety-fail gold conversation lives there.
- **Ambiguous-quality exchanges** — these are also E-025 territory. The
  ambiguous middle is what calibration tests; E-026 provides the clear top.

## Provenance and license

All content is from publicly published Joe Hudson coaching sessions hosted
on YouTube and podcast feeds, transcribed and consented per the original
publication context. Each exchange cites its `source_transcript`.

## Changelog

- v1.0 (2026-05-22, E-026): Initial creation. Seven gold exchanges extracted
  covering: reads + somatic intervention (001), signature questions (002),
  framework application (003), anti-pattern avoidance / refusing-to-validate
  (004), resistance navigation through an experiment (005), anti-pattern
  avoidance / refusing-to-fix (006), and mirror-the-judgment as a stand-alone
  resistance pattern (007).
