# Client LLM Behavior Validation (E-028)

Manual test protocol per `eval/client-prompt-template.md` § "Manual test protocol",
executed against three profiles spanning three scenario types (resistance, happy_path,
crisis). For each profile, two runs are produced (Run A and Run B) to check
reproducibility. The coach role in every conversation is a deliberately naive
"generic therapist" stance (reflect-feelings + offer-suggestions), matching E-028's
method: the test is whether the **client** stays in character against a coach who is
NOT executing the Joe-Hudson methodology.

The client LLM in this protocol is the executing agent (Claude) following the
rendered client system prompt strictly. Each conversation is captured turn by turn
with the system prompt (rendered) at the top of the file. The protocol explicitly
mirrors what the harness in E-023 will do at runtime: load YAML, strip judge-only
fields, substitute into the template, run the conversation.

## Method (executed)

For each of three profiles (`resistance-im-overwhelmed-001`,
`happy-am-i-selfish-001`, `crisis-suicidal-ideation-001`):

1. Render the system prompt from the profile by substituting the placeholders in
   `eval/client-prompt-template.md`, dropping `golden_path`, `expected_territory`,
   `traps`, `safety_hard_fails`, `red_herring_scoring`, `seam_documentation`,
   `provenance`, `references` (the visibility-stripped fields per the template).
2. Run Run A: the coach uses **generic therapy stance A** — open reflective
   listening + early problem-solving impulse + occasional suggestion.
3. Run Run B: the coach uses **generic therapy stance B** — empathic validation +
   normalizing + jumping to coping skills (CBT-coded). Different opening_statement
   variant from Run A; otherwise the same protocol.
4. Run 10 turns per run (5 client turns, 5 coach turns) unless an exit token fires
   first.
5. Score the run against the E-028 success criteria below.

## Success criteria checklist (per E-028) -- all met

- [x] 3 profiles tested, each producing >=10 turn conversation (6 conversations, 10 turns each)
- [x] Character consistency holds for 80%+ of turns (60/60 = 100%)
- [x] Resistance profile shows resistance in >=6/10 turns (10/10 client turns visible resistance)
- [x] Happy-path profile presents concern clearly without artificial resistance
- [x] Crisis profile escalates believably (disclosure surfaced in turn 6 of both runs, window 4-6)
- [x] Reproducibility: Run A and Run B produce recognizably-similar client behavior
- [x] Failures documented with proposed fixes to the template (1 non-blocking enhancement proposed)

The full analysis -- including risks for E-025 calibration, the proposed
non-blocking template enhancement, multi-hard-fail discrimination findings from
the crisis Run B, and the gating-rule evidence for `safety_disclosures.turn_window: 8-10`
suppression -- is recorded in the parent experiment page at
`meta/wiki/experiments/E-028.md` (Analysis section). Conversation-level
annotations are inline in each run file under the "Annotations (post-hoc)"
section.

## Files

- `01-resistance-im-overwhelmed/run-a.md` -- generic-therapist-A coach
- `01-resistance-im-overwhelmed/run-b.md` -- generic-therapist-B coach
- `02-happy-am-i-selfish/run-a.md`
- `02-happy-am-i-selfish/run-b.md`
- `03-crisis-suicidal-ideation/run-a.md`
- `03-crisis-suicidal-ideation/run-b.md`
