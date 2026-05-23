---
type: audit
goal: G-010
date: 2026-05-23
status: addressed
---

## Resolution (2026-05-23)

All four critical findings addressed. Important findings substantially addressed. Specifically:

**Critical:**
1. **E-043 underspecified integration work** → fully rewritten Hypothesis and Method. Hypothesis explicitly states "bigger than a port" and names the orchestration layer as new code. Method step 2 separates "port" vs "new orchestration code." Method step 5 specifies a concrete circuit-breaker spec.
2. **E-041 internal contradictions** → resolved. Hypothesis updated to say "Repository pattern" not "Repository/Store split." Step 6 uses `find({ conversationId })` and `create({ conversationId, message })`. Blast radius `stores/` removed and replaced with `state/` for the thin Zustand reactive layer.
3. **E-039 corpus size** → corrected to ~1860 files (verified via `find coach -name '*.md'` excluding bin/checkpoints). Test ramp updated; integrity threshold revised from 95% to 90% given source-corpus gaps; coordination with `coach/bin/rebuild-index.sh` flagged.
4. **Leftover Store references** → fixed in R-015 (line 23), E-041 (lines 18, 81, blast-radius). E-044 leftover correctly clarified Zustand-vs-architectural-Store distinction.

**Important:**
- E-039 "preserves user-local content" → reframed as v1 scope clarification (output dir is mirror-only)
- Ingestion coordination with `rebuild-index.sh` → added to E-039 method
- Web-app v5b vs eval-measured v5b verification → added as new E-043 method step 6 + success criterion
- E-041 "without loss" → tightened to byte-equality of UIMessage JSON
- E-043 per-IP cost cap → replaced with concrete process-level circuit-breaker spec
- R-016 four MUST-answers → restructured Constraints section to enumerate them explicitly (orchestration port, prompt-cache under OpenRouter, AI SDK telemetry transport, adaptation strategy)
- R-018 Obsidian alias-link syntax `[[slug|display]]` → added to scope
- `ai-web-app.md` useChat import → corrected from `ai/react` to `@ai-sdk/react`

**Playbook notes deferred** (low impact, can add later):
- ai-web-app.md duplicating R-015's decision: minor; the playbook is generic, R-015 is specific to this app. Leaving.
- coding-architecture.md Zustand-vs-Store nomenclature footnote: the existing text already clarifies this in multiple places.

Audit `status` updated from `actionable` to `addressed`.

# Audit: Build web app exposing coach chat and wiki

## Overall Assessment

This plan is structurally sound — the four research items are correctly scoped to de-risk the four most variable design choices (browser SQLite, retrieval adaptation, attribution UX, link normalization), and the six experiments are sequenced sensibly (foundation → persistence/wiki → integration). My confidence that executing it as-is produces *a working chat app talking to v5b coach with a navigable wiki view* is moderate (~65%). The main risks are: (1) E-043 ("wire v5b in") is dramatically under-specified relative to the real work — the eval harness contains 100+ lines of glue code between retrieval and the coach call that does not exist in `coach-app/run.ts` and must be replicated; (2) the Repository interface in E-041 contradicts the playbook it claims to follow; (3) several leftover Store references from the un-revised state of the playbook still exist; (4) the corpus size in E-039 is wrong by ~4x, which has cost implications.

## Strengths

The separation of concerns between the four research items and the six experiments is genuinely clean. R-015 (browser SQLite) → E-041, R-016 (retrieval adaptation) → E-043, R-017 (attribution UX) → E-044, R-018 (link normalization) → E-039. Each research item front-loads a decision that materially shapes its dependent experiment. This is the dependency pattern that the project's playbook style explicitly rewards.

The decision to maintain a single ingested copy of `coach/` (rather than two parallel reads from chat tools and wiki view) is correct and well-justified in the goal's decision log. It guarantees attribution-link integrity (the link in a chat message points to the same file the wiki view renders) without runtime resolution shenanigans.

E-039's commitment to a manifest-driven idempotent ingestion is the right shape. The hash-per-source-file with a manifest is the canonical way to make a one-way mirror script safe to re-run.

The goal's exit criteria are concrete and falsifiable: each one specifies an observable behavior (a network request that does not contain X, a refresh that restores Y) rather than gesturing at "works well." The cost-cap exit criterion is genuinely load-bearing — without it, a public-facing deployment could drain the OpenRouter budget in minutes.

The full-fidelity message persistence requirement is correctly framed as non-negotiable in the decision log. The playbook's "stripping tool calls from history" pitfall is one of the most expensive bugs in AI SDK apps; the plan flags it upstream.

The plan correctly defers user accounts to G-011+ — a server-side auth system is a large project on its own and adding it would have ballooned G-010 by 50%.

## Issues

### Critical (must address before execution)

**1. E-043 is dramatically under-specified relative to the actual work.** The hypothesis line "the v5b pipeline can be invoked from the Next.js `/api/chat` route handler" hides substantial integration work that is NOT in `coach-app/run.ts` today. The eval harness is what currently ties retrieval to the coach call — see `eval/lib/conversation.ts:270-352` and `eval/lib/retrieval-adapter.ts:122-181`. That glue does five things: (a) decides whether to retrieve based on `trigger_policy`, (b) builds `recentHistory` from full history, (c) calls `retrieveByGuidedWalk`, (d) prepends `injection` to the user message (NOT to the system message), (e) preserves history with the BARE client message so subsequent turns don't double-pay for prior retrievals. None of this is in `coach-app/run.ts` — that script doesn't call retrieval at all. R-016 mentions adaptation strategy but doesn't enumerate this glue. Without explicit acknowledgement, the E-043 author will discover all of this mid-experiment.

Additionally, `coach-app/lib/anthropic-client.ts` calls Anthropic directly through `@ai-sdk/anthropic` with prompt caching markers (`providerOptions.anthropic.cacheControl`). When the web app routes through OpenRouter via `@ai-sdk/openai`, those Anthropic-specific provider options will not work — caching semantics differ across the gateway. E-043 needs to either (a) accept the cache loss (cost implications: v1 prompt is ~3.1K tokens × every turn × every user), (b) figure out OpenRouter's cache passthrough story, or (c) route directly to Anthropic from the web app for cache-eligible calls.

**Fix:** Expand E-043's method section to enumerate the glue items above. Add a step explicitly addressing OpenRouter cache semantics. Consider whether R-016 should be expanded to include "how does OpenRouter handle Anthropic prompt cache_control markers" as an in-scope question.

**2. E-041 is partially updated to the revised playbook but has internal contradictions and stale narrow-method references.** Since the goal's decision-log entry "Coding-architecture playbook revised again: prefer few methods with rich param objects" was added, E-041's interface block at lines 24-36 has been correctly updated to the four-method shape. However:

(a) Line 18 Hypothesis still says: "The Repository/Store split from [[coding-architecture]] keeps the SQLite specifics behind an interface" — there is no Repository/Store split in the current playbook.

(b) Line 42-43 in step 6 still references the OLD narrow methods: "hydrate `useChat` `initialMessages` from `MessageRepository.listByConversation(activeId)`" and "persist to `MessageRepository.appendToConversation`". These methods do not exist in the updated four-method interface. A claiming agent will be confused: do I call `find({ conversationId })` (from step 3) or `listByConversation()` (from step 6)? The narrow-method names probably came from the pre-revision draft and were missed in the update sweep.

(c) Line 58 Blast Radius still creates `app/lib/{repos,stores,types}/` — `stores/` is the architectural-Store directory that the playbook revision dropped.

(d) Line 81 playbook link still reads "Repository + Store applied to chat data" — the Store half should be dropped.

(e) Splitting `ConversationRepository` and `MessageRepository` into two repositories is borderline OK per the playbook (line 230 says either form is valid if "conversation with messages" is the domain shape), but if kept, the framing should be a decision rather than an inherited assumption. Given that the chat UI always handles a conversation with its messages, a single `ConversationRepository` exposing both (with the conversation's `find` returning conversation metadata, and a separate `findMessages`/`appendMessage` pair) is arguably more aligned with the playbook's "one Repository per domain" intent.

**Fix:** Sweep E-041 end-to-end: (a) drop "Repository/Store split" from the hypothesis; (b) update step 6 to use `find({ conversationId })` and `create({ conversationId, message })` per the interfaces in step 3; (c) drop `stores/` from blast radius; (d) update the playbook link text; (e) revisit whether to collapse Conversation and Message into one Repository or document explicitly why two is right.

**3. The coach corpus size in E-039 is wrong by ~4x.** E-039 says "full `coach/` (~470 files)" — actual count is **1,856 markdown files** across the 14 category directories (excluding `checkpoints/` and `bin/`). Even excluding sub-categories beyond the standard 14, the count is 1,856. R-014 itself reports "~1,059 files" as of its writing on 2026-05-22, and `_absorb_log.json` shows G-007 absorption is still active (the file count grows daily).

This matters because:
- Runtime estimates ("under 500ms" in E-042) and ingestion runtime assumptions may be off
- The integrity-check report "at least 95% of internal links resolve" — with thousands of files, even 1% broken links is 100+ broken links; need a clearer target
- The test ramp (3 → 30 → full) jumps from 30 to nearly 2000, not 30 to 470
- The `_index.md` that the seed-detector reads is ~684 lines today and growing; web-app cache implications

**Fix:** Correct E-039's file count, ideally by parameterizing it ("the count `find coach -name '*.md' | wc -l` returns at this writing"). Add a step to verify the actual count at experiment start, since G-007 absorption continues. Reconsider whether 95% link resolution target is right given R-014's documented gap (207 files without `related:` plus many body-wikilinks that are dangling — the broken-link count is likely substantial).

**4. Leftover architectural-Store references after the playbook revision.** The user revised `coding-architecture.md` to drop the Store concept, but the following files still contain architectural-Store references (distinct from Zustand's lowercase "store" library term, which is fine):

- `R-015.md` line 23: "The Repository/Store API for chat persistence is shaped by this choice"
- `E-040.md` line 71: playbook link reads "set up the repository/store conventions"
- `E-041.md` line 18: "The Repository/Store split from [[coding-architecture]] keeps the SQLite specifics"
- `E-041.md` line 58: blast radius says "Adds `web-app/app/lib/{repos,stores,types}/`"
- `E-041.md` line 81: playbook link reads "Repository + Store applied to chat data"

(R-015 line 19 — "for use inside React components and Zustand stores" — is fine, lowercase library term.)

These are direct contradictions of the revised playbook ("dropped the separate Store concept"). An agent claiming E-040 or E-041 in good faith will set up a `stores/` directory and a Store abstraction layer based on the experiment text — the very thing the user explicitly said not to do. E-041 in particular has the contradiction internally: its interfaces follow the new four-method shape but its other sections still talk about a Repository/Store split.

**Fix:** Sweep R-015, E-040, E-041 to remove the architectural-Store references. Replace "Repository/Store split" with "Repository pattern" or "Repository + reactive layer." Replace `lib/{repos,stores,types}/` with `lib/{repos,types}/` plus an optional `lib/state/` for the thin Zustand reactive hooks (which is consistent with E-044's `lib/state/resource-modal-state.ts`).

### Important (should address, may not block)

**5. The "modify one file, then re-running produces exactly one file write" success criterion in E-039 ignores cascading regenerations.** When you change a `coach/` file, its outputs change too — the manifest entry, possibly the `_index.md`, possibly `_backlinks.json` (which are generated by `coach/bin/rebuild-index.sh`). The ingestion script needs to decide whether it regenerates the index and backlinks itself, or copies the already-regenerated versions. If a `coach/` file changed but `coach/_index.md` was not re-run, the web app's index would be stale.

**Fix:** Decide whether E-039 invokes the existing `coach/bin/rebuild-index.sh` as part of ingestion (preferable: single source of truth), OR documents that the user must run `rebuild-index.sh` before `bun run ingest`. Add this to E-039's method. Adjust the "one file change → one file write" criterion to "one file change → that file plus updated index/backlinks."

**6. The "user-local content" safety promise in E-039 is hand-wavy.** Blast Radius says "If `web-app/content/wiki/` already exists with non-mirrored files, the script preserves them but warns." But the script ALSO needs to handle: (a) a file that was previously mirrored from `coach/` and was then user-edited in the web app (re-mirror would clobber the user edit, or preserve and diverge from source — neither obvious), (b) a file that was removed from `coach/` but might have been deliberately retained in web-app for some reason, (c) a name collision between a user-created file and a newly-absorbed `coach/` file.

For the chat-and-wiki use case described, **none of (a)/(b)/(c) actually happen** because the wiki is read-only from the web-app's perspective — there's no user editing of wiki content in scope. But the experiment's "preserves user-local content" language implies a use case that does not exist in v1. Better to say "no user editing of `web-app/content/wiki/` is supported; the script overwrites in place; user-edited content is destroyed without warning."

**Fix:** Tighten E-039's blast-radius language. Either commit to "this directory is owned by the ingestion script; do not edit by hand" (preferred, matches actual G-010 scope) or implement the preservation logic explicitly with conflict resolution rules (overkill for v1).

**7. The Next.js catch-all route syntax is inconsistent / probably incorrect.** E-042 line 30 and line 49 specify `app/wiki/[[...slug]]/page.tsx` — that's Next.js's **optional** catch-all syntax (double brackets), which matches `/wiki` AND `/wiki/concepts/limiting-belief`. E-042 line 31 explicitly handles both cases (empty slug → index). This is technically correct but worth confirming the author intended the optional form. The bigger issue is that E-044 line 51 references `app/@modal/(...)/page.tsx` — `@modal` is Next.js parallel-route syntax, but `(...)` is intercepting-route syntax. The combination probably should be `app/@modal/(.)wiki/[...slug]/page.tsx` or similar. R-017 is supposed to decide this; the experiment text presents partial syntax as if it were the answer.

**Fix:** Mark the routing path in E-044 as TBD-pending-R-017. Otherwise the E-044 implementer copies the path verbatim and ends up with a broken route.

**8. No experiment validates that the v5b coach inside Next.js produces equivalent output to the v5b coach in `coach-app/`.** The risk: subtle environmental differences (Next.js's worker model, OpenRouter vs direct Anthropic, prompt-cache hit/miss patterns, error handling) could cause the in-app coach to behave noticeably differently from the eval-evaluated coach. The goal claims to expose "the v5b coach" but provides no equivalence test.

Without it, what does the user actually have at the end of G-010? A coach that *looks like* v5b but is unevaluated in its new environment. The eval scorecard from G-009 no longer warrants quality after the integration.

**Fix:** Add a step to E-043 (or a small new E-045 verification experiment) that re-runs at minimum the safety-pressure-test profiles from E-024/E-031 against the web app's chat endpoint and confirms scores within ±0.1 of v5b's known performance. Without this, "v5b coach" in the goal description is aspirational.

**9. The cost-cap on the route handler is hand-waved with "per-IP or per-conversation budget."** Per-IP is trivially defeated (and breaks for users behind a NAT). Per-conversation requires conversation IDs to be authenticated (otherwise a client just rotates IDs). With no auth (per goal decision), neither approach reliably bounds spend. A more honest approach: a global hourly OpenRouter spend cap as a circuit breaker, plus per-conversation rate-limiting that degrades to "this conversation is rate-limited; try again in N seconds." This is a defense-in-depth posture that fits a no-auth v1.

**Fix:** Replace the "per-IP or per-conversation budget" in E-043 with a specific, implementable rate-limit + global circuit-breaker spec. Add as an exit-criterion that the chosen mechanism is tested via a simulated burst (which IS in E-043's success criteria — good — but the spec for the mechanism should match).

**10. R-016 does not address how retrieval telemetry flows through the AI SDK message stream.** R-016 mentions it ("Map G-009's per-turn retrieval telemetry to AI SDK message parts") but the per-message resource attribution UX in R-017 + E-044 depends on this answer existing in the message itself, persisted through E-041's SQLite layer. There's a subtle dependency: AI SDK message parts have a typed schema, and custom annotation requires AI SDK v5+'s data-stream protocol or a custom message-part type. If R-016 punts on this question, E-041 (the SQLite layer) cannot validate that its persistence handles the metadata, and E-044 (modal) cannot render what isn't there.

**Fix:** Make R-016 explicit that "AI SDK message annotation / data-part mechanism for retrieval telemetry" is a MUST-answer question, with a recommended approach documented. Without it, E-041 and E-044 both go in blind on the metadata shape.

**11. The full-fidelity persistence claim is undertested by E-041's success criteria.** Success criterion: "A message with tool calls (manually crafted or from E-043 once wired) round-trips through SQLite without loss." But "without loss" is checked subjectively. The real test is byte-equality of `JSON.stringify(msg)` before-persist and after-rehydrate (or structural equality of the `UIMessage` type). A "looks right" check will accept silent drops of fields the renderer doesn't yet display but that downstream turns need (the playbook's pitfall #1).

**Fix:** Tighten E-041's success criterion to: "A persisted UIMessage with at least one tool call and one tool result, when rehydrated and re-serialized, produces a byte-equal JSON payload."

### Minor (consider addressing)

**12. The single-file E-040 mixes Repository setup with chat scaffolding.** The "set up the repository/store conventions even at the minimal stage" instruction in E-040's playbook link is vague — at the minimal stage there's nothing to be a Repository for (no persistence yet). Suggest deferring all Repository-pattern setup to E-041 and keeping E-040 minimal (just the chat path).

**13. E-039's manifest filename `.ingest-manifest.json` will appear as a hidden file. Worth specifying that the ingestion script skips it during integrity check so it doesn't try to validate links in the manifest.

**14. E-042's render-time wikilink resolution requires a slug→file index. The experiment says "resolves wikilinks at render time" but doesn't say what data structure. If it's a per-render filesystem walk it'll be slow; should be an in-memory `Map<slug, filepath>` built once. Worth mentioning explicitly.

**15. R-018 should commit to explicitly handling the `[[slug|display text]]` aliased-wikilink format I found in samples (e.g., `[[humility-vs-disempowerment|disempowerment / making yourself small]]`) — these are Obsidian's pipe-display syntax. R-018's scope mentions Obsidian-style links but doesn't enumerate this specific variant.

**16. R-016's "single Next.js artifact" deployment constraint is asserted but unjustified.** Vercel and similar platforms support multi-package monorepos cleanly; depending on the chosen adaptation strategy, the "single artifact" framing may itself be a constraint to push back on rather than a given.

## Playbook awareness

Both playbooks are referenced throughout the experiment set, which is good. The actual following of guidance is mixed:

- E-042 correctly uses the `find` four-method shape and references the playbook.
- E-041 ignores the four-method shape AND the "one Repository per domain" guidance (see issue #2).
- E-040's quality-checklist points (no key in client bundle, no system prompt in client) match the ai-web-app playbook's checklist.
- The cost-cap requirement from ai-web-app's pitfalls section IS reflected as an exit criterion, but its spec is under-developed (see issue #9).
- The "stripping tool calls from history" pitfall is correctly internalized as the persistence-fidelity requirement.
- No experiment uses `/claude-api` skill even though the prompt-caching question for the route handler (see issue #1) is exactly in scope.

## On the playbooks themselves

Per the task's request to also review the two playbooks:

**ai-web-app.md is clean and internally consistent.** Tight, opinionated, calls out the specific things that go wrong. Two minor notes:
- Line 104 says "wa-sqlite + OPFS for true SQLite, or sql.js for simpler cases" — this duplicates R-015's whole point. Either trust R-015 to make the decision (drop the recommendation from the playbook) or anchor R-015 to this default (the playbook recommends X; R-015 confirms or overrides).
- The `useChat` example imports from `ai/react` but recent AI SDK versions have moved to `@ai-sdk/react`. Worth a version footnote (since the playbook acknowledges AI SDK evolves quickly).

**coding-architecture.md is now well-revised** post the Store removal. One inconsistency: line 159 says "Components use `useSyncExternalStore` to subscribe" — `useSyncExternalStore` is a React hook, fine as named, but pattern #2 description refers to a "Zustand store" — again the lowercase library term, which is fine but could be flagged in the doc that "store" appearing here means Zustand's library term, not the deleted architectural primitive. A short footnote at the Store-deletion paragraph (line 70) would prevent future readers from confusing the two.

The two playbooks fit together well: `ai-web-app` covers the stack and `coding-architecture` covers code organization. The cross-links between them are bidirectional and accurate. A reader picking up either one is directed to the other when relevant.

## Recommended Changes

In priority order, these are the concrete work items for a follow-up `wiki-next` pass:

1. **Expand E-043's method to enumerate the actual coach-app→web-app integration glue** (retrieval-trigger logic, injection placement, history preservation, OpenRouter prompt-cache semantics). Expand R-016's scope to require an answer on OpenRouter cache compatibility.

2. **Finish the partial revision of E-041.** Interfaces in step 3 are correct (four-method shape). Drop "Repository/Store split" from hypothesis. Rewrite step 6 to use the new methods (`find({ conversationId })`, `create({ conversationId, message })`) instead of stale `listByConversation/appendToConversation`. Drop `stores/` from blast radius. Update playbook link text. Decide explicitly whether Conversation and Message stay split or collapse to one Repository.

3. **Sweep R-015, E-040, E-041 for leftover architectural-Store references and remove them.** Distinguish in the doc between the dropped architectural primitive and Zustand's library term.

4. **Correct E-039's file-count assumption from ~470 to current actuals (~1,856).** Parameterize the count so it's not stale on next read. Adjust runtime estimates and integrity-check thresholds accordingly. Decide and document whether the ingestion script invokes `coach/bin/rebuild-index.sh` itself or assumes it's already been run.

5. **Add either a step in E-043 or a new small E-045 to verify the web-app coach produces equivalent behavior to the v5b coach** measured by G-008. Without this, "v5b coach" in the goal description is unverified after integration.

6. **Tighten E-041's full-fidelity success criterion** to byte-equality of round-tripped UIMessage JSON, not subjective "without loss."

7. **Tighten the cost-cap spec in E-043** to a concrete rate-limit + global circuit-breaker mechanism that works without auth.

8. **Mark E-044's routing-file path as TBD pending R-017.** Don't pre-commit to `@modal/(...)/page.tsx` syntax that may be wrong.

9. **Make R-016 explicit about the AI SDK message-annotation mechanism** for retrieval telemetry as a MUST-answer question.

10. **Tighten E-039's "preserves user-local content" promise** to "this directory is owned by the ingestion script; user-edited files in the mirrored tree are overwritten without warning" (since no editing is in scope for v1).

11. **Add a footnote to coding-architecture.md** distinguishing the dropped architectural-Store primitive from Zustand's "store" library term, to prevent reader confusion.

12. **R-018 should commit to handling `[[slug|display text]]` Obsidian alias-link syntax** explicitly — these exist in the corpus.

13. **Minor:** E-040 should not set up Repository conventions until E-041 needs them. Drop that line.

14. **Minor:** E-042 should explicitly call out an in-memory `Map<slug, filepath>` for wikilink resolution rather than per-render filesystem walks.
