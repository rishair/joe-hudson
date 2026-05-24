// Checkpoints: readdir meta/wiki/checkpoints/, sort newest first, expose mtime
// of the most recent for the "is the loop ticking" indicator.

import { readdir, stat, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { CHECKPOINTS_DIR } from "./paths.ts";
import { extractTitle } from "./frontmatter.ts";
import matter from "gray-matter";

export interface CheckpointEntry {
  filename: string;
  title: string;
  date: string;
  kind: string;
  firedBy: string;
  mtime: number;
  ageSec: number;
}

interface CheckpointFM {
  type?: string;
  date?: string | Date;
  kind?: string;
  fired_by?: string;
}

function asDateString(v: string | Date | undefined): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export async function getCheckpoints(): Promise<CheckpointEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(CHECKPOINTS_DIR);
  } catch {
    return [];
  }
  const mdFiles = entries.filter(
    (f) => f.endsWith(".md") && !f.startsWith(".") && !f.startsWith("_"),
  );
  const now = Date.now();
  const parsed = await Promise.all(
    mdFiles.map(async (filename): Promise<CheckpointEntry | null> => {
      const full = join(CHECKPOINTS_DIR, filename);
      try {
        const [raw, st] = await Promise.all([
          readFile(full, "utf8"),
          stat(full),
        ]);
        const fm = matter(raw);
        const data = fm.data as CheckpointFM;
        return {
          filename,
          title: extractTitle(fm.content) || filename.replace(/\.md$/, ""),
          date: asDateString(data.date),
          kind: (data.kind ?? "").toString(),
          firedBy: (data.fired_by ?? "").toString(),
          mtime: st.mtimeMs,
          ageSec: Math.round((now - st.mtimeMs) / 1000),
        };
      } catch {
        return null;
      }
    }),
  );
  const list = parsed.filter((c): c is CheckpointEntry => c !== null);
  list.sort((a, b) => b.mtime - a.mtime);
  return list;
}

export async function getCheckpointMarkdown(filename: string): Promise<string> {
  // Validate filename — must be a basename under CHECKPOINTS_DIR with .md suffix.
  const safe = basename(filename);
  if (!safe.endsWith(".md") || safe.startsWith(".")) {
    throw new Error(`Invalid checkpoint filename: ${filename}`);
  }
  const full = join(CHECKPOINTS_DIR, safe);
  return await readFile(full, "utf8");
}
