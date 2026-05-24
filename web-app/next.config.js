/** @type {import('next').NextConfig} */
// COOP/COEP headers are required by R-015's sqlocal + OPFS choice (E-041)
// and are set here from day one so E-041 inherits a working environment.
// OpenRouter calls run server-side from /api/chat, so COEP does not block them.
//
// Per E-046: these headers are emitted at the Next.js layer (in route
// handlers and page responses), so they reach the browser EVEN when the
// app is served from a Cloudflare Worker via @opennextjs/cloudflare —
// the `_headers` file under public/ only governs static asset responses,
// not dynamic Worker output. The two configurations are complementary.
const securityHeaders = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
];

const nextConfig = {
  reactStrictMode: true,
  // The repo root has its own package-lock.json (eval harness); pin Turbopack
  // to web-app's directory so it does not infer the wrong workspace root.
  turbopack: {
    root: import.meta.dirname,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

// Initialize @opennextjs/cloudflare bindings during `next dev`. This makes
// `getCloudflareContext()` work locally in dev mode so the wiki-asset-reader
// can be exercised end-to-end without `wrangler dev`. Side-effect-only
// import: no-op if @opennextjs/cloudflare isn't installed (e.g., before
// `bun install` runs).
//
// Wrapped in a try because the package may not be present in some
// environments (e.g., a fresh checkout that hasn't run install yet). The
// dev server still works without it; we just lose dev-time CF context.
try {
  const { initOpenNextCloudflareForDev } = await import('@opennextjs/cloudflare');
  initOpenNextCloudflareForDev();
} catch {
  // Adapter not installed, or initialization failed. Continue with
  // pure-Next dev mode — the wiki-asset-reader falls back to node:fs
  // which is what we want for local development anyway.
}

export default nextConfig;
