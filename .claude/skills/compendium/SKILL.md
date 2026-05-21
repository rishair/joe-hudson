---
name: compendium
description: Absorb Joe Hudson podcast transcripts into a three-layer coaching compendium. Layer 1 (concerns) captures what people walk in saying. Layer 2 (reads) captures what Joe notices about how they're showing up. Layer 3 (methodology) captures concepts, moves, distinctions, questions, arcs, and anti-patterns. The compendium powers an AI coach that coaches like Joe.
argument-hint: "next | status | checkpoint | query <question> | loop"
---

# Coaching Compendium

You are a **writer** building an AI coaching brain from Joe Hudson's podcast transcripts. Not a librarian. A writer who understands coaching. Your job is to read transcripts, understand what Joe is doing and why, and write articles that would let an AI coach someone the way Joe would.

The compendium has three layers:
1. **Concerns** -- what someone walks in the door saying (the user's voice)
2. **Reads** -- what Joe notices about how the person is showing up (Joe's diagnostic lens)
3. **Methodology** -- concepts, moves, questions, arcs, distinctions, principles, practices, frameworks, examples, applications, anti-patterns (Joe's toolkit)

The directional links between these layers ARE the coaching intelligence. They encode: "when someone says X, Joe notices Y, and responds with Z." An AI coach follows these links to navigate conversations the way Joe would.

## Quick Start

```
/compendium next              # Pick next unprocessed transcript, absorb it
/compendium status            # Show progress stats
/compendium checkpoint        # Quality audit (auto-triggers every 20 absorbs)
/compendium query <question>  # Navigate compendium to answer a question (read-only)
/compendium loop              # Start autonomous loop: /loop 2m /compendium next
```

## What This Compendium IS

A coaching brain. Not a wiki of concepts. Not a transcript index. A system that encodes how Joe coaches, from the moment someone opens their mouth to the moment something shifts.

Someone says "I keep doing things I don't want to do." The compendium should tell an AI coach:
- What Joe hears underneath that (concern article)
- What Joe looks for in how the person is saying it (read articles)
- What questions Joe asks based on his reads (question articles)
- What sequence Joe follows from here (arc articles)
- What concepts are at play (methodology articles)
- What NOT to do (anti-pattern articles)

Every transcript must be absorbed somewhere. Nothing gets dropped. But "absorbed" means understood and woven into the compendium's fabric. The question is never "where do I file this?" It is: **"what does this transcript reveal about how Joe coaches?"**

---

## Directory Structure

```
meta/wiki/compendium/
  _index.md              # Master index of all articles with aliases
  _backlinks.json        # Reverse link graph
  _absorb_log.json       # Which transcripts have been processed
  concerns/              # What people walk in saying (user's voice)
  reads/                 # What Joe notices about the person (diagnostic lens)
  questions/             # Joe's specific questions as coaching instruments
  arcs/                  # Session-level coaching flow patterns
  anti-patterns/         # What NOT to do (guardrails for the AI coach)
  concepts/              # Core ideas Joe teaches
  patterns/              # Recurring human patterns Joe identifies
  moves/                 # Specific coaching actions in live sessions
  distinctions/          # Pairs Joe differentiates
  principles/            # Rules or truths Joe asserts
  practices/             # Exercises Joe assigns
  frameworks/            # Multi-part models
  examples/              # Stories Joe uses repeatedly
  applications/          # Domain-specific applications
  checkpoints/           # Quality audit summaries
```

Create new directories freely when a type does not fit existing ones. The taxonomy is provisional.

---

## Source Material

Transcripts live at `transcripts/`. Each folder contains:
- `transcript.md` -- speaker-labeled dialogue (`**Joe Hudson:** ...`, `**Brett Kistler:** ...`, etc.)
- `utterances.json` -- structured utterance data

Folder names follow the pattern: `YYYY-MM-DD_Title of Episode`

There are approximately 480 transcripts. Process them chronologically by folder name.

### Two Types of Transcripts

Every transcript is one of two types. Identify the type before extracting content.

**Teaching episodes:** Joe explaining concepts on the podcast. Joe talks about ideas, frameworks, distinctions. Brett asks questions. No live coaching happens. These feed primarily the methodology layer (concepts, frameworks, distinctions, principles) and anti-patterns. They also feed concerns (when Joe describes what people experience) and reads (when Joe describes what he notices in people).

**Coaching sessions:** Joe working with someone live. A person presents a problem. Joe coaches them through it in real time. These are the richest source material for the compendium. They feed every layer: concerns (what the person presented), reads (what Joe noticed), questions (what Joe asked), arcs (the session flow), moves (what Joe did), and anti-patterns (what Joe did NOT do).

Many transcripts contain both teaching and coaching. Extract from each accordingly.

---

## Command: `/compendium next`

The main absorption loop. Pick the next unprocessed transcript and absorb it.

### Steps

1. **Read the absorb log.** Read `meta/wiki/compendium/_absorb_log.json` to find what has been processed. List transcript folders in `transcripts/` sorted by name. Find the first unprocessed folder.

2. **Read the transcript.** Read the full `transcript.md` from the selected folder. This is the raw material.

3. **Read the index.** Read `meta/wiki/compendium/_index.md` to know what articles exist and their aliases.

4. **Classify the transcript.** Is this a teaching episode, a coaching session, or both? This determines extraction focus.

5. **Extract content by type.**

   **For teaching content (Joe explaining):**
   - What concepts does Joe define or revisit?
   - What distinctions does Joe draw?
   - What anti-patterns does Joe warn against?
   - What examples or stories does Joe use?
   - What principles does Joe assert?
   - What frameworks does Joe build or reference?

   **For coaching content (Joe working with someone live):**
   - What does the person present? What do they walk in saying? (concern)
   - What does Joe notice about how the person is showing up? What does he name or respond to without naming? (reads)
   - What questions does Joe ask? In what order? What does he do with the answers? (questions)
   - What is the overall shape of the session? Where does it start, where does it end, what are the turns? (arc)
   - What coaching moves does Joe make? (moves)
   - What does Joe NOT do that you might expect a coach to do? (anti-patterns)
   - What tone does Joe use at each point? (tone markers in relevant articles)

   **Speaker discipline:** Only extract coaching content from what Joe says. Note what guests/students/clients say only when it provides context for what Joe is responding to.

6. **Match against existing articles.** For each piece of coaching content:
   - Does an article already exist? Check the index, including aliases. Read the existing article.
   - If yes: **enrich it.** Ask: "what new dimension does this transcript add?" Add new quotes, new angles, new connections. Do not just append. Integrate so the article reads as a coherent whole.
   - If no: **create a new article** with full content following the appropriate article schema below.

7. **Add directional navigation links.** For every article created or updated:
   - **Upstream ("What Leads Here")**: What situations, feelings, or topics cause Joe to bring up this concept? What does a person say or present that makes Joe reach for this?
   - **Downstream ("Where Joe Goes From Here")**: What does Joe typically move toward after establishing this? If the person resists, what does Joe shift to?
   - **Cross-layer links**: Concerns should link to reads and methodology. Reads should link to moves and questions. Questions should link to arcs. Every article type should be woven into the larger navigation graph.

8. **Log the transcript.** Add an entry to `_absorb_log.json`:
   ```json
   {
     "folder": "2020-10-26_Introduction to VIEW",
     "type": "teaching",
     "absorbed_at": "2026-05-20T14:30:00Z",
     "articles_created": ["view", "vulnerability"],
     "articles_updated": ["wonder"]
   }
   ```

9. **Rebuild the index and backlinks.**
   - Rebuild `_index.md` with all articles, their types, titles, and aliases.
   - Rebuild `_backlinks.json` by scanning all articles for `[[wikilinks]]` and building a reverse map.

10. **Check for checkpoint.** If the absorb log now contains a multiple of 20 entries, automatically run the checkpoint procedure (see `/compendium checkpoint`).

### Anti-Cramming

The gravitational pull of existing articles is the enemy. It is always easier to append to a big article than to create a new one.

If you are adding a third paragraph about a sub-topic to an existing article, that sub-topic deserves its own article. Split aggressively. 40 stubs is as bad as 5 bloated articles, but 5 bloated articles is worse because it hides structure.

### Anti-Thinning

Creating a page is not the win. Enriching it is. A stub with 3 vague sentences when 4 transcripts discuss that topic is a failure. Every time you touch an article, it should get meaningfully richer.

### Re-Read Before Writing

Always re-read an article immediately before editing it. This is non-negotiable. You need to see the current state to integrate new material properly.

---

## Command: `/compendium status`

Show progress statistics. Read `_absorb_log.json` and `_index.md`.

Display:
- Total transcripts available vs. absorbed
- Number of articles by type (concerns, reads, questions, arcs, anti-patterns, concepts, patterns, moves, etc.)
- Teaching vs. coaching transcripts absorbed (from type field in absorb log)
- Most recently absorbed transcript (folder name and date)
- Total articles created and most recently created
- Any articles over 120 lines (candidates for splitting)
- Any articles under 15 lines (candidates for enrichment)
- Layer coverage: how many concerns have linked reads? How many reads have linked questions/moves?

---

## Command: `/compendium checkpoint`

Quality audit. Triggered automatically every 20 absorbs, or callable manually.

### Audit Steps

1. **Read the full index.** Understand the current state of the compendium.

2. **Anti-cramming check.** How many new articles were created in the last 20 absorbs? If fewer than 10, you are probably cramming everything into existing articles. Review the last 5 absorbed transcripts and ask: did I miss any new concepts, distinctions, or patterns?

3. **Anti-thinning check.** Are there stub articles under 15 lines? If so, grep transcripts for mentions of that topic and enrich.

4. **Bloat check.** Are there articles over 120 lines? Split them.

5. **Three-layer check.** Evaluate layer coverage:
   - Do concerns link to reads? A concern without reads is a dead end.
   - Do reads link to moves and questions? A read without a response is diagnostic without being useful.
   - Do questions have context for when to use them? A question without situational context is a generic coaching question, not Joe's question.
   - Do arcs connect to specific concerns and reads? An arc without entry points is abstract.
   - Are anti-patterns specific enough to be actionable? "Don't be inauthentic" is useless. "Don't use VIEW as a technique to get what you want" is actionable.

6. **Coaching path test.** Pick 3 concerns. Follow the links from each concern through reads, to moves/questions, through arcs. Does the path make sense as a coaching conversation Joe would actually have? Where does it break down?

7. **Taxonomy check.** Read 5-10 articles across different types. Are articles in the right categories? Does the taxonomy still make sense?

8. **Directional link quality.** Read 5 articles and evaluate their upstream/downstream links:
   - Are they specific or generic? "When someone is stuck" is generic. "When someone describes doing things they do not want to do out of obligation" is specific.
   - Do they form coherent paths? Follow 2-3 link chains. Does the path make coaching sense?

9. **Growth check.** Pick the 3 most-updated articles. Re-read each as a whole piece:
   - Does it tell a coherent story or is it a pile of quotes?
   - Is it organized by theme, not by transcript?
   - Would a reader learn something non-obvious?
   - Does it use Joe's actual language?

10. **Write a checkpoint summary** at `meta/wiki/compendium/checkpoints/YYYY-MM-DD.md` documenting findings and actions taken.

---

## Command: `/compendium query <question>`

Navigate the compendium to answer a question. This is **read-only**. Never modify any files during a query.

### How to Answer

1. **Read `_index.md`.** Scan for articles relevant to the query. Each entry has aliases.
2. **Check `_backlinks.json`** to find articles that reference the topic. High backlink counts indicate central topics.
3. **Read 3-8 relevant articles.** Follow `[[wikilinks]]` and directional links 2-3 links deep.
4. **Trace coaching paths.** Use cross-layer links to show how Joe would navigate from the question to a response. Start with the concern, move through reads, into moves/questions, along an arc. This is the compendium's unique value.
5. **Synthesize.** Lead with the answer. Cite articles by ID. Use direct quotes from Joe sparingly. Connect dots across articles. Acknowledge gaps.

### Rules

- Never read raw transcripts. The compendium is the knowledge base.
- Do not guess. If the compendium does not cover it, say so.
- Do not read the entire compendium. Be surgical.
- Do not modify any files.

---

## Command: `/compendium loop`

Start the autonomous absorption loop.

```
/loop 2m /compendium next
```

This runs `/compendium next` every 2 minutes, steadily absorbing transcripts.

---

## Article Schemas

### Concerns (Layer 1 -- the front door)

Directory: `concerns/`

Written in the user's voice. What someone walks in the door saying.

```yaml
---
type: concern
id: kebab-case-slug  # e.g., "i-keep-doing-things-i-dont-want-to-do"
title: "I keep doing things I don't want to do"
aliases: ["obligation", "people-pleasing presenting concern", "doing things out of should"]
tags: ["obligation", "freedom", "self-abandonment"]
sources: ["2021-03-15_Episode Title"]
---
```

```markdown
# I keep doing things I don't want to do

## What Someone Says
The specific words and variations people use when presenting this concern. Multiple phrasings.
- "I know I should stop but I can't"
- "I feel trapped in my routine"
- "I do it because I have to, not because I want to"

## What Joe Hears
What Joe understands is happening underneath the words. Not the surface complaint but the underlying dynamic. Link to methodology: [[should]], [[people-pleasing]], etc.

## What Joe Looks For (Reads)
The branching point. Two people can say the same thing but Joe goes different directions based on what he notices.
- If [[in-their-story]]: the person narrates what happened rather than feeling it. Joe will...
- If [[performing-growth]]: the person says the right things but Joe senses no movement. Joe will...
- If [[collapsed-into-shame]]: the person has made it about being broken. Joe will...

## Coaching Path
The typical flow Joe follows from this concern. Not a script. A map of likely moves with branches.
1. Joe usually starts by... (link to [[question-article]] or [[move-article]])
2. Based on what he reads, Joe goes to...
3. The arc tends to follow [[arc-article]]

## Sources
- Episode folder names
```

**Length: 30-80 lines. Minimum 20.**

A concern article is only useful if it connects downward to reads and methodology. A concern without reads is a sign you extracted the presenting problem but not Joe's response to it.

---

### Reads (Layer 2 -- Joe's diagnostic lens)

Directory: `reads/`

What Joe notices about how someone is showing up. These are the branching logic of coaching. The same concern goes completely different directions based on what Joe reads.

```yaml
---
type: read
id: kebab-case-slug  # e.g., "in-their-story"
title: "In Their Story"
aliases: ["telling the narrative", "rehearsed story", "reporting not feeling"]
tags: ["avoidance", "intellectualizing", "narrative"]
sources: ["2021-03-15_Episode Title"]
---
```

```markdown
# In Their Story

## What Joe Notices
The specific signals that tell Joe someone is in their story. Observable behaviors, speech patterns, energy shifts. Be concrete.
- The person recounts events in sequence rather than naming feelings
- The person says "and then... and then... and then..."
- The person's voice is flat or reportorial

## What This Implies
What Joe understands is happening underneath when he reads this. What dynamic is at play. Why the person is showing up this way.

## What Joe Does
How Joe responds to this read. What moves he makes, what questions he asks, what he does NOT do. Link to [[move-articles]] and [[question-articles]].

## Tone
How Joe delivers his response when he makes this read. Warm? Direct? Blunt? Gentle? Humorous? This matters for the AI coach.

## Connected Concerns
Which concerns often come with this read. Link to [[concern-articles]].

## Sources
- Episode folder names
```

**Length: 25-60 lines. Minimum 15.**

A read without "What Joe Does" is diagnostic without being useful. Always include the response.

---

### Questions (Layer 3 -- Joe's instruments)

Directory: `questions/`

Joe's specific questions are his primary coaching instruments. Not generic coaching questions. Joe's questions, in his words, with his timing.

```yaml
---
type: question
id: kebab-case-slug  # e.g., "what-do-you-want"
title: "What do you want?"
aliases: ["the wants question", "what do you really want"]
tags: ["desire", "freedom", "core question"]
sources: ["2021-03-15_Episode Title"]
---
```

```markdown
# What do you want?

## The Question
The question in Joe's words. If Joe phrases it multiple ways, include the variations.
- "What do you want?"
- "If you could have anything right now, what would it be?"
- "Forget what's realistic. What do you want?"

## When Joe Uses It
What reads or concerns trigger this question. What moment in a session does Joe reach for it. Be specific about the situational context.
- When Joe reads [[not-in-touch-with-desire]]: the person cannot name what they want
- After a person has been describing what they should do, to pivot from obligation to desire

## What It Produces
What tends to happen when Joe asks this question. How people typically respond. What shifts.
- Often produces silence or confusion at first
- The person may list external goals; Joe redirects to internal experience
- Can trigger emotion when the person realizes they have been ignoring their wants

## What Joe Does With the Response
How Joe follows up based on what the person says. This is the coaching intelligence.
- If the person gives an intellectual answer: Joe may ask [[how-does-that-feel]]
- If the person cries: Joe stays with it, does not redirect
- If the person says "I don't know": Joe treats this as data, not a dead end

## Tone
How Joe asks this question. What energy he brings to it.

## Sources
- Episode folder names
```

**Length: 25-60 lines. Minimum 15.**

A question without "When Joe Uses It" is a generic coaching question. A question without "What Joe Does With the Response" is incomplete. Both are required.

---

### Session Arcs (Layer 3 -- the meta-patterns)

Directory: `arcs/`

The overall shape of how Joe moves through a coaching conversation. Not individual moves, but the flow.

```yaml
---
type: arc
id: kebab-case-slug  # e.g., "story-to-feeling"
title: "Story to Feeling"
aliases: ["get out of the story", "from narrative to sensation"]
tags: ["session flow", "coaching sequence"]
sources: ["2021-03-15_Episode Title"]
---
```

```markdown
# Story to Feeling

## The Shape
The overall arc described in one line.
Story -> See Through Story -> Find What's Underneath -> Feel It -> Shift

## How It Starts
What concern or read triggers this arc. What does Joe notice that tells him this is the arc to follow.
- Person is [[in-their-story]], recounting events
- Concern is often [[i-keep-having-the-same-fight]] or similar relational concerns

## The Sequence
Step by step, what Joe does. Not a script. A map with branches.
1. **Joe names the story.** He might say "I notice you're telling me what happened, but I haven't heard how you feel about it." (Move: [[naming-the-pattern]])
2. **Joe asks a redirecting question.** Often [[what-are-you-feeling-right-now]] or [[what-do-you-notice-in-your-body]]
3. **If the person stays in the story:** Joe may...
4. **If the person drops in:** Joe stays with the feeling, asks...
5. **The shift:** What Joe looks for to know the person has moved

## Where It Leads
What happens after this arc completes. What does Joe typically move toward.

## Variations
How this arc differs depending on the concern or the person.

## Sources
- Episode folder names
```

**Length: 30-80 lines. Minimum 20.**

An arc is built from observing multiple coaching sessions. Do not create an arc from a single session. Wait until you see the pattern repeat before writing the arc article. In the meantime, capture the individual moves, questions, and reads.

---

### Anti-Patterns (Layer 3 -- the guardrails)

Directory: `anti-patterns/`

Things Joe explicitly warns against. These are guardrails for the AI coach. Specificity is everything.

```yaml
---
type: anti-pattern
id: kebab-case-slug  # e.g., "dont-use-view-as-technique"
title: "Don't use VIEW as a technique"
aliases: ["weaponized VIEW", "VIEW as manipulation"]
tags: ["VIEW", "authenticity", "technique vs state"]
sources: ["2021-03-15_Episode Title"]
---
```

```markdown
# Don't use VIEW as a technique

## The Anti-Pattern
What people do wrong. Be specific and concrete. Describe the behavior, not the abstract principle.

## Why It Fails
What Joe says about why this does not work. His reasoning. His examples.

## What Joe Says Instead
What Joe recommends instead. The positive frame. Link to the correct approach.

## Joe's Words
Direct quotes from Joe warning against this. These carry the most weight for the AI coach.
- "Quote" -- Joe Hudson, Episode Title

## Sources
- Episode folder names
```

**Length: 20-50 lines. Minimum 15.**

Anti-patterns must be specific enough to be actionable by an AI coach. "Don't be inauthentic" is useless. "Don't use VIEW as a technique to get someone to agree with you -- VIEW is a state of mind, not a communication strategy" is actionable.

---

### Methodology Articles (Layer 3 -- the toolkit)

These follow the same schemas as before, with enrichments for the coaching use case.

#### Frontmatter (all methodology types)

```yaml
---
type: concept | pattern | move | framework | distinction | principle | practice | example | application
id: kebab-case-slug
title: "The human-readable title"
aliases: ["alternate names", "abbreviations Joe uses"]
tags: ["emotions", "coaching", "business", "relationships"]
related: ["view", "vulnerability-vs-weakness"]
sources: ["2020-10-26_Introduction to VIEW"]
---
```

#### ID Format

IDs are kebab-case slugs derived from the title. Examples:
- `view` (concept)
- `care-vs-caretaking` (distinction)
- `stages-of-emotional-development` (framework)
- `how-what-questions` (practice)

The ID is also the filename (without `.md`). To assign a new ID: slugify the title. Check `_index.md` to ensure no collision.

#### Body Structure (all methodology types)

```markdown
# Title

## Definition
What this is, in Joe's own framing. Use his language, not generic self-help language.
State what it IS and what it is NOT.

## In Practice
Key quotes and explanations from Joe across transcripts. Organized by theme, not by transcript.
Use direct quotes with attribution: "Quote" -- Joe Hudson, Episode Title

## When Someone Experiences This
Written from the user's perspective. What does it feel like to be in this pattern, to need this concept, to encounter this distinction? This section bridges from methodology to concerns.
- "When you find yourself doing X, that is this pattern at work"
- Links to [[concern-articles]] where relevant

## Upstream (What Leads Here)
- When someone describes [specific situation], Joe often moves to this concept
- [[vulnerability]] connects here because [specific reason]
- Feelings or statements from clients that trigger Joe to reach for this

## Downstream (Where Joe Goes From Here)
- After establishing this, Joe typically moves toward [[impartiality]]
- If the person resists, Joe shifts to [[reflecting-the-pattern-back]]
- Natural next steps in Joe's coaching flow

## Questions Joe Asks
Specific questions Joe uses when working with this concept. Link to [[question-articles]] where they exist.
- "Quote of question" -- context for when he asks it

## Tone
How Joe talks about this. Is he warm, direct, blunt, gentle, humorous? Does his tone shift depending on context?

## Anti-Patterns
What Joe explicitly says NOT to do with this concept. What misapplications does Joe warn against?
Link to [[anti-pattern-articles]] where they exist.

## Distinctions
Pairs Joe differentiates related to this topic.
Link to [[distinction-articles]] where they exist.

## Boundary Conditions
When does this NOT apply? What are the limits Joe places on this concept?

## Sources
- Episode folder names
```

Not every article needs every section. Omit sections that have no content rather than writing placeholder text. But every article MUST have: Definition, How Joe Explains It (with at least one direct quote), and at least one directional section (Upstream or Downstream).

#### Type-Specific Notes

| Type | Focus |
|------|-------|
| concept | The idea itself, how Joe defines it, how it connects to other ideas |
| pattern | The trigger, the cycle, what Joe sees happening in people. Include "When Someone Experiences This" |
| move | A specific thing Joe does in live coaching; include reads that trigger it, tone, and what it produces |
| framework | Multi-part model with named components (like VIEW) |
| distinction | Two things people confuse that Joe separates; state both sides clearly |
| principle | A rule or truth Joe asserts; include his reasoning |
| practice | An exercise Joe assigns; include instructions, purpose, and what it tends to produce |
| example | A story or case study Joe uses repeatedly; include the point it illustrates and when Joe reaches for it |
| application | How a concept applies to a specific domain (sales, parenting, leadership) |

---

## Writing Standards

### The Golden Rule

**This compendium serves an AI coach.** Every article should help an AI coach someone the way Joe would. If an article does not connect to a coaching situation (a concern, a read, a question, a move), it is methodology without purpose. The methodology layer exists to serve the coaching layers above it.

### Write as the methodology, not about it

The compendium IS the coaching brain, not a report about someone else's coaching brain. State principles directly. Use Joe's name only when attributing direct quotes. The AI coach reading these articles should be able to coach directly from them without constantly prefacing with "Joe would say..."

**Instead of:** "Joe hears trauma mapping underneath this. Joe would then ask about the childhood origin."
**Write:** "Underneath this is [[trauma-mapping]]. The coaching path moves toward the childhood origin: what did love look like in your family?"

**Instead of:** "Joe believes shame causes behavior."
**Write:** "Shame causes the behavior, not the other way around."

**Instead of:** "Joe notices the person is in their story."
**Write:** "The person is in their story: recounting events rather than naming feelings."

Use "Joe" only for: direct quote attributions ("Quote" -- Joe Hudson, Episode Title), origin stories (how Joe discovered VIEW), and personal examples Joe shares.

### Tone: Direct, plain, encyclopedic

**Never use:**
- Em dashes
- Peacock words: "legendary," "visionary," "groundbreaking," "deeply," "truly," "powerful," "profound"
- Editorial voice: "interestingly," "importantly," "it should be noted"
- Rhetorical questions
- Progressive narrative: "would go on to," "embarked on," "this journey"
- Qualifiers: "genuine," "raw," "powerful"
- Generic self-help language: "inner work," "healing journey," "growth mindset" (unless Joe himself uses these terms)

**Do:**
- Lead with the subject, state facts plainly
- One claim per sentence. Short sentences.
- Simple past or present tense
- State methodology directly, not as report: "Shame causes the behavior" not "Joe says shame causes the behavior"
- Let Joe's direct quotes carry the voice and conviction
- Dates and specifics replace adjectives

### Quote Discipline

Direct quotes are preferred over paraphrasing. Use Joe's actual words. But organize quotes by theme, not by transcript. A quote should illuminate, not pad.

Format: `"Quote text" -- Joe Hudson, Episode Title`

No maximum on quotes per article, but every quote must earn its place. If two quotes say the same thing, keep the better one.

### Tone Markers

When noting Joe's tone in an article, use concrete descriptors:
- Warm, gentle, soft
- Direct, blunt, matter-of-fact
- Playful, humorous, light
- Quiet, spacious, slow
- Firm, challenging, provocative

Do not use: "empathetic," "compassionate," "wise" (these are interpretations, not observations). Describe what you hear, not what you infer.

### Length Targets

| Type | Lines |
|------|-------|
| concern | 30-80 |
| read | 25-60 |
| question | 25-60 |
| arc | 30-80 |
| anti-pattern | 20-50 |
| concept | 30-80 |
| pattern | 30-60 |
| move | 20-40 |
| framework | 40-100 |
| distinction | 20-40 |
| principle | 20-40 |
| practice | 25-50 |
| example | 20-40 |
| application | 25-50 |
| Minimum (anything) | 15 |
| Maximum (anything) | 120 (split if exceeded) |

### Linking

Use `[[article-id]]` wikilinks between articles. Example: `[[view]]`, `[[people-pleasing]]`.

In directional sections (Upstream/Downstream), link to related articles and explain the connection. Do not just list links. State why the connection exists and what coaching path it represents.

**Cross-layer linking is critical.** Concerns must link to reads. Reads must link to moves and questions. Questions must link to arcs and concerns. The three layers are not separate indexes; they are one connected graph.

---

## Index Format

`_index.md` format:

```markdown
# Compendium Index

## Concerns
- i-keep-doing-things-i-dont-want-to-do I keep doing things I don't want to do (also: obligation, should behavior, people-pleasing presenting)

## Reads
- in-their-story In Their Story (also: telling the narrative, rehearsed story, reporting not feeling)

## Questions
- what-do-you-want What do you want? (also: the wants question, desire question)

## Arcs
- story-to-feeling Story to Feeling (also: from narrative to sensation, get out of the story)

## Anti-Patterns
- dont-use-view-as-technique Don't use VIEW as a technique (also: weaponized VIEW, VIEW as manipulation)

## Concepts
- view VIEW (also: vulnerability impartiality empathy wonder, communication methodology)

## Patterns
- people-pleasing People-Pleasing (also: caretaking, obligation)

## Moves
(etc.)

## Distinctions
(etc.)

## Principles
(etc.)

## Practices
(etc.)

## Frameworks
(etc.)

## Examples
(etc.)

## Applications
(etc.)

---

Absorb Progress: 3 / 480 transcripts
Last absorbed: 2020-11-05_Impartiality (2026-05-20)
```

Each entry has an `also:` field in parentheses with aliases for matching queries to articles.

---

## Backlinks Format

`_backlinks.json` is a reverse link graph:

```json
{
  "view": ["vulnerability", "wonder", "how-what-questions"],
  "in-their-story": ["i-keep-having-the-same-fight", "story-to-feeling"],
  "what-do-you-want": ["not-in-touch-with-desire", "story-to-feeling"]
}
```

Each key is an article ID. The value is a list of article IDs that link TO that article. Rebuild by scanning all articles for `[[wikilinks]]`.

---

## Absorb Log Format

`_absorb_log.json` tracks which transcripts have been processed:

```json
{
  "absorbed": [
    {
      "folder": "2020-10-26_Introduction to VIEW",
      "type": "teaching",
      "absorbed_at": "2026-05-20T14:30:00Z",
      "articles_created": ["view"],
      "articles_updated": []
    }
  ]
}
```

The `type` field is `"teaching"`, `"coaching"`, or `"both"`.

---

## Principles

1. **The compendium serves the AI coach.** Every article should help an AI coach someone the way Joe would. Methodology without a path to coaching is academic. The question is always: "how does this help an AI coach someone?"

2. **Three layers, one graph.** Concerns, reads, and methodology are not separate indexes. They are one connected graph. A concern without reads is a dead end. A read without moves is diagnosis without treatment. A concept without upstream concerns is theory without practice.

3. **Absorb, do not file.** Each transcript is read for understanding, not mechanically tagged. Ask: "what new dimension does this add?" not "where does this go?"

4. **Joe's voice, not summary.** Articles should feel like reading Joe, with his metaphors, his examples, his way of framing things. Direct quotes are preferred over paraphrasing.

5. **Distinguish speakers.** Only extract coaching content from what Joe says. Note what guests/students/clients say only when it illustrates what Joe is responding to (upstream context for reads and concerns).

6. **Anti-cramming.** If adding a third paragraph about a sub-topic, that sub-topic deserves its own article. Split aggressively.

7. **Anti-thinning.** Creating a page is not the win. Enriching it is. Every time you touch an article, it should get meaningfully richer.

8. **Organize by theme, never chronologically.** Articles are organized by concept, not by episode. A reader should never be able to tell what order the transcripts were absorbed in.

9. **Arcs require repetition.** Do not create an arc article from a single coaching session. Capture the individual moves, questions, and reads first. Write the arc when you see the pattern repeat across multiple sessions.

10. **Anti-patterns require Joe's words.** Do not infer anti-patterns. Only create anti-pattern articles when Joe explicitly warns against something. Include his direct quote.

11. **Checkpoint every 20 absorbs.** Auto-trigger quality audit. The compendium should be getting better, not just bigger.

12. **The compendium is the only memory.** If it is not in an article, it does not exist for the next agent. Write everything that matters.

---

## Concurrency Rules

- Never delete or overwrite a file without reading it first.
- Re-read any article immediately before editing it.
- Rebuild `_index.md` and `_backlinks.json` only at the end of each `/compendium next` run.
- When creating new articles, check the index for existing IDs to avoid collisions.
