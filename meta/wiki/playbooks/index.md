# Playbooks Index

Specialized toolkits for wiki work items. Load a playbook when the work requires domain-specific guidance, skills, or resources that go beyond common sense execution. Not every work item needs a playbook — only load one if it's genuinely relevant.

## Toolkits

- [ai-experiment](ai-experiment.md) — Running AI/LLM experiments: prompt testing, eval runs, model comparisons, RAG retrieval testing, embedding work. Includes available skills (`/ai_toolbelt`, `/claude-api`) and guidance on reproducibility, cost tracking, and scoring.
- [eval-design](eval-design.md) — Designing evaluation frameworks for conversational AI: dependency chain (ground truth → rubrics → test subjects → judge calibration → baseline), LLM-as-judge architecture, simulated user patterns, safety vs quality separation, per-turn diagnostics.
- [ai-web-app](ai-web-app.md) — Building user-facing AI web apps with Next.js (App Router) + TypeScript + Vercel AI SDK + OpenRouter. Server/client boundary, streaming patterns, tool use, message persistence, common pitfalls.
- [coding-architecture](coding-architecture.md) — Organizing application code via the Repository pattern (owns reads + writes for a domain), composed via constructor injection. When to compose, when to inline, wiring patterns, naming conventions, reactivity integration. Pairs with [[ai-web-app]] for Next.js apps.
- [data-migrations](data-migrations.md) — Class-based TypeScript migrations with apply-tracking table. Use whenever creating or modifying any persistent data schema (browser SQLite, server DB, etc.). Covers file layout, runner, browser-SQLite specifics (workers, multi-tab races), server specifics (zero-downtime patterns), and pitfalls. Pairs with [[coding-architecture]] (runner is invoked from the Repository that owns the DB connection).
- [cloudflare-deploy](cloudflare-deploy.md) — Deploying a Next.js (App Router) app to Cloudflare Workers via `@opennextjs/cloudflare` with an automated GitHub Actions pipeline. Covers wrangler.jsonc canonical shape, compatibility-date thresholds, the 10 MiB bundle ceiling and the ASSETS-binding workaround, the env-bake-in security trap, COOP/COEP through `next.config.js` (not `_headers`), Cloudflare secrets two-tier model, and a "how to apply to a new project" recipe. Pairs with [[ai-web-app]] (the stack being deployed).
