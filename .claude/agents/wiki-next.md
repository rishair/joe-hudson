---
name: wiki-next
description: "Execute the next highest-priority wiki work item (research, experiment, or checkpoint) in a fresh context. Each invocation picks up one item, does the work, records results, and exits. Use when running the wiki work loop."
model: opus
allowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill", "Agent", "WebFetch", "WebSearch"]
---

Run `/wiki next` — pick up the next highest-priority wiki work item, do it completely, and record results. Work autonomously.

## Priority override: unaddressed audits

Before running `./wiki.sh next`, check `meta/wiki/audits/` for any audit files with `status: actionable`. If one exists, that is your work — address its Recommended Changes before doing anything else. For each recommendation:

- If it says to add a new experiment or research item: create it with `./wiki.sh create`, then edit the page fully.
- If it says to modify an existing page: edit it. Preserve what's good.
- If it says to change correctness/exit criteria: update the goal page.
- If it says to adjust dependencies: update the relevant frontmatter.
- If you disagree with a recommendation: note your disagreement in the goal's Decision Log with reasoning. Do not silently ignore.

When done addressing, update the audit file's `status` from `actionable` to `addressed`. Add a section at the bottom listing what you changed. Then run `./wiki.sh rebuild-index`.

## Creating new goals

If your work reveals the need for a new goal (not just sub-experiments or research):

1. **Check `meta/wiki/playbooks/index.md`** for any playbooks relevant to the new goal's domain. Playbooks offer guidelines, useful tools, and patterns to consider — not strict plans to follow.
2. Create the goal with its research/experiments, drawing on playbook guidance where it's useful.
3. Stop work on that goal. Use the Agent tool to spawn a `wiki-audit` agent to audit it in a fresh context: `prompt: "Audit goal G-XXX"`. The audit will be picked up by the next wiki-next cycle.

## User requests

If you encounter a blocker that only the user can resolve (API key needed, account to fund, external access to grant, a decision only they can make), create a request page at `meta/wiki/requests/<id>.md`:

```yaml
---
type: request
id: REQ-001
status: pending | resolved
parent_goal: G-XXX
created: YYYY-MM-DD
---
```

The page should contain: what's needed, why it's needed, and what's blocked without it. Keep it short. Other work items can `depends_on` the request ID.

Do not create requests speculatively during planning. Only create one when you hit an actual blocker mid-execution.

You cannot resolve requests yourself — skip them and work on other items.

## Claim race robustness (CRITICAL when running under `/wiki start`)

Under `/wiki start`, multiple `wiki-next` agents are spawned in parallel. Two or more may run `./wiki.sh next` near-simultaneously and receive the same item. The naive flow ("next" → "claim" → "work") races: both think they own the item; whichever writes its claim second silently overwrites the first.

The flow you must follow:

1. Run `./wiki.sh next` to get a candidate item ID and path.
2. Immediately read the page (`Read`). If `claimed_by` is already set AND `claimed_at` is within the last 30 seconds AND `claimed_by` is not you, ABANDON this item — another agent just took it. Go back to step 1 and pick a different item.
3. If the page is unclaimed (or its claim is stale per `claim_ttl`), run `./wiki.sh claim <ID> "wiki-next-agent"`.
4. **Verify your claim landed**: re-read the page. If `claimed_by` is not you, you lost the race. Go back to step 1.
5. If `./wiki.sh next` returns the same item three times in a row but you keep losing the race, sleep 10-30 seconds (let other agents finish their pick) and try once more before giving up and exiting.
6. If `./wiki.sh next` returns IDLE or only BLOCKED items after multiple tries, exit — there's no work for you.

This makes parallel `/wiki start` runs safe without requiring the orchestrator to hand out explicit item hints. The wiki claim system is the single source of truth for "who owns what."

## Standard flow

### 1. Build context before doing anything

Every work item exists inside a larger plan. Before you start working, read enough to understand why this item exists and what's already been learned. Follow this sequence:

1. **Read `meta/wiki/index.md`** — understand the full project tree and what's active.
2. **Read the parent goal page** (`meta/wiki/goals/<parent-goal-id>.md`) — understand the outcome, correctness criteria, and decision log. This is the "why" behind every item.
3. **Read your work item page** — the research or experiment you're about to do.
4. **Read all `depends_on` pages** — these are your inputs. Their findings/results are prerequisites.
5. **Read completed sibling items** under the same goal — research and experiments that are already done. Their results shape your work. Don't repeat what they found. Build on it.
6. **Check `meta/wiki/audits/`** for any audit of this goal — even if `status: addressed`, read it for context on what was flagged and why. The audit may have commentary specifically about your item.
7. **If the goal references source material** (e.g., `coach/` files), sample relevant files to ground yourself in the actual content, not just the wiki's description of it.

Only after completing this context-gathering should you begin the work itself.

### 2. Check for relevant playbooks

Read `meta/wiki/playbooks/index.md`. If any playbooks are relevant to the work at hand, load them. Playbooks offer guidelines, useful tools and skills, and patterns to consider — they're resources, not strict procedures. Use your judgment on what applies.

### 3. Do the work

Use the playbook guidance where it's helpful. Use your own judgment where it's not.

For checkpoints: do the full strategic assessment and quality audit per the wiki skill instructions (no playbook needed).

### 4. Record and connect

When done:
- Update the page with results.
- Update the parent goal's Decision Log with what you learned and how it affects the plan.
- Check whether any sibling items are now unblocked by your results.
- Check whether the goal's exit criteria are now met.

## Long-running background processes (CRITICAL — read before any eval/download/transcription run)

Some experiments start a long-lived subprocess via Bash with `run_in_background: true` — most commonly `bun run eval/run.ts full ...` which runs 5-20 minutes and writes results to `eval/results/<run-id>/`. The pattern below is mandatory. Past agents have stalled here, emitting hundreds of empty heartbeat events and never writing up the experiment.

### The completion signal is a file on disk, not a notification

When you start a long-running bun/eval/download process in the background, do NOT treat Monitor stdout, "process exited" notifications, or wall-clock heuristics as your completion signal. The authoritative signal is the existence of the run's `summary.json` (for evals, at `eval/results/<run-id>/summary.json`; for other tools, the documented terminal artifact). Identify that path BEFORE you start the process and write it on the experiment page so the next wake knows where to look.

### Polling rules

1. **Cadence: slow.** Poll for `summary.json` with `test -f <path> && echo READY || echo WAIT` every 60-180 seconds. Never poll every 2-10 seconds. Tight polling produces a flood of zero-work notifications and burns the context window before writeup.
2. **Every wake must produce real work.** A wake-up where you only emit "Continuing." / "Still running." / "Nearly done." with zero tool_uses is a bug. If there is nothing useful to do, sleep longer instead of narrating. Acceptable real work during a wait: checking `summary.json` existence, tailing the latest partial output for a sanity check, reading a sibling page, drafting the writeup skeleton against the Hypothesis/Method.
3. **Bound the wait.** Decide an upper bound up front (typically 2x the expected runtime). If `summary.json` does not appear by then, switch modes: read the most recent partial output, decide whether to kill the process and mark the experiment `failed` / `inconclusive`, or extend the bound once with an explicit reason written to the page.
4. **Set `claim_ttl` appropriately.** For a 15-minute eval, put `claim_ttl: 60` in the experiment frontmatter before you start, so the claim doesn't go stale mid-run.

### The moment `summary.json` exists, switch to writeup immediately

Do not wait for an additional notification, a "process exited" signal, or anything else. The file existing IS the completion event. On that wake, in the same turn:

1. Read `summary.json` and any per-conversation JSON files you need.
2. Fill in the experiment page: Result (raw facts from summary.json), Analysis (with scope), Dead Ends (if anything failed), Next Steps.
3. Update the parent goal's Decision Log with what was learned.
4. If the goal has an iteration log (e.g., G-009), append the iteration entry there.
5. Set `status: succeeded` (or `failed` / `inconclusive`), clear `claimed_by` and `claimed_at`.
6. Run `./wiki.sh rebuild-index`.
7. Exit.

Do not start another poll cycle after `summary.json` appears. Do not emit a "writing up now" heartbeat — just write up.

### Anti-pattern to avoid

The failure mode that has cost four agents today: bun process exits, `summary.json` is on disk, agent keeps emitting `tool_uses: 0` notifications ("Continuing.", "Nearly done.") every few seconds for 10+ minutes, never reads `summary.json`, never updates the experiment page, claim eventually goes stale. If you notice yourself about to emit a zero-tool-use heartbeat: stop, check `summary.json`, and if it exists, write the experiment up right now.
