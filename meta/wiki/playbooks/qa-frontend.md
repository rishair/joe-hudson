# Frontend QA Playbook

## What this is

How to QA any user-facing surface in this repo — chat UIs, dashboards, wiki views, public APIs that humans inspect. Distilled from the live-browser debugging round on G-010 (E-046 post-deploy) where the deployed coach SSR'd correctly but stayed stuck on "Loading conversations..." forever because of a COOP/COEP regression that no curl-based smoke test could see.

Pairs with the [[ai-web-app]] playbook (which assumes the Next.js + AI SDK stack) and the [[cloudflare-deploy]] playbook (which assumes Cloudflare Workers deploy). This playbook is stack-agnostic — it's about HOW to drive a real browser against whatever you shipped.

## When to QA

Always, for any experiment whose output a human will look at:

- A web page rendered to a browser
- A chat UI, dashboard, modal, form
- An API response that a human inspects in the browser network tab
- A CLI command whose output a human reads
- Static content (markdown rendered to HTML, generated images)

Skip QA for:

- Internal scripts that produce machine-only output (data pipelines, ingestion)
- Backend services consumed only by code (a DB migration, a queue worker)
- Refactors with no observable surface change

When in doubt: if a human will look at the output, it needs QA.

## The hard truth a curl-only smoke test won't tell you

A `curl /` against the deployed URL returns 200 with valid HTML. That proves SSR works. It tells you NOTHING about:

- Whether the client-side JS bundle hydrates correctly
- Whether Web Workers spawn (COOP/COEP, CORS, CORP all silently block them)
- Whether IndexedDB / OPFS / SQLite init succeeds
- Whether `<dialog>` modals open and close correctly
- Whether tab/keyboard navigation works
- Whether mobile layouts overflow or break
- Whether SSE / streaming actually streams (vs buffers)
- Whether async fetches that depend on initial state ever resolve

You need a real browser. Headless Chrome is the minimum bar.

## Tool stack (canonical for this repo, as of 2026-05-24)

**Use Puppeteer with the bundled Chromium.** Battle-tested on the Hetzner box.

```bash
# One-time setup
cd /tmp && mkdir -p pw-qa && cd pw-qa
bun init -y
bun add -d puppeteer
# Install Chrome's shared libs (Puppeteer bundles Chromium but not libnspr4/libcairo etc)
sudo apt-get install -y \
  libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
  libasound2t64 libcairo2 libpangocairo-1.0-0 \
  libpangoft2-1.0-0 libfontconfig1 libfreetype6 \
  libxext6 libx11-6 libxcb1 libxrender1 libdrm2 \
  libexpat1 libdbus-1-3 libglib2.0-0t64
```

**Do NOT use Playwright on ubuntu26.04-x64** — Playwright doesn't ship a Chromium build for that platform. Error: "Playwright does not support chromium on ubuntu26.04-x64". Puppeteer ships its own Chromium download which works fine once the apt libs are in place.

**Browserbase MCP returned `Invalid query parameters` on every call from this environment** — that tool path is dead here. If your Claude Code session has working Browserbase MCP, prefer it for cloud-side QA (it can hit public URLs without local browser deps). But Puppeteer is the reliable fallback.

**For live Worker logs during QA**: run `bunx wrangler tail <worker-name> --format json` in the background; pipes JSON-per-line events you can grep for exceptions / cost markers. Source `.env` for the CF token first.

## The reusable QA driver

`/tmp/pw-qa/qa.mjs` (see the file on disk for the latest version). It captures:

- `page.on('console')` — every console log/warn/error from the page
- `page.on('pageerror')` — uncaught exceptions
- `page.on('requestfailed')` — network failures (block by CORP/COEP, 404s, DNS errors)
- `page.on('response')` — any response with status >= 400
- Page screenshots (mobile 412×915 and desktop 1280×800, both `fullPage: true`)
- OPFS availability check via `navigator.storage.getDirectory()`
- Body innerText and main element content (to verify what the user actually sees)

Extend it per QA — add interaction steps (`page.type`, `page.click`), wait points, custom DOM inspections.

## The Q-XXX workflow

1. **Create the QA page** when scoping the parent experiment:
   ```
   ./wiki.sh create qa "Coach chat end-to-end on prod URL" \
     --experiment E-043 \
     --brief "Welcome flow, send message, retrieval, streaming, modal"
   ```
2. **Fill in the test plan** before any work — concrete scenarios with expected outcomes. "Send 'I feel like an imposter at work' → response renders, resource modal shows imposter-syndrome wiki entry" beats "test the chat."
3. **Wait for the parent experiment to succeed** (frontmatter `status: succeeded` means the build/deploy worked; QA blesses the user-visible behavior).
4. **Claim the QA page** and walk the test plan with the real browser.
5. **Record results per scenario** in the page — pass/fail + screenshots saved under `/tmp/pw-qa/qa-screenshots/<descriptive-name>.png` (a sibling agent can re-examine them).
6. **Triage issues by severity**:
   - `blocker` — primary feature broken (chat doesn't respond, modal doesn't open, page never renders)
   - `important` — feature works but degraded (slow, partial, layout broken on mobile)
   - `minor` — cosmetic or polish (alignment, typo, console warning)
7. **Set the verdict**: `passed` only if zero `blocker` and zero `important`. Otherwise `needs-fix`.
8. **Triage spawned fixes** (orchestrator / next wiki-next cycle, NOT the QA agent itself):
   - `blocker` → spawn a fix experiment as `E-XXX`; QA stays `failed` until the fix lands and a re-run passes
   - `important` → spawn a fix OR park as backlog with explicit reason; QA stays `failed`
   - `minor` → log on parent experiment's "future improvements"; QA can be `passed` with caveats noted

The QA agent's job is to FIND and DOCUMENT. The orchestrator's job is to TRIAGE and SCOPE FIXES. Don't conflate them — keeps QA cheap to run repeatedly.

## Common silent failures (post-deploy)

These are the bugs that pass `curl` and fail in a real browser. Watch for them every time:

- **COOP/COEP blocks Web Workers** — symptom: SQLite-backed app stuck on "Loading...", no JS exception. Cause: page sets `Cross-Origin-Embedder-Policy: require-corp` but the chunk that gets loaded as a Web Worker lacks `Cross-Origin-Embedder-Policy: require-corp` (and `Cross-Origin-Resource-Policy: same-origin`) on its OWN response. See [[cloudflare-deploy]] "Common pitfalls" for the `_headers` fix.
- **Secret leaked into client bundle** — symptom: subtle, easy to miss. Mitigation: fetch a sample of JS chunks and grep for `sk-or-v1-`, `sk-ant-`, `hf_` patterns. The `cf-build.ts` wrapper catches this at build time but post-deploy verification matters.
- **Streaming infrastructure works but blocks for N seconds before first byte** — symptom: user perceives "no streaming." Cause: a synchronous prework step (retrieval, validation, throttle wait) runs to completion before `createUIMessageStream` opens. Fix: open the stream first, write progress data parts during the prework. See E-043 / E-047 progressive-streaming work for the pattern.
- **Hydration mismatch** — symptom: SSR HTML differs from client render; React errors in console; FOUC. Cause: time-dependent values (Date.now), random IDs, locale strings rendered server-side but re-computed client-side.
- **`fetch` is blocked by COEP** without `crossorigin` attribute — third-party scripts, fonts, images need `crossorigin="anonymous"` AND a CORS-allowing response from the third party.
- **`<dialog>` open attribute set but element not in DOM** — modal "opens" but isn't visible. Verify the dialog is actually rendered (e.g., not behind a Suspense boundary that hasn't resolved).
- **Mobile viewport breaks** — desktop layout assumes width. Set Puppeteer viewport to 412×915 (Pixel-ish) before screenshotting; check for overflow.
- **Click handlers not bound** — symptom: clicking does nothing. Usually a hydration error elsewhere on the page killed the event-handler attachment for the whole tree.
- **404 favicon noise** — cosmetic, document and move on.

## Cost-aware QA

Each LLM-backed turn in a chat-app QA costs real money. Discipline:

- **Limit to 3-5 real turns total** per pass. Cover golden path + 1-2 edge cases.
- **Use mocked state where possible** for non-LLM-touching tests (welcome flow, modal opens, wiki navigation).
- **Capture costs from `wrangler tail`** during the pass — if any turn exceeds expectations, flag it as an `important` issue ("cost spike on prompt X").
- **Don't QA-iterate on the same expensive flow** to chase a cosmetic bug — fix and re-QA once, not five times.

For G-010's pricing as of 2026-05-24: ~$0.03-0.10 per coach turn (Sonnet 4.6 with prompt cache, graph-walk + walker + coach). Budget $0.50 per full QA pass.

## What a good QA report looks like

A scannable table at the top, then per-feature sections with verdict + issues + screenshots. The reader (you, in a week, or a sibling agent) should be able to tell at a glance what works and what doesn't.

```markdown
| Feature | Verdict | Blockers | Important | Minor |
|---------|---------|----------|-----------|-------|
| Welcome flow | pass | 0 | 0 | 1 (typo) |
| Chat persistence | pass | 0 | 0 | 0 |
| Wiki view | pass | 0 | 0 | 0 |
| Resource modal | pass | 0 | 1 | 0 |
| Coach pipeline E2E | fail | 1 | 0 | 0 |
| Mobile rendering | fail | 0 | 2 | 3 |
| Streaming UX | fail | 0 | 1 | 0 |
| Error states | pass | 0 | 0 | 1 |
| Security smoke | pass | 0 | 0 | 0 |
```

Then per-feature: "what was tested", "result", "issues found" (each with severity + repro + recommended fix), "screenshots".

## Re-running QA after a fix

Same Q-XXX page. Append a new section "Re-run YYYY-MM-DD" with results. The page accumulates a per-run history. When verdict flips from `needs-fix` to `passed`, mark the QA `passed` and the parent goal's exit criterion ticks.

The "Spawned fixes" section in the QA page tracks which fixes were attempted between runs — read it before re-running so you know what to focus on.

## Anti-patterns

- **Don't fix bugs inside the QA page.** QA finds and documents; fix lives in a sub-experiment. Mixing the two makes QA un-rerunnable.
- **Don't auto-spawn fix experiments from the QA agent.** Human (or orchestrator) triage. Otherwise QA passes generate noise.
- **Don't ship without QA on a frontend-touching experiment.** The cost of a 30-minute QA pass is far less than the cost of a stuck user reporting "it's not loading" via mobile.
- **Don't write a QA page after the fact ("we tested manually").** Capture the test plan up front in the Q-XXX page so it's re-runnable on the next deploy.

## Resources

- Puppeteer docs: https://pptr.dev/
- The reusable driver: `/tmp/pw-qa/qa.mjs`
- Companion playbooks: [[cloudflare-deploy]], [[ai-web-app]]
- Origin story: the COOP/COEP debugging session on 2026-05-24 captured in `cloudflare-deploy` playbook under "Common pitfalls"
