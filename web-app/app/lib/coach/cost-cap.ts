import 'server-only';

/**
 * Process-level cumulative-cost circuit breaker for the chat route.
 *
 * Per R-016 + E-043 method step 5: with no auth in v1, per-IP or per-user caps
 * are unworkable. Instead we track total LLM spend (retrieval + coach) for
 * THIS PROCESS, since startup. When spend exceeds `OPENROUTER_DAILY_CAP` USD
 * (default $5), the route handler returns HTTP 503 and refuses to invoke the
 * model. Restarting the process resets the budget — this is intentionally
 * minimal protection against runaway loops, NOT a billing-grade quota.
 *
 * Auth-gated per-user/per-IP limits are a G-011+ concern.
 *
 * In-memory only; if the process restarts or scales horizontally, each
 * instance has its own counter. The cap is meant to be a low-cost backstop
 * that catches "I left it open on a tab overnight" or "a bug retried 1000x" —
 * not a hard budget guarantee.
 */

function parseCap(): number {
  const raw = process.env.OPENROUTER_DAILY_CAP;
  if (!raw) return 5;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    // Fail loud rather than degrade silently.
    throw new Error(
      `OPENROUTER_DAILY_CAP must be a non-negative number; got "${raw}"`,
    );
  }
  return n;
}

const BUDGET_USD = parseCap();

type Counter = { spentUsd: number; startedAt: number };

const STATE: Counter = { spentUsd: 0, startedAt: Date.now() };

export function getBudgetCapUsd(): number {
  return BUDGET_USD;
}

export function getSpentUsd(): number {
  return STATE.spentUsd;
}

export function getRemainingUsd(): number {
  return Math.max(0, BUDGET_USD - STATE.spentUsd);
}

/**
 * Call BEFORE invoking the LLM. Returns `{ allowed: true }` if there's any
 * remaining budget, or `{ allowed: false, reason }` if the cap is exhausted.
 * The route handler should return HTTP 503 with `reason` if disallowed.
 */
export function checkBudget(): { allowed: true } | { allowed: false; reason: string } {
  if (STATE.spentUsd >= BUDGET_USD) {
    // Format both sides at the same precision so 0.0001-budget tests don't
    // render the cap as $0.00.
    const precision = BUDGET_USD < 0.01 ? 6 : 4;
    return {
      allowed: false,
      reason:
        `Process-level OpenRouter spend cap reached ` +
        `($${STATE.spentUsd.toFixed(precision)} of $${BUDGET_USD.toFixed(precision)}). ` +
        `Restart the server to reset.`,
    };
  }
  return { allowed: true };
}

/**
 * Call AFTER each LLM call (coach turn AND each walker step) to accumulate
 * actual incurred cost. Returns the new running total for logging.
 */
export function recordSpend(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) return STATE.spentUsd;
  STATE.spentUsd += usd;
  return STATE.spentUsd;
}

/**
 * For tests / dev tooling.
 */
export function _resetForTest(): void {
  STATE.spentUsd = 0;
  STATE.startedAt = Date.now();
}
