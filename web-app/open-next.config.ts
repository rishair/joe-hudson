// OpenNext Cloudflare adapter configuration.
//
// For v1 we deploy with NO incremental cache backend (no R2 bucket
// dependency). This works because the app has NO static-or-ISR pages —
// every route is dynamic:
//   - `/` (chat) is a fully client-side React tree using useChat
//   - `/wiki/[[...slug]]` is server-rendered fresh on each request
//   - `/api/chat` streams from OpenRouter on every call
//
// If we ever add ISR pages (e.g., a server-rendered landing page with a
// 1-hour cache), we'd uncomment the r2IncrementalCache override below
// and add the matching r2_buckets binding to wrangler.jsonc.
//
// See https://opennext.js.org/cloudflare/get-started for the full config
// surface (queue, tagCache, kvCache, etc.) — all unneeded for v1.

import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Future-extension scaffolding kept commented:
// import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache';

export default defineCloudflareConfig({
  // incrementalCache: r2IncrementalCache,
});
