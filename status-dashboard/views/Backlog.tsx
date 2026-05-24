// Backlog: render meta/wiki/backlog/index.md inline as HTML.

import type { SectionResult } from "./types.ts";
import { SectionError } from "./SectionError.tsx";
import { renderMarkdown } from "../lib/markdown.ts";
import { raw } from "hono/html";

export function Backlog({ data }: { data: SectionResult<string> }) {
  if (!data.ok) {
    return <SectionError what="Backlog" error={data.error ?? "unknown error"} />;
  }
  const md = data.value ?? "";
  const html = renderMarkdown(md);
  return (
    <div>
      <h2>Backlog</h2>
      <div class="backlog-body">{raw(html)}</div>
    </div>
  );
}
