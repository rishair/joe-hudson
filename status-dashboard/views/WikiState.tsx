// Live wiki state: active goals, in-flight items, stale-claim warnings.

import type { SectionResult } from "./types.ts";
import type { WikiState as WikiStateData } from "../lib/wiki-state.ts";
import { SectionError } from "./SectionError.tsx";

export function WikiState({ data }: { data: SectionResult<WikiStateData> }) {
  if (!data.ok) {
    return <SectionError what="Wiki state" error={data.error ?? "unknown error"} />;
  }
  const state = data.value!;
  const activeGoals = state.goals.filter((g) => g.status === "active");

  return (
    <div>
      <h2>Wiki state</h2>

      <div class="counts">
        <span><strong>{state.counts.goalsActive}</strong> active goals</span>
        <span><strong>{state.counts.goalsComplete}</strong> complete</span>
        <span>·</span>
        <span><strong>{state.counts.researchPending}</strong> research pending</span>
        <span><strong>{state.counts.experimentsPending}</strong> experiments pending</span>
        <span><strong>{state.counts.experimentsSucceeded}</strong> exp succeeded</span>
        {state.counts.experimentsBlocked > 0 && (
          <span class="blocked"><strong>{state.counts.experimentsBlocked}</strong> blocked</span>
        )}
      </div>

      {state.stale.length > 0 && (
        <div class="stale-warning">
          <strong>Stale claims ({state.stale.length})</strong> — claim TTL exceeded:
          <ul>
            {state.stale.map((s) => (
              <li>
                <code>{s.id}</code> {s.title}
                {" — "}claimed by {s.claimedBy} {s.ageMinutes}m ago (TTL {s.claimTtlMinutes}m)
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3>In flight ({state.inFlight.length})</h3>
      {state.inFlight.length === 0 ? (
        <p class="empty-state">No items currently claimed.</p>
      ) : (
        <ul class="inflight-list">
          {state.inFlight.map((i) => (
            <li class={i.stale ? "stale" : ""}>
              <code class="id">{i.id}</code>{" "}
              <span class="type">[{i.type}]</span>{" "}
              <span class="parent">[{i.parentGoal}]</span>{" "}
              <span class="title">{i.title}</span>
              <div class="claim-meta">
                claimed by <code>{i.claimedBy || "(unknown)"}</code>{" "}
                {i.ageMinutes}m ago · TTL {i.claimTtlMinutes}m · status {i.status}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>Active goals</h3>
      <ul class="goals-list">
        {activeGoals.map((g) => (
          <li>
            <code class="id">{g.id}</code> {g.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
