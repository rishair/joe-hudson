#!/usr/bin/env bun
// Cloudflare-safe Next.js build wrapper.
//
// THIS SOLVES A SECURITY-CRITICAL ISSUE: Next.js's standalone build (which
// @opennextjs/cloudflare consumes) bundles values from `.env.local` into
// the server function bundle. On Cloudflare that bundle is the Worker code,
// uploaded as-is to Cloudflare's edge. Without this guard, a developer's
// local API key in .env.local would be embedded in the deployed Worker —
// readable by anyone who downloads the deploy artifact or sees the wrangler
// dry-run output. This script ensures the build runs without those env vars
// in scope, so the runtime reads happen against Cloudflare secrets instead.
//
// Discovered during E-046 verification: `wrangler deploy --dry-run` showed
// the OPENROUTER_API_KEY string baked into the worker.js as a literal,
// inside a `var production = {...}` block Next emits when it sees secrets
// in process.env during build.
//
// The fix: spawn `opennextjs-cloudflare build` with a sanitized env.
// Allowlist is small and explicit; everything else is dropped.
//
// At RUNTIME, the Worker reads OPENROUTER_API_KEY from process.env which
// Cloudflare populates from `wrangler secret put OPENROUTER_API_KEY`. The
// secret never appears in the build artifact.

import { spawnSync } from 'node:child_process';

// Allowlist: env vars that ARE safe to leak into the build artifact AND
// are needed for `next build` to succeed.
const SAFE_BUILD_VARS = new Set([
  // System / tooling — required for any node/bun process.
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'CI',
  'GITHUB_ACTIONS',
  'GITHUB_WORKFLOW',
  'GITHUB_RUN_ID',
  'NODE_OPTIONS',
  'NODE_ENV',
  'NEXTJS_ENV',
  'NEXT_TELEMETRY_DISABLED',
  // OpenNext build internals.
  'OPEN_NEXT_DEBUG',
  // Bun internals.
  'BUN_INSTALL',
  'BUN_RUNTIME_TRANSPILER_CACHE_PATH',
]);

// Anything starting with these prefixes is also safe (build-time config,
// not secrets). NEXT_PUBLIC_* by definition reaches the client bundle, so
// callers must already have decided those are safe to publish.
const SAFE_PREFIXES = ['NEXT_PUBLIC_', 'TURBOPACK_', 'GH_', 'GITHUB_'];

// Explicit deny list — even if a future maintainer adds these to the
// allowlist by accident, they get stripped. The build NEVER needs these.
const HARD_DENY = new Set([
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'HF_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
]);

function buildSanitizedEnv(): NodeJS.ProcessEnv {
  // Build incrementally then cast — NodeJS.ProcessEnv has a required
  // NODE_ENV field under @types/node 22+, but we set it explicitly below.
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (HARD_DENY.has(key)) continue;
    if (SAFE_BUILD_VARS.has(key)) {
      out[key] = value;
      continue;
    }
    if (SAFE_PREFIXES.some((p) => key.startsWith(p))) {
      out[key] = value;
      continue;
    }
    // Drop everything else. This is the safe default: opt-in to keeping
    // an env var by adding it to SAFE_BUILD_VARS or a SAFE_PREFIX.
  }
  // Force production for the build itself.
  out.NODE_ENV = 'production';
  out.NEXTJS_ENV = 'production';
  // Disable Next telemetry to keep CI logs clean.
  out.NEXT_TELEMETRY_DISABLED = '1';
  return out as NodeJS.ProcessEnv;
}

function main(): void {
  const env = buildSanitizedEnv();
  const droppedSecrets: string[] = [];
  for (const key of HARD_DENY) {
    if (process.env[key]) droppedSecrets.push(key);
  }
  if (droppedSecrets.length > 0) {
    console.log(`cf-build: dropping ${droppedSecrets.length} secrets from build env: ${droppedSecrets.join(', ')}`);
    console.log('cf-build: these will be read at runtime from Cloudflare secrets, NOT embedded in the bundle.');
  }

  // Next.js loads `.env.local` for `next build` regardless of the spawned
  // env. If that file contains the same secrets we just dropped from
  // process.env, Next will re-introduce them. Stash .env.local out of
  // the way for the duration of the build (and restore on exit).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  const ROOT = path.join(import.meta.dir, '..');
  const envLocal = path.join(ROOT, '.env.local');
  const envLocalStash = path.join(ROOT, '.env.local.cf-build-stash');
  let envLocalStashed = false;
  if (fs.existsSync(envLocal)) {
    fs.renameSync(envLocal, envLocalStash);
    envLocalStashed = true;
    console.log('cf-build: stashed .env.local for the duration of the build (will restore on exit)');
  }
  const restore = () => {
    if (envLocalStashed && fs.existsSync(envLocalStash)) {
      fs.renameSync(envLocalStash, envLocal);
      envLocalStashed = false;
    }
  };
  // Belt-and-suspenders: restore on any abnormal exit so dev workflow
  // doesn't lose its .env.local after a failed deploy.
  process.on('exit', restore);
  process.on('SIGINT', () => { restore(); process.exit(130); });
  process.on('SIGTERM', () => { restore(); process.exit(143); });

  const result = spawnSync('bunx', ['opennextjs-cloudflare', 'build'], {
    env,
    stdio: 'inherit',
  });
  restore();
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log('cf-build: build complete; verifying no secret strings leaked into the worker bundle...');
  // Self-test: read worker.js + middleware/handler.mjs + main bundles and
  // grep for known secret patterns. If any hit, fail loudly.
  // (fs, path, ROOT already in scope from the stash logic above.)
  const filesToCheck: string[] = [];
  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.cjs')) {
        filesToCheck.push(full);
      }
    }
  }
  walkDir(path.join(ROOT, '.open-next'));
  // Secret patterns to scan for. Be specific — generic "key" strings
  // appear naturally in compiled JS. Match the actual prefix shapes.
  // We do NOT scan for Cloudflare API tokens because their format
  // (40-char alphanumeric, no fixed prefix) overlaps with compiled
  // function names and JSX class identifiers and produces many false
  // positives. Cloudflare tokens are also never set in app code — they
  // only exist in the GitHub Actions secret store and never flow into
  // process.env at app-build time.
  const patterns: { name: string; re: RegExp }[] = [
    { name: 'OpenRouter v1 key', re: /sk-or-v1-[a-f0-9]{30,}/ },
    { name: 'Anthropic API key', re: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
    { name: 'HuggingFace token', re: /\bhf_[a-zA-Z0-9]{30,}\b/ },
  ];
  let leaks = 0;
  for (const file of filesToCheck) {
    const src = fs.readFileSync(file, 'utf-8');
    for (const { name, re } of patterns) {
      if (re.test(src)) {
        leaks += 1;
        console.error(`cf-build: SECURITY LEAK — ${name} found in ${file.replace(ROOT + '/', '')}`);
      }
    }
  }
  if (leaks > 0) {
    console.error(`cf-build: ${leaks} secret leak(s) detected in build output. ABORTING.`);
    console.error('cf-build: review which env var is being inlined; add it to HARD_DENY and rebuild.');
    process.exit(2);
  }
  console.log(`cf-build: clean. Scanned ${filesToCheck.length} JS files; 0 secret leaks.`);
}

main();
