// Tiny wrapper around marked for rendering checkpoint/backlog markdown.
// Configured for synchronous use, GFM enabled, with [[wikilinks]] left as text
// (no resolution since the dashboard doesn't link out to wiki pages in v1).

import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(md: string): string {
  // marked.parse is sync when no async extensions are configured
  return marked.parse(md, { async: false }) as string;
}
