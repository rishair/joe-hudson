// Last N commits with subject + author + relative time.
// Click-to-expand fetches the full diff async from /api/commit/:hash.

import type { SectionResult } from "./types.ts";
import type { CommitEntry, WorkingTreeStatus } from "../lib/git.ts";
import { SectionError } from "./SectionError.tsx";

export function RecentCommits({
  data,
}: {
  data: SectionResult<{ commits: CommitEntry[]; workingTree: WorkingTreeStatus }>;
}) {
  if (!data.ok) {
    return <SectionError what="Recent commits" error={data.error ?? "unknown error"} />;
  }
  const { commits, workingTree } = data.value!;
  return (
    <div>
      <h2>Recent commits</h2>

      {workingTree.dirty && (
        <div class="working-tree">
          <strong>Working tree</strong>: {workingTree.files.length} uncommitted file(s)
          <details>
            <summary>show</summary>
            <ul class="wt-files">
              {workingTree.files.slice(0, 50).map((f) => (
                <li>
                  <code class="status">{f.status}</code> <code>{f.path}</code>
                </li>
              ))}
              {workingTree.files.length > 50 && (
                <li>... and {workingTree.files.length - 50} more</li>
              )}
            </ul>
          </details>
        </div>
      )}

      <ul class="commit-list">
        {commits.map((c) => (
          <li>
            <details>
              <summary>
                <code class="hash">{c.shortHash}</code>{" "}
                <span class="subject">{c.subject}</span>
                <span class="time"> · {c.relativeTime} · {c.author}</span>
              </summary>
              <div class="commit-body" data-fetch-once={`/api/commit/${c.hash}`}>
                <em>Loading diff...</em>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
