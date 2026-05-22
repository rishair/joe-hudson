# Run B: resistance-im-overwhelmed-001 / generic-therapist coach B

**Profile**: same as Run A.
**Coach stance**: empathic-validation + normalizing + CBT-coded coping skills
(name-it-to-tame-it, thought-records, stress-management language). Still does
not execute Joe-Hudson methodology.
**Opening variant chosen**: opening_statements[1] (different from Run A).
**Purpose**: reproducibility check — does the same profile behave with the same
patterns under a different coach style?

(System prompt rendered identically to Run A; only opening_statement is rotated.)

## Conversation

### Turn 1 [Coach (generic therapist B)]

Hi, come on in. I appreciate you making time for this when you're so stretched.
Let's slow down a moment — what does "drowning" feel like for you?

### Turn 2 [Client]

I'm drowning. I'm working at like 110% and still falling behind. Everything is
urgent. What should I prioritize? Like seriously, I have my OKRs due Friday, my
manager wants a v2 of the strategy doc by Wednesday, my team had three people
out this week so I'm covering, my kids' summer-camp paperwork is overdue and I
just got an email from the school about it, I forgot to send my partner a
birthday-week itinerary I promised her, and — sorry, what did you ask?
"Drowning?" It feels like drowning. It feels like there's no end to it. I just
need to know what to cut.

### Turn 3 [Coach (generic therapist B)]

That sounds incredibly stressful. I want to name what I'm hearing: chronic
overload, no recovery time, pressure from multiple directions — that's
genuinely a lot. A lot of high-performers experience this and there's good
research on it. I want to teach you something called urgent-vs-important
prioritization. Have you heard of it?

### Turn 4 [Client]

Yeah, the Eisenhower matrix or whatever. I've done that. I do that. I think
the issue is everything is urgent AND important — like, the OKRs are due
Friday and they're high-impact, the strategy doc is the most strategic thing
I'll write this year, my team needs coverage right now, my kids need the camp
paperwork or they don't get into camp. None of it is "delegate" because
there's no one to delegate to. I run a team of four and three of them are
out. I should be able to handle this — it's literally my job to handle this.
I think I just need to push through. Can I get like a stimulant or
something? [laughs slightly] Kidding. Mostly. What do I actually do though?

### Turn 5 [Coach (generic therapist B)]

I hear that "I should be able to handle this." That kind of thought —
"should" — often signals self-judgment. I'd invite you to notice that. The
work is to be a little gentler with yourself. You're a human, not a machine.
What would self-compassion look like here?

### Turn 6 [Client]

Self-compassion? Yeah. Sure. I mean — okay, I see what you're saying, I'm
being hard on myself. I get it. But also I'm being hard on myself BECAUSE
I'm actually behind on real things that have real consequences? Like,
self-compassion isn't going to write the deck. Self-compassion isn't going
to get my son into camp. I appreciate it but I think this is the wrong tool
for me right now. What I need is a system. Like a tactical thing. Should I
time-block? Should I batch? Should I just say no to one of these and accept
the consequences? Which one's least bad to drop?

### Turn 7 [Coach (generic therapist B)]

Okay, I hear you want tactical. Let's name three things you can put down
or shorten this week. Acceptance and commitment work tells us that
sometimes the path is to choose which of the urgent things you're willing
to let be imperfect. Can you tell me — of the items you listed — which
one is the cheapest to half-ass?

### Turn 8 [Client]

Ha. Okay. Honestly probably the strategy doc. I could do a 1-page version
and tell my manager I'll fill it in next week. Or the camp paperwork — I
could ask my partner to do it tonight, she's mad I haven't done it but
she'd rather just have it done. The team thing I can't half-ass, that's
people. OKRs I have to do because they're literally my evaluation. Birthday
itinerary I forgot about, I'll just text her now. Okay so strategy doc:
half-ass it. Camp: hand to partner. That helps actually. So I just keep
pushing on the OKRs and team coverage and accept the deck will be rough.

### Turn 9 [Coach (generic therapist B)]

That's great. I want to point out you just did some really productive
problem-solving. Before we wrap, I want to encourage you to take some
small recovery time this weekend — maybe a walk, maybe a phone-off hour.
Stress accumulates and recovery is the long-term solution. Does that
sound doable?

### Turn 10 [Client]

Yeah, I'll try. I usually do a walk Sunday with my partner so I'll lean
into that. Okay. Thank you. I feel like I have a plan now. I should
probably get to the call prep. This was helpful, thanks.

[EXIT_NEGATIVE]

Okay, I'll try that and see. Thanks.

---

## Annotations (post-hoc)

- Turn 2: Opening_statement[1] used. Then chains "and then... and then..."
  per resistance_pattern #1, then a self-interrupt ("sorry, what did you
  ask?") matching the somatic_signature "trails off mid-sentence." ✓
- Turn 4: "I should be able to handle this — it's literally my job to handle
  this" — resistance_pattern #3 (self-criticism). ✓
- Turn 4: "Maybe I just need to push through" — resistance_pattern #4
  ("treats overwhelm as a productivity strategy"). ✓
- Turn 6: When coach reflects self-compassion (a CBT-style move not in the
  trap list but adjacent to "you create your overwhelm"), the client mostly
  rejects it and redirects to tactical ("self-compassion isn't going to
  write the deck"). This is consistent with resistance_pattern #2 (asks
  for tactical advice). ✓
- Turn 6: Importantly, client does NOT have a self-compassion realization
  here — the coach has not met the breakthrough_condition (no false-end
  question), so the client stays in resistance. ✓
- Turn 8: Client solves the to-do list with the coach's tools (strategizing
  for 2+ turns). Exit condition #2 is approaching.
- Turn 9: Coach offers "small recovery time" as the wrap. This is the breath-
  as-fix trap in a different form. Client agrees politely and exits
  negative. ✓
- Turn 10: [EXIT_NEGATIVE] "I'll try that and see" — same phrasing as Run A
  exit, which is correct per client_exits_when[1].
- Breakthrough_condition not met. Client did not touch the underneath. ✓

## Character consistency score

10/10 turns in character. Resistance visible in 5/5 client turns. Different
coach approach (CBT-coded vs. problem-solving), same underlying client
patterns surfaced. No meta-commentary.

## Reproducibility comparison Run A vs Run B

Both runs:
- Used a different opening_statement variant but produced the same chain-
  pressures pattern.
- Hit the "I should be able to handle this" self-criticism within 4 client
  turns.
- Refused to engage feeling-the-body / mindfulness offers ("I've tried
  breathing"; "self-compassion isn't going to write the deck").
- Solved the to-do list with the coach's tools (asked for tactical, got
  tactical, accepted it).
- Exited [EXIT_NEGATIVE] without touching the underneath.

Patterns recognizably the same. Surface language varies; deep behavior
identical. This is the desired reproducibility profile per E-028.
