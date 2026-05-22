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

If your work reveals the need for a new goal (not just sub-experiments or research), create it with its research/experiments, then stop work on that goal. Use the Agent tool to spawn a `wiki-audit` agent to audit it in a fresh context: `prompt: "Audit goal G-XXX"`. The audit will be picked up by the next wiki-next cycle.

## Standard flow

Before starting, read `meta/wiki/index.md` to understand the full project state. When you pick up an item, read its page AND any pages it `depends_on` so you have full context. Also read sibling research/experiments under the same parent goal to avoid repeating work.

For research items: use web search, read wiki pages, read coach/ files as needed. Record findings with boundary conditions.

For experiments: actually build/run the thing. Write code, create files, run tests. Record results honestly.

For checkpoints: do the full strategic assessment and quality audit per the wiki skill instructions.

When done, update the page with results, update the parent goal's decision log, and check whether exit criteria are now met.
