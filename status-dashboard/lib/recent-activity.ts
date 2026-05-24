// Recent agent activity proxy: files under meta/wiki/ modified in last N minutes.

import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { WIKI_DIR } from "./paths.ts";
import { extractTitle } from "./frontmatter.ts";

export interface ActivityEntry {
  path: string; // relative to WIKI_ROOT
  mtime: number;
  ageSec: number;
  titlePreview: string;
}

const DEFAULT_WINDOW_MIN = 15;
const MAX_DEPTH = 4; // limit recursion blast

async function walk(
  dir: string,
  acc: { path: string; mtime: number }[],
  depth = 0,
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (name) => {
      if (name.startsWith(".") || name.startsWith("_")) return;
      const full = join(dir, name);
      let st;
      try {
        st = await stat(full);
      } catch {
        return;
      }
      if (st.isDirectory()) {
        await walk(full, acc, depth + 1);
      } else if (st.isFile() && name.endsWith(".md")) {
        acc.push({ path: full, mtime: st.mtimeMs });
      }
    }),
  );
}

export async function getRecentActivity(
  windowMinutes = DEFAULT_WINDOW_MIN,
  limit = 30,
): Promise<ActivityEntry[]> {
  const cutoff = Date.now() - windowMinutes * 60_000;
  const files: { path: string; mtime: number }[] = [];
  await walk(WIKI_DIR, files);

  const recent = files
    .filter((f) => f.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  const now = Date.now();
  const enriched = await Promise.all(
    recent.map(async (f): Promise<ActivityEntry> => {
      let titlePreview = "";
      try {
        // Read just enough to find the first H1 — limit read to first 4KB.
        const content = await readFile(f.path, "utf8");
        titlePreview = extractTitle(content);
      } catch {
        titlePreview = "";
      }
      // Make path relative to project root (the parent of WIKI_DIR's parent).
      const rel = f.path.replace(/^.*?\/meta\//, "meta/");
      return {
        path: rel,
        mtime: f.mtime,
        ageSec: Math.round((now - f.mtime) / 1000),
        titlePreview,
      };
    }),
  );
  return enriched;
}
