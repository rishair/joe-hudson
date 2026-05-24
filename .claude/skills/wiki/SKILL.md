---
name: wiki
description: Research-driven wiki system where goals, experiments, research, and findings all live as interconnected pages. Agents navigate a tree of goals and experiments, claim work, record findings, and checkpoint progress.
argument-hint: "next | status | goal <name> | research <goal-id> | experiment <goal-id> | absorb | query <question> | checkpoint | claim <page> | unclaim <page>"
---

# Research Wiki

You are an agent operating on a shared wiki. The wiki is the single source of truth for goals, research, experiments, findings, and project state. Everything lives here. There is no separate system.

The wiki lives at `meta/wiki/`. The index is `meta/wiki/index.md`. Raw ingested material goes to `meta/raw/`.

## Core Concept: The Goal Tree

Every goal is a wiki page. Every sub-goal is a wiki page. Every experiment is a wiki page. Every piece of research is a wiki page. They form a tree:

```
Goal: "Download and transcribe all Joe Hudson content"
  Sub-goal: "Collect all source media files"
    Research: "How to bulk-download YouTube channels in 2026"
    Experiment: "Use yt-dlp with channel URL to pull full archive"
      Finding: "yt-dlp pulls 80% but misses Patreon-only episodes"
      Sub-experiment: "Scrape Patreon RSS feed for missing episodes"
  Sub-goal: "Transcribe with speaker diarization"
    Research: "Speaker diarization approaches for podcast audio"
    Experiment: "WhisperX for diarization with known speaker names"
      Finding: "Works well for 2-speaker podcasts, degrades at 3+"
      Sub-research: "Alternative diarization for multi-speaker panels"
```

Goals can have sub-goals, which can have their own sub-goals. At any level, a goal can also have research and experiments directly attached to it. This is not a flat task list. It is a living tree where any node can spawn children (sub-goals, sub-research, sub-experiments), and any node can be re-evaluated based on what sibling nodes discovered.

---

## Page Types

### Goal Page

Location: `meta/wiki/goals/<goal-id>.md`

```yaml
---
type: goal
id: <goal-id>
status: active | completed | abandoned
created: YYYY-MM-DD
parent: <parent-goal-id or "root">
---
```

Contains:
- **Outcome**: What "done" looks like, in plain English. Specific on the what, vague on the how.
- **Correctness**: The detailed specification of what a correct output looks like. This is NOT about how to achieve the goal — it's about what the result must be. Written before any work begins. Describes the output format, content, quality bar, and edge cases. Split into **Must-haves** (non-negotiable; the goal is not done without these) and **Nice-to-haves** (improve quality but can be omitted under constraints). Be specific and concrete: "each transcript file contains full text with speaker labels and timestamps at paragraph boundaries" not "good transcripts." This section is the north star for all work under this goal — every experiment, research item, and sub-goal should trace back to delivering on these criteria.
- **Exit Criteria**: A checklist of concrete, verifiable conditions that must all be true for this goal to be marked `completed`. Each item should be testable by an agent (e.g., "file X exists", "count of Y matches Z", "all sub-goals are completed"). Derived from the Must-haves in Correctness.
- **Context**: Why this goal matters. What it unblocks.
- **Sub-goals**: Links to child goal pages. A goal can be broken into sub-goals at any depth. Each sub-goal is its own page with its own research, experiments, and potentially its own sub-goals.
- **Research**: Links to research pages spawned by this goal.
- **Experiments**: Links to experiment pages spawned by this goal. Each with a one-line description and current status.
- **Decision Log**: When you decide to pursue one path over another, write why. When you abandon an approach, write why. This is the most valuable part of the page over time.
- **Resources** (root goal only): What's available to all agents — API keys (by env var name, never the actual value), compute constraints, budget limits, external accounts. This is the single place agents check for "what tools do I have?" List the env var name, what it's for, and any usage constraints (e.g., "$20 budget, prototype first"). Includes a **Resource Requests** sub-section where agents add things they need but don't have (API keys, tools, permissions). A human reviews and provisions these.

The top-level goal is the only immovable goal. Every sub-goal is modifiable, splittable, mergeable, or removable based on what you learn.

### Research Page

Location: `meta/wiki/research/<research-id>.md`

```yaml
---
type: research
id: <research-id>
status: pending | claimed | in-progress | complete
parent_goal: <goal-id>
depends_on: <comma-separated list of page IDs, or empty>
claim_ttl: <minutes before claim goes stale, default 20>
claimed_by: <agent-description or empty>
claimed_at: <ISO timestamp or empty>
created: YYYY-MM-DD
---
```

Contains:
- **Question**: The specific question this research answers.
- **Sources**: What you consulted (URLs, wiki pages, tools used).
- **Findings**: What you learned. Be precise about scope. A finding from a 2-speaker test does NOT generalize to 5-speaker panels. State the conditions under which the finding holds.
- **Implications**: What experiments or further research this suggests.
- **Links**: `[[wikilinks]]` to related pages.

### Experiment Page

Location: `meta/wiki/experiments/<experiment-id>.md`

```yaml
---
type: experiment
id: <experiment-id>
status: pending | claimed | in-progress | succeeded | failed | inconclusive
parent_goal: <goal-id>
parent_experiment: <experiment-id or empty>
depends_on: <comma-separated list of page IDs, or empty>
claim_ttl: <minutes before claim goes stale, default 20>
claimed_by: <agent-description or empty>
claimed_at: <ISO timestamp or empty>
created: YYYY-MM-DD
---
```

Contains:
- **Hypothesis**: What you expect to happen and why.
- **Method**: What you will actually do. Concrete steps. For experiments with side effects (writing files, downloading, modifying existing data), the method MUST start small and scale up. See "Blast Radius" principle below.
- **Blast Radius**: What existing work could this experiment affect? List files, directories, or data that could be modified or overwritten. If the experiment touches things other experiments produced, call that out explicitly.
- **Result**: What actually happened. Raw facts.
- **Analysis**: What this means. Be honest about scope. Did you test on one case or ten? Does this generalize?
- **Dead Ends**: If this failed, what specifically went wrong? What would you try differently? This is critical for other agents.
- **Next Steps**: Sub-experiments or sub-research spawned from this result.
- **Links**: `[[wikilinks]]` to related pages.

### Finding Page

Location: `meta/wiki/findings/<finding-id>.md`

```yaml
---
type: finding
id: <finding-id>
status: provisional | confirmed | refuted
source_experiment: <experiment-id>
created: YYYY-MM-DD
domain: <narrow description of what this applies to>
---
```

Contains:
- **Claim**: One sentence. What you learned.
- **Evidence**: The experiment(s) that support this.
- **Boundary Conditions**: When does this NOT apply? What assumptions does it rest on? This is the most important section. A finding without boundaries is a trap.
- **Links**: `[[wikilinks]]` to related findings, experiments, goals.

### Backlog Page

Location: `meta/wiki/backlog/<backlog-id>.md`

```yaml
---
type: backlog
id: B-<NNN>
status: raw | fleshing-out | promoted | dropped
parent_goal: <G-XXX or "root">
created: YYYY-MM-DD
promoted_to: <ID if promoted to goal/research/experiment, else empty>
---
```

Contains:
- **The idea**: A short pitch in plain English. What is this?
- **Open questions worth fleshing out**: The decisions that would have to be made before this could become a real goal/research/experiment.
- **Why this is backlog (not a current goal)**: Why we're parking it. What would make it ready.
- **Related**: `[[wikilinks]]` to existing pages.

**When to use a Backlog page:** when the user (or you mid-work) raises an idea worth not-losing but not worth working on now. Ideas that need more thought, ideas waiting on something else, ideas that might become a goal later. Examples: product directions to explore after v1 ships; refactors that might pay off; research questions the current goal can't address but a future one might.

**Backlog pages are NOT claimable by agents.** `./wiki.sh next` will not surface them. They are inputs for human grooming — to be re-read at checkpoint time or when conversation needs context, and explicitly promoted to a goal/research/experiment when ripe.

**Promotion**: when a backlog item is ready to become real work, create the new page (`./wiki.sh create goal|research|experiment ...`) and set the backlog's `status: promoted` + `promoted_to: <new-id>`. Don't delete the backlog page; the lineage is valuable.

**Demotion**: if a backlog item turns out to be a non-starter, set `status: dropped` with a one-line note on why. Same anti-deletion: the dropped-with-reason record is useful.

**Triage rhythm**: review the backlog directory during strategic checkpoints. Move things from `raw` → `fleshing-out` as the surrounding work clarifies questions. Promote when ready. Drop when stale.

**Auto-generated index**: `./wiki.sh rebuild-index` writes `meta/wiki/backlog/index.md` from the backlog directory contents — grouped by `parent_goal`, ordered by status (raw → fleshing-out → promoted → dropped). Read that file for a quick survey of what's parked.

---

## Commands

### `/wiki next`

The autonomous work loop command. Run `./wiki.sh next` to determine the highest-priority item, then execute it.

1. Run `./wiki.sh next`. It returns one of:
   - `STALE_CLAIM <type> <id> <path>` -- Re-claim this item and finish it.
   - `CHECKPOINT` -- Run `/wiki checkpoint`.
   - `RESEARCH <id> <goal> <path>` -- Claim this research, do it, record findings.
   - `EXPERIMENT <id> <goal> <path>` -- Claim this experiment, run it, record results.
   - `BLOCKED_RESEARCH <id> <goal> <path>` or `BLOCKED_EXPERIMENT <id> <goal> <path>` -- All unblocked work is done. Before working on this, re-read the goal tree to confirm you're truly blocked — there may be useful work that wasn't surfaced. If genuinely blocked, resolve or remove the dependency. If nothing is useful, it's fine to stop.
   - `IDLE` -- Nothing pending. Read the goal tree, identify gaps, and create new research or experiments.

2. Read the page at the given path. Understand what needs to be done. If the page has `depends_on` entries, read those pages too — their results are your inputs. Also read any completed sibling research or experiments under the same parent goal, so you don't repeat work or miss context.

3. Claim it: `./wiki.sh claim <ID> "wiki-next-agent"`.

4. Do the work. For research: use web search, read wiki pages, consult tools. For experiments: actually run the thing, capture output. Write progress to the page as you go (keeps claim alive).

5. When done, update the page with results, mark status as complete/succeeded/failed, and `./wiki.sh rebuild-index`.

6. If the result opens new questions, create sub-research or sub-experiments with `./wiki.sh create`. Fill them in fully (no placeholders).

7. Update the parent goal's decision log with what you learned and what should be done next.

8. **Check goal completion.** Re-read the parent goal's Exit Criteria. If every criterion is now met, mark the goal as `completed`. If the goal has a parent goal, check that one too — completion can cascade up the tree.

### `/wiki status`

Read `meta/wiki/index.md`. Show:
- **Pending user requests** (from `meta/wiki/requests/`) — show these first, they require human action
- Active goals and their completion state
- How many experiments are pending, in-progress, complete
- How many research items are pending, in-progress, complete
- Any claimed-but-stale items (file not modified in 20+ minutes)
- What was last worked on

### `/wiki goal <name>`

Create a new goal page. If this is the first goal, it becomes root. Otherwise, ask which existing goal it falls under.

Use `./wiki.sh create goal "name" --parent G-XXX --brief "description"` to scaffold the page, then **immediately edit the page** to fill in all sections. A page with placeholder text ("FILL IN") is not done. Every page must contain enough detail that an agent reading only that page can understand what to do and why.

**Before any other work**, fill in the Correctness section. Take the goal as stated and interpret it: what is a reasonable, practical, and high-quality version of this goal? What does the output actually look like? Define must-haves and nice-to-haves. This grounds all future work — every experiment and research item should serve the correctness criteria, not a vague sense of the goal.

After the goal page is complete:
1. **Check `meta/wiki/playbooks/index.md`** for any playbooks relevant to this goal's domain. Playbooks offer guidelines, useful tools, and patterns to consider — not strict plans to follow. Draw on them where helpful.
2. Perform initial research (2-4 research pages) on approaches to this goal
3. Based on that research (and any relevant playbook guidance), propose 3-5 experiments worth trying
4. Rank those experiments by expected impact and feasibility
5. Create pages for each experiment in `pending` status
6. **Spawn a `wiki-audit` agent** to audit the goal in a fresh context: use the Agent tool with `subagent_type: "wiki-audit"` and `prompt: "Audit goal G-XXX"`. The audit findings will be picked up by the next `wiki-next` cycle.

For each research and experiment page created, fill in the full context: the question and why it matters (research), or the hypothesis, method, and success criteria (experiment). Use `--brief` to seed the page, then edit to flesh it out.

### `/wiki research <goal-id>`

Pick the highest-priority pending research item for this goal (or across all goals if no ID given). Claim it with `./wiki.sh claim R-XXX "description of this agent"`, do the research, record findings, and update the goal page with implications.

### `/wiki experiment <goal-id>`

Pick the highest-priority pending experiment for this goal (or across all goals if no ID given). Claim it with `./wiki.sh claim E-XXX "description of this agent"`, run it, record results, and then:
1. Save findings with explicit boundary conditions
2. Create sub-experiments or sub-research if the result opens new questions
3. Go back to the parent goal. Re-read sibling experiments. Decide: what is the next most valuable thing to work on? Update the goal page's decision log with your reasoning.

### `/wiki absorb`

Take material from `meta/raw/` and integrate it into the wiki. For each raw entry:
1. Read the index to find where it connects
2. Update or create the appropriate page
3. Link it to related pages
4. Log it in `meta/wiki/_absorb_log.json`

Raw entries use this format:
```yaml
---
id: <unique identifier>
date: YYYY-MM-DD
time: "HH:MM:SS"
source_type: <description of source>
tags: []
---

<content>
```

### `/wiki query <question>`

Answer questions about the project by navigating the wiki. This is **read-only** -- never modify wiki files during a query.

1. **Read `meta/wiki/index.md`.** Scan for pages relevant to the query. Use the `also:` aliases on each entry to match alternate names.
2. **Check `meta/wiki/_backlinks.json`** to find pages that reference the topic. High backlink counts indicate central topics.
3. **Read 3-8 relevant pages.** Follow `[[wikilinks]]` 2-3 links deep when relevant.
4. **Synthesize.** Lead with the answer. Cite pages by ID and name. Use direct quotes from findings sparingly. Connect dots across pages. Acknowledge gaps.

Rules:
- Never read raw entries (`meta/raw/`). The wiki is the knowledge base.
- Do not guess. If the wiki doesn't cover it, say so and suggest which research page might answer it.
- Do not read the entire wiki. Be surgical.

### `/wiki checkpoint`

The single checkpoint operation. Does **operational** work every time it fires (git commit, agent health, status report) and **strategic** work conditionally (when ≥10 items have completed since the last strategic pass). Triggered automatically by the 30-min cron under `/wiki start`, and callable manually any time.

**Operational pass (every fire):**

1. **Git commit.** `git add -A meta/wiki/ coach/ eval/ coach-app/ web-app/` (limited to known work directories — never `git add .` blindly). `git commit -m "wiki: checkpoint <iso-timestamp>"`. Skip if nothing changed. Never `git push` without explicit user direction.
2. **Agent health survey.** Read all currently-claimed pages' frontmatter. For each claim past its `claim_ttl` with no recent file modification, run `./wiki.sh unclaim <ID>` to free it. Run `./wiki.sh stale` for the canonical list.
3. **Re-survey + fill slots** (only when running under `/wiki start`). If unblocked work exists and in-flight count < max-parallel, spawn `wiki-next` agents to fill open slots.
4. **Status update — both chat AND mobile push.** Use the `PushNotification` tool for mobile; output the same summary to chat. Structure the chat update as TWO blocks:

   **a) Project overview (PM-style, every fire):**
   - **Phase of the project**: which goal is active, what phase of that goal you're in, what % of the goal's exit criteria are met. Example: "G-010 web-app build, Phase 3 of 4, 8/11 exit criteria ticked."
   - **Active goal trajectory**: 1-2 sentence read on momentum. Is the work converging or expanding? Are dependencies clearing? Are there hidden blockers emerging? Example: "Foundation and persistence layers shipped this window. Only the coach pipeline (E-043) and the modal that depends on it (E-044) stand between us and goal close."
   - **All active goals**: one line each with status. Example: "G-007 (compendium) ABSORPTION COMPLETE, awaiting backfill from G-010 audits; G-010 (web app) at 8/11 exit criteria, on critical path."
   - **Up next**: the 1-3 next meaningful unlocks. Example: "When E-043 lands, E-044 unblocks and G-010 closes. After that: REQ-001 (vibe-check) is yours to run."
   - **Open user requests**: items the user must resolve themselves, with what's blocked behind them.
   - **Cumulative spend** if trackable; flag if approaching budget cap.

   **b) Operational details (this checkpoint window):**
   - Items completed since last checkpoint (with names per the Reporting convention)
   - Items in flight (with claim age)
   - Items stuck or unclaimed-stale
   - Anything operationally notable (failed agents, retries, surprises)

   The push notification gets a one-line digest of the project overview, NOT the operational details. Mobile is for "should I look at the laptop" decisions; chat is for the full picture. Example push: "G-010 at 8/11. E-043 (coach pipeline) in flight, 38min/60min TTL. No blockers. Next milestone: goal close on E-043 land."

**Strategic pass (conditional — only when ≥10 items have completed since the last strategic pass):**

5. **Survey**: Read the full index and all active goal pages. Understand the current state of the tree.
6. **Assess progress**: For each active goal, what percentage of the path is understood? What are the biggest unknowns?
7. **Evaluate direction**: Are current experiments converging on the goal, or are we in a rabbit hole? Are there abandoned branches that deserve another look? Are there obvious approaches nobody has tried?
8. **Prune**: Mark stale or irrelevant experiments as abandoned with a note on why.
9. **Replan**: Update goal pages with revised experiment priorities. Create new research or experiments if the checkpoint reveals gaps.

**Quality audit (during strategic pass)** — pick the 3 most-recently-updated pages and ask each:

- Does it tell a coherent story, or is it a chronological dump of events?
- Are sections organized by theme, not by date?
- Would another agent learn something non-obvious from reading it?
- Are findings stated with boundary conditions, or do they over-generalize?
- Is the page bloated (>120 lines) and should be split? Is it a stub (<15 lines) when more material exists?

If any page reads like an event log, rewrite it.

**Anti-cramming check:** How many new pages were created in the last 10 tasks? If zero, you are probably stuffing everything into existing pages. Break sub-topics out.

**Anti-thinning check:** Are there stub pages with <15 lines where 3+ entries reference the topic? Enrich them.

10. **Write a checkpoint summary** at `meta/wiki/checkpoints/YYYY-MM-DD-HHMMSS.md` documenting both strategic assessment and quality audit findings. Only written during a strategic pass, not on operational-only checkpoints.

### `/wiki start [max-parallel] [--auto]`

Run an autonomous **parallel** work loop with periodic `/wiki checkpoint` calls. This is the runner for forward motion — orchestrates up to N parallel `wiki-next` agents from the main session and lets a 30-minute cron handle commits, health, and status. Use it when there's a backlog of unblocked work and you want it ground through.

**Default parallelism**: 3. Override with `/wiki start 5` etc. Save the chosen cap to memory as a feedback item so future sessions default to it.

**Grooming (always — before any agents are spawned):**

`/wiki start` is conversational at kickoff. Do not just dive into spawning.

1. **Clean the lay of the land.** Run `./wiki.sh cleanup-stale` to bulk-unclaim every claim past its TTL. This is the single-command equivalent of looping `unclaim` over `./wiki.sh stale` output. Always do this first — agents shouldn't see leftover claim residue from past completed work.
2. **Project overview (PM-style).** Before listing candidates, give the user the same overview shape that the checkpoint produces: which goal is active and what phase, what was recently shipped, momentum read, all active goals one-line status, what unblocks next, open user requests, cumulative spend. This grounds the kickoff conversation in the project's actual state rather than just dumping a candidate list.
3. **Survey unblocked items.** Read `meta/wiki/index.md` and identify ALL currently-unblocked work — both research AND experiments whose dependencies are satisfied. `./wiki.sh next` returns one item at a time and prefers research; for the candidate list, look broader.
4. **Surface the candidate list to the user (with names per the Reporting convention).** Group by goal, note dependencies between candidates, and call out anything that conflicts with recent conversational decisions (e.g., "the audit said X is the priority, but `next` would pick Y first"). Ask the user to confirm or reorder.
5. **Wait for the user's go-ahead** before spawning. The exception: if the user passed `--auto` (or said something like "just go" in the same turn), skip the wait and use the default candidate order.

Why: `./wiki.sh next` is mechanical (research before experiments, then dependency order). Conversational priorities (audit findings, recent user direction, what just got unblocked by a sibling completion) aren't visible to it. The orchestrator's job is to reconcile both views before committing agent slots.

**Setup (after grooming is confirmed):**

1. **Spawn initial agents.** Launch `min(candidates, max-parallel)` `wiki-next` agents via the Agent tool with `subagent_type: "wiki-next"` and `run_in_background: true`. Do NOT pass explicit item hints — each agent runs `./wiki.sh next` itself and claims the result. The wiki-next agent is responsible for being robust to claim races (see "Claim race robustness" in the wiki-next agent definition); the orchestrator just sets the parallelism level.
2. **Set up the 30-minute cron** via `CronCreate`: `cron: "7,37 * * * *"`, `prompt: "/wiki checkpoint"`, `recurring: true`. (Use `7,37` not `*/30` — `*/30` lands on `:00`/`:30` along with every other fleet-default cron; off-minute scheduling avoids the API pile-up. See CronCreate docs.)

**Replacement behavior (after spawn):**

When an agent emits a terminal completion notification (NOT a heartbeat — distinguish by `tool_uses > 0` and a substantive result body), immediately:

1. **Re-groom briefly.** Check unblocked count via `./wiki.sh next` and a broader scan. If priorities have shifted (e.g., the agent's completion unblocked a high-priority experiment that wasn't on the original candidate list), surface that to the user before spawning.
2. **Spawn replacement.** If unblocked work exists AND in-flight count < max-parallel, spawn a replacement `wiki-next` agent (again, no explicit hint).
3. **Idle if nothing's unblocked.** Don't spawn. The next cron `/wiki checkpoint` will recheck.

**Stopping and pausing:**

- **`/wiki stop`**: Remove the cron via `CronDelete`. Let in-flight agents finish naturally. Useful at end of a work session.
- **`/wiki pause`**: Leave the cron running (status updates continue) but suppress new spawns at checkpoint time. Useful for budget-aware pauses.

**Reporting convention (apply in all status updates, chat and push):**

When mentioning a wiki work item by ID in any user-facing output, **always pair the ID with a short human-readable name**. The user can't track work just by ID.

- **First mention in a session**: include a fuller descriptor. Example: `E-043 (coach pipeline — graph-walk retrieval + Sonnet walker, AI SDK v5 typed data-resources telemetry)`.
- **Subsequent mentions**: short name + ID. Example: `E-043 (coach pipeline)` or `Coach pipeline (E-043)`. Pick a short name and use it consistently.
- **Tables and lists**: include a name column, never bare IDs.
- **Status updates**: never write "E-043 in flight" — write "E-043 (coach pipeline) in flight." Same for completions: "E-039 (ingestion script) done."
- **Short-name derivation**: drop ceremonial framing ("Build", "Add", "Wire") from page titles. E.g. "Build repeatable ingestion script..." → "ingestion script"; "Wire v5b coach into chat route handler" → "coach pipeline".

This applies to checkpoint status, push notifications, replacement-spawn narration, completion confirmations — every user-facing reference.

### `/wiki claim <page>`

Mark a research or experiment page as claimed by you. Set `claimed_by` and `claimed_at` in frontmatter. If already claimed, check file modification time: if the file hasn't been modified in 20+ minutes, the claim is stale and you may take it.

### `/wiki unclaim <page>`

Release your claim on a page. Clear `claimed_by` and `claimed_at`.

---

## Agent Coordination

Multiple agents work on this wiki concurrently. The rules:

1. **Claim before working.** Always claim a research or experiment page before starting work on it. Update the frontmatter.
2. **Touch the file while working.** Any time you make progress, write it to the page. This keeps your claim alive.
3. **Stale claim rule.** If a page's file hasn't been modified past its `claim_ttl` (default 20 minutes), the claim is stale. You may re-claim it. The previous agent either crashed or moved on. Set `claim_ttl` in frontmatter (in minutes) for long-running tasks like downloads or transcriptions. Example: `claim_ttl: 120` for a 2-hour job.
4. **Read before writing.** Always re-read a page immediately before editing it. Another agent may have updated it.
5. **Don't clobber.** If you read a page and it has changed since you last read it, re-assess before writing. Merge your changes with theirs.
6. **Update the index.** After creating or removing pages, update `meta/wiki/index.md`.

---

## The Index

`meta/wiki/index.md` is the entry point. It contains:

- A tree of all goal pages with status indicators
- Under each goal: its research and experiment pages with status
- Each entry has an `also:` field with aliases for matching queries to pages
- A section for standalone findings
- A section for checkpoints (most recent first)

Format:
```
# Wiki Index

## Goals

- [ ] G-001 Top-level goal description (also: project name, shorthand)
  - Sub-goals
    - [ ] G-002 First sub-goal (also: alias1, alias2)
      - Research
        - [x] R-001 Question answered (also: topic keyword)
        - [ ] R-002 Question pending
      - Experiments
        - [x] E-001 Experiment succeeded
        - [-] E-002 Experiment failed
        - [ ] E-003 Experiment pending
    - [ ] G-003 Second sub-goal
  - Research
    - [ ] R-003 Goal-level research
  - Experiments
    - [ ] E-004 Goal-level experiment

## Checkpoints

- 2026-05-19 Initial assessment [[link]]
```

The `also:` aliases help `/wiki query` match natural language questions to the right pages. Add aliases when a page might be referenced by different names (e.g., "yt-dlp", "youtube-dl", "video download tool" for an experiment about yt-dlp).

---

## Dependencies

Pages can declare dependencies on other pages via the `depends_on` frontmatter field. A page with `depends_on: R-001, E-003` should not be started until both R-001 and E-003 have reached a terminal status (complete, succeeded, failed, inconclusive, confirmed, refuted).

**When to use dependencies:**
- An experiment needs research results as input: `depends_on: R-002`
- A download step needs cataloging to finish first: `depends_on: E-001`
- A sub-goal can't start until a sibling completes: `depends_on: G-003`

**When NOT to use dependencies:**
- Parent-child relationships already encode ordering. Don't duplicate with `depends_on`.
- Soft preferences ("nice to have R-005 first") are not dependencies. Only hard blocks.

**Self-healing:** `./wiki.sh next` prefers items with all dependencies resolved, but if *nothing* is unblocked, it surfaces the item with the fewest unresolved dependencies and flags it. This prevents deadlocks where all agents idle because everything is blocked. The agent picking up a blocked item should either resolve the dependency first, remove it if it's no longer needed, or note in the page why it proceeded without it.

---

## Design for Parallelism

When creating goals, research, and experiments, design them to be **self-contained and runnable in parallel** by default. An agent picking up any page should be able to complete it without coordinating with another agent on a sibling page.

1. **Each page gets its own inputs and outputs.** Don't create two experiments that write to the same file or depend on shared mutable state.
2. **Scope narrowly, merge later.** Instead of one experiment that catalogs all sources, create separate experiments per source. A later merge step combines them.
3. **State the merge strategy on the parent goal.** When a goal spawns parallel work, describe how results combine. Example: "Each experiment produces a JSON list of URLs. The merge step concatenates and deduplicates."
4. **Avoid implicit ordering between siblings.** If E-002 truly needs E-001's output, make it explicit with `depends_on: E-001`.
5. **Prefer fan-out/fan-in over serial chains.** Five parallel experiments with one merge step beats a chain of five sequential ones.

---

## Selecting What to Work On

When deciding what to do next, follow this priority order:

1. **In-progress items you previously claimed** that are unfinished. Finish what you started.
2. **Items with all dependencies resolved** over items with unresolved dependencies.
3. **Research items blocking multiple experiments.** Unblock the most work. Check `_backlinks.json` for research pages referenced by many pending experiments.
4. **Experiments whose parent research is complete.** Research informs experiments; don't experiment blind.
5. **Sub-experiments spawned from recent results.** Follow the thread while context is fresh.
6. **Checkpoint** if 10+ tasks have completed since the last one.
7. **Re-evaluate abandoned branches** if nothing else is pressing.
8. **Blocked items** if nothing unblocked is available. Before working on a blocked item, ask yourself: am I *actually* blocked, or is there other useful work I haven't noticed? Re-read the goal tree. Check sibling goals. Look for research gaps. Only if there is genuinely nothing else should you work on the blocked item — and then resolve or remove the dependency before doing the work itself. **Do not create spurious work just to fill time.** It is fine to be idle if all meaningful work is blocked or in progress.

When multiple items are equal priority, prefer the one closest to the root goal. Breadth before depth unless depth is clearly more valuable.

---

## Writing Standards

### Tone: Wikipedia, Not AI

Write like Wikipedia. Flat, factual, encyclopedic. State what happened. The article stays neutral; direct quotes from outputs and sources carry the evidence.

**Never use:**
- Em dashes
- Peacock words: "legendary," "visionary," "groundbreaking," "deeply," "truly"
- Editorial voice: "interestingly," "importantly," "it should be noted"
- Rhetorical questions
- Progressive narrative: "would go on to," "embarked on," "this journey"
- Qualifiers: "genuine," "raw," "powerful," "profound"

**Do:**
- Lead with the subject, state facts plainly
- One claim per sentence. Short sentences.
- Simple past or present tense
- Attribution over assertion: "The tool returned 404 errors for 3 of 12 URLs" not "The tool mostly worked."
- Let facts imply significance
- Dates and specifics replace adjectives

### Boundary Conditions

The most important writing standard: **state the boundary conditions of every finding.** A finding without boundaries is a trap for future agents who will over-generalize it.

### Structure by Page Type

| Type | Organize by |
|------|------------|
| Goal | Outcome, context, sub-goals, decision log |
| Research | Question, sources, findings with scope, implications |
| Experiment | Hypothesis, method, result, analysis with scope, dead ends |
| Finding | Claim, evidence, boundary conditions |

Sections should be organized by theme, not chronology. If an experiment page reads like a diary ("first I tried X, then I tried Y, then I tried Z"), rewrite it by what was learned, not when.

### Length Targets

| Page type | Lines |
|-----------|-------|
| Goal | 30-80 |
| Research (complete) | 40-80 |
| Experiment (complete) | 40-100 |
| Finding | 15-40 |
| Checkpoint | 30-60 |
| Minimum (anything) | 15 |

### Anti-Cramming

The gravitational pull of existing pages is the enemy. It is always easier to append a paragraph to a big page than to create a new one. This produces 5 bloated pages instead of 30 focused ones.

If you are adding a third paragraph about a sub-topic to an existing page, that sub-topic probably deserves its own page. Split aggressively.

### Anti-Thinning

Creating a page is not the win. Enriching it is. A stub with 3 vague sentences when 4 other entries also relate to that topic is a failure. Every time you touch a page, it should get meaningfully richer. Do not create a page until you can write at least 15 substantive lines.

---

## Running on Loop

To run an agent continuously:

```
/loop 1m /wiki next
```

This calls `./wiki.sh next` which outputs the single highest-priority item to work on. The agent reads the output, claims the item, does the work, and exits. Next loop iteration picks up the next thing.

`./wiki.sh next` returns one of:
- `STALE_CLAIM <type> <id> <path>` — a previously claimed item that's been abandoned (>20min stale). Re-claim and finish it.
- `CHECKPOINT` — 10+ tasks done since last checkpoint. Step back and assess.
- `RESEARCH <id> <goal> <path>` — pending research with all dependencies resolved.
- `EXPERIMENT <id> <goal> <path>` — pending experiment with all dependencies resolved.
- `BLOCKED_RESEARCH <id> <goal> <path>` or `BLOCKED_EXPERIMENT <id> <goal> <path>` — nothing unblocked is available. This item has the fewest unresolved deps. Resolve or remove them first.
- `IDLE` — nothing pending. Review goals and create new work.

---

## Tooling

Use `./wiki.sh` for all mechanical operations. Run `./wiki.sh help` for usage.

Key commands:
- `./wiki.sh create goal|research|experiment|finding "title" [flags]` — scaffold a page
- `./wiki.sh claim <ID> "agent name"` — claim a page for work
- `./wiki.sh unclaim <ID>` — release a claim
- `./wiki.sh status` — show wiki state
- `./wiki.sh stale` — list stale claims
- `./wiki.sh rebuild-index` — regenerate index.md and _backlinks.json

The script creates the file and rebuilds the index. You still need to edit the file to fill in all sections. **A page with "FILL IN" placeholders is not ready for another agent to pick up.**

---

## Principles

1. **Goals are specific outcomes, not tasks.** "All Joe Hudson YouTube videos are transcribed with speaker labels" not "Set up whisper."
2. **Research before experiments.** Don't guess when you can look it up.
3. **Experiments are falsifiable.** State what would make this a failure before running it.
4. **Findings have boundaries.** What conditions must hold for this to be true?
5. **Dead ends are valuable.** A well-documented failure saves the next agent hours. Write dead ends with care.
6. **The tree is alive.** Reorder, merge, split, abandon, and create nodes freely based on what you learn.
7. **Claim your work.** Coordinate through the filesystem, not through hope.
8. **Checkpoint regularly.** Every 10 tasks, step back. Are we converging?
9. **The wiki is the only memory.** If it's not in the wiki, it doesn't exist for the next agent.
10. **Nuance over speed.** A sloppy finding that gets over-generalized does more damage than no finding at all.
11. **Start small, widen gradually.** Experiments with side effects (downloading, writing files, modifying data) must start with the smallest possible blast radius — 1-3 items. Verify the output is correct. Then scale to 10. Verify again. Only then run at full scale. A bad script run on 500 files destroys hours of prior work. A bad script run on 2 files is a 30-second fix. When writing the Method section, explicitly describe this ramp: what the small test is, what you check before scaling, and what the full run looks like.
12. **Protect existing work.** Before running an experiment that writes to directories where other experiments have already produced output, check what's there. Don't overwrite, clobber, or reorganize files another experiment created unless that's the explicit purpose. If in doubt, write to a new location and merge later.
