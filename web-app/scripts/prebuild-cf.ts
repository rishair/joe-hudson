#!/usr/bin/env bun
// Prebuild step for Cloudflare deployment.
//
// Copies `content/wiki/` (produced by E-039's ingestion script) into
// `public/content/wiki/`. Next.js bundles the entire public/ tree into
// static assets, which @opennextjs/cloudflare then routes through the
// ASSETS binding on Cloudflare Workers.
//
// We can't keep content/wiki/ inside the Worker bundle because the
// Worker bundle limit is 10 MiB compressed and our content gzips to
// ~10.01 MiB (just over the line). The static-assets path bypasses the
// Worker bundle limit entirely — only the compiled JS goes through the
// Worker, content is served as files.
//
// Why not just put content/wiki/ under public/ from the start?
//   - Bun's dev server doesn't need it there (we read via node:fs)
//   - Keeping public/ free of 38 MiB of markdown speeds up `next dev`
//     (Next.js does a watch-stat of public/* on every request)
//   - The runtime reader (app/lib/runtime/wiki-asset-reader.ts) handles
//     both shapes, so the prebuild copy is a deploy-only concern
//
// Idempotency: this script is safe to re-run. It removes the previous
// public/content/wiki/ first (if any) then copies fresh. A future
// optimization could hash-skip per-file like ingest-coach.ts does, but
// the CI deploy is the only caller and a full copy of 38 MiB takes
// ~2s on a CI runner — not worth the complexity.

import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SRC = join(ROOT, 'content', 'wiki');
const DEST = join(ROOT, 'public', 'content', 'wiki');

async function main(): Promise<void> {
  if (!existsSync(SRC)) {
    console.error(`prebuild-cf: source missing: ${SRC}`);
    console.error('prebuild-cf: run `bun run ingest` first to produce content/wiki/');
    process.exit(1);
  }
  const t0 = Date.now();

  if (existsSync(DEST)) {
    await rm(DEST, { recursive: true, force: true });
  }
  await mkdir(join(ROOT, 'public', 'content'), { recursive: true });
  await cp(SRC, DEST, { recursive: true });

  const ms = Date.now() - t0;
  console.log(`prebuild-cf: copied ${SRC} -> ${DEST} in ${ms}ms`);
}

main().catch((err) => {
  console.error('prebuild-cf: failed', err);
  process.exit(1);
});
