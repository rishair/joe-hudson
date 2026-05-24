// Shared section data types. Each section can be in an OK or error state,
// so the same renderer can serve both the full-page and /api/state JSON paths.

import type { PendingRequest } from "../lib/requests.ts";
import type { WikiState as WikiStateData } from "../lib/wiki-state.ts";
import type { ActivityEntry } from "../lib/recent-activity.ts";
import type { CommitEntry, WorkingTreeStatus } from "../lib/git.ts";
import type { CheckpointEntry } from "../lib/checkpoints.ts";

export interface SectionResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export interface SectionData {
  pending: SectionResult<PendingRequest[]>;
  wiki: SectionResult<WikiStateData>;
  activity: SectionResult<ActivityEntry[]>;
  commits: SectionResult<{
    commits: CommitEntry[];
    workingTree: WorkingTreeStatus;
  }>;
  checkpoints: SectionResult<CheckpointEntry[]>;
  backlog: SectionResult<string>;
}
