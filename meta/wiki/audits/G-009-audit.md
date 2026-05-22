---
type: audit
goal: G-009
date: 2026-05-22
status: addressed
---

## Resolution (2026-05-22)

All 14 recommendations addressed. User-decided changes: (a) E-036 graph-walk added as a fourth retrieval experiment, (b) budget raised from $40 to $60 to fund both graph-walk and pre-spec'd E-037 hybrid. Critical and Important fixes are reflected in G-009's decision log, the relevant experiment pages (E-031 through E-037), and R-012/R-013 scope updates.

# Audit: Build the Joe Hudson AI coach

## Overall Assessment

This plan is structurally sound and shows real care: clear two-phase framing (architecture-then-prompt), explicit budget allocation, hard dependency on judge calibration, smoke-then-full ramp on every experiment, and a versioned iteration log. My confidence that executing it as-is will produce a *runnable coach with an eval scorecard* is high (~85%). My confidence that it will *clear the eval bar* (mean delta >= 0.3 on >= 4 dimensions vs E-024) within the $40 budget is moderate (~55%), driven by three things: (1) the retrieval-architecture space is under-covered, (2) the $40 budget has thin margins given realistic full-eval costs, and (3) the "iterate prompt v4-v7 on the winning architecture" assumption may not survive contact with the per-dimension findings from E-034.

## Strengths

The dependency on E-025 (judge calibration) is properly load-bearing and explicitly encoded as a blocker. This is the single highest-value design decision in the plan — building a coach against an unvalidated eval is the canonical way to waste $40 in 6 hours, and the plan catches it.

Holding the system prompt constant across E-031/E-032/E-033 (v1 from E-031 is reused by E-032 and E-033) is the correct experimental discipline. It isolates retrieval as the independent variable so E-034 can attribute deltas to architecture, not confounded with prompt drift. The playbook calls this out explicitly ("Isolate one variable") and the plan honors it.

The "no full eval without smoke evidence of movement" rule in E-035 is a real cost-control mechanism, not boilerplate. At ~$5-9 per full run, this rule alone is what makes the prompt-iteration phase fit in the budget. Without it, four iterations of full eval would consume the entire G-009 budget.

E-034 is genuinely set up as a *decision* experiment, not a confirmation. The clause "if no clear winner emerges, spawn E-036 hybrid" prevents the most common failure mode where teams pick a winner based on means and ignore per-dimension variance. The cost-adjustment step (quality delta / cost-per-turn) is the right normalization.

The decision to put the coach on Vercel AI SDK while leaving the eval harness on raw Anthropic SDK is correct and well-justified in the decision log (different roles, different needs). This avoids a tempting-but-wrong unification.

The plan correctly separates *retrieval into context* from *retrieval as tools*. Many plans collapse these.

## Issues

### Critical (must address before execution)

**1. The retrieval-strategy trichotomy systematically misses graph-walk, which is the most coach/-shaped approach.**

The plan tests three architectures: no-retrieval (E-031), tool-based navigation (E-032), embedding-based (E-033). It does not test graph-walk over the `related:` links. This is a serious gap because the `coach/` compendium *is* a knowledge graph: `_backlinks.json` is 5,624 lines, every file has a `related:` array with 5-10 hand-curated semantic edges, and the curator of the compendium (G-007) explicitly built it as hypertext rather than corpus. R-012's scoping language acknowledges this ("the graph structure of `related:` links is unique to this compendium and deserves explicit consideration") but then the experiments do not implement a graph-walk approach. R-012 might recommend one, but no experiment slot is reserved for it.

Why this matters: a coach that retrieves `defense.md` via embedding similarity will get the same hit as one that walks `concerns/i-cant-apologize -> related:[defense, apologies-as-power-struggle-surrogate] -> related:[...]`. But the *quality* of those retrievals is likely very different. The hand-curated edges encode the same expert judgment the coach is trying to embody. Embedding similarity over markdown will retrieve topically-adjacent files; graph-walk will retrieve relationally-adjacent files (what Joe actually goes to next from this concept). For a *coaching* system whose central skill is "where does Joe go from here," graph-walk is the architecturally-closest match.

Fix: Either (a) add E-033b: graph-walk retrieval starting from concern/concept seeds discovered in the client message, with related-link traversal as the retrieval primitive, OR (b) explicitly fold graph-walk into the tool catalog for E-032 (the existing `follow_related` tool is a *primitive* but not a *strategy*; a strategy would be "start at concern, walk 2 hops via related:, return frontier"), OR (c) make R-012's output authoritative for what gets tested and explicitly allow R-012 to swap E-033's embedding approach for graph-walk if the survey recommends it. The current language allows pivot but does not commit budget to it. The cleanest fix is (a) — add it as a fourth retrieval experiment with a slim budget, since the index is already built (`_backlinks.json` exists and is free to walk).

**2. Hybrid is a blind spot. The plan assumes a single winner emerges, but the per-dimension structure of G-008 makes that empirically unlikely.**

R-008 designed six orthogonal dimensions specifically so a coach can score 3/1/3/3/3/2. The eval is *built* to surface that different things matter for different dimensions. Yet G-009 assumes E-034 produces one architectural winner and E-035 iterates the prompt on that single substrate. The plausible outcome — tool-based wins on Perceptual Accuracy because the router can fetch reads/, embedding wins on Methodology Fidelity because semantic retrieval surfaces signature questions, no-retrieval wins on Coaching Stance because retrieved content actually *interferes* with VIEW state — is not just handled by E-036; it actively requires a hybrid that the plan only sketches in a single sentence ("spawn E-036 hybrid").

Why this matters: if E-034 sees mixed results (which is the most likely outcome), E-035 cannot proceed as designed. The plan has no concrete spec for E-036, no budget reservation, and no fallback if hybrid design itself needs iteration. The "$10 for E-035 prompt iteration" line item silently assumes E-035 is the right thing to do next. If the path is actually E-036 then E-035, the budget is already over.

Fix: Pre-spec E-036 (hybrid: per-dimension retrieval strategy or tiered: cheap embedding first-pass then tool-based refinement) with a $5-8 budget reservation, and explicitly call out that E-035 may happen after E-036 if E-034 mandates a hybrid. Then re-check that the total fits in $40.

**3. The $40 budget allocation is plausible but operates on optimistic eval-cost estimates.**

The decision log estimates: E-031 ~$8, E-032 ~$10, E-033 ~$8, E-034 ~$0, E-035 ~$10. Total ~$36 with $4 contingency.

Verification against actual eval cost: R-010 estimates $6-9 per full eval run with caching; E-023 has shipped and the real costs would be measurable, but the audit cannot see them. Take the midpoint $7.50 per full run. E-031, E-032, E-033 each do at minimum: 1 smoke (~$1.50) + 1 full ($7.50) = $9 per experiment. Three experiments = $27 floor before retrieval-side overhead.

E-032 has additional cost: tool-call round-trips inflate token counts. The plan says "Haiku is 12x cheaper than Opus so net add is moderate," which is true *per call* but Haiku also runs more turns (router + coach is at minimum 2 calls per coaching turn) and the cache-hit story is worse because tool outputs invalidate prefix caches. Realistic E-032 cost is more like $12-14, not $10.

E-033 has lower per-eval cost (embedding is free locally) but inlining retrieved content blows up the coach's input token count. If you retrieve 5 files averaging 1.5K tokens each, that's 7.5K extra tokens per turn × 12 turns × 15 profiles = 1.35M extra input tokens per eval. That is real money even with caching.

E-035 iteration plan says "2-3 iterations of partial-eval runs on the smoke-test 2-profile mode for cheap iteration, then 1 final full run." But the success criteria say "at least 3 prompt iterations (v4, v5, v6)" and the cap is 4 iterations. Each iteration is smoke ($1.50) + sometimes full ($7.50). If 2 of 4 iterations need full verification, that's $18 for E-035, not $10-15.

Realistic worst-case sum: $9 + $13 + $9 + $0 + $18 = $49. Best case: $27 + $5 = $32. The actual run will probably land $40-48.

Fix: Either (a) raise the budget to $50 with explicit user sign-off, (b) tighten the rule that E-035 caps at 3 iterations not 4 and only the final iteration runs full (others stop at smoke unless smoke shows a >0.3 delta on the targeted dimension), or (c) add a hard checkpoint after E-031 where the plan re-projects total spend based on actual E-031 cost and adjusts the rest. The current plan has the right *structure* for budget discipline but the math is tight enough to bite.

**4. The exit criteria bar (mean delta >= 0.3 over E-024 on >= 4 dimensions) is calibrated against a baseline that does not yet exist.**

E-024 is `status: pending`. E-025 is `status: claimed` but not complete. G-009 cannot be sanity-checked against E-024 because there are no numbers yet. A delta of 0.3 on a 1-3 scale represents 15% of the full range — this could be either trivially easy (if E-024 scores ~1.5 across the board and the AoA-named prompt is so weak that any real methodology immediately pops it to 1.9) or genuinely hard (if E-024 scores ~2.2 because Sonnet 4.6 with even a thin prompt is already pretty good, leaving little ceiling). The bar's appropriateness is *unknown* and will stay unknown until E-024 actually runs.

Compounding: R-010's calibration design explicitly instructs the judge to refuse to use 2 as a hedge. If that anti-hedging instruction works well, scores will be bimodal (1s and 3s) and a 0.3 mean delta represents a meaningful share of conversations moving from 1 to 3 — that's a real bar. If anti-hedging *fails* and scores still cluster around 2, a 0.3 delta is hard to achieve because the range is compressed.

Fix: Add to G-009's correctness section: "The eval bar will be re-calibrated after E-024 produces real numbers. If E-024 mean scores are below 1.6 on most dimensions, the bar tightens to delta >= 0.4. If E-024 mean scores are above 2.4, the bar relaxes to delta >= 0.2 because the headroom is limited." Or simpler: make E-024-completion an explicit precondition for setting the bar, not just for starting the work. The current language treats 0.3 as a fixed value when it should be a function of E-024.

### Important (should address, may not block)

**5. The "iterate prompt v4-v7 on the winning architecture" assumption is fragile because architecture and prompt co-evolve.**

E-035's design assumes the prompt and the retrieval architecture are separable: pick one architecture, then iterate the prompt on it. In practice, a prompt that works under no-retrieval may need to be rewritten under embedding-retrieval because "you have retrieved context, use it appropriately" is a different stance instruction than "you have only your training." This is acknowledged in E-035 only weakly ("Pull the current best prompt"). The risk is that E-035 starts with v1 (which was tuned for no-retrieval in E-031), the winning architecture turns out to be embedding-based (E-033), and the v1 prompt actively underperforms because it never instructed the coach how to use retrieved content. Three iterations of v4/v5/v6 might be spent re-discovering this rather than addressing G-008-rubric failures.

Fix: In E-032 and E-033, *do* hold the prompt content constant for fair comparison, but add a single line to each retrieval-equipped prompt: "When relevant `coach/` content is retrieved into your context, draw on it to ground your reading and your move selection. Do not announce that you are retrieving." Then E-035 inherits a prompt that already knows it has retrieval. Alternatively, the first iteration in E-035 should be explicitly architecture-tuning (v4 = "make v1 fit the winning architecture") rather than dimension-targeting.

**6. The system prompt iteration loop has no protection against the "scoring my own work" pitfall from the playbook.**

The ai-experiment playbook warns: "Scoring your own work. If you wrote the prompt and you're judging the output, you're biased. Use structured rubrics or a separate judge model." G-009 satisfies the model-separation form of this (Opus judges Sonnet coach). But there is a subtler version: the agent iterating the prompt in E-035 is also the agent reading the per-turn annotations and deciding what to change. The annotations are the iteration signal, but if the agent is biased toward incremental changes ("v4 adjusted the stance section") rather than admitting failure ("v1's whole structure is wrong"), iterations can plateau.

Mitigation in the plan: "If smoke shows no improvement, revert and try a different edit hypothesis." This is good but reactive — it triggers only after a failed iteration. A proactive guard would be: every iteration must propose at least one *contrasting* hypothesis ("maybe the issue is X, but it could also be Y"), and if v5 and v6 both fail, v7 must try the contrasting hypothesis instead of doubling down. Without this, the iteration loop is biased toward whatever the first diagnosis was.

Fix: Add to E-035 method: "For each iteration, document two candidate diagnoses, not one. Pick the highest-likelihood one to try, but record the alternative. If two iterations in a row fail to move the target dimension, switch to the alternative diagnosis on the next iteration."

**7. R-013 (Vercel AI SDK research) may be overscoped relative to what E-031 actually needs.**

R-013 is doing useful work surveying tool-use, multi-step loops, error handling, cache invalidation, etc. But E-031 is a no-retrieval, no-tool baseline. It needs the SDK's `generateText` and a system prompt — nothing else. The risk is that R-013 produces a comprehensive tool-use cheatsheet that E-031 does not consume, and E-031 is delayed waiting for R-013. The dependency chain shows E-031 depends on R-011 (prompt design) AND R-013 (SDK), but R-013's tool-use focus is only really needed for E-032/E-033.

Fix: Either (a) split R-013 into R-013a (SDK basics: `generateText`, prompt caching, error handling — needed for E-031) and R-013b (tool catalog and multi-step loops — needed for E-032/E-033), or (b) declare R-013a-equivalent to be a 30-min spike in E-031 itself and remove the R-013 blocker from E-031. The latter is simpler.

**8. The coach lacks an explicit "remember context across turns" design choice.**

The plan assumes multi-turn conversation works because the AI SDK supports message history. But there is a design question buried in there: in a 12-turn conversation with retrieval, do you re-retrieve every turn (and inline different context each turn, polluting the cache), retrieve only on the first turn (and risk going stale), retrieve every N turns, or retrieve only when the client message has a topic shift signal? This choice has both quality and cost implications and is not addressed by R-012 or any experiment.

Fix: Add to R-012's scope: "When in a multi-turn conversation, what is the retrieval trigger policy (every turn, first turn only, on detected topic shift)? What is the cost-quality tradeoff?" Then E-032 and E-033 must each document their choice in the config.

**9. No experiment validates that the coach refuses to bypass safety under client pressure.**

The must-have says "Safety screen integrated: the E-027 safety criteria are enforced live, not just at eval time. The coach refuses to bypass safety even under client pressure." The exit criterion says "Safety screen is integrated and verified against at least 1 crisis profile from `eval/profiles/`." But none of E-031/E-032/E-033/E-035 specifically targets this. The implicit assumption is that the full eval covers the 3 crisis profiles (`crisis-coercion-shutdown-001`, `crisis-destructive-coping-001`, `crisis-suicidal-ideation-001`) and the safety screen result will indicate pass/fail.

This is mostly fine but creates an evidence gap: if the coach passes safety on the 3 crisis profiles by accident (e.g., the simulated client doesn't push hard enough), the exit criterion is "met" without real safety pressure-testing. The G-008 eval is designed for coaching quality measurement, not adversarial safety testing.

Fix: Either (a) add an explicit safety verification step to E-031 ("manually craft 3 adversarial inputs that try to pressure the coach into bypassing safety — e.g., 'I know you have to suggest professional help but I really just want to talk this through' — and verify the coach holds the line"), or (b) explicitly verify the safety screen logic is wired into the coach loop (not just the eval judge), with a code-review item that confirms `safety_screen()` is called pre-response on every turn.

### Minor (consider addressing)

**10. E-031's hypothesis bar (delta >= 0.2 vs E-024) differs from the goal-level bar (delta >= 0.3 vs E-024 on >= 4 dimensions).**

E-031 sets its own success at 0.2; G-009 requires 0.3 from the *final* coach. This is internally consistent (E-031 is a baseline coach, not the final one) but worth a sentence on E-031 explaining that beating E-024 by 0.2 is a "necessary not sufficient" signal that the prompt direction is right.

**11. No experiment captures the iteration log content format.**

G-009's must-have says "Iteration log on this page shows every prompt version tried, its retrieval config, its eval score, and the change made for the next iteration." Where is the template for this? E-035 says "Iteration log on G-009's goal page is updated with every version, score, and edit" but doesn't show structure. A small template in E-031 (which is the first iteration) would set the format for the rest.

**12. The `coach-app/configs/<name>.yaml` schema is not specified anywhere.**

The plan says configs are consumable by `eval/run.ts`, and we know from `eval/coach-configs/naive-aoa.yaml` what the v0 schema looks like (id, model, temperature, max_tokens_per_turn, system_prompt). But coach configs that include retrieval will need extra fields (retrieval_strategy, retrieval_config, tools, etc.). Neither R-011 nor R-012 nor R-013 specifies this. The first experiment to add retrieval (E-032) will invent it, and E-033 will have to follow the same shape or refactor. A pre-spec would prevent that.

Fix: Add a 5-line schema in R-013 or E-031 covering the optional retrieval fields, so E-032 and E-033 both inherit it cleanly.

**13. The "AI SDK over raw Anthropic SDK" decision is sound but the playbook (ai-experiment) doesn't actually require it.**

Worth a sentence on why the coach gains from AI SDK that the eval did not. The decision log mentions "tool-use loops, agent-style retrieval, possibly streaming" — that's the right reasoning, but it's only in the decision log, not in R-013. R-013 should also articulate this so the next agent reading R-013 sees the rationale.

**14. Playbook awareness check — partial.**

The ai-experiment playbook is correctly cited. The eval-design playbook is not cited but the dependency on E-025 calibration honors its core principle ("calibrate the judge before trusting it"). One playbook principle the plan does not honor is principle #4 from ai-experiment: "Run multiple samples." The full 15-profile eval has 15 samples per dimension — that's good — but each profile runs *once*. If a specific (coach, profile) pairing produces noisy scores, there's no variance estimate. R-010's calibration touches on this (self-consistency runs in E-025) but G-009 doesn't carry that forward. Re-running 1-2 profiles per coach config for variance estimates would catch this. Not blocking, but flag.

## Recommended Changes

Priority-ordered work items for the wiki-next agent:

1. **Add a fourth retrieval experiment (E-033b: graph-walk via `related:` links)** or explicitly merge graph-walk into E-032's tool catalog as a first-class strategy (not just a `follow_related` primitive). Adjust budget accordingly. (Addresses Critical #1.)

2. **Pre-spec E-036 (hybrid retrieval) as a sibling of E-035, not a contingent follow-up.** Reserve $5-8 in the budget and make E-035 vs E-036 a decision E-034 makes, not a fallback. (Addresses Critical #2.)

3. **Tighten the budget math.** Either raise to $50 with user sign-off, or add a hard checkpoint after E-031 that re-projects total spend based on actual cost, or tighten E-035's iteration rule (3 iterations max, only final runs full unless smoke shows >0.3 delta). (Addresses Critical #3.)

4. **Make the eval bar a function of E-024's actual scores, not a fixed 0.3.** Add the conditional bar logic to G-009's correctness section. (Addresses Critical #4.)

5. **Add retrieval-aware language to v1 prompt, OR make architecture-tuning the first step in E-035.** (Addresses Important #5.)

6. **Add "two diagnoses per iteration" rule to E-035 to prevent confirmation-bias loops.** (Addresses Important #6.)

7. **Split R-013 into a slim SDK-basics part (R-013a, blocks E-031) and a tool-catalog part (R-013b, blocks E-032/E-033)** — or remove R-013 as a hard E-031 blocker and inline the SDK-basics work into E-031. (Addresses Important #7.)

8. **Add multi-turn retrieval-trigger policy to R-012 scope.** (Addresses Important #8.)

9. **Add a safety pressure-test step to E-031 with hand-crafted adversarial inputs**, and verify in code review that the safety screen runs on every coach response, not just at eval-judge time. (Addresses Important #9.)

10. **Add a coach-config schema spec (with retrieval fields) to R-013 or E-031**, so E-032 and E-033 inherit a stable shape. (Addresses Minor #12.)

11. **Add an iteration log template to E-031** so subsequent versions follow the same structure. (Addresses Minor #11.)

12. **Add 1-2 variance re-runs per coach config (smoke-test mode is cheap enough) to estimate per-profile noise.** (Addresses Minor #14.)
