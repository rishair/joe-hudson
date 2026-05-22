#!/usr/bin/env python3
"""
Build the embedding index for E-033 (Coach v3: embedding-based retrieval).

Per R-012's spec:
  - One file = one document (no sub-chunking).
  - Embedding text = `title + aliases (joined) + body up to first ## heading`.
  - Embedding model = bge-small-en-v1.5 via fastembed (free local CPU).
  - Store in SQLite for cosine-similarity lookup.

Schema:
  documents(
    file_id TEXT PRIMARY KEY,    -- e.g., "concerns/im-not-an-anxious-person"
    category TEXT,                -- e.g., "concerns"
    slug TEXT,                    -- e.g., "im-not-an-anxious-person"
    title TEXT,
    aliases_json TEXT,            -- JSON array of aliases
    aliases_concat TEXT,          -- aliases joined with " | " for BM25-over-aliases
    body_excerpt TEXT,            -- title + aliases concatenated + body up to first ## heading
    full_body TEXT,               -- the full file content (markdown), for retrieval-time inlining
    embedding BLOB                -- float32 array, dim=384
  )
  meta(key TEXT PRIMARY KEY, value TEXT) -- "model_name", "dim", "built_at", "doc_count"

Usage:
  python3 coach-app/retrieval/build_index.py \
    --coach-dir coach \
    --out coach-app/index.db \
    [--model BAAI/bge-small-en-v1.5]

Idempotent: re-running rebuilds the index from scratch.

E-033 inherits R-012's settings; do not change embedding model or text
composition here without updating R-012 / E-033.
"""

import argparse
import json
import os
import re
import sqlite3
import struct
import sys
import time
from pathlib import Path
from typing import Iterator

# Parse minimal YAML frontmatter from a markdown file. We deliberately avoid
# adding a PyYAML dependency to keep the script dep-light. Frontmatter in the
# compendium is single-document, uses simple flow-style for arrays of strings,
# and is bounded by leading and trailing "---" lines.
FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Return (frontmatter_dict, body_without_frontmatter).

    The frontmatter parser handles:
      key: value (single-line scalar)
      key: "value with: colons"  (quoted)
      key: ["a", "b", "c"]  (inline list of strings)
      key: [a, b, c]  (inline list of bare tokens)

    It does NOT handle multi-line block scalars or nested maps because the
    compendium frontmatter does not use them. If frontmatter cannot be parsed
    fully, the unknown keys are skipped (best-effort).
    """
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    fm_text = m.group(1)
    body = text[m.end():]
    fm: dict = {}
    for raw_line in fm_text.split("\n"):
        line = raw_line.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip()
        if not val:
            fm[key] = ""
            continue
        # Inline list?
        if val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            if not inner:
                fm[key] = []
                continue
            items: list[str] = []
            # split on commas not inside quotes
            cur: list[str] = []
            in_q: str | None = None
            for ch in inner:
                if in_q:
                    if ch == in_q:
                        in_q = None
                    else:
                        cur.append(ch)
                else:
                    if ch in ('"', "'"):
                        in_q = ch
                    elif ch == ",":
                        items.append("".join(cur).strip())
                        cur = []
                    else:
                        cur.append(ch)
            if cur:
                items.append("".join(cur).strip())
            items = [it.strip(" \"'") for it in items if it.strip()]
            fm[key] = items
            continue
        # Quoted scalar?
        if (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        ):
            fm[key] = val[1:-1]
            continue
        # Bare scalar
        fm[key] = val
    return fm, body


HEADING_RE = re.compile(r"^##\s", re.MULTILINE)


def body_up_to_first_subheading(body: str) -> str:
    """Return body content from the start through (but not including) the first
    "## " heading. Per R-012: this biases the embedded representation toward
    the file's framing/headline content rather than later expository sections.
    If the body has no subheading, the whole body is returned.

    The leading "# Title" line is preserved (it is the level-1 heading and the
    file's primary framing).
    """
    m = HEADING_RE.search(body)
    if not m:
        return body.strip()
    return body[: m.start()].strip()


def discover_files(coach_dir: Path) -> Iterator[Path]:
    """Yield every coach/*/*.md file (one level deep), skipping files starting
    with "_" (which are index/log files, not articles)."""
    for sub in sorted(coach_dir.iterdir()):
        if not sub.is_dir():
            continue
        if sub.name.startswith("_") or sub.name == "bin" or sub.name == "checkpoints":
            continue
        for md in sorted(sub.glob("*.md")):
            if md.name.startswith("_"):
                continue
            yield md


def compose_embedding_text(title: str, aliases: list[str], body_excerpt: str) -> str:
    """Per R-012: embed `title + aliases (joined) + body up to first ## heading`.

    Format:
      <title>
      <aliases joined with " | ">
      <body excerpt>
    """
    parts: list[str] = []
    if title:
        parts.append(title.strip())
    if aliases:
        parts.append(" | ".join(a.strip() for a in aliases if a.strip()))
    if body_excerpt:
        parts.append(body_excerpt.strip())
    return "\n\n".join(parts)


def pack_floats(vec) -> bytes:
    """Pack a numpy float32 array to bytes (little-endian)."""
    return struct.pack(f"<{len(vec)}f", *vec.tolist())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--coach-dir",
        type=Path,
        default=Path("coach"),
        help="Path to the coach/ compendium",
    )
    ap.add_argument(
        "--out",
        type=Path,
        default=Path("coach-app/index.db"),
        help="Output SQLite path",
    )
    ap.add_argument(
        "--model",
        type=str,
        default="BAAI/bge-small-en-v1.5",
        help="Sentence-embedding model (fastembed-supported)",
    )
    ap.add_argument(
        "--batch-size",
        type=int,
        default=64,
        help="Embedding batch size",
    )
    args = ap.parse_args()

    coach_dir = args.coach_dir.resolve()
    if not coach_dir.is_dir():
        print(f"ERROR: coach-dir not found: {coach_dir}", file=sys.stderr)
        return 2

    out_path = args.out.resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Discovering coach files under {coach_dir} ...", file=sys.stderr)
    files = list(discover_files(coach_dir))
    print(f"Found {len(files)} markdown files.", file=sys.stderr)

    # Read + parse each file. We capture all data needed downstream.
    docs: list[dict] = []
    for path in files:
        rel = path.relative_to(coach_dir).with_suffix("")
        category = rel.parts[0] if len(rel.parts) > 1 else "_root"
        slug = rel.parts[-1]
        file_id = f"{category}/{slug}"

        text = path.read_text(encoding="utf-8")
        fm, body = parse_frontmatter(text)
        title = (fm.get("title") or "").strip() or slug
        aliases_raw = fm.get("aliases") or []
        if isinstance(aliases_raw, str):
            aliases = [aliases_raw]
        else:
            aliases = [str(a) for a in aliases_raw]

        body_excerpt = body_up_to_first_subheading(body)
        embedding_text = compose_embedding_text(title, aliases, body_excerpt)

        docs.append(
            {
                "file_id": file_id,
                "category": category,
                "slug": slug,
                "title": title,
                "aliases": aliases,
                "embedding_text": embedding_text,
                "full_body": text,  # full markdown including frontmatter
            }
        )

    print(f"Parsed {len(docs)} docs.", file=sys.stderr)

    # Embed.
    print(f"Loading embedding model: {args.model} ...", file=sys.stderr)
    from fastembed import TextEmbedding  # type: ignore

    t0 = time.time()
    model = TextEmbedding(model_name=args.model)
    t1 = time.time()
    print(f"Model loaded in {t1 - t0:.2f}s.", file=sys.stderr)

    texts = [d["embedding_text"] for d in docs]
    print(f"Embedding {len(texts)} docs ...", file=sys.stderr)
    t0 = time.time()
    embeddings = list(model.embed(texts, batch_size=args.batch_size))
    t1 = time.time()
    print(f"Embedded in {t1 - t0:.2f}s.", file=sys.stderr)

    if not embeddings:
        print("ERROR: no embeddings produced", file=sys.stderr)
        return 1
    dim = len(embeddings[0])
    print(f"Embedding dim: {dim}", file=sys.stderr)

    # Write SQLite.
    if out_path.exists():
        out_path.unlink()
    conn = sqlite3.connect(out_path)
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE documents (
            file_id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            slug TEXT NOT NULL,
            title TEXT NOT NULL,
            aliases_json TEXT NOT NULL,
            aliases_concat TEXT NOT NULL,
            body_excerpt TEXT NOT NULL,
            full_body TEXT NOT NULL,
            embedding BLOB NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    cur.execute("CREATE INDEX idx_category ON documents(category)")

    for d, emb in zip(docs, embeddings):
        cur.execute(
            "INSERT INTO documents (file_id, category, slug, title, aliases_json, aliases_concat, body_excerpt, full_body, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                d["file_id"],
                d["category"],
                d["slug"],
                d["title"],
                json.dumps(d["aliases"], ensure_ascii=False),
                " | ".join(d["aliases"]),
                d["embedding_text"],
                d["full_body"],
                pack_floats(emb),
            ),
        )

    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for k, v in [
        ("model_name", args.model),
        ("dim", str(dim)),
        ("built_at", built_at),
        ("doc_count", str(len(docs))),
        ("coach_dir", str(coach_dir)),
    ]:
        cur.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (k, v))

    conn.commit()
    size_kb = out_path.stat().st_size / 1024
    print(
        f"Wrote {out_path} ({size_kb:.1f} KB, {len(docs)} docs, dim={dim}, model={args.model}).",
        file=sys.stderr,
    )
    print(f"built_at={built_at}", file=sys.stderr)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
