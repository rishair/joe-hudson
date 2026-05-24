// Git-backed views: recent commits + per-commit diff + working-tree dirty state.
//
// Filtering own commits: two layers documented in E-050:
//  1. Path filter via pathspec ':(exclude)status-dashboard/' to drop
//     commits that touched only the dashboard.
//  2. Subject filter via --invert-grep --grep='^dash:' to drop commits
//     using the convention `dash:` prefix.
//
// Worst case if both miss: a dashboard commit shows up in recent-commits.
// Mildly noisy, not a correctness bug.

import { $ } from "bun";
import { WIKI_ROOT } from "./paths.ts";

export interface CommitEntry {
  hash: string;
  shortHash: string;
  subject: string;
  relativeTime: string;
  author: string;
  // diff stats (insertions, deletions, fileCount) populated lazily on the
  // detail fetch — keep the list response small.
}

export interface WorkingTreeStatus {
  dirty: boolean;
  files: { status: string; path: string }[];
}

const DIFF_TRUNCATE_BYTES = 200 * 1024; // 200 KB

export async function getRecentCommits(limit = 20): Promise<CommitEntry[]> {
  // Use a clear delimiter that won't appear in commit subjects.
  const SEP = "\x1f"; // ASCII unit separator
  const REC = "\x1e"; // ASCII record separator
  // --invert-grep + --grep='^dash:' filters dashboard-only commits by subject
  // Pathspec at the end excludes commits that ONLY touched status-dashboard/
  // (commits touching both dashboard and other paths still appear).
  const out =
    await $`git -C ${WIKI_ROOT} log -n ${String(limit)} --pretty=format:%H${SEP}%s${SEP}%cr${SEP}%an${REC} --invert-grep --grep=^dash: -- . ":(exclude)status-dashboard/"`
      .text();
  const records = out.split(REC).map((r) => r.trim()).filter(Boolean);
  return records.map((rec) => {
    const [hash, subject, relativeTime, author] = rec.split(SEP);
    return {
      hash: hash ?? "",
      shortHash: (hash ?? "").slice(0, 7),
      subject: subject ?? "",
      relativeTime: relativeTime ?? "",
      author: author ?? "",
    };
  });
}

export async function getCommitDiff(hash: string): Promise<{
  diff: string;
  truncated: boolean;
}> {
  // Validate hash format — only allow [0-9a-f]{6,40} to be safe even though
  // Bun.$ properly escapes args. Pure defense in depth.
  if (!/^[0-9a-f]{6,40}$/i.test(hash)) {
    throw new Error(`Invalid commit hash: ${hash}`);
  }
  const out =
    await $`git -C ${WIKI_ROOT} show --stat --patch ${hash}`.text();
  if (out.length > DIFF_TRUNCATE_BYTES) {
    return {
      diff:
        out.slice(0, DIFF_TRUNCATE_BYTES) +
        `\n\n... (diff truncated at ${DIFF_TRUNCATE_BYTES} bytes; run \`git show ${hash}\` locally for the full diff)`,
      truncated: true,
    };
  }
  return { diff: out, truncated: false };
}

export async function getWorkingTreeStatus(): Promise<WorkingTreeStatus> {
  try {
    const out = await $`git -C ${WIKI_ROOT} status --porcelain=v1`.text();
    const lines = out.split("\n").filter((l) => l.trim().length > 0);
    const files = lines.map((line) => {
      const status = line.slice(0, 2);
      const path = line.slice(3);
      return { status, path };
    });
    return { dirty: files.length > 0, files };
  } catch {
    return { dirty: false, files: [] };
  }
}
