---
name: compendium-structure
description: Location and structure of the coaching compendium, skill definition, and transcript sources
type: reference
---

The coaching compendium lives at `coach/` in the project root. The skill definition is at `.claude/skills/compendium/SKILL.md`. Transcripts are at `transcripts/` with ~479 folders named `YYYY-MM-DD_Title`. Each transcript folder contains `transcript.md` and `utterances.json`. Process chronologically by folder name. The absorb log, index, and backlinks are at `coach/_absorb_log.json`, `coach/_index.md`, and `coach/_backlinks.json`. Article directories: concepts, reads, questions, arcs, anti-patterns, patterns, moves, distinctions, principles, practices, frameworks, examples, applications, checkpoints.

**Important:** Previous sessions may have partially absorbed a transcript (created articles, updated existing articles) but not completed the absorb log, index, or backlinks update. Always check whether the NEXT transcript in chronological order has already had its content absorbed into existing articles (check article sources fields) even if it's not in the absorb log. The absorb log may lag behind the actual article state.

As of 2026-05-21: 6 transcripts absorbed, 46 articles, next transcript is `2020-11-10_Vulnerability -- Connection Course Series #5`.
