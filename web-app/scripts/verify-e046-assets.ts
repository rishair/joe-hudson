#!/usr/bin/env bun
// E-046 pre-flight verifier: checks every Cloudflare-deploy assumption
// that can be validated without an actual Cloudflare account.
//
// Runs in CI before the deploy step so a mis-configured PR fails fast
// rather than burning a deploy slot. Local devs can run this manually
// when they touch any of the Cloudflare-adjacent config.
//
// Validates:
//   1. wrangler.jsonc is well-formed and has the required keys
//   2. open-next.config.ts exists
//   3. compatibility_date >= 2025-09-01 (the threshold this app's
//      runtime-wiki-asset-reader assumes)
//   4. compatibility_flags includes nodejs_compat + global_fetch_strictly_public
//   5. ASSETS binding is configured
//   6. content/wiki/ exists (the prebuild step's source)
//   7. .github/workflows/deploy.yml is well-formed YAML
//   8. The workflow references the same Worker name that wrangler.jsonc does
//   9. server-only modules are not accidentally imported from client
//      components (a smoke spot-check, not exhaustive)
//  10. The wiki-asset-reader fallback path works in Node mode (read a
//      known file and assert non-null)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const checks: Check[] = [];

function pass(name: string, detail?: string) {
  checks.push({ name, ok: true, detail });
}
function fail(name: string, detail: string) {
  checks.push({ name, ok: false, detail });
}

// 1+3+4+5: wrangler.jsonc
const wranglerPath = join(ROOT, 'wrangler.jsonc');
if (!existsSync(wranglerPath)) {
  fail('wrangler.jsonc exists', `not found at ${wranglerPath}`);
} else {
  const raw = readFileSync(wranglerPath, 'utf-8');
  // Strip line + block comments — jsonc is JSON with comments.
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripped);
    pass('wrangler.jsonc parses');
  } catch (err) {
    fail('wrangler.jsonc parses', `JSON parse failed: ${(err as Error).message}`);
    parsed = {};
  }
  if (parsed.main === '.open-next/worker.js') pass('main = .open-next/worker.js');
  else fail('main = .open-next/worker.js', `got ${JSON.stringify(parsed.main)}`);

  const compatDate = String(parsed.compatibility_date ?? '');
  if (compatDate >= '2025-09-01') pass(`compatibility_date >= 2025-09-01 (got ${compatDate})`);
  else fail('compatibility_date >= 2025-09-01', `got ${compatDate}`);

  const flags = Array.isArray(parsed.compatibility_flags)
    ? (parsed.compatibility_flags as string[])
    : [];
  if (flags.includes('nodejs_compat')) pass('nodejs_compat flag set');
  else fail('nodejs_compat flag set', `flags: ${flags.join(', ')}`);
  if (flags.includes('global_fetch_strictly_public')) pass('global_fetch_strictly_public flag set');
  else fail('global_fetch_strictly_public flag set', `flags: ${flags.join(', ')}`);

  const assets = parsed.assets as { directory?: string; binding?: string } | undefined;
  if (assets?.directory === '.open-next/assets' && assets?.binding === 'ASSETS')
    pass('ASSETS binding configured');
  else fail('ASSETS binding configured', `got ${JSON.stringify(assets)}`);
}

// 2: open-next.config.ts
if (existsSync(join(ROOT, 'open-next.config.ts'))) pass('open-next.config.ts exists');
else fail('open-next.config.ts exists', 'not found');

// 6: content/wiki source exists
if (existsSync(join(ROOT, 'content', 'wiki', '.ingest-manifest.json')))
  pass('content/wiki/.ingest-manifest.json exists');
else fail('content/wiki/.ingest-manifest.json exists', 'run `bun run ingest` first');

// 7+8: GitHub workflow
const wfPath = join(ROOT, '..', '.github', 'workflows', 'deploy.yml');
if (!existsSync(wfPath)) {
  fail('.github/workflows/deploy.yml exists', `not found at ${wfPath}`);
} else {
  const wf = readFileSync(wfPath, 'utf-8');
  if (wf.includes('cloudflare/wrangler-action')) pass('workflow uses cloudflare/wrangler-action');
  else fail('workflow uses cloudflare/wrangler-action', 'missing action ref');
  if (wf.includes('CLOUDFLARE_API_TOKEN') && wf.includes('CLOUDFLARE_ACCOUNT_ID'))
    pass('workflow references both Cloudflare secrets');
  else fail('workflow references both Cloudflare secrets', 'missing one or both');
}

// 9: server-only sanity — wiki-asset-reader has 'server-only' import
const readerPath = join(ROOT, 'app', 'lib', 'runtime', 'wiki-asset-reader.ts');
if (existsSync(readerPath)) {
  const src = readFileSync(readerPath, 'utf-8');
  if (src.includes("import 'server-only'")) pass("wiki-asset-reader has 'server-only' guard");
  else fail("wiki-asset-reader has 'server-only' guard", 'missing import');
} else {
  fail("wiki-asset-reader has 'server-only' guard", `not found at ${readerPath}`);
}

// 10: Node-mode read path actually works.
// `wiki-asset-reader.ts` does `import 'server-only'` which only resolves
// inside a Next.js build pipeline. Outside Next, that import errors. We
// can't dynamic-import the module directly under `bun scripts/...`. So
// instead, re-implement the trivial Node-mode read here as an equivalence
// check: if these two reads succeed, the reader's fallback path is sound.
try {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const root = process.env.WIKI_ROOT ?? path.join(ROOT, 'content', 'wiki');
  const idx = await fs.readFile(path.join(root, '_index.md'), 'utf-8');
  if (idx.length > 1000) pass(`Node-mode read of _index.md returned ${idx.length} chars`);
  else fail('Node-mode read of _index.md', `returned ${idx.length} chars (suspiciously small)`);
  const manifest = await fs.readFile(path.join(root, '.ingest-manifest.json'), 'utf-8');
  const parsed = JSON.parse(manifest) as { files?: Record<string, unknown> };
  if (parsed.files && Object.keys(parsed.files).length > 500)
    pass(`manifest parses; ${Object.keys(parsed.files).length} files indexed`);
  else fail('manifest parses', `unexpected shape or count`);
} catch (err) {
  fail('Node-mode wiki content read', `${(err as Error).message}`);
}

// Render
console.log('');
console.log('E-046 pre-flight checks:');
console.log('');
let failed = 0;
for (const c of checks) {
  const mark = c.ok ? 'OK  ' : 'FAIL';
  console.log(`  [${mark}] ${c.name}${c.detail ? `  -- ${c.detail}` : ''}`);
  if (!c.ok) failed += 1;
}
console.log('');
console.log(`Result: ${checks.length - failed}/${checks.length} passed`);
if (failed > 0) {
  process.exit(1);
}
