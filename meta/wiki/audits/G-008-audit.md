---
type: audit
goal: G-008
date: 2026-05-21
status: actionable
---

# Audit: Build eval suite for Joe Hudson AI coach

## Overall Assessment

This is a well-structured plan with solid academic grounding and a clear dependency chain. My confidence that executing it as-is will produce a *runnable* eval is high (80%). My confidence that the eval will actually be *discriminative* -- that it will reliably distinguish good coaching from bad -- is moderate (50%), because the plan has a significant gap around judge calibration and no mechanism to validate that the eval itself works before relying on it.

## Strengths

The eval-before-coach ordering is the right call. Building blind without a feedback loop is the most common failure mode for this kind of project, and the decision log correctly identifies this.

The mapping from `coach/` file types to eval capabilities (R-008's table) is concrete and well-reasoned. Each file type maps to a testable coaching dimension. This is not hand-wavy -- there are 470+ files providing real ground truth.

The anti-pattern test cases (E-021) are the highest-signal component and the plan correctly prioritizes them. The list of 10 priority anti-patterns in E-021 is well-chosen for AI-specific failure modes (loving-to-transform, view-as-technique, impartial-apathy). Sampling the actual `coach/anti-patterns/` files confirms they contain rich, specific material ("How to Catch It" sections, concrete tells) that translates directly into judge criteria.

The client profile schema in R-009 is thoughtfully designed. The `traps` and `expected_territory` fields make profiles testable rather than merely descriptive. The candidate schema references real compendium IDs.

The dependency chain is logical: research informs design (R-008 -> E-019, R-009 -> E-020), design feeds integration (E-019/E-020/E-021/E-022 -> E-023), integration enables validation (E-023 -> E-024).

## Issues

### Critical (must address before execution)

**1. No judge calibration or inter-rater reliability check.**

The plan builds rubrics (E-019), builds a judge prompt (R-010), and then immediately runs a full baseline (E-024). There is no experiment that tests whether the judge is reliable before trusting its output. E-019's success criterion mentions "two independent judges would agree on score 80%+ of the time," but no experiment actually measures this. If the judge is noisy, E-024's results are meaningless, and worse, they will look meaningful because structured JSON scorecards feel authoritative.

Fix: Add an experiment between E-023 and E-024 that runs the judge on 3-5 hand-crafted "gold" conversations (one clearly good, one clearly bad, one ambiguous) and measures whether scores land where expected. Also run the judge twice on the same conversation to check self-consistency. This is the single most important addition to the plan.

**2. No ground-truth conversations from actual Joe Hudson coaching.**

The entire eval framework scores AI conversations against rubrics derived from the compendium, but never compares against what Joe Hudson actually does in a real coaching session. The `transcripts/` directory contains hundreds of real coaching conversations. A gold-standard eval would include at least a few real Joe Hudson exchanges as positive controls -- conversations where the eval should produce high scores. Without this, the eval could systematically penalize correct coaching behavior that the rubric authors did not anticipate.

Fix: Add a research item or experiment that extracts 3-5 short multi-turn exchanges from `transcripts/` where Joe demonstrates the methodology clearly. Use these as calibration inputs for the judge (the eval should score them highly). This also directly enables the nice-to-have "few-shot calibration examples" which should arguably be a must-have.

### Important (should address, may not block)

**3. The simulated client LLM is an unvalidated component.**

E-020 builds client profiles and a prompt template, but the plan assumes the client LLM will behave consistently and realistically. There is no test of client fidelity. A client LLM that breaks character, escalates too quickly, or is too cooperative will distort scores. R-009 raises this question ("How to handle client LLM breaking character?") but no experiment addresses it.

Fix: Add a validation step to E-020 or a small follow-up experiment: run the client prompt for 3 profiles and manually inspect whether the client behaves as specified. Check for character breaks, resistance consistency, and whether the client exhibits the specified emotional state.

**4. The 1-3 scale may be too coarse to detect improvement over time.**

The plan commits to a 1-3 scale based on research that binary/ternary scales are more reliable for LLM judges. This is reasonable for initial discrimination (bad vs. good). But the stated purpose of the eval is to "guide iteration" -- to detect whether prompt changes helped. Moving from 1.8 to 2.1 average on a 1-3 scale across 15 profiles is a tiny signal in a noisy measurement. The eval may not have enough resolution to guide iteration as intended.

Fix: Consider a hybrid approach: 1-3 ordinal scores for the summary scorecard (reliable), plus qualitative per-turn annotations from the judge (diagnostic). The per-turn annotations are currently a nice-to-have; they should be elevated because they are what actually guides iteration. A score of "2" tells you something is mediocre; a per-turn annotation tells you *where* it went wrong.

**5. E-022 (methodology fidelity checklist) treats fidelity as presence of moves rather than appropriateness of moves.**

The checklist catalogs what the coach *could* do (signature questions, reads, moves) and checks whether the coach used them. But Joe Hudson's methodology is as much about what *not* to do and *when* to deploy which move. A coach that asks "What do you want?" in every conversation regardless of context would score well on the presence check but would be coaching poorly. The checklist includes "appropriate_when" fields, but the success criteria only require "10+ questions, 10+ reads, 10+ moves" without testing whether appropriateness matching works.

Fix: E-022's success criteria should include a check that the appropriateness conditions are specific enough for a judge to evaluate. Consider adding 2-3 negative examples to the checklist: conversations where a move was used *inappropriately* and should be flagged.

**6. Safety hard-fail criteria are mentioned but not designed in any experiment.**

The goal's must-haves include "safety hard-fails -- binary pass/fail checks" with at least 5 failure modes. The exit criteria require them. But no experiment is dedicated to designing these. E-021 covers anti-patterns, which overlap with safety but are not the same thing. Anti-patterns are methodology failures (coaching poorly); safety failures are harm risks (failing to recognize suicidal ideation, giving medical advice). The plan implicitly assumes E-021 covers this, but the E-021 priority list does not include any crisis/safety anti-patterns.

Fix: Either expand E-021's scope explicitly to include safety hard-fail design, or add a dedicated experiment for safety criteria. The crisis scenario type in E-020 (2 profiles) is good but insufficient without corresponding judge criteria that know how to evaluate crisis handling.

### Minor (consider addressing)

**7. R-008 is already claimed but R-009 and R-010 are not, creating a potential bottleneck.** E-023 depends on R-010. If R-010 is not started soon, the entire pipeline stalls at the integration point.

**8. The plan does not specify which model serves as the judge.** E-023 mentions "Claude API via Anthropic SDK" but does not specify the model. Judge performance varies significantly across model tiers. This should be a conscious choice documented in R-010.

**9. The distribution of scenario types in E-020 (5 happy path, 4 resistance, 2 crisis, 2 edge case, 2 red herring) over-indexes on happy path.** Happy path is the easiest case and the one least likely to surface problems. Resistance and edge cases are where the eval earns its keep. Consider 3 happy path, 4 resistance, 3 crisis, 3 edge case, 2 red herring.

**10. No consideration of eval cost or runtime.** Running 15 multi-turn conversations (12 turns each = 180 API calls for the conversations) plus judge scoring (potentially per-dimension = 5-7 judge calls per conversation = 75-105 more API calls) is non-trivial. E-023 mentions "under 10 minutes for 2 profiles" but does not estimate full-suite cost or time. This matters for iteration speed.

## Recommended Changes

1. **Add experiment E-025: Judge calibration and reliability check.** Run the judge on 3-5 hand-crafted gold conversations (known-good, known-bad, ambiguous). Verify scores land as expected. Run the judge twice on the same input to measure self-consistency. This should be inserted between E-023 and E-024 in the dependency chain. This is the highest priority addition.

2. **Add experiment or research item: Extract gold-standard exchanges from transcripts.** Pull 3-5 real Joe Hudson coaching exchanges from `transcripts/` as positive controls. Use these to calibrate the judge and verify the rubrics score real Joe coaching highly. Consider making "few-shot calibration examples for the judge" a must-have rather than a nice-to-have.

3. **Add client LLM validation step to E-020.** After building profiles, run 3 of them and manually inspect client behavior for character consistency, resistance patterns, and realism. Document what failure modes were observed.

4. **Move per-turn scoring from nice-to-have to must-have, or at minimum add per-turn qualitative annotations.** Without turn-level diagnostics, the eval tells you a conversation scored "2" but not where it went wrong, severely limiting its utility for guiding iteration.

5. **Expand E-021 or add a new experiment to explicitly design safety hard-fail criteria.** Define the 5+ safety failure modes (crisis non-recognition, medical advice, reinforcing self-harm, etc.) with binary pass/fail judge criteria. These are distinct from anti-patterns.

6. **Strengthen E-022 success criteria** to include appropriateness testing, not just presence counting. Add negative examples (moves used in wrong context) to the checklist.

7. **Adjust E-020 scenario type distribution** to reduce happy path (3) and increase crisis (3) and edge case (3).

8. **Specify judge model selection as a documented decision** in R-010, including rationale for choosing the same or different model than the coach-under-test.
