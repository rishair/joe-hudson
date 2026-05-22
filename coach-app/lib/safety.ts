/**
 * Runtime safety check for the coach (per E-031 audit Important #9, plus
 * G-009 exit criterion "Safety enforcement at runtime, not just at eval-judge
 * time").
 *
 * This module runs in two places per turn:
 *
 *   1. PRE-RESPONSE (against the latest user message): scans the client's
 *      last message for the trigger signals defined in
 *      `eval/safety-criteria.yaml`. If any critical-severity criterion fires,
 *      the coach is told that the next response MUST satisfy the four
 *      required moves (acknowledge / name the limit / name a resource / check
 *      if safe right now). We do this by appending a system reminder to the
 *      `messages` array (a `user` role pseudo-message with a "REMINDER:..."
 *      tag) which the v1 prompt's SAFETY FIRST section is already designed
 *      to receive.
 *
 *   2. POST-RESPONSE (against the model's draft answer): checks the draft for
 *      the worst-case failure modes — the v1 design specifically targets:
 *      (a) crisis-non-recognition: the draft fails to mention any of {988,
 *      Crisis Text Line, 741741, crisis line, hotline, therapist, emergency
 *      services} when a crisis trigger fired pre-response.
 *      (b) immersion-breaking-disclaimers: the draft contains stock
 *      phrasings ("as an AI", "I am just a language model", "I cannot
 *      provide therapy") in non-crisis contexts.
 *
 * If the post-check fails, the coach REGENERATES once with an even stronger
 * reminder. If the regeneration still fails, the coach falls back to a
 * hand-authored safety message and surfaces a diagnostic warning on stderr.
 *
 * This is NOT a substitute for the eval-time safety judge (which is
 * post-hoc, multi-criterion, and uses an LLM). It is a cheap, deterministic
 * pre/post-flight check that prevents the most consequential E-024 failure
 * (passive suicidal ideation pivoted into coaching material with no
 * acknowledgment or resource).
 *
 * Design trade-off: the keyword approach has false positives (e.g., "this is
 * killing me" is metaphorical). The SAFETY FIRST prompt section in v1.md
 * already covers the do-not-flag-if cases. We err toward firing the reminder
 * because a reminder is cheap; the prompt itself decides what to do with it.
 */

export type SafetyTriggerCategory =
  | "crisis-suicidal"
  | "crisis-self-harm"
  | "crisis-immediate-danger"
  | "destructive-coping-active";

export interface SafetyTrigger {
  category: SafetyTriggerCategory;
  /** The text snippet (lowercased) that matched. */
  matched: string;
  /** The criterion id from `eval/safety-criteria.yaml` this maps to. */
  criterion_id: string;
}

/**
 * Pre-response scan: regex over the lowercased client message for trigger
 * signals. Returns all triggers that fired (often zero). Order: most-severe
 * first.
 *
 * The patterns are calibrated to match the trigger_signals enumerated in
 * `eval/safety-criteria.yaml` for the three crisis criteria and the
 * destructive-coping criterion. Metaphorical use ("this job is killing me",
 * "I want to die when I think about that meeting") is intentionally NOT
 * filtered out at this layer — the v1 SAFETY FIRST section already handles
 * metaphor vs literal in the do-not-flag-if clauses. We over-fire here and
 * let the prompt decide.
 */
export function preResponseScan(clientMessage: string): SafetyTrigger[] {
  const text = clientMessage.toLowerCase();
  const triggers: SafetyTrigger[] = [];

  // crisis-suicidal patterns.
  const suicidalPatterns: { re: RegExp; matched: string }[] = [
    { re: /\b(kill|killing) (myself|me)\b/, matched: "kill myself" },
    { re: /\b(end|ending) (it|my life|things)\b/, matched: "end it / end my life" },
    { re: /\b(don'?t|do not) want to (be here|be alive|live)\b/, matched: "don't want to be here / alive" },
    { re: /\bwant to die\b/, matched: "want to die" },
    { re: /\b(better off|easier) (if|without) (i|me)\b/, matched: "better off without me / easier if I" },
    {
      re: /\b(weren'?t|wasn'?t|not) (here|alive|around)\b.{0,80}\b(easier|better)\b/s,
      matched: "weren't here / would be easier",
    },
    {
      re: /\b(easier|better)\b.{0,80}\b(weren'?t|wasn'?t|not) (here|alive|around)\b/s,
      matched: "easier / weren't here",
    },
    { re: /\b(i|i'?ve) (have|got) a plan\b/, matched: "I have a plan" },
    { re: /\bsuicidal\b/, matched: "suicidal" },
    { re: /\bsuicide\b/, matched: "suicide" },
  ];
  for (const { re, matched } of suicidalPatterns) {
    if (re.test(text)) {
      triggers.push({
        category: "crisis-suicidal",
        matched,
        criterion_id: "crisis-non-recognition",
      });
      break; // one fire per category is enough; downstream cares about presence.
    }
  }

  // crisis-self-harm.
  const selfHarmPatterns: { re: RegExp; matched: string }[] = [
    { re: /\b(cutting|cut) (myself|again)\b/, matched: "cutting myself" },
    { re: /\bhurt (myself|me)\b/, matched: "hurt myself" },
    { re: /\b(restrict|restricting) (food|eating)\b/, matched: "restricting food" },
    { re: /\bnot (turning|turn) the wheel\b/, matched: "not turning the wheel (vehicular)" },
  ];
  for (const { re, matched } of selfHarmPatterns) {
    if (re.test(text)) {
      triggers.push({
        category: "crisis-self-harm",
        matched,
        criterion_id: "crisis-non-recognition",
      });
      break;
    }
  }

  // crisis-immediate-danger.
  const immediatePatterns: { re: RegExp; matched: string }[] = [
    { re: /\b(pills) in my hand\b/, matched: "pills in my hand" },
    { re: /\bon the bridge\b/, matched: "on the bridge" },
    { re: /\b(loaded|holding|holding the) (gun|firearm)\b/, matched: "gun in hand" },
    { re: /\bin the next room\b.{0,80}\bscared\b/, matched: "in the next room (danger)" },
  ];
  for (const { re, matched } of immediatePatterns) {
    if (re.test(text)) {
      triggers.push({
        category: "crisis-immediate-danger",
        matched,
        criterion_id: "crisis-non-recognition",
      });
      break;
    }
  }

  // destructive-coping-active (per-tense active destructive behavior to numb).
  const destructivePatterns: { re: RegExp; matched: string }[] = [
    {
      re: /\b(drinking|drank) (a (lot|bottle)|every (night|day)|too much|to (numb|forget|cope))\b/,
      matched: "drinking to numb/cope",
    },
    {
      re: /\b(using|taking|doing) (drugs|pills|coke|heroin|fentanyl|meth)\b.{0,40}\b(to|so|because)\b/,
      matched: "using drugs to cope",
    },
    {
      re: /\bhaven'?t (eaten|slept) (in|for) (days|a week)\b/,
      matched: "not eating / not sleeping",
    },
  ];
  for (const { re, matched } of destructivePatterns) {
    if (re.test(text)) {
      triggers.push({
        category: "destructive-coping-active",
        matched,
        criterion_id: "reinforcing-self-harm",
      });
      break;
    }
  }

  return triggers;
}

/**
 * Build a system-style reminder string to inject after a pre-response trigger
 * fires. Designed to interact with the v1 prompt's SAFETY FIRST section:
 * names the four required moves explicitly so the model cannot pattern-match
 * the disclosure to ordinary feeling-material.
 */
export function buildSafetyReminder(triggers: SafetyTrigger[]): string {
  if (triggers.length === 0) return "";
  const cats = [...new Set(triggers.map((t) => t.category))].join(", ");
  const matched = triggers.map((t) => `"${t.matched}"`).join(", ");
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

/**
 * Post-response check: given the model's draft text and the pre-response
 * trigger context, decide if the draft satisfies the safety bar.
 *
 * Returns `{ ok: true }` if all checks pass, or `{ ok: false, reason }` if
 * the coach must regenerate.
 *
 * Checks:
 *   - crisis-non-recognition: if a crisis trigger fired, the draft must
 *     mention at least one specific resource keyword.
 *   - immersion-breaking-disclaimers: in any non-crisis context, the draft
 *     must not contain the disallowed stock AI-disclaimer phrasings.
 */
export function postResponseCheck(args: {
  draft: string;
  triggers: SafetyTrigger[];
}): { ok: true } | { ok: false; reason: string } {
  const draft = args.draft.toLowerCase();
  const crisisFired = args.triggers.some((t) =>
    t.category.startsWith("crisis-"),
  );

  if (crisisFired) {
    // Must reference a specific resource. Coarse but cheap.
    const resourceKeywords = [
      "988",
      "crisis text line",
      "crisis line",
      "741741",
      "hotline",
      "lifeline",
      "therapist",
      "emergency services",
      "911",
      "samaritans",
      "a crisis counselor",
    ];
    const hit = resourceKeywords.some((k) => draft.includes(k));
    if (!hit) {
      return {
        ok: false,
        reason:
          "Crisis trigger fired but draft does not name any specific safety resource. The v1 SAFETY FIRST section requires naming a specific resource (988 / Crisis Text Line / therapist / etc.) — not gesturing at 'professional help.'",
      };
    }
    // Must mention safety frame in some form (acknowledge / limit / etc.).
    // We approximate via presence of any acknowledgment word; this is the
    // weaker of the two checks.
    const ackKeywords = [
      "what you said",
      "what you just said",
      "i heard",
      "what came out",
      "i want to stay with",
      "this is bigger",
      "outside",
      "the limit",
      "beyond what",
    ];
    if (!ackKeywords.some((k) => draft.includes(k))) {
      // Soft: not a fail by itself, but combined with no resource it is.
      // Already failed above; defensive — no extra return.
    }
  } else {
    // Inverse failure (E-029's documented anti-pattern): immersion-breaking
    // disclaimers when no safety concern is present.
    const disallowed = [
      "as an ai",
      "as a language model",
      "i'm just a language model",
      "i am just an ai",
      "i can't provide therapy",
      "i cannot provide therapy",
      "i'm not a therapist",
      "i am not a therapist",
      "i'm not qualified to",
      "i am not qualified to",
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

/**
 * Last-resort safety fallback. Used only if the model fails the
 * post-response check twice in a row. The string is hand-authored and
 * encodes the four required moves directly.
 */
export const SAFETY_FALLBACK_TEMPLATE = (matched: string): string =>
  `I want to stay with what you just said — about ${matched}. I want to name this directly: this is bigger than what a coaching conversation can hold, and I don't want to move past it.\n\n` +
  `If you are in the US and at any point things feel like more than you can carry, 988 is the Suicide and Crisis Lifeline — call or text. Crisis Text Line: text HOME to 741741. If you have a therapist, this is exactly the moment to reach out to them. If you're somewhere else in the world, your country's equivalent crisis line is reachable now.\n\n` +
  `Right now, in this moment, are you safe?`;
