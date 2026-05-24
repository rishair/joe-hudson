import 'server-only';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

// R-016 decided to use @openrouter/ai-sdk-provider (NOT @ai-sdk/openai with a
// custom baseURL) because the OpenAI-compat shim does NOT preserve Anthropic
// provider options like cache_control. E-043 needs prompt caching on the
// system message; E-040 does not yet, but using the same provider from the
// start avoids a swap later.

if (!process.env.OPENROUTER_API_KEY) {
  // Fail loud at module-load on the server. The route handler imports this
  // module; without a key, the import itself throws and the route returns 500
  // immediately rather than producing confusing downstream errors.
  throw new Error(
    'OPENROUTER_API_KEY is not set. Add it to .env (gitignored). See web-app/.env.example.',
  );
}

export const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    'HTTP-Referer': process.env.APP_URL ?? 'http://localhost:3000',
    'X-Title': 'Joe Hudson Coach (G-010 web-app)',
  },
});

// Default model for G-010. The eval-side v5b coach (E-038) used Sonnet for
// the walker AND the coach. Per R-016, both will share this default.
// OpenRouter model IDs use dot notation (e.g., 'sonnet-4.6', not 'sonnet-4-6').
export const DEFAULT_COACH_MODEL = 'anthropic/claude-sonnet-4.6';
