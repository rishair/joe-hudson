# AI Web App Playbook

## What this is

Patterns and conventions for building user-facing web apps that talk to LLMs. Stack is **Next.js + TypeScript + Vercel AI SDK + OpenRouter**. Use when the goal involves a web UI that streams or invokes LLM responses, not when the work is a CLI tool, a one-shot eval, or a non-AI web app.

## Stack defaults

- **Framework**: Next.js with **App Router** (server components + route handlers for streaming). Pages Router only for legacy apps.
- **Language**: TypeScript. `strict: true`. No `any` without an inline justification comment.
- **LLM SDK**: **Vercel AI SDK** (`ai`, `@ai-sdk/openai`). Not raw provider SDKs. AI SDK gives `useChat` on the client, `streamText`/`generateText` on the server, tool-use ergonomics, and message-format stability.
- **LLM gateway**: **OpenRouter** via `@ai-sdk/openai` configured with `baseURL: "https://openrouter.ai/api/v1"` and `apiKey: process.env.OPENROUTER_API_KEY`. One key, one billing source, one switch to change models. Slight cost premium (OpenRouter takes a margin) is acceptable for the operational simplicity.
- **Client state**: **Zustand** as the thin reactive layer over repositories (see [[coding-architecture]] — repositories own data access; Zustand handles re-renders). No Redux. React Context only for theme/locale/auth-style cross-cutting concerns.
- **Architecture**: See [[coding-architecture]] playbook for the Repository pattern + composition.

## OpenRouter usage

```typescript
import { createOpenAI } from '@ai-sdk/openai';

export const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    'HTTP-Referer': process.env.APP_URL ?? 'http://localhost:3000',
    'X-Title': 'AppName',
  },
});

// Use anywhere
const result = await streamText({
  model: openrouter('anthropic/claude-sonnet-4-6'),
  // ...
});
```

Model IDs follow OpenRouter's `provider/model` convention. Anthropic: `anthropic/claude-opus-4-7`, `anthropic/claude-sonnet-4-6`, `anthropic/claude-haiku-4-5`. OpenAI: `openai/gpt-5`. Etc.

Set the `HTTP-Referer` and `X-Title` headers so OpenRouter analytics distinguish your apps.

## Server-vs-client boundary

- **System prompts NEVER reach the client.** They live in route handlers (`app/api/.../route.ts`) and are concatenated server-side onto the messages the client sends. The client only knows it's talking to "the assistant"; it does not know what instructions shape that assistant.
- **API keys NEVER reach the client.** `OPENROUTER_API_KEY` is server-only. The client posts messages to your route handler; the route handler calls OpenRouter.
- **User messages and AI responses (including tool calls) live on both sides** if persistence is local. The client stores the full message history; the server reads it on each request and prepends the system prompt.

## Streaming patterns

For chat UIs, use AI SDK's `streamText` + `useChat`:

```typescript
// app/api/chat/route.ts
import { streamText } from 'ai';
import { openrouter } from '@/lib/openrouter';

export async function POST(req: Request) {
  const { messages } = await req.json();
  const result = await streamText({
    model: openrouter('anthropic/claude-sonnet-4-6'),
    system: SYSTEM_PROMPT,
    messages,
    tools: { /* see Tool use */ },
    stopWhen: stepCountIs(10),
  });
  return result.toUIMessageStreamResponse();
}
```

```typescript
// app/page.tsx (client component)
'use client';
import { useChat } from '@ai-sdk/react';

const { messages, sendMessage, status } = useChat({ api: '/api/chat' });
```

The `toUIMessageStreamResponse()` (formerly `toDataStreamResponse`) serializes tool calls + tool results + text together so `useChat` renders them all in order.

## Tool use

Define tools on the server with Zod schemas:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const tools = {
  search_wiki: tool({
    description: 'Search the wiki by keyword. Returns up to 8 matching entries.',
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      return wikiRepository.search(query);
    },
  }),
};
```

`execute` returns whatever JSON the LLM should see. AI SDK handles the round-trip: model emits tool call → SDK calls `execute` → result returned to model → model continues. The `useChat` hook surfaces these as message parts on the client.

## Message persistence

If conversations need to survive a page refresh, persist the **full UI message history including tool calls and results**. Don't reconstruct from text. AI SDK message types serialize cleanly to JSON.

For local-only (no server DB), put it in IndexedDB or browser SQLite (wa-sqlite + OPFS for true SQLite, or sql.js for simpler cases). The client posts the same array back to the route handler on each turn — server is stateless across turns, which keeps deployment simple.

## Tools and skills available

- Bash, Read, Write, Edit
- **`/claude-api`** — for prompt-caching and tool-use specifics on Anthropic models (some patterns differ slightly when going through OpenRouter)
- Web search — for AI SDK and OpenRouter doc lookups (both evolve quickly)

## Quality checklist

- [ ] No API keys or secrets in client code or env vars prefixed `NEXT_PUBLIC_`
- [ ] No system prompts visible to client (check the network tab of a chat turn)
- [ ] OpenRouter `HTTP-Referer` and `X-Title` headers set
- [ ] Streaming works end-to-end (text + tool calls render in order)
- [ ] Multi-turn conversations preserve tool-call message parts (not just text)
- [ ] Rate-limit / cost-cap on the route handler so a single user can't burn the budget
- [ ] Error states render (network failure, model overload, tool error)
- [ ] Loading/streaming indicators are visible

## Common pitfalls

- **Stripping tool calls from history.** A previous tool call's result is part of the conversation context; dropping it confuses the model and produces inconsistent behavior. Always send the full UI message array back.
- **Stateless server amnesia.** The route handler has no memory across turns — the client must send the full history. If you forget, you get amnesia bugs that look like the model being dumb.
- **OpenRouter rate limits and outages.** OpenRouter has its own quota separate from the underlying provider. Plan for 429s and 5xxs at the gateway layer, not just the provider.
- **Cost blindness.** A streaming endpoint can burn $1+ per minute of conversation at scale. Track cost per request and cap per-user/session.
- **System prompt leak via `NEXT_PUBLIC_*` env vars.** Anything `NEXT_PUBLIC_` is bundled into client JS. System prompts must come from non-public env vars and live in route handlers.
- **`useChat` history mutation.** `useChat`'s internal state is the source of truth during a session; if you persist to SQLite, hydrate `initialMessages` from SQLite on mount, then let `useChat` manage. Don't try to sync both ways mid-stream.
- **Model ID drift between providers.** Direct Anthropic SDK uses `claude-sonnet-4-6`; OpenRouter uses `anthropic/claude-sonnet-4-6`. Pick OpenRouter format everywhere in this stack.

## Resources to check

- Goal page Resources section for `OPENROUTER_API_KEY` and cost cap
- `/coach` or other content directories the chat may need to reach via tools
- Vercel AI SDK docs (changes frequently — version-pin and watch breaking changes)
