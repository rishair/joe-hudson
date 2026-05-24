// Runtime-agnostic reader for files in the ingested wiki tree.
//
// Two backends:
//
//   - Node.js / local dev / `bun run dev`: use `node:fs` directly against
//     `content/wiki/<relPath>`. Sync `readFileSync` is fine in this mode.
//
//   - Cloudflare Worker (production deploy via @opennextjs/cloudflare):
//     use the ASSETS binding (`env.ASSETS.fetch(...)`) because the wiki
//     content (~38 MiB, 2,379 files) is too large to fit in the Worker's
//     10 MiB compressed bundle limit. The wiki content is bundled into the
//     static-assets directory (`.open-next/assets/content/wiki/`) at build
//     time by `scripts/prebuild-cf.ts`, and the Worker fetches a single
//     page on demand via `env.ASSETS.fetch('https://assets.local/content/
//     wiki/<relPath>')`.
//
// Detection is by best-effort try: if `getCloudflareContext()` succeeds we
// are on Cloudflare; otherwise fall back to fs. The small index files
// (_index.md, _backlinks.json, .ingest-manifest.json — about 1.4 MiB
// compressed total) are read this same way; they sit in the assets bundle
// not the worker bundle so the worker is small.

import 'server-only';

let cloudflareReader: ((relPath: string) => Promise<string | null>) | null = null;
let nodeReader: ((relPath: string) => Promise<string | null>) | null = null;

function isCloudflareRuntime(): boolean {
  // OpenNext sets process.env.NEXT_RUNTIME=cloudflare in the Worker.
  // Also fall back to the workerd-vs-node user-agent check that some
  // runtimes provide.
  if (typeof process !== 'undefined') {
    if (process.env.NEXT_RUNTIME === 'cloudflare') return true;
    // OpenNext exposes CF_PAGES / CF_WORKER vars on some surfaces; treat
    // anything starting with CF_ as a positive signal.
    if (process.env.CLOUDFLARE_WORKER === '1') return true;
  }
  // navigator.userAgent === 'Cloudflare-Workers' in workerd.
  if (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers') {
    return true;
  }
  return false;
}

async function getCloudflareReader(): Promise<(relPath: string) => Promise<string | null>> {
  if (cloudflareReader) return cloudflareReader;
  const { getCloudflareContext } = await import('@opennextjs/cloudflare');
  cloudflareReader = async (relPath: string): Promise<string | null> => {
    const { env } = getCloudflareContext();
    // The hostname is meaningless; only the pathname matches an asset.
    // Per Cloudflare docs: any valid hostname works.
    const url = `https://assets.local/content/wiki/${relPath}`;
    const res = await (env as { ASSETS: { fetch(input: string | Request | URL): Promise<Response> } }).ASSETS.fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`ASSETS.fetch(${url}) returned ${res.status}`);
    }
    return await res.text();
  };
  return cloudflareReader;
}

async function getNodeReader(): Promise<(relPath: string) => Promise<string | null>> {
  if (nodeReader) return nodeReader;
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  // `turbopackIgnore` hint: tells Next.js's file tracer NOT to bundle
  // every file rooted at process.cwd() into the route's static bundle.
  // The content tree is 38 MiB / 2,379 files — on Cloudflare it goes
  // via ASSETS, on Node it's read at runtime from process.cwd(), but
  // either way Next shouldn't try to trace it.
  const root =
    process.env.WIKI_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), 'content', 'wiki');
  nodeReader = async (relPath: string): Promise<string | null> => {
    try {
      return await fs.readFile(path.join(root, relPath), 'utf-8');
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'ENOENT') return null;
      throw err;
    }
  };
  return nodeReader;
}

/**
 * Read a wiki file by its path relative to `content/wiki/`. Returns null
 * if the file does not exist. Throws on other I/O failures.
 *
 * Examples:
 *   readWikiAsset('_index.md')
 *   readWikiAsset('.ingest-manifest.json')
 *   readWikiAsset('concepts/limiting-belief.md')
 */
export async function readWikiAsset(relPath: string): Promise<string | null> {
  // Defensive: refuse paths that escape the content tree.
  if (relPath.includes('..') || relPath.startsWith('/')) {
    throw new Error(`readWikiAsset: refusing path ${relPath}`);
  }
  const reader = isCloudflareRuntime() ? await getCloudflareReader() : await getNodeReader();
  return reader(relPath);
}

/**
 * Sync variant — only safe to call on Node. Throws on Cloudflare runtime
 * because the ASSETS binding is async-only. Used by code paths that need
 * to stay synchronous (e.g., one-shot module init reads) AND know they
 * will only run on Node (e.g., a build-time index loader).
 *
 * The coach pipeline's `loadCompendium()` is async-await safe and should
 * use `readWikiAsset` instead.
 */
export function readWikiAssetSyncOrNull(relPath: string): string | null {
  if (isCloudflareRuntime()) {
    throw new Error(
      'readWikiAssetSyncOrNull called on Cloudflare runtime; use readWikiAsset (async) instead',
    );
  }
  if (relPath.includes('..') || relPath.startsWith('/')) {
    throw new Error(`readWikiAssetSyncOrNull: refusing path ${relPath}`);
  }
  // Lazy require to keep this file load-light when the sync path is unused.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  // `turbopackIgnore` keeps Next's file tracer from walking the 2,379-file
  // wiki content tree when bundling code paths that reference this fn.
  const root =
    process.env.WIKI_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), 'content', 'wiki');
  try {
    return fs.readFileSync(path.join(root, relPath), 'utf-8');
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ENOENT') return null;
    throw err;
  }
}

export const __runtime = { isCloudflareRuntime };
