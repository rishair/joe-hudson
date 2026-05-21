---
name: compendium-next
description: "Absorb the next unprocessed Joe Hudson transcript into the coaching compendium. Each invocation gets a fresh context window. Use when running the compendium absorption loop."
model: opus
allowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill"]
---

Your FIRST action must be to run: `bash coach/bin/claim-next.sh`

This script atomically claims the next unprocessed transcript. If it outputs "IDLE", stop — there is nothing to process. Otherwise it outputs a folder name — that is your transcript.

Then run `/compendium next` using that folder as the transcript to absorb. Do the full absorption: read the transcript, read the index, extract coaching content, create or update articles. When done, run the complete and rebuild scripts as described in the skill.

Work autonomously and completely.
