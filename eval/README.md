# Eval Harness

Multi-turn evaluation harness for the Joe Hudson AI coach (G-008 / E-023).

## Setup

Requires Bun (`curl -fsSL https://bun.sh/install | bash`).

```bash
bun install
```

Set `ANTHROPIC_API_KEY` in `.env` at the repo root, or export it in your shell.

## Quick start

```bash
# Validate every YAML/JSON artifact loads through Zod successfully
bun run eval/run.ts validate-schemas

# Verify Zod fails loudly on a corrupted profile
bun run eval/run.ts corrupt-test

# Run smoke test (2 profiles, ~3 min, ~$1)
bun run eval/run.ts smoke

# Run full suite (15 profiles, ~5 min, ~$5-7)
bun run eval/run.ts full

# Useful options
bun run eval/run.ts smoke --max-turns 10
bun run eval/run.ts smoke --profiles client-crisis-suicidal-001
bun run eval/run.ts full --coach eval/coach-configs/my-experimental.yaml
bun run eval/run.ts full --no-cache   # bypass local file cache
```

## Models

- **Judge:** `claude-opus-4-7` (one tier above coach; R-010 decision). Opus 4.7 does not accept `temperature` — the SDK wrapper detects this and omits the parameter automatically.
- **Coach:** `claude-sonnet-4-6` (configurable per coach config).
- **Client LLM:** `claude-sonnet-4-6`.

If a requested model is unavailable, calls retry up to 5 times with exponential backoff capped at 30s (~1 min total wait). After that the call surfaces the error; no automatic model fallback. Check status.claude.com when 529 storms hit; wait and re-run.

## Caching

Two independent layers:

1. **Local file cache** at `eval/cache/<sha256>.json`. Hashes on `model + system + messages + temperature/max-tokens`. Hits return the previous response without an API call. Manual invalidation: `rm -rf eval/cache/`.
2. **Anthropic prompt caching** via `cache_control: { type: "ephemeral" }` on coach, client, and judge system blocks. 5-minute TTL. Cache reads bill at 10% of base input pricing; cache writes bill at 125% of base.

## Output

Each run writes to `eval/results/<UTC-timestamp>/`:

- `summary.json` — run-level aggregates (per-dimension means, safety pass rate, total cost, cache stats)
- `scorecard.<profile-id>.json` — per-conversation scorecard with per-dimension scores AND per-turn × per-dimension matrix
- `conversation.<profile-id>.json` — full client+coach transcript with per-call records
- `cost_log.jsonl` — one JSON record per API call (model, tokens, cost, cache hit/miss)

## What the harness loads

- Rubrics: `eval/rubrics/*.yaml` (E-019, 6 dimensions)
- Profiles: `eval/profiles/*.yaml` (E-020 + E-027, 15 total)
- Safety criteria: `eval/safety-criteria.yaml` (E-027, 6 criteria)
- Methodology checklist: `eval/checklists/methodology.yaml` (E-022, validated only — not yet injected into judge prompt)
- Anti-pattern tests: `eval/anti-pattern-tests/*.yaml` (E-021, validated only — not yet injected into judge prompt)
- Gold exchanges: `eval/gold-exchanges/*.json` (E-026, used as few-shot examples in dimension judge prompts)
- Client prompt template: `eval/client-prompt-template.md` (E-020)
- Coach configs: `eval/coach-configs/*.yaml` (this experiment)

## Architecture pointer

See `meta/wiki/experiments/E-023.md` for the full Result section.

Files:

- `eval/run.ts` — entrypoint
- `eval/lib/schemas.ts` — Zod schemas for all loaded YAML/JSON
- `eval/lib/loaders.ts` — YAML/JSON readers
- `eval/lib/anthropic.ts` — SDK wrapper with retry, cost tracking, prompt-cache support
- `eval/lib/cache.ts` — local file response cache
- `eval/lib/conversation.ts` — client↔coach turn loop with visibility enforcement
- `eval/lib/judge.ts` — two-pass judge (safety + per-dimension parallel)
- `eval/lib/aggregate.ts` — scorecard + run summary builders
