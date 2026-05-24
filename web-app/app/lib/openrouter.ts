import 'server-only';
import { createOpenRouter, type OpenRouterProvider } from '@openrouter/ai-sdk-provider';

// R-016 decided to use @openrouter/ai-sdk-provider (NOT @ai-sdk/openai with a
// custom baseURL) because the OpenAI-compat shim does NOT preserve Anthropic
// provider options like cache_control. E-043 needs prompt caching on the
// system message; E-040 does not yet, but using the same provider from the
// start avoids a swap later.
//
// Lazy construction: at module-load time on Cloudflare, OPENROUTER_API_KEY
// is NOT in process.env — it gets bound at request time by the worker
// runtime from the wrangler secret. Constructing the provider lazily lets
// `next build` succeed without the key, while still failing fast at the
// FIRST request if the key is genuinely missing in production. Per E-046.

let _openrouter: OpenRouterProvider | null = null;

export function getOpenRouter(): OpenRouterProvider {
  if (_openrouter) return _openrouter;
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      'OPENROUTER_API_KEY is not set at request time. ' +
        'Locally: add it to .env (gitignored), see web-app/.env.example. ' +
        'On Cloudflare: run `wrangler secret put OPENROUTER_API_KEY` once. See E-046 / REQ-003.',
    );
  }
  _openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: {
      'HTTP-Referer': process.env.APP_URL ?? 'http://localhost:3000',
      'X-Title': 'Joe Hudson Coach (G-010 web-app)',
    },
  });
  return _openrouter;
}

// Backwards-compat: existing callers do `import { openrouter } from '...'`.
// The Proxy defers construction until a model is actually requested.
export const openrouter: OpenRouterProvider = new Proxy({} as OpenRouterProvider, {
  get(_target, prop, _receiver) {
    const inst = getOpenRouter() as unknown as Record<string | symbol, unknown>;
    const value = inst[prop];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(inst) : value;
  },
  apply(_target, _thisArg, args: unknown[]) {
    return (getOpenRouter() as unknown as (...a: unknown[]) => unknown)(...args);
  },
}) as OpenRouterProvider;

// Default model for G-010. The eval-side v5b coach (E-038) used Sonnet for
// the walker AND the coach. Per R-016, both will share this default.
// OpenRouter model IDs use dot notation (e.g., 'sonnet-4.6', not 'sonnet-4-6').
export const DEFAULT_COACH_MODEL = 'anthropic/claude-sonnet-4.6';
