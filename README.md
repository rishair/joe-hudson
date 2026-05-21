# Joe Hudson Knowledge Base

A Claude Code-powered repo that ingests Joe Hudson's content and organizes it into a comprehensive wiki. The entire project -- from downloading and transcribing 480+ episodes to building a structured coaching compendium -- is driven by Claude Code agents using a goal-based wiki system.

## What's here

**~480 transcribed episodes** from Joe Hudson's [Art of Accomplishment](https://www.artofaccomplishment.com/) podcast and YouTube channel, speaker-diarized and labeled. Plus a growing **coaching compendium** that distills Joe's methodology into an interconnected knowledge graph an AI coach can navigate.

## The Wiki System

Everything in this repo is organized through a goal-driven wiki at `meta/wiki/`. The wiki is a tree of goals, research, experiments, and findings -- a structure designed for Claude Code agents to autonomously plan and execute multi-step projects.

### How it works

```
Goals (G-001, G-002, ...)
├── Research (R-001, R-002, ...)    -- what do we need to learn?
├── Experiments (E-001, E-002, ...) -- try something concrete
├── Findings                        -- what did we learn?
└── Sub-goals                       -- break it down further
```

Each node is a markdown file with YAML frontmatter tracking status, parent relationships, and dependencies. The wiki index (`meta/wiki/index.md`) shows the full tree with completion status.

**Goals** define outcomes and correctness criteria. A goal like "Download and transcribe all AoA content" breaks into sub-goals (catalog sources, download media, transcribe with diarization), each with their own research questions and experiments.

**Research** answers "what do we need to know?" before acting -- e.g., surveying speech-to-text tools, figuring out how to bulk-download podcast feeds.

**Experiments** are concrete attempts with pass/fail criteria -- prototyping WhisperX on a few episodes, testing speaker voiceprint labeling, running a bulk transcription pipeline.

Claude Code agents claim work by marking nodes as `active`, run experiments, record results, and mark them `completed`. The wiki is the persistent memory across sessions -- any new Claude session can read the tree and pick up where the last one left off.

### Current goals

| Goal | Status |
|------|--------|
| G-001: Download and transcribe all AoA content | Completed |
| G-007: Build coaching compendium from transcripts | Active (21/480 transcripts absorbed, ~205 articles) |

## The Compendium

The compendium (`coach/`) is a coaching knowledge graph extracted from Joe Hudson's transcripts. It's designed to power an AI coach that coaches the way Joe does.

### Three layers

1. **Concerns** -- what someone walks in the door saying. "I keep ending up in the same pattern." "I can't stop criticizing myself." These are written in the user's voice.

2. **Reads** -- what Joe notices about how the person is showing up. Not what they're saying, but what's underneath it. "They're not hearing the person in front of them." "Fight-or-submit binary."

3. **Methodology** -- Joe's toolkit. This layer contains:
   - **Concepts** -- core ideas like Wonder, Vulnerability, Impartiality, Feeling Unfelt Emotions
   - **Moves** -- specific coaching actions (Become the Authority Figure, Mirror the Judgment)
   - **Questions** -- "What do you want?" "How is that not true about you?"
   - **Distinctions** -- pairs that clarify thinking (Caring vs Caretaking, Love vs Nice)
   - **Principles** -- operating rules (Shame Drives Behavior, What We Fear We Invite)
   - **Practices** -- things to try (Daily Emotional Yoga, Don't Improve for Two Weeks)
   - **Patterns** -- recurring shapes Joe names (Quit-Hope-Lose Cycle, Childhood Imprinting)
   - **Arcs** -- the shape of transformation over time
   - **Anti-patterns** -- what NOT to do (Don't use VIEW as a technique, Loving to Transform)
   - **Frameworks** -- structured methodologies (VIEW, Fear Triangle, Four Faces of Love)
   - **Examples** -- specific stories Joe tells (Tennis Quarter, Michelangelo, Subway Kid)
   - **Applications** -- how concepts land in specific domains (Money, Vulnerability in the Workplace)

Every 20 absorbs, a quality audit checkpoint runs against the compendium and writes its findings to `coach/checkpoints/`.

### How it encodes coaching

The directional links between layers are the coaching intelligence. They encode: "when someone says X, Joe notices Y, and responds with Z." An AI coach follows these links to navigate a conversation the way Joe would.

The compendium is built by the `/compendium` skill in Claude Code, which reads transcripts one at a time and weaves their content into existing or new articles.

## Project structure

```
transcripts/                    # ~480 episodes, each with transcript.md + MEDIA.md
  {YYYY-MM-DD}_{title}/
    transcript.md               # Speaker-diarized transcript
    MEDIA.md                    # Metadata (title, date, participants, source)

coach/                          # The coaching compendium (knowledge graph)
  _index.md                     # Master index of all articles
  _backlinks.json               # Inverse-link map built by rebuild-index
  _absorb_log.json              # Per-transcript record of what was absorbed
  bin/                          # Claim, complete, and index-rebuild scripts
  checkpoints/                  # Quality-audit summaries (every 20 absorbs)
  concerns/                     # Layer 1: what people say
  reads/                        # Layer 2: what Joe notices
  concepts/                     # Layer 3: methodology
  moves/
  questions/
  distinctions/
  principles/
  practices/
  patterns/
  arcs/
  anti-patterns/
  frameworks/
  examples/                     # Specific stories Joe tells
  applications/                 # How concepts land in specific domains

meta/wiki/                      # Goal-driven wiki system
  index.md                      # Tree of all goals, research, experiments
  goals/                        # G-001 through G-007
  research/                     # R-001 through R-007
  experiments/                  # E-001 through E-018
  findings/
```

## Built with

- [Claude Code](https://claude.ai/code) -- agents that plan, execute, and checkpoint all work
- [WhisperX](https://github.com/m-bain/whisperX) -- speech-to-text with word-level timestamps
- [AssemblyAI](https://www.assemblyai.com/) -- bulk transcription with speaker diarization
- [Pyannote](https://github.com/pyannote/pyannote-audio) -- speaker voiceprint embeddings for labeling
