// Thin wrapper around gray-matter for the wiki frontmatter shape.
// Centralizing here so changes to the parser (or swap to a hand-rolled one)
// happen in one place.

import matter from "gray-matter";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface ParsedPage<T = Record<string, unknown>> {
  path: string;
  filename: string;
  data: T;
  content: string;
  mtime: number; // unix ms
}

export async function parseFile<T = Record<string, unknown>>(
  filePath: string,
): Promise<ParsedPage<T>> {
  const [raw, st] = await Promise.all([
    readFile(filePath, "utf8"),
    stat(filePath),
  ]);
  const parsed = matter(raw);
  return {
    path: filePath,
    filename: filePath.split("/").pop() ?? filePath,
    data: parsed.data as T,
    content: parsed.content,
    mtime: st.mtimeMs,
  };
}

export async function parseDirectory<T = Record<string, unknown>>(
  dir: string,
): Promise<ParsedPage<T>[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const mdFiles = entries.filter(
    (f) => f.endsWith(".md") && !f.startsWith("_") && !f.startsWith("."),
  );
  const results = await Promise.all(
    mdFiles.map(async (f) => {
      try {
        return await parseFile<T>(join(dir, f));
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is ParsedPage<T> => r !== null);
}

// Extract the first H1 heading from markdown content (for title preview).
export function extractTitle(content: string): string {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "";
}
