---
name: wiki
description: Research-driven wiki system where goals, experiments, research, and findings all live as interconnected pages. Agents navigate a tree of goals and experiments, claim work, record findings, and checkpoint progress.
argument-hint: "status | goal <name> | research <goal-id> | experiment <goal-id> | absorb | checkpoint | claim <page> | unclaim <page>"
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
- **Context**: Why this goal matters. What it unblocks.
- **Sub-goals**: Links to child goal pages. A goal can be broken into sub-goals at any depth. Each sub-goal is its own page with its own research, experiments, and potentially its own sub-goals.
- **Research**: Links to research pages spawned by this goal.
- **Experiments**: Links to experiment pages spawned by this goal. Each with a one-line description and current status.
- **Decision Log**: When you decide to pursue one path over another, write why. When you abandon an approach, write why. This is the most valuable part of the page over time.

The top-level goal is the only immovable goal. Every sub-goal is modifiable, splittable, mergeable, or removable based on what you learn.

### Research Page

Location: `meta/wiki/research/<research-id>.md`

```yaml
---
type: research
id: <research-id>
status: pending | claimed | in-progress | complete
parent_goal: <goal-id>
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
claimed_by: <agent-description or empty>
claimed_at: <ISO timestamp or empty>
created: YYYY-MM-DD
---
```

Contains:
- **Hypothesis**: What you expect to happen and why.
- **Method**: What you will actually do. Concrete steps.
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

---

## Commands

### `/wiki status`

Read `meta/wiki/index.md`. Show:
- Active goals and their completion state
- How many experiments are pending, in-progress, complete
- How many research items are pending, in-progress, complete
- Any claimed-but-stale items (file not modified in 20+ minutes)
- What was last worked on

### `/wiki goal <name>`

Create a new goal page. If this is the first goal, it becomes root. Otherwise, ask which existing goal it falls under. Create the page, add it to the index, and then immediately:
1. Perform initial research (2-4 research pages) on approaches to this goal
2. Based on that research, propose 3-5 experiments worth trying
3. Rank those experiments by expected impact and feasibility
4. Create pages for each experiment in `pending` status

### `/wiki research <goal-id>`

Pick the highest-priority pending research item for this goal (or across all goals if no ID given). Claim it, do the research, record findings, and update the goal page with implications.

### `/wiki experiment <goal-id>`

Pick the highest-priority pending experiment for this goal (or across all goals if no ID given). Claim it, run it, record results, and then:
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

### `/wiki checkpoint`

Triggered automatically every 10 completed tasks (experiments + research items). Also callable manually. This is the "are we doing the right things" moment.

1. **Survey**: Read the full index and all active goal pages. Understand the current state of the tree.
2. **Assess progress**: For each active goal, what percentage of the path is understood? What are the biggest unknowns?
3. **Evaluate direction**: Are current experiments converging on the goal, or are we in a rabbit hole? Are there abandoned branches that deserve another look? Are there obvious approaches nobody has tried?
4. **Prune**: Mark stale or irrelevant experiments as abandoned with a note on why.
5. **Replan**: Update goal pages with revised experiment priorities. Create new research or experiments if the checkpoint reveals gaps.
6. **Write a checkpoint summary** at `meta/wiki/checkpoints/YYYY-MM-DD-HHMMSS.md` documenting your assessment so future agents (and humans) can see the trajectory.

### `/wiki claim <page>`

Mark a research or experiment page as claimed by you. Set `claimed_by` and `claimed_at` in frontmatter. If already claimed, check file modification time: if the file hasn't been modified in 20+ minutes, the claim is stale and you may take it.

### `/wiki unclaim <page>`

Release your claim on a page. Clear `claimed_by` and `claimed_at`.

---

## Agent Coordination

Multiple agents work on this wiki concurrently. The rules:

1. **Claim before working.** Always claim a research or experiment page before starting work on it. Update the frontmatter.
2. **Touch the file while working.** Any time you make progress, write it to the page. This keeps your claim alive.
3. **20-minute stale rule.** If a page's file hasn't been modified in 20+ minutes (check with file stat), the claim is stale. You may re-claim it. The previous agent either crashed or moved on.
4. **Read before writing.** Always re-read a page immediately before editing it. Another agent may have updated it.
5. **Don't clobber.** If you read a page and it has changed since you last read it, re-assess before writing. Merge your changes with theirs.
6. **Update the index.** After creating or removing pages, update `meta/wiki/index.md`.

---

## The Index

`meta/wiki/index.md` is the entry point. It contains:

- A tree of all goal pages with status indicators
- Under each goal: its research and experiment pages with status
- A section for standalone findings
- A section for checkpoints (most recent first)

Format:
```
# Wiki Index

## Goals

- [ ] G-001 Top-level goal description
  - Sub-goals
    - [ ] G-002 First sub-goal [[link]]
      - Research
        - [x] R-001 Question answered [[link]]
        - [ ] R-002 Question pending [[link]]
      - Experiments
        - [x] E-001 Experiment succeeded [[link]]
        - [-] E-002 Experiment failed [[link]]
        - [ ] E-003 Experiment pending [[link]]
    - [ ] G-003 Second sub-goal [[link]]
      - Sub-goals
        - [ ] G-004 Deeper sub-goal [[link]]
  - Research
    - [ ] R-003 Goal-level research [[link]]
  - Experiments
    - [ ] E-004 Goal-level experiment [[link]]

## Checkpoints

- 2026-05-19 Initial assessment [[link]]
```

---

## Selecting What to Work On

When deciding what to do next, follow this priority order:

1. **In-progress items you previously claimed** that are unfinished. Finish what you started.
2. **Experiments whose parent research is complete** and that are high-priority. Research informs experiments; don't experiment blind.
3. **Research items blocking multiple experiments.** Unblock the most work.
4. **Sub-experiments spawned from recent results.** Follow the thread while context is fresh.
5. **Checkpoint** if 10+ tasks have completed since the last one.
6. **Re-evaluate abandoned branches** if nothing else is pressing.

When multiple items are equal priority, prefer the one closest to the root goal. Breadth before depth unless depth is clearly more valuable.

---

## Writing Standards

Write like Wikipedia. Flat, factual, encyclopedic. No peacock words, no AI editorial voice, no em dashes, no "interestingly" or "importantly."

- One claim per sentence. Short sentences.
- Attribution over assertion: "The tool returned 404 errors for 3 of 12 URLs" not "The tool mostly worked."
- Dates and specifics replace adjectives.
- Direct quotes from outputs or sources carry the evidence. The article stays neutral.

The most important writing standard: **state the boundary conditions of every finding.** A finding without boundaries is a trap for future agents who will over-generalize it.

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
