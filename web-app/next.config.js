/** @type {import('next').NextConfig} */
// COOP/COEP headers are required by R-015's sqlocal + OPFS choice (E-041)
// and are set here from day one so E-041 inherits a working environment.
// OpenRouter calls run server-side from /api/chat, so COEP does not block them.
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

export default nextConfig;
