// Recent agent activity: meta/wiki/ files modified in last 15min.

import type { SectionResult } from "./types.ts";
import type { ActivityEntry } from "../lib/recent-activity.ts";
import { SectionError } from "./SectionError.tsx";

function formatAge(sec: number): string {
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export function RecentActivity({ data }: { data: SectionResult<ActivityEntry[]> }) {
  if (!data.ok) {
    return <SectionError what="Recent agent activity" error={data.error ?? "unknown error"} />;
  }
  const entries = data.value ?? [];
  return (
    <div>
      <h2>Recent agent activity <span class="subtitle">(last 15 minutes)</span></h2>
      {entries.length === 0 ? (
        <p class="empty-state">No wiki edits in the last 15 minutes.</p>
      ) : (
        <ul class="activity-list">
          {entries.map((e) => (
            <li>
              <span class="age">{formatAge(e.ageSec)}</span>{" "}
              <code class="path">{e.path}</code>
              {e.titlePreview && (
                <div class="preview">{e.titlePreview}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
