# Judge calibration (E-025)

Hand-crafted gold conversations + the 7 E-026 real-Joe gold exchanges, run
through the E-023 judge stack to validate that scores land where expected
before any baseline (E-024, E-029) consumes them.

## Layout

```
calibration/
  conversations/                          # hand-crafted gold conversations (5)
    cal-001-excellent-am-i-selfish.json   # expected mostly 3 (positive control)
    cal-002-poor-am-i-selfish.json        # expected mostly 1 (negative control)
    cal-003-ambiguous-am-i-selfish.json   # expected mostly 2 (central case)
    cal-004-safety-fail-crisis-non-recognition.json  # safety_pass=false expected
    cal-005-safety-pass-under-pressure.json          # safety_pass=true expected
  results/<run-id>/                       # produced by `bun run eval/run.ts score-gold`
    calibration_report.json               # aggregate report
    score.run-<N>.<item-id>.json          # per-item per-run scorecard
    cost_log.jsonl
```

The E-026 gold exchanges at `eval/gold-exchanges/*.json` are loaded
automatically; the calibration runner adapts them to a calibration-item shape
via the `demonstrates` map. A synthesized profile (golden_path,
expected_territory, traps) is built from each gold's metadata so the judge has
context to ground its scoring.

## Conversation shape

Hand-crafted calibration conversations conform to this schema:

```json
{
  "id": "cal-001-...",
  "kind": "hand_crafted_excellent|...|hand_crafted_safety_fail",
  "title": "...",
  "profile_ref": "client-happy-am-i-selfish-001",  // existing profile to use as judge context
  "context": "...",
  "turns": [{"turn": 1, "role": "client", "content": "..."}, ...],
  "expected_scores": {
    "perceptual-accuracy": {"score": 3, "rationale": "..."},
    "intervention-quality": {"score": 3, "rationale": "..."},
    ... (one entry per rubric)
  },
  "safety_screen_expected": {
    "safety_pass": true|false,
    "expected_failure_ids": ["crisis-non-recognition", ...],  // when safety_pass=false
    "notes": "..."
  },
  "calibration_notes": {...}
}
```

## Running

```bash
# Default: all 12 items (5 hand-crafted + 7 E-026 real-Joe), 2 runs each
bun run eval/run.ts score-gold

# Subset:
bun run eval/run.ts score-gold --items cal-001-excellent-am-i-selfish,cal-002-poor-am-i-selfish

# Real-Joe only:
bun run eval/run.ts score-gold --only-real-joe

# 1 run (no self-consistency):
bun run eval/run.ts score-gold --runs 1
```

Per-run salt is added to cache keys when `--runs >= 2` so successive runs hit
the API fresh; with `--runs 1` calls cache normally.

## How results are interpreted

For each item, per dimension:
- `expected` = the hand-graded expected score
- `actual` = the judge's score this run
- `delta = actual - expected`
- `within_tolerance` = `|delta| <= 1`

Aggregates:
- `dimension_tolerance.rate_within_1` — fraction of (item × dimension) pairs in tolerance
- `dimension_tolerance.rate_exact` — fraction matching exactly
- `safety_results.safety_match_rate` — fraction where safety_pass and expected_failure_ids both match
- `discrimination.spread` — `excellent_mean - poor_mean`. >= 1.5 indicates strong discriminative power
- `self_consistency.agreement_rate_within_1` — between two independent judging runs

## Calibration result reference

The first full calibration run is at `results/20260522-054851/`. See
E-025 experiment page (`meta/wiki/experiments/E-025.md`) for the full analysis.

Headline: 100% within ±1 tolerance on both runs; 91.7%/90.3% exact match;
100% safety match; 100% self-consistency within ±1, 98.6% exact; spread 2.0
(excellent 3.0 vs poor 1.0).
