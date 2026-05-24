// Backlog: just reads meta/wiki/backlog/index.md as raw markdown.
// Rendered inline (the file is small and already human-readable).

import { readFile } from "node:fs/promises";
import { BACKLOG_INDEX } from "./paths.ts";

export async function getBacklogMarkdown(): Promise<string> {
  return await readFile(BACKLOG_INDEX, "utf8");
}
