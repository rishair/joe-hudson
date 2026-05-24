---
type: audit
goal: G-013
date: 2026-05-24
status: addressed
---

# Audit: Project status dashboard at status.play.ris.hair

## Overall Assessment

The plan is structurally sound for a v1 dashboard and well-aligned with the user's explicit "doesn't have to be complex to start" directive. Confidence that executing as-is produces a useful dashboard is moderate-to-high (~70%). The main risks are: (1) R-020 is a near-empty stub that forces an early stack decision without articulating the actual evaluation criteria — and its framing already nudges toward "Next.js per playbook vs simpler Bun-HTTP," omitting other valid options; (2) E-050's auto-refresh choice (`<meta http-equiv="refresh">`) is a known UX foot-gun that breaks scroll/focus and will undermine "glance-friendly"; (3) coverage gaps around the user's most-asked question — "what's the agent currently doing right now" — are tacitly punted to nice-to-haves when minimal signal would be cheap to add; (4) cross-goal dependency wiring between E-051 / E-049 has them depending on each other in a way that's correct in spirit but could create a deadlock if either tries to claim both.

## Strengths

- **Outcome statement is unambiguous and grounded in literal user words.** The "what's going on right now without me having to ask Claude" framing keeps the experiment honest. The plan resists feature creep by explicitly tagging drill-downs, spend tally, and "what the agent is doing" as nice-to-haves.
- **The dogfood framing is genuinely useful.** Tying G-013 to G-012 as the first PaaS consumer makes both goals concrete. The "if G-013 fights G-012, G-012 fixes the friction" line in the goal context is the right contract.
- **Scope discipline.** Four sections is the right number for a v1, and the goal correctly forbids a database, external API calls, and chrome (nav menus, theme pickers). Information density over polish matches "phone glance."
- **Reuse signal is captured.** The note about reusing E-042's `<WikiRenderer>` if Next.js is chosen, and shelling to `./wiki.sh next` / `./wiki.sh stale` for wiki-state, avoids re-implementing already-working logic.
- **Exit criteria are mostly testable.** Cloudflare Access verification ("incognito hits SSO, not the dashboard") and the 1s load target are concrete enough to falsify.

## Issues

### Critical (must address before execution)

1. **R-020 is a stub with leading framing.** The current title — "Next.js per playbook vs simpler Bun-HTTP for a 4-section read-only view" — frames the decision as a binary, and the body is all placeholder text. As written, it forces the executing agent to invent the evaluation criteria on the fly, which usually means picking whichever stack is easier to scaffold. The user's question to you mentions Astro and Hono as live options; neither is in R-020's framing. Why this matters: for a 4-section, server-rendered, no-client-state dashboard, the actual real options are arguably (a) plain HTML over Bun.serve, (b) Astro (purpose-built for this exact use case — content-heavy, mostly-static, light interactivity), (c) Hono on Bun (a hair more structure than raw Bun.serve, much less than Next.js), and (d) Next.js (only worth its weight if `<WikiRenderer>` reuse is genuinely needed in v1). **Fix:** rewrite R-020 with (1) explicit evaluation criteria — bundle size at runtime, cold-start latency, ergonomics for shelling out + rendering markdown, dev-loop friction, deployment story under G-012's systemd unit; (2) at least 4 candidates including Astro; (3) the "Why this matters" and "Constraints and scope" sections actually filled in.

2. **Auto-refresh strategy is wrong for the stated UX.** `<meta http-equiv="refresh" content="30">` causes a full page reload every 30s. On a glance-from-phone dashboard, this means: lost scroll position, lost expanded-commit-diff state, lost expanded-checkpoint-body state, browser flicker, and broken back button. E-050 explicitly mentions "click to expand" for commits and checkpoints — meta-refresh destroys that interaction the moment the user opens anything. **Fix:** E-050's method step 8 should change to either (a) `fetch`-based polling of a `/api/state` JSON endpoint with client-side render of the changed sections — even with no framework, a 30-line script can do this — or (b) SSE if the server stack supports it cleanly. A "Last refreshed: 12s ago — refresh now" manual indicator is also a fine v1, since the user is the only consumer.

3. **Coverage gap: "what is the main agent doing right now" is the most natural question this dashboard should answer, and it's silently punted.** The nice-to-haves list this with "probably not feasible without writing logs the dashboard can read" — but the wiki system already has cheap signal: `claimed_by` and `claimed_at` on research/experiment frontmatter, plus the most-recently-modified files in `meta/wiki/`. The strategic checkpoint from 2026-05-24 explicitly tracks "In flight" by inspecting these fields. The must-have list mentions "in-flight items with claim age and the claiming agent" — but that's wiki-agent activity, not "what is the main session doing." **Fix:** either (a) elevate "most-recently-modified file under repo root in the last 5 min, with a one-line preview of what changed" from nothing to a must-have — that's a strong proxy for "agent is working on X right now" — or (b) explicitly write a one-liner in the goal: "main-session activity is intentionally out of scope for v1; the in-flight wiki claims plus recent commits are the surrogate signal." Right now the punt is invisible.

### Important (should address, may not block)

1. **E-051 / E-049 circular-feeling dependency.** E-051 depends on E-050 + (implicitly) E-048. E-049 depends on E-048 + E-051. The agent claiming E-051 needs to know G-012's `paas` CLI exists and have permission to invoke it. The agent claiming E-049 needs E-051 done. These are correctly ordered but the deps aren't fully transitive in the frontmatter: E-051's `depends_on: E-050` is missing E-048 (paas CLI must exist before E-051 can use it). **Fix:** update E-051's `depends_on` to `E-050, E-048` (or note in the body that the deploy step assumes E-048 done and `paas register` is callable). Without this, an agent could pick up E-051 the moment E-050 finishes, before the paas CLI exists, and get stuck.

2. **Reading the project filesystem from a separate `status-dashboard/` directory raises path-resolution questions.** E-050 puts the dashboard at `/home/claude/joe-hudson/status-dashboard/` and configures `WIKI_ROOT=/home/claude/joe-hudson` via env var. That works, but: (a) is the dashboard inside the same git repo or a sibling? The blast-radius says "adds `/home/claude/joe-hudson/status-dashboard/`" suggesting in-repo, which means the dashboard is a project inside the project it reports on — risk of recursion (dashboard's own commits clutter "recent commits" section). (b) When systemd runs `bun run start` as user `claude`, does `WikiRoot` need to be canonicalized? (c) Does `./wiki.sh` need to be invoked from the project root or can it be called from elsewhere? The script uses `cd "$SCRIPT_DIR"` at the top, so it self-locates — good. But the dashboard server shelling to `./wiki.sh next` from inside `status-dashboard/` will fail unless it `cd`s first or uses an absolute path. **Fix:** E-050 method should specify (a) where the dashboard lives (in-repo vs sibling), (b) how it invokes wiki.sh (recommend absolute path: `${WIKI_ROOT}/wiki.sh next`), and (c) whether the dashboard's own commits get filtered out of the recent-commits section.

3. **Permission concerns under systemd user units.** Per G-012's design, the dashboard runs as a systemd user service (`systemctl --user`). The directory is owned by uid 1000 (claude) with 775 perms. The git history reads via shelling out require `git` access to `.git/` — fine. The wiki.sh script writes lockfiles to `meta/wiki/.locks/` — the dashboard only needs to invoke read-only commands (`next`, `stale`, `status`), but `next` may want to take a lock. **Fix:** E-050 should specify "only invoke read-only wiki.sh subcommands; if `next` mutates state under any condition, parse the wiki frontmatter directly instead." Or, more elegant: build the wiki-state section by reading frontmatter from `meta/wiki/{research,experiments,goals,requests}/*.md` directly, not by shelling to wiki.sh. That sidesteps lock contention and is faster.

4. **Open user requests must-have isn't grounded in the actual `requests/` directory.** The must-have says "Open user requests (REQ-XXX with `status: pending`)." Inspecting the repo: `meta/wiki/requests/REQ-001.md`, REQ-002, REQ-003 exist. The user's framing of "what's going on right now" should absolutely include REQs blocking on the user (vibe-check, DNS confirmation, etc. — these are the highest-leverage things the user can act on from the dashboard). **Fix:** make the requests panel a more prominent visual treatment — these are "blocked on YOU" items, distinct from in-flight wiki items which are "blocked on an agent." A subtle "3 things waiting for you" callout at the top would dramatically improve the dashboard's "should I do something" value.

5. **No "last cron checkpoint" / "next cron checkpoint" timing.** The cron-based checkpoint system fires on a schedule (the recent checkpoint mentions ":07 of the next hour"). For a status dashboard, "when did the autonomous loop last tick, and when does it next tick" is high-signal — it tells the user whether the project is actively being worked or idle. **Fix:** add to must-haves or just to the checkpoint section: surface `mtime` of the most recent checkpoint file and (if discoverable from cron config or a known env var) the next scheduled fire.

### Minor (consider addressing)

1. **Goal title is long.** "Project status dashboard at status.play.ris.hair: live wiki state, recent file changes, checkpoints" — 100+ chars. Fine, but inconsistent with shorter goal titles (G-012's is similarly long; both could be trimmed). Cosmetic.

2. **The Resources section says "Already-installed: Next.js scaffold patterns from E-040, the `<WikiRenderer>` from E-042 could be reused."** This subtly biases R-020 toward Next.js by listing reuse benefits without listing the simpler-stack alternatives. If R-020 picks Astro or Bun-HTTP, neither of these are reused. Either remove this hint from Resources (let R-020 decide unbiased) or balance it with "alternatively, a plain HTML server reads markdown directly with no framework."

3. **No explicit "what to do when filesystem reads fail" criterion.** If `meta/wiki/backlog/index.md` is mid-regeneration (the rebuild-index script writes it), or `git` is locked by another process, the dashboard should render a clear "data temporarily unavailable" state rather than crash. Worth one line in success criteria.

4. **The 1s load target is plausible but unverified.** Filesystem reads + `git log -n 20` + 20 commit-stat lookups + parsing N checkpoint frontmatters + reading backlog index — at scale (the repo has 50+ research/experiment files, 6+ checkpoints), this could approach a few hundred ms. Worth noting in E-050 that timing should be measured against the actual repo, not a fresh empty one.

5. **No mention of how the dashboard handles long-running operations.** What if `git show <hash>` for an expanded diff takes 2s for a large commit? Worth a one-liner that diff fetches are async/streaming and the page doesn't block.

## Recommended Changes

Prioritized list of concrete revisions:

1. **Rewrite R-020 from a stub to a real research item.** Title to something like: "Status dashboard stack choice for a 4-section, server-rendered, filesystem-reading view." Fill in "Why this matters" (decides E-050's whole project layout, affects G-012 deployment story, affects whether E-042's WikiRenderer can be reused). Fill in "Constraints and scope" (deploy via systemd user unit + cloudflared, no DB, no client state lib, must shell out to git/wiki.sh, single port, must support markdown rendering for checkpoint bodies). Enumerate at least 4 candidates: plain Bun.serve + HTML templates, Hono on Bun, Astro, Next.js. Add explicit evaluation criteria (cold start, dev loop, deployment artifact size, markdown-rendering ergonomics, reuse story).

2. **Change E-050 method step 8 (auto-refresh) from meta-refresh to fetch-polling.** Concrete spec: server exposes `/api/state` returning JSON of all 4 sections; client polls every 20-30s and replaces the relevant DOM regions. Expanded states (commit diffs, checkpoint bodies) preserved across polls. Last-refreshed timestamp visible. Add manual "Refresh now" button.

3. **Elevate "in-flight" signal to be unambiguous.** Either add to must-haves: "Recent activity panel: list of files under `meta/wiki/` modified in the last 15 minutes, with a one-line preview" — OR explicitly document the punt: "Main-session agent activity not visible in v1; the in-flight claims + recent commits + recent wiki edits are the proxy."

4. **Fix E-051 `depends_on` to include E-048.** Either via the frontmatter `depends_on: E-050, E-048` or via an explicit precondition in step 1 of the method ("Confirm E-048 is complete and `paas` is on $PATH").

5. **Specify dashboard project location and wiki.sh invocation in E-050.** Add to method: where does `status-dashboard/` live (in-repo recommended for simplicity), how does it filter its own commits out of the "recent commits" view if in-repo, and how it invokes wiki.sh (recommend reading frontmatter directly instead of shelling to wiki.sh, to avoid lock contention and improve speed).

6. **Add a "requests waiting for user" callout to the must-haves.** Either as its own section or as a visually-prominent block of the wiki-state section. The user explicitly cares about "what should I do" and pending REQs are the answer.

7. **Add "most recent checkpoint mtime + next cron fire if discoverable" to the checkpoints section.** One line of code, high signal.

8. **Add to E-050 success criteria: graceful degradation on transient filesystem/git errors.** Explicit failure-mode rendering, no whitescreens.

9. **De-bias the Resources section in G-013.** Remove or balance the Next.js / WikiRenderer reuse hint so R-020 evaluates options fairly.

10. **Add to E-050 blast radius: the dashboard process reads but never writes to the project filesystem.** Already implied; making it explicit prevents an agent from "helpfully" adding a write feature in v1.

## Resolution (2026-05-24)

Addressed by wiki-next agent in the same pass that completed [[R-020]]. Changes:

**R-020 (recommendation 1):** Rewritten from a stub to a complete research item with 4 candidates (plain Bun.serve, Hono on Bun, Astro, Next.js), explicit evaluation criteria (bundle size, cold-start, ergonomics, dev-loop friction, deployment story under G-012's systemd), and a decisive recommendation: **Hono + Bun + `hono/jsx`**. Rationale: only candidate that satisfies four properties simultaneously (no build step, type-safe JSX templating, tiny memory footprint, zero client JS for v1). Bun is already the project's script runtime so no new runtime requirement. Boundary conditions documented for when to revisit (streaming LLM responses, optimistic UI, multi-user, real-time push).

**E-050 (recommendations 2, 5, 8, 10 + general method rewrite):** Method section rewritten end-to-end for the Hono+JSX stack. Specifically:
- Step 8 (auto-refresh) changed from `<meta http-equiv="refresh">` to fetch-polling of `/api/state` with DOM-region replacement. Expanded `<details>` states preserved across polls via per-section HTML diffing on the client side. Manual "Refresh now" button + visible "Last refreshed Ns ago" indicator. Meta-refresh is explicitly forbidden.
- Dashboard project location specified as in-repo at `/home/claude/joe-hudson/status-dashboard/`. Own-commits filtering documented via two layers: path filter (`--diff-filter` excluding `status-dashboard/`-only commits) plus subject filter (`dash:` prefix convention with `--invert-grep`).
- Wiki state reads switched from `./wiki.sh` shell-out to direct frontmatter parsing (gray-matter on `meta/wiki/{goals,research,experiments,requests}/*.md`) to avoid lock contention with wiki-next agents and improve speed.
- Graceful degradation section added: per-section try/catch with "data temporarily unavailable" fallbacks. One section failing does not cascade.
- Long-running diff fetches (`git show <hash>`) are async via the click-to-expand pattern; large diffs truncate with a "full diff via `git show` locally" notice.
- Blast Radius made explicit: process reads but never writes to project filesystem.

**E-051 (recommendation 4):** Frontmatter `depends_on: E-050, E-048` (was `E-050` alone). Method step 1 references the new dependency explicitly. Method step 3's `command:` corrected from `bun run start` to `bun run server.tsx` to match E-050's entrypoint.

**G-013 (recommendations 3, 6, 7, 9 + Decision Log entries):**
- Outcome paragraph updated to reflect Hono+Bun+JSX stack.
- Must-haves restructured: "Pending-on-you callout" added as a top-of-page section with distinct visual treatment ("blocked on YOU" vs "blocked on an agent"). "Recent agent activity" added as a must-have proxy signal for "what is the main session doing" (lists `meta/wiki/` files modified in last 15min with title preview). "Most-recent checkpoint mtime" added to the checkpoints section as a high-signal "is the autonomous loop ticking" indicator.
- Auto-refresh must-have rewritten to specify fetch-polling against `/api/state`, DOM-region replacement, expanded-state preservation, manual "Refresh now" button, and visible "Last refreshed" timestamp. Full meta-refresh explicitly forbidden.
- Graceful degradation added as a must-have.
- Nice-to-haves: "What's the agent currently doing" removed (now a must-have via recent-agent-activity proxy). Added SSE push as a deferred alternative to polling.
- Exit Criteria expanded: new must-haves have testable conditions (pending-on-you renders with current REQs + empty state; recent activity panel populates; dashboard's own commits filter out; checkpoint mtime visible; graceful-degradation verified by deliberate broken read).
- Resources section de-biased: removed "Next.js scaffold patterns from E-040, the `<WikiRenderer>` from E-042 could be reused" hint that nudged toward Next.js. Replaced with Hono+Bun+JSX context note acknowledging that React/Next-specific code from G-010 is not directly reusable but link-parsing logic could be ported.
- Decision Log: two new entries — one documenting R-020's stack pick with rationale, one documenting this audit-addressing pass and the specific changes made.

**Recommendations deferred / not addressed in this pass:**
- Minor item #1 (goal title length, cosmetic) — title left as-is; matches G-012's verbosity convention.
- Minor item #4 (1s load target unverified) — now addressed in exit criteria: "timing measured against the actual repo, not a fresh empty one."
- Minor item #5 (long-running operations handling) — addressed in E-050 method: diff fetches are async via the `<details>`-open pattern; large diffs truncate.

All Critical and Important recommendations either addressed or explicitly deferred-with-reason. No silent ignores.
