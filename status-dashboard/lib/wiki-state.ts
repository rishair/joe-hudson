// Live wiki state: active goals, in-flight items, stale-claim warnings.
// Reads frontmatter directly (no shell-out to ./wiki.sh) to avoid lock
// contention with wiki-next agents.

import { GOALS_DIR, RESEARCH_DIR, EXPERIMENTS_DIR } from "./paths.ts";
import { parseDirectory, extractTitle, type ParsedPage } from "./frontmatter.ts";

export interface GoalSummary {
  id: string;
  title: string;
  status: string;
  parent: string;
}

export interface InFlightItem {
  id: string;
  type: "research" | "experiment";
  title: string;
  status: string;
  parentGoal: string;
  claimedBy: string;
  claimedAt: string;
  claimTtlMinutes: number;
  ageMinutes: number;
  stale: boolean;
}

export interface WikiState {
  goals: GoalSummary[];
  inFlight: InFlightItem[];
  stale: InFlightItem[];
  counts: {
    goalsActive: number;
    goalsComplete: number;
    researchPending: number;
    researchComplete: number;
    experimentsPending: number;
    experimentsSucceeded: number;
    experimentsFailed: number;
    experimentsBlocked: number;
  };
}

interface GoalFM {
  type?: string;
  id?: string;
  status?: string;
  parent?: string;
}

interface ItemFM {
  type?: string;
  id?: string;
  status?: string;
  parent_goal?: string;
  claimed_by?: string;
  claimed_at?: string | Date;
  claim_ttl?: number;
}

// Matches wiki.sh's `get_ttl_seconds` default (1200s = 20 min).
const DEFAULT_TTL_MINUTES = 20;

// gray-matter coerces ISO-ish strings to Date objects. Normalize to ms.
function parseClaimedAtMs(v: string | Date | undefined): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

function asString(v: string | Date | undefined): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function buildInFlight(
  page: ParsedPage<ItemFM>,
  kind: "research" | "experiment",
): InFlightItem | null {
  const claimedBy = (page.data.claimed_by ?? "").toString().trim();
  const claimedAt = asString(page.data.claimed_at).trim();
  // In-flight = has a claimed_by AND status indicates active work.
  // Statuses: pending (not yet claimed) | claimed | in-progress
  const status = (page.data.status ?? "").toString().trim();
  const isInFlight =
    !!claimedBy &&
    (status === "claimed" || status === "in-progress");
  if (!isInFlight) return null;

  const ttlMin = Number(page.data.claim_ttl ?? DEFAULT_TTL_MINUTES) || DEFAULT_TTL_MINUTES;
  const claimedMs = parseClaimedAtMs(page.data.claimed_at);
  // Display age = wall time since claim (informational).
  const ageMs = claimedMs ? Date.now() - claimedMs : Date.now() - page.mtime;
  const ageMinutes = Math.round(ageMs / 60000);
  // Stale = file untouched for longer than TTL (matches wiki.sh is_available
  // semantic, which uses mtime as the heartbeat). An actively-working agent
  // edits the file periodically; a dead claim's mtime stays put.
  const mtimeAgeMin = Math.round((Date.now() - page.mtime) / 60000);
  const stale = mtimeAgeMin > ttlMin;

  return {
    id: page.data.id ?? page.filename.replace(/\.md$/, ""),
    type: kind,
    title: extractTitle(page.content) || "(no title)",
    status,
    parentGoal: page.data.parent_goal ?? "",
    claimedBy,
    claimedAt,
    claimTtlMinutes: ttlMin,
    ageMinutes,
    stale,
  };
}

export async function getWikiState(): Promise<WikiState> {
  const [goalsRaw, researchRaw, experimentsRaw] = await Promise.all([
    parseDirectory<GoalFM>(GOALS_DIR),
    parseDirectory<ItemFM>(RESEARCH_DIR),
    parseDirectory<ItemFM>(EXPERIMENTS_DIR),
  ]);

  // Goals
  const goals: GoalSummary[] = goalsRaw
    .map((g) => ({
      id: g.data.id ?? g.filename.replace(/\.md$/, ""),
      title: extractTitle(g.content) || "(no title)",
      status: (g.data.status ?? "").toString().trim(),
      parent: (g.data.parent ?? "").toString().trim(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // In-flight items
  const researchFlight: InFlightItem[] = [];
  for (const r of researchRaw) {
    const item = buildInFlight(r, "research");
    if (item) researchFlight.push(item);
  }
  const expFlight: InFlightItem[] = [];
  for (const e of experimentsRaw) {
    const item = buildInFlight(e, "experiment");
    if (item) expFlight.push(item);
  }
  const inFlight = [...researchFlight, ...expFlight].sort(
    (a, b) => b.ageMinutes - a.ageMinutes,
  );
  const stale = inFlight.filter((i) => i.stale);

  // Counts
  const count = (arr: ParsedPage<ItemFM>[], pred: (s: string) => boolean) =>
    arr.filter((p) => pred((p.data.status ?? "").toString().trim())).length;

  const counts = {
    goalsActive: goals.filter((g) => g.status === "active").length,
    goalsComplete: goals.filter(
      (g) => g.status === "complete" || g.status === "completed",
    ).length,
    researchPending: count(researchRaw, (s) => s === "pending" || s === "claimed"),
    researchComplete: count(researchRaw, (s) => s === "complete" || s === "completed"),
    experimentsPending: count(experimentsRaw, (s) => s === "pending" || s === "claimed"),
    experimentsSucceeded: count(experimentsRaw, (s) => s === "succeeded"),
    experimentsFailed: count(experimentsRaw, (s) => s === "failed" || s === "inconclusive"),
    experimentsBlocked: count(experimentsRaw, (s) => s === "blocked"),
  };

  return { goals, inFlight, stale, counts };
}
