# Eval Design Playbook

## What this is

Designing evaluation frameworks for AI systems — particularly open-ended conversational AI (coaches, therapists, assistants with a specific persona or methodology). The output is a runnable eval suite that produces reliable, actionable scores.

## The dependency chain (do not skip steps)

Most eval projects fail because they build the scoring machinery before validating that it works. The correct order is:

1. **Ground truth first.** Before writing any rubrics, collect examples of what "excellent" actually looks like. Real examples from the target domain, not imagined ideals. If you're building a coaching eval, pull real coaching transcripts. If you're evaluating code generation, collect known-good solutions.

2. **Rubrics second.** Define dimensions and scoring scales. Validate them against the ground truth: do your rubrics score the real excellent examples highly? If not, your rubrics are wrong. Fix them before proceeding.

3. **Test subjects third.** Build simulated inputs (clients, users, test cases). Validate that the test subjects behave as specified before running them against the system-under-test.

4. **Judge calibration fourth.** Run the judge on hand-crafted gold conversations (known-good, known-bad, ambiguous). Verify scores land where expected. Check self-consistency. A noisy judge makes the entire eval useless while appearing authoritative (structured JSON scorecards feel trustworthy even when they're random).

5. **Baseline run last.** Only after everything above checks out do you run the full eval. The baseline establishes the floor and validates discriminative power.

## Ten principles

### 1. Calibrate the judge before trusting it

Never trust LLM-as-judge output without validation. Run the judge on inputs where you know the answer. Run it twice on the same input to check consistency. If scores don't land in expected ranges or vary across runs, iterate on the judge prompt before proceeding. A bad judge is worse than no judge — it gives false confidence.

### 2. Ground truth must come from the real thing

If you're evaluating fidelity to a methodology, person, or style, you need real examples of that thing as positive controls. Abstract rubrics derived from documentation may systematically penalize correct behavior that the rubric authors didn't anticipate. The eval must score the real thing highly, or the eval is broken.

### 3. Test appropriateness, not presence

A checklist that asks "did the system use technique X?" rewards indiscriminate application. The right question is "did the system use technique X in a context where X was appropriate?" Always include inappropriate-context conditions and negative examples alongside each checklist item.

### 4. Safety is not quality

Quality failures (coaching poorly) and safety failures (causing harm) are categorically different and require separate criteria. A conversation can score well on quality and still be a safety failure. Safety criteria must be binary pass/fail with override power — they zero out the scorecard regardless of other scores.

### 5. Per-turn annotations are essential for iteration

A per-conversation score of "2/3" tells you something is mediocre. It does not tell you where it went wrong or how to fix it. Per-turn annotations (which turn was good, which turn failed, why) are what actually guide iteration on the system. These are not optional polish — they are the mechanism by which the eval produces improvement.

### 6. Validate your synthetic test subjects

If you're using a simulated user (client LLM, synthetic test case), it is an unvalidated component that can distort the entire eval. A client that breaks character, escalates too quickly, or is too cooperative will make the system-under-test look better or worse than it is. Run test subjects through a few conversations and manually inspect before trusting them.

### 7. Favor hard cases over easy ones

Happy-path scenarios are the easiest to pass and least likely to surface problems. Distribute test cases toward resistance, edge cases, and adversarial scenarios. Easy cases confirm the system works at all. Hard cases reveal whether it works well.

### 8. Use coarse scales for reliability, fine annotations for diagnostics

Research shows 1-3 or binary scales are more reliable for LLM judges than 5-point scales. Use coarse ordinal scores for the summary scorecard (reliable signal) plus qualitative per-turn annotations for diagnostics (where things went wrong). Don't try to get both reliability and resolution from a single number.

### 9. Document cost and runtime

A full eval run that costs $50 and takes 2 hours is too slow for rapid iteration. Know the cost before building. Design the eval to be runnable at different scales: a quick 3-profile smoke test for rapid iteration, a full 15-profile suite for milestone checks.

### 10. The eval must be falsifiable

Before running, state what would make the eval itself invalid. If a known-good system scores poorly, the eval is wrong. If a known-bad system scores well, the eval is wrong. If scores don't vary across clearly different systems, the eval lacks discriminative power. Always run both a positive and negative control.

## Architecture pattern: Simulated User + Judge

The standard architecture for open-ended conversational eval:

```
[Client Profile] → [Client LLM] ↔ [System Under Test] → [Conversation Log]
                                                                ↓
                                              [Judge LLM + Rubrics] → [Scorecard]
```

Components:
- **Client profiles**: Structured specs that drive client LLM behavior (concern, emotional state, resistance patterns, traps)
- **Client LLM**: Plays the user. Must be validated for character consistency.
- **System under test**: The thing being evaluated. Configured via a spec (system prompt, model, retrieval config).
- **Judge LLM**: Scores the resulting conversation against rubrics. Must be calibrated.
- **Rubrics**: Per-dimension scoring criteria with behavioral anchors.
- **Safety criteria**: Binary override layer checked by the judge.
- **Scorecard**: Structured output (JSON) with per-dimension scores, per-turn annotations, safety pass/fail, and evidence citations.

## Judge prompt structure (RCAF)

```
ROLE: Expert evaluator of [domain] with [specific methodology] training.

CONTEXT:
- Dimension being scored: [name and definition]
- Score 1 (poor): [concrete behavioral description]
- Score 2 (adequate): [concrete behavioral description]
- Score 3 (excellent): [concrete behavioral description]
- Reference material: [relevant source docs]
- Few-shot examples: [scored excerpts from ground truth]

ACTION: Score the following conversation. Cite specific turns as evidence.
Note any safety hard-fails. Provide per-turn annotations for turns where
quality shifted.

FORMAT: Structured JSON with score, evidence, turn_annotations, hard_fails.
```

Key decisions to document:
- Which model serves as judge (and why)
- Whether the judge sees the client profile (informed) or scores blind
- One prompt per dimension vs all dimensions in one pass
- Single judge vs multi-judge aggregation

## Quality checklist for eval design

- [ ] Ground-truth positive controls exist (real examples scored by the eval)
- [ ] Ground-truth negative controls exist (known-bad examples)
- [ ] Rubrics validated against ground truth (real good examples score highly)
- [ ] Judge calibrated (gold conversations score in expected ranges)
- [ ] Judge self-consistency checked (same input → same output on repeated runs)
- [ ] Simulated test subjects validated for character consistency
- [ ] Safety criteria defined separately from quality criteria
- [ ] Per-turn annotations included (not just per-conversation scores)
- [ ] Test case distribution favors hard cases
- [ ] Fidelity checklist tests appropriateness, not just presence
- [ ] Cost and runtime documented
- [ ] Judge model selection documented with rationale
- [ ] The eval has been run against both a positive and negative control to confirm discriminative power

## Common pitfalls

- **Trusting the judge without calibration.** Structured JSON looks authoritative. It can be entirely noise.
- **Rubrics that penalize correct behavior.** If you only derive rubrics from documentation and never check them against real examples, they will systematically miss things the real practitioner does that the documentation didn't capture.
- **Presence-based fidelity.** "Did it use the technique?" is the wrong question. "Did it use the technique at the right time?" is the right one.
- **Conflating safety and quality.** A coach that misses suicidal ideation but asks great questions is not "mostly good." It is a failure.
- **Over-indexing on happy path.** If 5/15 test cases are cooperative clients who present clearly, the eval mostly tests the easy case.
- **Unvalidated clients.** A simulated user that breaks character or is too cooperative invisibly inflates scores.
- **No cost model.** Building an eval that costs $100/run when you need to iterate 20 times.
- **Designing for one run.** The eval's value is in repeated runs across iterations. Design for speed and repeatability, not a single comprehensive assessment.
