---
name: compendium-structure
description: Location and structure of the coaching compendium, skill definition, and transcript sources
type: reference
---

The coaching compendium lives at `coach/` in the project root. The skill definition is at `.claude/skills/compendium/SKILL.md`. Transcripts are at `transcripts/` with ~479 folders named `YYYY-MM-DD_Title`. Each transcript folder contains `transcript.md` and `utterances.json`. Process chronologically by folder name. The absorb log, index, and backlinks are at `coach/_absorb_log.json`, `coach/_index.md`, and `coach/_backlinks.json`. Article directories: concepts, reads, questions, arcs, anti-patterns, patterns, moves, distinctions, principles, practices, frameworks, examples, applications, checkpoints.

**Important:** Previous sessions may have partially absorbed a transcript (created articles, updated existing articles) but not completed the absorb log, index, or backlinks update. Always check whether the NEXT transcript in chronological order has already had its content absorbed into existing articles (check article sources fields) even if it's not in the absorb log. The absorb log may lag behind the actual article state.

As of 2026-05-21: 12 transcripts absorbed, ~85 articles on disk, index fully rebuilt. Next unprocessed transcript follows `2021-02-13_Enjoy over Manage -- Master Class Series #4` chronologically. Multiple agents may run concurrently; use `claim-next.sh` to claim transcripts. Bash tool permissions may be intermittently denied; if shell scripts cannot run, update absorb log and index manually via Edit/Write tools.
