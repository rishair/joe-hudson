#!/usr/bin/env python3
"""
Persistent query embedding server for E-033.

Spawned as a long-running subprocess by `coach-app/retrieval/embeddings.ts`.
Reads queries (one per line, UTF-8) from stdin, writes embeddings (one per
line, JSON float array) to stdout. Loads the embedding model once at startup.

Protocol:
  - Input line: raw text. Backslash-n is NOT escape — the client must replace
    real newlines with the literal token "\\n" before sending (no real newlines
    inside a query line). We strip that back inside.
  - Output line: a JSON array of 384 floats.
  - On model-init success, the server writes "READY\n" to stderr.
  - The server also accepts "QUIT\n" to exit cleanly.

Usage:
  python3 coach-app/retrieval/embed_query.py [--model BAAI/bge-small-en-v1.5]

Failure modes handled:
  - Empty query line: returns "[]\n" (zero-length vector). The TS client treats
    this as "skip retrieval for this turn".
"""

import argparse
import json
import sys
from typing import Iterable


def _emit_ready() -> None:
    sys.stderr.write("READY\n")
    sys.stderr.flush()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="BAAI/bge-small-en-v1.5")
    args = ap.parse_args()

    # Lazy-import so --help is fast even without fastembed installed.
    from fastembed import TextEmbedding  # type: ignore

    model = TextEmbedding(model_name=args.model)
    # Warmup with a no-op query so first real query is already cached.
    list(model.embed(["warmup"]))
    _emit_ready()

    for raw_line in sys.stdin:
        line = raw_line.rstrip("\n").rstrip("\r")
        if line == "QUIT":
            return 0
        if not line:
            sys.stdout.write("[]\n")
            sys.stdout.flush()
            continue
        # Replace literal "\n" tokens with real newlines (clients escape on send).
        query = line.replace("\\n", "\n")
        try:
            vec = next(iter(model.embed([query])))
            sys.stdout.write(json.dumps(vec.tolist()) + "\n")
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f"EMBED_ERROR: {e}\n")
            sys.stdout.write("[]\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
