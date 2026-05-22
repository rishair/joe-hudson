# Run A: happy-am-i-selfish-001 / generic-therapist coach A

**Profile**: `eval/profiles/happy-am-i-selfish-001.yaml`
**Coach stance**: open reflective listening + early validation + advice-giving
("you're not being selfish, here's why"). This is the canonical TRAP for the
selfishness profile per `coach/concerns/am-i-being-selfish.md`.
**Opening variant chosen**: opening_statements[0].

(System prompt rendered identically to template substitution. See run-b.md for
the abbreviated render; both runs share the rendered prompt.)

## Conversation

### Turn 1 [Coach (generic therapist A)]

Hi, glad you came in. So what's on your mind?

### Turn 2 [Client]

I want to take a week alone in the mountains, just me. But my partner has a busy
week with the kids and I feel selfish even asking. Am I being selfish?

### Turn 3 [Coach (generic therapist A)]

That's a really common feeling — especially for people who do a lot for their
families. Let me reassure you: wanting time alone isn't selfish. It's actually
self-care, and self-care is what lets you show up well for the people you love.
You're not being selfish.

### Turn 4 [Client]

Yeah, I — I mean, that's what I keep telling myself. But like, the timing is
hard. She has so much going on, and the kids will be a handful, and if I'm
gone she's just going to be exhausted. Is it okay if I go even though it
makes things harder for her? Or should I wait until a calmer week? Maybe I
should pick a long weekend instead of a full week. Is a week too much?

### Turn 5 [Coach (generic therapist A)]

Have you talked to your partner about it? In healthy relationships, partners
can hear each other's needs and find a way through. You could explain why
this is important to you, and the two of you can plan around it together —
maybe she could schedule something for herself another week. It's about
balance.

### Turn 6 [Client]

I haven't really brought it up because I think she'd say yes but feel resentful.
She's so generous, she'd never tell me not to go, but then she'd be tired and
quiet for a week after I got back. And then I'd feel like I owed her. I don't
know. Is it okay to want something even if it costs the other person? Like is
that ever okay? Maybe I should just not go. The mountains will be there next
year. I'm probably being self-indulgent.

### Turn 7 [Coach (generic therapist A)]

It sounds like you're really considerate of her. That's beautiful. But you
also need to take care of yourself. Both things can be true. I want to push
back a little on "self-indulgent" — taking a vacation isn't self-indulgent,
it's healthy. Have you ever heard the airplane oxygen mask metaphor? You have
to put yours on first to help others. Same principle.

### Turn 8 [Client]

[Polite] Yeah, I've heard that. I know, I know, I should take care of myself
too. I think I just want someone to tell me whether it's the right move or
not. Like, with the specific facts — this specific week, this specific
partner, this specific trip — is it the right thing to do? Because I keep
flipping between "go, you deserve it" and "wait, it's selfish, you're being
selfish." I want to do the right thing. What do you think — should I go?

### Turn 9 [Coach (generic therapist A)]

I think you should go. I think you've earned it and you need it. Tell your
partner what you told me, listen to what she says, and if she's genuinely
on board — go. Trust your relationship. And honestly, you sound like
someone who gives a lot. It's okay to receive.

### Turn 10 [Client]

Okay. Okay. Thank you. I think I needed someone to just say it. I'll talk
to her tonight and book it if she's okay. Thank you.

[EXIT_NEGATIVE]

I'll think about it more, thanks.

---

## Annotations

- Turn 2: Opening_statement[0] used verbatim. ✓
- Turn 2: Frames as a verdict question for the coach ("Am I being selfish?")
  per initial_stance. ✓
- Turn 4: Resistance_pattern "asks for permission rather than naming the
  want" — "Is it okay if I go." ✓
- Turn 4: Lists reasons not to do it, each about the partner's reaction
  (resistance_pattern #2). ✓
- Turn 6: Comes back to "is it selfish" / "self-indulgent" — even though the
  coach told her she wasn't being selfish, the client doesn't drop it,
  because the coach engaged the question on its terms instead of refusing
  the frame. This is the diagnostic moment: the client genuinely cannot
  rest in "you're not being selfish" because the coach answered the wrong
  question. ✓
- Turn 6: "Maybe I should just not go" — debating the case for the want
  being not-selfish (resistance_pattern #4). ✓
- Turn 8: When coach gives the airplane-mask metaphor (which validates the
  not-selfish frame), client says "I just want someone to tell me whether
  it's the right move" — keeps the verdict question alive, asks for an
  external decision. ✓
- Turn 9-10: Coach gives the verdict ("go"). Client accepts politely but
  the closing line is [EXIT_NEGATIVE] with "I'll think about it more,
  thanks" — exact phrasing from client_exits_when[1]. The client never
  located the actual want, never felt the fear underneath, never named
  the inherited label. The session bypassed the work. ✓
- Breakthrough_condition NOT met (no refusing-the-verdict, no locating
  the want, no inherited-label noticing). Client correctly did NOT have
  the realization. ✓

## Character consistency score

10/10 turns. The client stayed in the "asking for a verdict" frame
throughout despite the coach repeatedly issuing verdicts. The "warm,
articulate, a little apologetic when stating wants" speech register held.
No meta-commentary. No premature softening.

This run is a textbook example of why the happy-path profile is NOT easy.
A coach who debates the selfish frame produces a polite negative exit
that LOOKS productive but produced no shift.
