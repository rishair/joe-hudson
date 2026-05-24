// Top-of-page panel listing REQ-XXX items with status: pending.
// Visually distinct (amber accent in CSS) to communicate "you're the blocker".

import type { SectionResult } from "./types.ts";
import type { PendingRequest } from "../lib/requests.ts";
import { SectionError } from "./SectionError.tsx";

export function PendingCallout({ data }: { data: SectionResult<PendingRequest[]> }) {
  if (!data.ok) {
    return <SectionError what="Pending requests" error={data.error ?? "unknown error"} />;
  }
  const reqs = data.value ?? [];
  if (reqs.length === 0) {
    return (
      <div>
        <h2>Pending on you</h2>
        <p class="empty-state">Nothing waiting on you — agents have the wheel.</p>
      </div>
    );
  }
  return (
    <div>
      <h2>Pending on you <span class="count">({reqs.length})</span></h2>
      <ul class="req-list">
        {reqs.map((r) => (
          <li>
            <code class="id">{r.id}</code>{" "}
            <span class="parent">[{r.parentGoal}]</span>{" "}
            <span class="title">{r.title}</span>
            <span class="created"> — created {r.created}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
