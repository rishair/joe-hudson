# Cloudflare Deploy Playbook

## What this is

Patterns and conventions for deploying a Next.js (App Router) web app to Cloudflare Workers with an automated GitHub→Cloudflare pipeline. Use when the goal is to make a web app reachable at a public URL without standing up your own server, with push-to-main as the deploy trigger.

Distilled from E-046 (G-010 web app deploy). Pairs with [[ai-web-app]] (which assumes a Next.js + AI SDK + OpenRouter app) and [[coding-architecture]] (Repository pattern + composition).

## Stack defaults

- **Platform**: Cloudflare Workers (NOT Pages — `next-on-pages` is deprecated as of 2026)
- **Adapter**: `@opennextjs/cloudflare` (1.19+). The official, currently-recommended path. Bundles Next.js's standalone output into a Workers-compatible artifact.
- **Runtime**: Node.js compatibility layer (`compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"]`). NOT the Edge runtime — `@opennextjs/cloudflare` does not support `export const runtime = "edge"`. The Node runtime gives you the full AI SDK surface, prompt caching, Anthropic SDK, sqlocal, and most NPM packages.
- **Compatibility date**: `2025-09-01` or later. This threshold gets you:
  - `nodejs_compat` fully populated (most node:* modules)
  - `process.env` auto-populated from `wrangler vars` and `secrets` (older dates require manual binding plumbing)
  - Workers VFS for `node:fs` against `/bundle` (bundled-module reads work synchronously)
- **CI/CD**: GitHub Actions + `cloudflare/wrangler-action@v3`. Build artifact and deploy in a single workflow run; concurrency-grouped so two pushes don't race.
- **Static assets**: Anything large or read at runtime (markdown content, images, JSON data) lives under `public/` and is served via the ASSETS binding. The Worker bundle limit is **3 MiB on Free, 10 MiB on Paid** (compressed); ASSETS bypass this cap.
- **Secrets**: `wrangler secret put` (one-time per environment) or the Cloudflare dashboard. NEVER in `wrangler.jsonc` `vars`. Plaintext config (cost caps, default model) goes in `vars`.

## The repository pattern

```
project-root/
  .github/
    workflows/
      deploy.yml                # the pipeline
  web-app/                      # the Next.js app
    wrangler.jsonc              # Workers config
    open-next.config.ts         # OpenNext adapter config
    next.config.js              # Next config + COOP/COEP + initOpenNextCloudflareForDev()
    .dev.vars                   # local-only NEXTJS_ENV (gitignored)
    public/
      _headers                  # static asset HTTP headers
      content/...               # large runtime-read files (mirrored at prebuild)
    scripts/
      prebuild-cf.ts            # copies large content into public/ before build
      verify-e046-assets.ts     # pre-flight: wrangler.jsonc, content, workflow
    app/lib/runtime/
      wiki-asset-reader.ts      # runtime-agnostic file reader (Node fs OR ASSETS)
```

## wrangler.jsonc — the canonical shape

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "<worker-name>",                // becomes <name>.workers.dev
  "main": ".open-next/worker.js",         // OpenNext build output entry
  "compatibility_date": "2025-09-01",
  "compatibility_flags": [
    "nodejs_compat",
    "global_fetch_strictly_public"
  ],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },
  "services": [
    { "binding": "WORKER_SELF_REFERENCE", "service": "<worker-name>" }
  ],
  "images": { "binding": "IMAGES" },      // for next/image
  "vars": {
    "OPENROUTER_DAILY_CAP": "5",
    "APP_URL": "https://<worker-name>.workers.dev"
  },
  "observability": { "enabled": true }    // dashboard logs + metrics
}
```

Things to know:
- `name` is the Worker name AND the default public hostname. Renaming creates a NEW Worker.
- `vars` are plaintext-visible. `secrets` (set via `wrangler secret put`) are encrypted, read-only after creation.
- `WORKER_SELF_REFERENCE` is recommended by OpenNext for revalidation-style internal calls. Harmless if unused.
- `observability` is free for the first 200k requests/day.

## open-next.config.ts — the minimal shape

```typescript
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig({
  // incrementalCache: r2IncrementalCache,  // only if you have ISR pages
});
```

For a fully-dynamic app (no static-or-ISR pages), the default config is fine. Add `r2IncrementalCache` only when you introduce ISR.

## package.json scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "typecheck": "tsc --noEmit",
    "prebuild:cf": "bun scripts/prebuild-cf.ts",
    "preview:cf": "bun run prebuild:cf && opennextjs-cloudflare build && opennextjs-cloudflare preview",
    "deploy:cf": "bun run prebuild:cf && opennextjs-cloudflare build && opennextjs-cloudflare deploy",
    "cf-typegen": "wrangler types --env-interface CloudflareEnv app/lib/runtime/cloudflare-env.d.ts"
  }
}
```

`opennextjs-cloudflare build` produces `.open-next/worker.js` + `.open-next/assets/`. `opennextjs-cloudflare deploy` is a thin wrapper around `wrangler deploy`. Use `preview` for local Worker emulation (useful when you suspect a Cloudflare-specific bug).

## GitHub Actions workflow

```yaml
name: Deploy to Cloudflare
on:
  push:
    branches: [main]
    paths: ['<app-dir>/**', '.github/workflows/deploy.yml']
  workflow_dispatch: {}

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: true

permissions: { contents: read }

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.3.14 }
      - working-directory: <app-dir>
        run: bun install --frozen-lockfile
      - working-directory: <app-dir>
        run: bun run typecheck
      - working-directory: <app-dir>
        run: bun run verify:e046:assets
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          packageManager: bun
          workingDirectory: <app-dir>
          command: deploy:cf
          wranglerVersion: '4'
      - name: Smoke
        env:
          APP_URL: https://<worker-name>.workers.dev
        run: |
          for i in 1 2 3 4 5 6; do
            curl -sf "$APP_URL/" | grep -qi "<your-app-name>" && exit 0
            sleep 10
          done
          exit 1
```

Repo secrets needed:
- `CLOUDFLARE_API_TOKEN` — scoped token with `Cloudflare Workers Scripts:Edit`, `Account Settings:Read`, `User Details:Read`
- `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard sidebar
- `OPENROUTER_API_KEY` (or other app secrets) — set as **Cloudflare** secrets via `wrangler secret put`, NOT as GitHub Actions secrets. The Action doesn't need to know them; only the deployed Worker does.

The `wrangler-action@v3` defaults to wrangler v4 and supports Bun as a package manager. The `command:` input runs the named script in `workingDirectory`.

## The 10 MiB bundle ceiling (the most common surprise)

Cloudflare Workers cap the **compressed** Worker bundle at 3 MiB (Free) / 10 MiB (Paid). Most Next.js apps have no problem with code — `.open-next/worker.js` typically lands at 1-5 MiB compressed. The trap is **data files read at runtime**: if your app reads markdown content, large JSON catalogs, lookup tables, or seed data via `fs.readFile`, those files want to be in the Worker bundle by default.

The fix: serve runtime-read data files as **static assets** and fetch them via `env.ASSETS.fetch()`. The assets directory is uncapped (well, capped at 25 MiB per file and 20k files total — generous).

**Pattern** (the `wiki-asset-reader.ts` shape):

```typescript
// app/lib/runtime/wiki-asset-reader.ts
import 'server-only';

function isCloudflareRuntime(): boolean {
  return typeof process !== 'undefined' && process.env.NEXT_RUNTIME === 'cloudflare';
}

export async function readWikiAsset(relPath: string): Promise<string | null> {
  if (isCloudflareRuntime()) {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = getCloudflareContext();
    const url = `https://assets.local/content/wiki/${relPath}`;
    const res = await (env as any).ASSETS.fetch(url);
    return res.status === 404 ? null : await res.text();
  }
  // Node fallback: read from local filesystem.
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const root = path.join(/* turbopackIgnore: true */ process.cwd(), 'content', 'wiki');
  try {
    return await fs.readFile(path.join(root, relPath), 'utf-8');
  } catch (err: any) {
    return err.code === 'ENOENT' ? null : Promise.reject(err);
  }
}
```

Three details:

1. **Detection by `process.env.NEXT_RUNTIME === 'cloudflare'`** — OpenNext sets this. Add `CLOUDFLARE_WORKER=1` to wrangler `vars` as a belt-and-suspenders fallback if needed.
2. **`https://assets.local/...`** as the fetch URL — Cloudflare docs say the hostname is meaningless; only the pathname is used for asset matching. Pick a sentinel hostname so logs are obviously about asset reads, not external fetches.
3. **`/* turbopackIgnore: true */`** comment on `process.cwd()` in the Node fallback — without it, Next.js's file tracer walks the entire content tree and tries to bundle it. The hint is the documented workaround.

The matching prebuild step (`scripts/prebuild-cf.ts`):

```typescript
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SRC = join(ROOT, 'content', 'wiki');
const DEST = join(ROOT, 'public', 'content', 'wiki');

if (existsSync(DEST)) await rm(DEST, { recursive: true, force: true });
await mkdir(join(ROOT, 'public', 'content'), { recursive: true });
await cp(SRC, DEST, { recursive: true });
```

Run as `prebuild:cf` before `opennextjs-cloudflare build`. The build packs anything under `public/` into `.open-next/assets/`, which the wrangler config binds as `ASSETS`.

## Secrets — the two-tier model

Cloudflare distinguishes plaintext `vars` (visible) from `secrets` (encrypted, write-only after creation).

- **`vars`** in `wrangler.jsonc`: app config that's safe to commit. Cost caps, default model IDs, app URL, observability switches.
- **`secrets`** set via `wrangler secret put <NAME>` (one-time, run after the first deploy creates the Worker): API keys, database credentials, anything that grants spend.

The GitHub Actions workflow does NOT need to set secrets on every deploy. Set them once via `wrangler secret put` from your local machine (with the API token in `~/.wrangler/config` or `CLOUDFLARE_API_TOKEN` env), and they persist across deploys.

Quick check that a secret is set: `wrangler secret list`. Plaintext value is unreadable after creation; only the name is shown.

**Inventory ALL secret-consuming subsystems before the first deploy.** Easy to miss: an LLM app that talks to multiple providers needs a secret per provider. The Joe Hudson coach (E-046) uses OpenRouter for the coach turn AND Anthropic-direct for the walker + seed-detector (the walker needs Anthropic-style `cache_control` markers that don't propagate through OpenRouter cleanly). The Worker initially shipped with only `OPENROUTER_API_KEY`; the first chat request logged `ANTHROPIC_API_KEY not set` and the retrieval pipeline failed open (graceful degrade — fine, but visible cost: $0.066 walker spend was wasted before the degrade kicked in). Audit your code for every `process.env.<KEY>` read AND every direct-SDK construction (`createAnthropic`, `createOpenAI`, `createGoogleGenerativeAI`, etc.) before the first deploy; set every required key as a Worker secret.

## COOP/COEP and other custom response headers

Cloudflare's `_headers` file (under the assets directory) **only applies to static asset responses, not Worker output**. If your app needs custom HTTP headers on dynamic routes (COOP/COEP for SharedArrayBuffer, CSP, X-Frame-Options), set them in `next.config.js`:

```javascript
async headers() {
  return [{
    source: '/:path*',
    headers: [
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
    ],
  }];
}
```

These are emitted by the Worker at request time and reach the browser. The `_headers` file complements them by setting cache-control on the asset side.

## Initializing CF bindings during `next dev`

Add this to `next.config.js` so `getCloudflareContext()` works locally:

```javascript
try {
  const { initOpenNextCloudflareForDev } = await import('@opennextjs/cloudflare');
  initOpenNextCloudflareForDev();
} catch {
  // Adapter not installed — pure Next dev mode. Reader code falls back to fs.
}
```

This makes `bun run dev` give you a working CF context (reading `.dev.vars`, exposing bindings). If you skip this, dev still works but `getCloudflareContext()` throws and the reader falls back to its Node path — which is what most local-dev workflows want anyway.

## Pre-flight verifier

A small `scripts/verify-cf-assets.ts` that checks:

1. `wrangler.jsonc` parses and has `main`, `compatibility_date >= 2025-09-01`, both required flags, the ASSETS binding
2. `open-next.config.ts` exists
3. The asset-source directory (`content/` or whatever) exists
4. `.github/workflows/deploy.yml` exists and references both Cloudflare secrets
5. Server-only modules have the `import 'server-only'` guard
6. A Node-mode read of a known asset succeeds

Run it as a step in the workflow before the wrangler-action deploy. Catches misconfig in 1 second instead of 5 minutes of deploy-then-fail.

## How to apply this to a new project

1. **In `<app-dir>/`**:
   - `bun install -d @opennextjs/cloudflare wrangler @opennextjs/aws`
   - Create `wrangler.jsonc` (use the canonical shape above; change `name` and `APP_URL`)
   - Create `open-next.config.ts` (default config)
   - Add the `prebuild:cf`, `preview:cf`, `deploy:cf`, `cf-typegen` scripts to `package.json`
   - Update `next.config.js` to call `initOpenNextCloudflareForDev()`
   - Update `.gitignore` with `.open-next/`, `.dev.vars`, `.wrangler/`, the prebuild copy dir, and any cf-typegen output

2. **For any runtime-read large data**:
   - Move it to `<app-dir>/<source>/` (kept out of `public/` so dev iteration is fast)
   - Write a `prebuild:cf` script that copies it into `public/<source>/` before build
   - Refactor your readers to be async and use the runtime-agnostic pattern (Node `fs` locally, `env.ASSETS.fetch` on Cloudflare)

3. **In `.github/workflows/deploy.yml`** (repo root): copy the canonical workflow shape, swap `<app-dir>` and `<worker-name>` placeholders.

4. **Provision Cloudflare side** (one-time, requires user action):
   - Create a Cloudflare account (free tier is fine for hobbyist usage)
   - Mint an API token with `Cloudflare Workers Scripts:Edit`, `Account Settings:Read`, `User Details:Read`
   - Copy account ID from the dashboard sidebar
   - Add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as GitHub repo secrets

5. **First deploy**:
   - `git push origin main` triggers the workflow
   - First deploy creates the Worker on Cloudflare's side
   - After first deploy, run `wrangler secret put OPENROUTER_API_KEY` (and any other secrets) once locally
   - Re-trigger the workflow (`gh workflow run deploy.yml`) so the next deploy picks up the secret

6. **Verify**: hit `https://<worker-name>.workers.dev/` in a browser. Check the Cloudflare dashboard for the deploy log + runtime metrics.

## Tools and skills available

- `bash` (for `wrangler` CLI, `gh secret set`, `curl` smoke tests)
- `WebFetch` / `WebSearch` (for the rapidly-evolving OpenNext + Wrangler docs)
- `/claude-api` (for any Anthropic-specific cache_control or streaming quirks that surface in the Worker runtime)

## Quality checklist

- [ ] `wrangler.jsonc` has `compatibility_date >= 2025-09-01` AND both `nodejs_compat` + `global_fetch_strictly_public` flags
- [ ] Worker bundle is under 10 MiB compressed (check the `wrangler deploy` summary)
- [ ] No runtime data files are bundled into the Worker; large files go through ASSETS
- [ ] Secrets are set via `wrangler secret put`, NOT in `wrangler.jsonc` `vars`
- [ ] COOP/COEP and other dynamic headers are in `next.config.js`, NOT `_headers`
- [ ] `_headers` IS used for static asset cache-control (immutable for hashed assets, sane defaults for content)
- [ ] The workflow concurrency-groups by branch (`cancel-in-progress: true`)
- [ ] A smoke step in the workflow asserts the public URL responds with expected content
- [ ] Pre-flight verifier runs before the wrangler-action step

## Common pitfalls

- **Bundle size overrun** — symptom: `wrangler deploy` fails with "Worker exceeded the size limit". Fix: move runtime data to ASSETS (see "10 MiB bundle ceiling" above). Don't try to bump the limit by paying — even Paid tops out at 10 MiB compressed.
- **Edge-runtime export** — symptom: build fails with "Edge runtime is not supported." Fix: remove all `export const runtime = "edge"` declarations. Use Node runtime (which is what OpenNext targets).
- **`fs.readFile` returns ENOENT in production** — symptom: works locally, 500s on Cloudflare. Cause: file isn't in the Worker bundle AND not in ASSETS. Fix: either bundle small files (works with `compatibility_date >= 2025-09-01` against `/bundle`) or serve large ones via ASSETS.
- **`process.env.X` is undefined in the Worker** — symptom: secret reads return `undefined`. Cause: `compatibility_date < 2025-04-01` requires manual binding plumbing. Fix: bump to `2025-04-01` or later. (Our default of `2025-09-01` covers this.)
- **OpenRouter / Anthropic SDK throws "fetch is not defined"** — symptom: runtime error inside `streamText`. Cause: `nodejs_compat` flag missing. Fix: add it to `compatibility_flags`.
- **Custom HTTP headers don't appear on dynamic routes** — cause: tried to set them in `_headers`. Fix: set them in `next.config.js` `headers()`.
- **Two parallel deploys race** — cause: missing `concurrency` block in the workflow. Fix: add `concurrency: { group: deploy-${{ github.ref }}, cancel-in-progress: true }`.
- **Build hangs on `next build` "matches XXXX files" warning** — cause: file-tracer is walking a large data directory. Fix: add `/* turbopackIgnore: true */` to the `path.join(process.cwd(), ...)` call that resolves the data root.
- **The `default` workers.dev hostname is unavailable** — cause: someone already took it. Pick a different `name` in `wrangler.jsonc`. (Bind your own domain via Cloudflare DNS later if needed.)
- **Local `wrangler dev` doesn't see your secrets** — secrets are not synced to local. Either use `.dev.vars` (Cloudflare's local-only file) or `.env.local` (Next-native; loaded only by `next dev`, not by `wrangler dev`).
- **Lazy-construction Proxy throws `<name> is not a function` on first call** — symptom: `bun run dev` works; `next build` works; `bunx wrangler deploy` works; the first POST/GET to an API route logs `TypeError: <minified-name> is not a function` from inside a provider call like `streamText`. Cause: a `new Proxy({}, { apply })` pattern was used to defer construction of an API provider; the JavaScript engine inspects the PROXY TARGET (not the proxy itself) to decide whether to attempt `apply`, and a non-callable target throws before the trap fires. The dev-mode bundling (Turbopack) often inlines or hoists the call differently and hides the issue; the production OpenNext bundle surfaces it. Fix: change the Proxy target from `{}` to `(() => {})` (or any function value) — the trap then fires correctly. Discovered live during E-046 Phase C; cost ~30 minutes of post-deploy debugging. To prevent: any lazy-construction Proxy MUST use a function target if callers ever invoke the value as a function. (Better: also smoke-test the production build locally — `bun run build && bun run start` against a port — not just `bun run dev`.)
- **Provider key wiring missed for direct-SDK paths** — symptom: retrieval pipeline silently degrades; error logs say `<PROVIDER>_API_KEY not set` even though OpenRouter is set. Cause: code uses both an OpenRouter-wrapped provider AND a direct-Anthropic / direct-OpenAI / direct-Google provider (typically for prompt-cache markers or vendor-specific features that don't propagate through OpenRouter). Each direct provider needs its own secret on the Worker. Fix: `wrangler secret put` each one. See the "Inventory ALL secret-consuming subsystems" note under Secrets.
- **COOP/COEP blocks static-chunk Web Workers post-deploy** — symptom: the page loads, the welcome modal renders correctly, but the main body stays stuck on a loading placeholder forever. Network panel shows `ERR_BLOCKED_BY_RESPONSE` on a chunk path like `/_next/static/chunks/turbopack-worker-*.js`. No JS exceptions are raised; the failure is silent at the Worker-creation level. Cause: the page sets `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` (needed for SharedArrayBuffer / OPFS-SQLite via sqlocal). Cross-origin isolation has TWO requirements that static chunks need to satisfy: (1) **`Cross-Origin-Resource-Policy: same-origin`** on the chunk response (needed for any subresource loaded from a COEP page); AND (2) **`Cross-Origin-Embedder-Policy: require-corp`** on the chunk response if that chunk gets loaded as a Web Worker (`new Worker(url)`), per the COEP spec — the worker script itself must be COEP-aware. Without BOTH, the browser silently blocks the worker. Fix: in `public/_headers`, add both headers to the `/_next/static/*` rule:
  ```
  /_next/static/*
    Cache-Control: public, max-age=31536000, immutable
    Cross-Origin-Resource-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp
  ```
  Discovered live mid-QA of E-046 after the user reported "not loading" — server returned 200, hydration succeeded, but sqlocal couldn't spawn its Web Worker so the conversations list stayed in its loading state. To prevent: any app using OPFS-SQLite (or SharedArrayBuffer-based features like WASM threads, ffmpeg.wasm, etc.) on Cloudflare Workers MUST set both CORP and COEP on static chunks via `_headers`. Smoke-test post-deploy with a real headless browser: a `curl /` check ONLY confirms the SSR shell renders; OPFS init only fires client-side. The [[ai-web-app]] playbook should reference this section when picking the OPFS path.

## Resources to check

- [OpenNext Cloudflare docs](https://opennext.js.org/cloudflare) — the canonical reference
- [Cloudflare Workers Next.js framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) — overview from Cloudflare's side
- [Cloudflare Static Assets headers](https://developers.cloudflare.com/workers/static-assets/headers/) — `_headers` file format
- [cloudflare/wrangler-action README](https://github.com/cloudflare/wrangler-action) — workflow input reference
- [Workers limits & pricing](https://developers.cloudflare.com/workers/platform/limits/) — for budget planning
- The project's `wrangler.jsonc`, `open-next.config.ts`, `scripts/prebuild-cf.ts`, `scripts/verify-e046-assets.ts`, and `.github/workflows/deploy.yml` are the canonical examples
