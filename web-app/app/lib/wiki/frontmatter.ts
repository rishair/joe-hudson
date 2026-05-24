// Minimal frontmatter parser tuned to the coach/ corpus shape.
//
// The corpus uses YAML-lite: `key: value` lines, with `value` being either
// a scalar, an inline JSON-style array `[...]`, or a quoted string. There
// are no nested objects, no multi-line block strings, no YAML anchors, and
// no multi-line block-list arrays (R-018 verified 100% of `related:`
// entries are inline-array form). A real YAML parser (`yaml`/`js-yaml`)
// would work too but adds a dep and runtime cost for behavior we don't
// need; the inline parser below is ~40 lines and exact for this corpus.

export type ParsedDoc = {
  frontmatter: Record<string, unknown>;
  body: string;
};

export function parseFrontmatter(raw: string): ParsedDoc {
  // Files start with `---\n`, end the frontmatter at the next `---\n`. The
  // body follows. Files without a leading `---` are treated as bodyless
  // (returned as `{frontmatter: {}, body: raw}`); the corpus has no such
  // files today, but the script is defensive.
  if (!raw.startsWith('---\n')) {
    return { frontmatter: {}, body: raw };
  }
  const close = raw.indexOf('\n---\n', 4);
  if (close === -1) {
    return { frontmatter: {}, body: raw };
  }
  const fmText = raw.slice(4, close);
  const body = raw.slice(close + 5);
  const frontmatter: Record<string, unknown> = {};
  for (const line of fmText.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = m[2];
    frontmatter[key] = parseValue(value);
  }
  return { frontmatter, body };
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  // Inline JSON-style array. The corpus uses `["a", "b", "c"]`.
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through; treat as a plain string.
    }
  }
  // Quoted string.
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
