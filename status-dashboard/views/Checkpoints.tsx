// Checkpoints list, most-recent first. Click expands to rendered markdown.

import type { SectionResult } from "./types.ts";
import type { CheckpointEntry } from "../lib/checkpoints.ts";
import { SectionError } from "./SectionError.tsx";

function formatAge(sec: number): string {
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ago`;
}

export function Checkpoints({ data }: { data: SectionResult<CheckpointEntry[]> }) {
  if (!data.ok) {
    return <SectionError what="Checkpoints" error={data.error ?? "unknown error"} />;
  }
  const list = data.value ?? [];
  const mostRecent = list[0];
  return (
    <div>
      <h2>
        Checkpoints
        {mostRecent && (
          <span class="subtitle">
            {" "}
            · last: <code>{mostRecent.filename}</code> ({formatAge(mostRecent.ageSec)})
          </span>
        )}
      </h2>
      {list.length === 0 ? (
        <p class="empty-state">No checkpoints found.</p>
      ) : (
        <ul class="checkpoint-list">
          {list.map((c) => (
            <li>
              <details>
                <summary>
                  <code class="filename">{c.filename}</code>{" "}
                  <span class="kind">[{c.kind || "?"}]</span>{" "}
                  <span class="title">{c.title}</span>
                  <span class="age"> · {formatAge(c.ageSec)}</span>
                </summary>
                <div
                  class="checkpoint-body"
                  data-fetch-once={`/api/checkpoint/${encodeURIComponent(c.filename)}`}
                >
                  <em>Loading checkpoint...</em>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
