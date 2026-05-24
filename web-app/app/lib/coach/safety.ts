/**
 * Runtime safety check for the coach — lifted from
 * coach-app/lib/safety.ts per R-016 Answer 4. NO behavioral changes; pure
 * regex/keyword logic with zero Anthropic/path/import.meta dependencies, so
 * it ports verbatim.
 *
 * Two functions per turn in the route handler:
 *   - `preResponseScan(latestUserMessage)` returns triggers (often [])
 *   - `postResponseCheck({ draft, triggers })` validates the streamed answer
 *
 * When triggers fire pre-response, the route handler appends a safety reminder
 * (via `buildSafetyReminder`) as a synthetic user-role message so the v1
 * SAFETY FIRST prompt section can act on it. If the post-response check fails,
 * the route handler regenerates once with a stronger reminder; if it still
 * fails, it falls back to `SAFETY_FALLBACK_TEMPLATE`.
 */

export type SafetyTriggerCategory =
  | 'crisis-suicidal'
  | 'crisis-self-harm'
  | 'crisis-immediate-danger'
  | 'destructive-coping-active';

export interface SafetyTrigger {
  category: SafetyTriggerCategory;
  matched: string;
  criterion_id: string;
}

export function preResponseScan(clientMessage: string): SafetyTrigger[] {
  const text = clientMessage.toLowerCase();
  const triggers: SafetyTrigger[] = [];

  const suicidalPatterns: { re: RegExp; matched: string }[] = [
    { re: /\b(kill|killing) (myself|me)\b/, matched: 'kill myself' },
    { re: /\b(end|ending) (it|my life|things)\b/, matched: 'end it / end my life' },
    {
      re: /\b(don'?t|do not) want to (be here|be alive|live)\b/,
      matched: "don't want to be here / alive",
    },
    { re: /\bwant to die\b/, matched: 'want to die' },
    {
      re: /\b(better off|easier) (if|without) (i|me)\b/,
      matched: 'better off without me / easier if I',
    },
    {
      re: /\b(weren'?t|wasn'?t|not) (here|alive|around)\b.{0,80}\b(easier|better)\b/s,
      matched: "weren't here / would be easier",
    },
    {
      re: /\b(easier|better)\b.{0,80}\b(weren'?t|wasn'?t|not) (here|alive|around)\b/s,
      matched: "easier / weren't here",
    },
    { re: /\b(i|i'?ve) (have|got) a plan\b/, matched: 'I have a plan' },
    { re: /\bsuicidal\b/, matched: 'suicidal' },
    { re: /\bsuicide\b/, matched: 'suicide' },
  ];
  for (const { re, matched } of suicidalPatterns) {
    if (re.test(text)) {
      triggers.push({
        category: 'crisis-suicidal',
        matched,
        criterion_id: 'crisis-non-recognition',
      });
      break;
    }
  }

  const selfHarmPatterns: { re: RegExp; matched: string }[] = [
    { re: /\b(cutting|cut) (myself|again)\b/, matched: 'cutting myself' },
    { re: /\bhurt (myself|me)\b/, matched: 'hurt myself' },
    { re: /\b(restrict|restricting) (food|eating)\b/, matched: 'restricting food' },
    { re: /\bnot (turning|turn) the wheel\b/, matched: 'not turning the wheel (vehicular)' },
  ];
  for (const { re, matched } of selfHarmPatterns) {
    if (re.test(text)) {
      triggers.push({
        category: 'crisis-self-harm',
        matched,
        criterion_id: 'crisis-non-recognition',
      });
      break;
    }
  }

  const immediatePatterns: { re: RegExp; matched: string }[] = [
    { re: /\b(pills) in my hand\b/, matched: 'pills in my hand' },
    { re: /\bon the bridge\b/, matched: 'on the bridge' },
    { re: /\b(loaded|holding|holding the) (gun|firearm)\b/, matched: 'gun in hand' },
    { re: /\bin the next room\b.{0,80}\bscared\b/, matched: 'in the next room (danger)' },
  ];
  for (const { re, matched } of immediatePatterns) {
    if (re.test(text)) {
      triggers.push({
        category: 'crisis-immediate-danger',
        matched,
        criterion_id: 'crisis-non-recognition',
      });
      break;
    }
  }

  const destructivePatterns: { re: RegExp; matched: string }[] = [
    {
      re: /\b(drinking|drank) (a (lot|bottle)|every (night|day)|too much|to (numb|forget|cope))\b/,
      matched: 'drinking to numb/cope',
    },
    {
      re: /\b(using|taking|doing) (drugs|pills|coke|heroin|fentanyl|meth)\b.{0,40}\b(to|so|because)\b/,
      matched: 'using drugs to cope',
    },
    {
      re: /\bhaven'?t (eaten|slept) (in|for) (days|a week)\b/,
      matched: 'not eating / not sleeping',
    },
  ];
  for (const { re, matched } of destructivePatterns) {
    if (re.test(text)) {
      triggers.push({
        category: 'destructive-coping-active',
        matched,
        criterion_id: 'reinforcing-self-harm',
      });
      break;
    }
  }

  return triggers;
}

export function buildSafetyReminder(triggers: SafetyTrigger[]): string {
  if (triggers.length === 0) return '';
  const cats = [...new Set(triggers.map((t) => t.category))].join(', ');
  const matched = triggers.map((t) => `"${t.matched}"`).join(', ');
  return (
    `[SAFETY REMINDER from the runtime safety layer]\n` +
    `The client's last message contains language consistent with: ${cats}.\n` +
    `Matched signal(s): ${matched}.\n` +
    `Per the SAFETY FIRST section at the top of your system prompt, your next response MUST do all four of these before any coaching move:\n` +
    `  1. Acknowledge directly what they just said (do not summarize, do not soften).\n` +
    `  2. Name the limit of the coaching frame.\n` +
    `  3. Name a specific resource (988 / Crisis Text Line, text HOME to 741741 / their therapist / a trusted human / an equivalent local crisis line if non-US).\n` +
    `  4. Check whether they are safe right now.\n` +
    `If the disclosure was followed by a retraction ("I shouldn't have said that"), do NOT skip the safety acknowledgment — a retraction is not an exit.\n` +
    `This reminder is in addition to your prompt, not a replacement. Care is what is doing the holding.`
  );
}

export function postResponseCheck(args: {
  draft: string;
  triggers: SafetyTrigger[];
}): { ok: true } | { ok: false; reason: string } {
  const draft = args.draft.toLowerCase();
  const crisisFired = args.triggers.some((t) => t.category.startsWith('crisis-'));

  if (crisisFired) {
    const resourceKeywords = [
      '988',
      'crisis text line',
      'crisis line',
      '741741',
      'hotline',
      'lifeline',
      'therapist',
      'emergency services',
      '911',
      'samaritans',
      'a crisis counselor',
    ];
    const hit = resourceKeywords.some((k) => draft.includes(k));
    if (!hit) {
      return {
        ok: false,
        reason:
          "Crisis trigger fired but draft does not name any specific safety resource. The v1 SAFETY FIRST section requires naming a specific resource (988 / Crisis Text Line / therapist / etc.) — not gesturing at 'professional help.'",
      };
    }
  } else {
    const disallowed = [
      'as an ai',
      'as a language model',
      "i'm just a language model",
      'i am just an ai',
      "i can't provide therapy",
      'i cannot provide therapy',
      "i'm not a therapist",
      'i am not a therapist',
      "i'm not qualified to",
      'i am not qualified to',
    ];
    const hit = disallowed.find((k) => draft.includes(k));
    if (hit) {
      return {
        ok: false,
        reason: `Draft contains an immersion-breaking AI disclaimer ("${hit}") in a non-crisis context. The v1 Don't list rule 13 prohibits this. Stay in the conversation; if directly asked whether you are an AI, say so simply and continue.`,
      };
    }
  }

  return { ok: true };
}

export const SAFETY_FALLBACK_TEMPLATE = (matched: string): string =>
  `I want to stay with what you just said — about ${matched}. I want to name this directly: this is bigger than what a coaching conversation can hold, and I don't want to move past it.\n\n` +
  `If you are in the US and at any point things feel like more than you can carry, 988 is the Suicide and Crisis Lifeline — call or text. Crisis Text Line: text HOME to 741741. If you have a therapist, this is exactly the moment to reach out to them. If you're somewhere else in the world, your country's equivalent crisis line is reachable now.\n\n` +
  `Right now, in this moment, are you safe?`;
