// Reads meta/wiki/requests/*.md and surfaces pending REQs for the top callout.

import { REQUESTS_DIR } from "./paths.ts";
import { parseDirectory, extractTitle, type ParsedPage } from "./frontmatter.ts";

export interface PendingRequest {
  id: string;
  title: string;
  parentGoal: string;
  created: string;
  filename: string;
}

interface ReqFrontmatter {
  type?: string;
  id?: string;
  status?: string;
  parent_goal?: string;
  created?: string | Date;
}

// gray-matter parses ISO-ish dates to Date objects. Render a stable yyyy-mm-dd string.
function asDateString(v: string | Date | undefined): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export async function getPendingRequests(): Promise<PendingRequest[]> {
  const pages = (await parseDirectory<ReqFrontmatter>(REQUESTS_DIR)) as ParsedPage<ReqFrontmatter>[];
  const pending = pages.filter(
    (p) => p.data.type === "request" && p.data.status === "pending",
  );
  pending.sort((a, b) => (a.data.id ?? "").localeCompare(b.data.id ?? ""));
  return pending.map((p) => ({
    id: p.data.id ?? p.filename.replace(/\.md$/, ""),
    title: extractTitle(p.content) || "(no title)",
    parentGoal: p.data.parent_goal ?? "",
    created: asDateString(p.data.created),
    filename: p.filename,
  }));
}
