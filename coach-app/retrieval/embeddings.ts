/**
 * E-033: Embedding-based retrieval over the coach/ compendium.
 *
 * Per R-012's recommended primary architecture: hybrid alias-BM25 + dense
 * (bge-small-en-v1.5) with RRF (reciprocal-rank fusion, k=60), one whole file
 * = one document (no sub-chunking), top-K=5, no reranker.
 *
 * Pure-dense over the same compact representation is a documented degenerate
 * fallback (smoke-only, not full-eval). Enable via config.mode = "dense".
 *
 * Architecture in this module:
 *   - `loadEmbeddingIndex(dbPath)` — opens the SQLite index built by
 *     `coach-app/retrieval/build_index.py`, loads ALL doc embeddings into
 *     memory once (668 × 384 floats × 4 bytes ≈ 1MB; trivial). Returns an
 *     `EmbeddingRetriever`.
 *   - `EmbeddingRetriever.retrieve(query, opts)` — runs alias-BM25 + dense
 *     similarity, fuses via RRF, returns top-K documents.
 *   - The dense query embedding is computed by a persistent Python subprocess
 *     (embed_query.py) so we pay the model-load cost once per coach session,
 *     not per turn.
 *
 * Failure modes:
 *   - If the embed_query.py subprocess dies, retrieve() falls back to BM25-only
 *     (and logs the degradation).
 *   - If the index DB is missing, loadEmbeddingIndex throws — the eval harness
 *     surfaces the error before any conversation starts.
 *
 * Telemetry: per-turn retrieval records are returned alongside the documents
 * so eval logs can capture which files surfaced, with which scores. See
 * `RetrievalTelemetry`.
 */

import { Database } from "bun:sqlite";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ---------- Types ----------

export interface CoachDoc {
  file_id: string; // "concerns/im-not-an-anxious-person"
  category: string; // "concerns"
  slug: string; // "im-not-an-anxious-person"
  title: string;
  aliases: string[];
  aliases_concat: string;
  body_excerpt: string;
  full_body: string;
  embedding: Float32Array; // length = dim (384 for bge-small)
}

export interface RetrievalResult {
  doc: CoachDoc;
  bm25_rank: number | null; // 1-based; null if not in BM25 top
  dense_rank: number | null; // 1-based
  bm25_score: number;
  dense_score: number; // cosine similarity in [-1, 1]
  rrf_score: number; // fused score (higher = better)
}

export interface RetrievalTelemetry {
  query: string;
  mode: "hybrid" | "dense" | "bm25";
  top_k: number;
  total_docs_scored: number;
  results: Array<{
    file_id: string;
    title: string;
    bm25_rank: number | null;
    dense_rank: number | null;
    bm25_score: number;
    dense_score: number;
    rrf_score: number;
  }>;
  ms: number;
  dense_query_skipped: boolean;
}

export interface RetrieveOptions {
  k?: number; // top-K returned; default 5
  mode?: "hybrid" | "dense" | "bm25"; // default "hybrid"
  rrf_k?: number; // default 60
  /** Restrict candidates to specific categories. Empty/undefined = all. */
  category_filter?: string[];
}

// ---------- Loader ----------

export interface EmbeddingIndex {
  docs: CoachDoc[];
  model_name: string;
  dim: number;
  built_at: string;
}

export function loadEmbeddingIndex(dbPath: string): EmbeddingIndex {
  const abs = resolve(dbPath);
  if (!existsSync(abs)) {
    throw new Error(
      `Embedding index DB not found at ${abs}. Build it first:\n  python3 coach-app/retrieval/build_index.py --coach-dir coach --out ${abs}`,
    );
  }
  const db = new Database(abs, { readonly: true });
  try {
    const metaRows = db
      .query("SELECT key, value FROM meta")
      .all() as { key: string; value: string }[];
    const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
    const dim = Number(meta.dim);
    if (!Number.isFinite(dim) || dim <= 0) {
      throw new Error(`Bad meta.dim in index: ${meta.dim}`);
    }
    const rows = db
      .query(
        "SELECT file_id, category, slug, title, aliases_json, aliases_concat, body_excerpt, full_body, embedding FROM documents",
      )
      .all() as {
      file_id: string;
      category: string;
      slug: string;
      title: string;
      aliases_json: string;
      aliases_concat: string;
      body_excerpt: string;
      full_body: string;
      embedding: Uint8Array;
    }[];
    const docs: CoachDoc[] = rows.map((r) => {
      let aliases: string[] = [];
      try {
        const parsed = JSON.parse(r.aliases_json);
        if (Array.isArray(parsed)) aliases = parsed.map((x) => String(x));
      } catch {
        aliases = [];
      }
      const expectedBytes = dim * 4;
      if (r.embedding.byteLength !== expectedBytes) {
        throw new Error(
          `Doc ${r.file_id} has embedding of ${r.embedding.byteLength} bytes but index dim ${dim} expects ${expectedBytes}`,
        );
      }
      // Float32Array view over the buffer. Copy to detach from SQLite memory.
      const view = new Float32Array(
        r.embedding.buffer.slice(
          r.embedding.byteOffset,
          r.embedding.byteOffset + r.embedding.byteLength,
        ),
      );
      return {
        file_id: r.file_id,
        category: r.category,
        slug: r.slug,
        title: r.title,
        aliases,
        aliases_concat: r.aliases_concat,
        body_excerpt: r.body_excerpt,
        full_body: r.full_body,
        embedding: view,
      };
    });
    return {
      docs,
      model_name: meta.model_name ?? "unknown",
      dim,
      built_at: meta.built_at ?? "unknown",
    };
  } finally {
    db.close();
  }
}

// ---------- BM25 over aliases + title ----------

/**
 * Tokenize for BM25. Lowercase, strip punctuation, split on whitespace,
 * drop stopwords. Aliases are short hand-authored client phrasings — token
 * overlap with client message is the signal.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "at", "by", "for", "with", "and", "or", "but",
  "not", "no", "as", "if", "then", "than", "this", "that", "these", "those",
  "i", "me", "my", "you", "your", "we", "us", "our", "they", "them",
  "do", "does", "did", "have", "has", "had", "having", "can", "could",
  "would", "should", "will", "shall", "may", "might", "must",
  "so", "too", "very", "really", "just", "even",
  // Avoid filtering "feel" / "feeling" — coaching-critical.
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Build BM25 stats over the alias-concat + title corpus. */
interface BM25Corpus {
  doc_tokens: string[][];
  doc_freqs: Map<string, number>; // term -> # docs containing
  doc_lens: number[];
  avg_doc_len: number;
  N: number;
}

function buildBM25Corpus(docs: CoachDoc[]): BM25Corpus {
  const doc_tokens = docs.map((d) =>
    // Bias toward aliases: title + aliases concatenated 3x so that aliases
    // dominate over generic terms in the body. The body-excerpt is also
    // included at 1x so that articles whose alias list is sparse can still
    // get matched by body content. R-012: aliases are "hand-authored sparse-
    // index targets" and should drive BM25.
    tokenize(
      `${d.title}\n${d.aliases_concat}\n${d.aliases_concat}\n${d.aliases_concat}\n${d.body_excerpt}`,
    ),
  );
  const doc_lens = doc_tokens.map((ts) => ts.length);
  const N = docs.length;
  const avg_doc_len = doc_lens.reduce((a, b) => a + b, 0) / Math.max(1, N);
  const doc_freqs = new Map<string, number>();
  for (const ts of doc_tokens) {
    const seen = new Set<string>();
    for (const t of ts) {
      if (seen.has(t)) continue;
      seen.add(t);
      doc_freqs.set(t, (doc_freqs.get(t) ?? 0) + 1);
    }
  }
  return { doc_tokens, doc_freqs, doc_lens, avg_doc_len, N };
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

function bm25Score(
  queryTokens: string[],
  docIdx: number,
  corpus: BM25Corpus,
): number {
  const docTokens = corpus.doc_tokens[docIdx];
  if (!docTokens.length) return 0;
  const docLen = corpus.doc_lens[docIdx];
  const tf = new Map<string, number>();
  for (const t of docTokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  let score = 0;
  const lenNorm = 1 - BM25_B + BM25_B * (docLen / corpus.avg_doc_len);
  for (const qt of queryTokens) {
    const f = tf.get(qt) ?? 0;
    if (!f) continue;
    const n = corpus.doc_freqs.get(qt) ?? 0;
    // BM25 IDF (Robertson + Sparck-Jones), with +0.5 smoothing.
    const idf = Math.log(1 + (corpus.N - n + 0.5) / (n + 0.5));
    const numer = f * (BM25_K1 + 1);
    const denom = f + BM25_K1 * lenNorm;
    score += idf * (numer / denom);
  }
  return score;
}

// ---------- Cosine similarity ----------

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function l2Norm(a: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * a[i];
  return Math.sqrt(sum);
}

// ---------- Query-embedding subprocess ----------

export interface QueryEmbedder {
  /** Embed a single string. Returns null if the subprocess is dead and the
   *  retriever should fall back to BM25-only. */
  embed(text: string): Promise<Float32Array | null>;
  shutdown(): Promise<void>;
}

class PythonQueryEmbedder implements QueryEmbedder {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void>;
  private dim: number;
  private queue: Array<{
    resolve: (v: Float32Array | null) => void;
    reject: (err: Error) => void;
  }> = [];
  private buf = "";
  private dead = false;

  constructor(
    private scriptPath: string,
    private model: string,
    dim: number,
  ) {
    this.dim = dim;
    this.ready = this.start();
  }

  private start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const py = spawn("python3", [this.scriptPath, "--model", this.model], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.proc = py;

      let readyEmitted = false;
      py.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        for (const line of text.split(/\r?\n/)) {
          if (line === "READY" && !readyEmitted) {
            readyEmitted = true;
            resolve();
          } else if (line.startsWith("EMBED_ERROR:") && !this.queue[0]) {
            // Stray error with no pending — log and continue.
            process.stderr.write(`[embeddings] ${line}\n`);
          } else if (line.trim() && process.env.COACH_EMBEDDINGS_VERBOSE) {
            process.stderr.write(`[embed_query.py] ${line}\n`);
          }
        }
      });
      py.stdout.on("data", (chunk: Buffer) => {
        this.buf += chunk.toString("utf8");
        let nl: number;
        while ((nl = this.buf.indexOf("\n")) >= 0) {
          const line = this.buf.slice(0, nl);
          this.buf = this.buf.slice(nl + 1);
          const pending = this.queue.shift();
          if (!pending) continue;
          if (!line.trim() || line.trim() === "[]") {
            pending.resolve(null);
            continue;
          }
          try {
            const arr = JSON.parse(line);
            if (!Array.isArray(arr) || arr.length !== this.dim) {
              pending.reject(
                new Error(
                  `embed_query.py returned vector of length ${
                    Array.isArray(arr) ? arr.length : "non-array"
                  }, expected ${this.dim}`,
                ),
              );
              continue;
            }
            pending.resolve(Float32Array.from(arr as number[]));
          } catch (e) {
            pending.reject(
              new Error(`Failed to parse embedding JSON: ${(e as Error).message}`),
            );
          }
        }
      });
      py.on("exit", (code, signal) => {
        this.dead = true;
        const err = new Error(
          `embed_query.py exited (code=${code}, signal=${signal})`,
        );
        for (const p of this.queue) p.reject(err);
        this.queue = [];
        if (!readyEmitted) reject(err);
      });
      py.on("error", (err) => {
        this.dead = true;
        reject(err);
      });
    });
  }

  async embed(text: string): Promise<Float32Array | null> {
    if (this.dead) return null;
    try {
      await this.ready;
    } catch {
      return null;
    }
    if (!this.proc || !this.proc.stdin.writable) return null;
    // Escape real newlines to "\n" tokens per the server protocol.
    const oneLine = text.replace(/\r?\n/g, "\\n");
    return new Promise<Float32Array | null>((resolve, reject) => {
      this.queue.push({ resolve, reject });
      try {
        this.proc!.stdin.write(oneLine + "\n");
      } catch (e) {
        reject(e as Error);
      }
    }).catch((e: Error) => {
      process.stderr.write(
        `[embeddings] query embed failed: ${e.message}; falling back to BM25-only.\n`,
      );
      return null;
    });
  }

  async shutdown(): Promise<void> {
    if (this.dead || !this.proc) return;
    const proc = this.proc;
    this.dead = true;
    // Resolve any pending requests so the caller can move on.
    for (const p of this.queue) p.resolve(null);
    this.queue = [];
    // The Python subprocess holds a stdio pipe back to Bun; the cleanest way
    // to make Bun exit is to SIGKILL the child unconditionally rather than
    // negotiate stdin EOF (which Bun has been observed to wait on
    // indefinitely). The Python process is stateless so SIGKILL is safe.
    try {
      proc.kill("SIGKILL");
    } catch {
      // ignore — already dead
    }
    try {
      proc.stdin.destroy();
      proc.stdout.destroy();
      proc.stderr.destroy();
    } catch {
      // ignore
    }
  }
}

// ---------- The retriever ----------

export interface EmbeddingRetrieverOpts {
  /** Path to the embed_query.py script. Default: alongside this file. */
  embedQueryScript?: string;
  /** If true, do not spawn the Python subprocess; BM25-only retrieval. */
  bm25_only?: boolean;
}

export class EmbeddingRetriever {
  readonly index: EmbeddingIndex;
  private corpus: BM25Corpus;
  private embedder: QueryEmbedder | null;
  /** Pre-computed L2 norms for each doc so cosine sim is one dot product. */
  private docNorms: Float64Array;

  constructor(index: EmbeddingIndex, opts: EmbeddingRetrieverOpts = {}) {
    this.index = index;
    this.corpus = buildBM25Corpus(index.docs);

    this.docNorms = new Float64Array(index.docs.length);
    for (let i = 0; i < index.docs.length; i++) {
      this.docNorms[i] = l2Norm(index.docs[i].embedding) || 1;
    }

    if (opts.bm25_only) {
      this.embedder = null;
    } else {
      const script =
        opts.embedQueryScript ?? join(dirname(import.meta.dir ? import.meta.dir : __dirname), "retrieval", "embed_query.py");
      // Use a robust default: __dirname-relative.
      const robustScript = join(
        // import.meta.dir is supported in Bun.
        // @ts-ignore
        import.meta.dir ?? __dirname,
        "embed_query.py",
      );
      this.embedder = new PythonQueryEmbedder(
        robustScript,
        index.model_name,
        index.dim,
      );
    }
  }

  /** Cosine similarity between a query vector and a single doc. */
  private cosine(q: Float32Array, qnorm: number, docIdx: number): number {
    const d = this.index.docs[docIdx].embedding;
    const denom = qnorm * this.docNorms[docIdx];
    if (!denom) return 0;
    return dotProduct(q, d) / denom;
  }

  /**
   * Retrieve top-K docs for a client message.
   *
   * Returns the ranked results (length K) and a telemetry record describing
   * what happened.
   */
  async retrieve(
    query: string,
    opts: RetrieveOptions = {},
  ): Promise<{ results: RetrievalResult[]; telemetry: RetrievalTelemetry }> {
    const t0 = Date.now();
    const k = opts.k ?? 5;
    const rrfK = opts.rrf_k ?? 60;
    const mode = opts.mode ?? "hybrid";

    // Optional category filter.
    const candidateIdxs: number[] = [];
    const allowed = opts.category_filter ? new Set(opts.category_filter) : null;
    for (let i = 0; i < this.index.docs.length; i++) {
      if (!allowed || allowed.has(this.index.docs[i].category)) {
        candidateIdxs.push(i);
      }
    }

    // ----- BM25 -----
    const qTokens = tokenize(query);
    const bm25Scored: Array<{ idx: number; score: number }> = [];
    if (qTokens.length > 0 && mode !== "dense") {
      for (const idx of candidateIdxs) {
        const s = bm25Score(qTokens, idx, this.corpus);
        if (s > 0) bm25Scored.push({ idx, score: s });
      }
      bm25Scored.sort((a, b) => b.score - a.score);
    }
    // Map idx -> bm25 rank (1-based) and score
    const bm25Top = mode === "dense" ? [] : bm25Scored.slice(0, 50);
    const bm25Rank = new Map<number, { rank: number; score: number }>();
    for (let r = 0; r < bm25Top.length; r++) {
      bm25Rank.set(bm25Top[r].idx, { rank: r + 1, score: bm25Top[r].score });
    }

    // ----- Dense -----
    let denseTop: Array<{ idx: number; score: number }> = [];
    let denseQuerySkipped = false;
    if (mode !== "bm25" && this.embedder) {
      const qv = await this.embedder.embed(query);
      if (qv) {
        const qn = l2Norm(qv) || 1;
        const denseScored: Array<{ idx: number; score: number }> = [];
        for (const idx of candidateIdxs) {
          denseScored.push({ idx, score: this.cosine(qv, qn, idx) });
        }
        denseScored.sort((a, b) => b.score - a.score);
        denseTop = denseScored.slice(0, 50);
      } else {
        denseQuerySkipped = true;
      }
    } else if (mode === "bm25") {
      denseQuerySkipped = false;
    } else if (!this.embedder) {
      denseQuerySkipped = true;
    }
    const denseRank = new Map<number, { rank: number; score: number }>();
    for (let r = 0; r < denseTop.length; r++) {
      denseRank.set(denseTop[r].idx, {
        rank: r + 1,
        score: denseTop[r].score,
      });
    }

    // ----- Fuse via RRF -----
    const candidateSet = new Set<number>();
    for (const e of bm25Top) candidateSet.add(e.idx);
    for (const e of denseTop) candidateSet.add(e.idx);

    const fused: RetrievalResult[] = [];
    for (const idx of candidateSet) {
      const b = bm25Rank.get(idx) ?? null;
      const d = denseRank.get(idx) ?? null;
      const bm25Contribution = b ? 1 / (rrfK + b.rank) : 0;
      const denseContribution = d ? 1 / (rrfK + d.rank) : 0;
      let rrfScore: number;
      if (mode === "bm25") {
        rrfScore = bm25Contribution;
      } else if (mode === "dense") {
        rrfScore = denseContribution;
      } else {
        // hybrid: equal weight to both
        rrfScore = bm25Contribution + denseContribution;
      }
      fused.push({
        doc: this.index.docs[idx],
        bm25_rank: b?.rank ?? null,
        dense_rank: d?.rank ?? null,
        bm25_score: b?.score ?? 0,
        dense_score: d?.score ?? 0,
        rrf_score: rrfScore,
      });
    }
    fused.sort((a, b) => b.rrf_score - a.rrf_score);
    const results = fused.slice(0, k);

    const telemetry: RetrievalTelemetry = {
      query: query.slice(0, 500),
      mode,
      top_k: k,
      total_docs_scored: candidateIdxs.length,
      ms: Date.now() - t0,
      dense_query_skipped: denseQuerySkipped,
      results: results.map((r) => ({
        file_id: r.doc.file_id,
        title: r.doc.title,
        bm25_rank: r.bm25_rank,
        dense_rank: r.dense_rank,
        bm25_score: r.bm25_score,
        dense_score: r.dense_score,
        rrf_score: r.rrf_score,
      })),
    };

    return { results, telemetry };
  }

  async shutdown(): Promise<void> {
    if (this.embedder) await this.embedder.shutdown();
  }
}

// ---------- Convenience: format retrieved docs as RETRIEVED CONTEXT block ----------

/**
 * Inline the retrieved docs as a "RETRIEVED CONTEXT" block to append to the
 * latest user message (or system prompt). Per R-012's cross-cutting design
 * choice: full markdown bodies, not summaries, with a short framing line.
 *
 * The framing line matches what R-012 prescribed:
 *   "Retrieved compendium files (relationally-adjacent to the client's
 *    current concern). Draw on these to ground your reading and move
 *    selection. Do not announce that you are retrieving."
 *
 * This composes cleanly with the v1 prompt's retrieval-aware closing line.
 */
export function formatRetrievedContext(results: RetrievalResult[]): string {
  if (!results.length) return "";
  const intro =
    "RETRIEVED CONTEXT: compendium files relevant to the client's current concern. Draw on these to ground your reading and move selection. Do not announce that you are retrieving.";
  const bodies = results.map((r) => `--- ${r.doc.file_id} ---\n${r.doc.full_body.trim()}`).join("\n\n");
  return `${intro}\n\n${bodies}`;
}
