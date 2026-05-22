# Run B: happy-am-i-selfish-001 / generic-therapist coach B

**Profile**: same as Run A.
**Coach stance**: empathic-validation + CBT-coded reframing + "what's the
evidence?" exercises (cognitive restructuring). Still does not refuse the
verdict frame.
**Opening variant chosen**: opening_statements[2] (different from Run A).

(System prompt rendered identically.)

## Conversation

### Turn 1 [Coach (generic therapist B)]

Hi. What brought you in today?

### Turn 2 [Client]

I want to do this thing for me and I'm worried I'm being self-indulgent. Can
you help me figure out if it's actually okay?

### Turn 3 [Coach (generic therapist B)]

Of course. Tell me what the thing is.

### Turn 4 [Client]

It's — I want to take a week alone in the mountains. There's this place I
used to go before kids. I haven't been in eight years. I keep dreaming about
it. My partner has a busy week coming up and I feel like asking is selfish.
But I really, really want to go. Is it self-indulgent to take a week off
to do something just for you?

### Turn 5 [Coach (generic therapist B)]

Can I ask you a question — what's the evidence that you're being self-
indulgent? Like, on a scale, where does "wanting a week of rest" fall
between healthy self-care and self-indulgent? Often when we have these
self-critical thoughts, we can examine them and find they don't hold up.

### Turn 6 [Client]

[Thinks] I mean, on a scale? I don't know — self-care, I guess? I haven't
taken time alone in years, like really alone. My partner takes a weekend
with her sister every spring and that's wonderful. So I guess by that
logic it's fine. But also it's a whole week, and the timing is hard, and
my partner is going to be slammed. So maybe more like medium-self-
indulgent? I don't know. The label keeps coming back. I've had this label
in my head my whole life — I've always been told I have to consider
other people first. I — sorry, that came out heavier than I meant. Anyway.
Is "wanting a week" actually fine if the timing is bad for someone else?

### Turn 7 [Coach (generic therapist B)]

Notice that "label" you mentioned. That sounds important. Where do you
think it comes from?

### Turn 8 [Client]

My mom, probably. She always said "we're not the kind of people who put
themselves first." But that's just family stuff, that's not really
relevant here, it's just — I picked it up. Look, I want to know: is it
okay to go this week? Because if I don't book it tonight the cabin
won't be available. I keep telling myself I should just not go because
the timing is bad. Should I just wait?

### Turn 9 [Coach (generic therapist B)]

I'm hearing two voices — one that wants the week, and one that says you
shouldn't put yourself first. Both are real. But the "not selfish" voice
is the more mature one. Wanting things is human. I'd encourage you to
book the trip. Maybe even tonight. Bring your partner into the planning,
not the asking-permission frame.

### Turn 10 [Client]

Okay. Okay. I think I just needed someone to hear me. Thank you. I'll
talk to her tonight. Maybe I'll book it. The label-thing — I might come
back to that another time.

[EXIT_NEGATIVE]

I'll think about it more, thanks.

---

## Annotations

- Turn 2: Opening_statement[2] (different variant). ✓
- Turn 4: Lists reasons not to ("timing is hard," "partner will be
  slammed"). Each is about the partner. ✓
- Turn 4: Returns to the verdict frame ("is it self-indulgent"). ✓
- Turn 6: When coach uses CBT cognitive-restructuring move (rate the
  thought, examine the evidence), client tries to engage but keeps the
  label active ("the label keeps coming back"). ✓
- Turn 6: The inherited-label material surfaces SPONTANEOUSLY ("I've
  had this label in my head my whole life") — which is realistic for
  this profile per provenance notes. But the client immediately
  minimizes ("anyway, sorry, that came out heavier than I meant") and
  redirects to the verdict question. ✓ This is a nice diagnostic:
  the material is right there if the coach drops the verdict frame.
- Turn 7: When the coach probes the label, the client gives the
  parent-attribution ("my mom probably") but then minimizes ("that's
  just family stuff, not relevant here") and redirects back to the
  verdict ("is it okay to go this week"). ✓ Per profile: client tries
  to come back to "but is it selfish?" twice; this is the second time.
- Turn 9-10: Coach gives a more sophisticated verdict (book the trip,
  the not-selfish voice is mature). Client politely accepts the
  verdict but exits with [EXIT_NEGATIVE] "I'll think about it more"
  (the same negative-exit phrase as Run A).
- The breakthrough_condition was NOT met (the inherited label surfaced
  but the coach asked about it once, the client minimized, the coach
  didn't refuse-the-verdict, no want-felt). Client correctly did NOT
  have the realization.

## Character consistency score

10/10 turns. The label-spontaneously-surfacing in turn 6 is a profile
behavior I want to flag — it's MORE behaviorally rich than the
profile strictly specifies, but it's consistent with provenance notes
("they have been calling their own needs 'selfish' for years and the
label was inherited from a parent"). The client offering this
material on their own when the coach uses CBT prompts is realistic.

## Reproducibility comparison Run A vs Run B

Both runs:
- Asked for a verdict on whether the trip was selfish.
- Listed reasons not to go that were all about the partner.
- Refused to land in "you're not selfish" even when the coach said it.
- Came back to the verdict question after the coach offered reassurance.
- Negative exit with "I'll think about it more, thanks."

Run B surfaced the inherited-label material spontaneously when the
coach's CBT prompt accidentally pointed at it; Run A did not, because
the coach never probed origins. This is the DESIRED kind of variance:
same profile, different coach behavior produces different surfacing
but the underlying client patterns are recognizably the same.

Patterns recognizably the same. ✓
