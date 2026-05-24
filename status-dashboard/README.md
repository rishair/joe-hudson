# status-dashboard

A small Hono+Bun+JSX server that renders the current state of this project (`/home/claude/joe-hudson/`) as a single-page dashboard. Built for G-013 — see `meta/wiki/goals/G-013.md` and `meta/wiki/experiments/E-050.md`.

## Sections

- **Pending on you** — open `REQ-XXX` items from `meta/wiki/requests/` (top callout, amber background)
- **Wiki state** — active goals, in-flight claimed items, stale-claim warnings
- **Recent agent activity** — files under `meta/wiki/` modified in the last 15 minutes
- **Recent commits** — last 20 commits with click-to-expand diffs (async)
- **Checkpoints** — checkpoint files newest-first, click to read the body
- **Backlog** — `meta/wiki/backlog/index.md` rendered inline

## Run locally

```bash
cd /home/claude/joe-hudson/status-dashboard
bun install
bun run dev          # bun --hot, edits reload
# or
bun run start        # plain start
```

Then visit `http://localhost:4001`.

## Environment variables

| Var          | Default                             | Purpose                                                                                 |
| ------------ | ----------------------------------- | --------------------------------------------------------------------------------------- |
| `PORT`       | `4001`                              | Server listen port                                                                      |
| `WIKI_ROOT`  | the parent dir of this project      | Override for running the dashboard out-of-repo against a different checkout (dev only)  |

## Architecture

- Server: `server.tsx` — single Hono app, four routes: `/`, `/api/state`, `/api/commit/:hash`, `/api/checkpoint/:filename`, plus `/healthz` and `/static/*`.
- Page render: server-rendered JSX (no client framework). `Page.tsx` is the shell; each section is its own component under `views/`.
- Data layer: `lib/*.ts` modules read filesystem and `git` directly. Frontmatter via `gray-matter`. No shell-out to `./wiki.sh` (avoids lock contention with wiki-next agents).
- Polling: `public/poll.js` (~110 lines vanilla JS) fetches `/api/state` every 25s, replaces each section's `innerHTML`, preserves the open-state of `<details>` across replacements.
- Lazy fetch: commit diffs and checkpoint bodies use `data-fetch-once="/api/..."` placeholders that load on first expand.

## Graceful degradation

Each section is wrapped in `safe()` in the server. If a filesystem read or `git` shell-out fails, that section renders a "data temporarily unavailable" message with the error. Other sections continue to render normally.

## Commit subject convention for self-filtering

The dashboard's own recent-commits view filters its own commits two ways:

1. Pathspec `:(exclude)status-dashboard/` drops commits that touched ONLY this directory.
2. `--invert-grep --grep='^dash:'` drops commits whose subject starts with `dash:`.

When making dashboard-only commits, use the prefix:

```
dash: tweak poll interval to 20s
```

If both filters miss a commit, a dashboard commit shows up in the list. Mildly noisy, not a correctness bug.

## Deploy via G-012

`.local-dev.yaml` is the manifest G-012's `paas register` reads. Deploy is `paas register` then `paas restart status` on the Hetzner box. Cloudflare Access policy on the host gates the URL.

## Footprint

- Cold start: ~150ms on first request (file reads happen at request time, not boot)
- Per-request: dominated by `git log` (50-100ms typical); section reads parallelize via `Promise.all`
- Memory: ~30 MB RSS idle for the Bun process
