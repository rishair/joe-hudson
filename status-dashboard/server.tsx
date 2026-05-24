// G-013 status dashboard server.
// Hono + Bun + JSX. Single file entrypoint.

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { html, raw } from "hono/html";

import { getPendingRequests } from "./lib/requests.ts";
import { getWikiState } from "./lib/wiki-state.ts";
import { getRecentActivity } from "./lib/recent-activity.ts";
import {
  getRecentCommits,
  getCommitDiff,
  getWorkingTreeStatus,
} from "./lib/git.ts";
import { getCheckpoints, getCheckpointMarkdown } from "./lib/checkpoints.ts";
import { getBacklogMarkdown } from "./lib/backlog.ts";
import { renderMarkdown } from "./lib/markdown.ts";

import { Page } from "./views/Page.tsx";
import { PendingCallout } from "./views/PendingCallout.tsx";
import { WikiState } from "./views/WikiState.tsx";
import { RecentActivity } from "./views/RecentActivity.tsx";
import { RecentCommits } from "./views/RecentCommits.tsx";
import { Checkpoints } from "./views/Checkpoints.tsx";
import { Backlog } from "./views/Backlog.tsx";
import type { SectionData, SectionResult } from "./views/types.ts";

const app = new Hono();

// Static assets (styles.css, poll.js). Mount under /static/ to keep route
// space clean; the root path is for the dashboard page.
app.use(
  "/static/*",
  serveStatic({
    root: "./public",
    rewriteRequestPath: (p) => p.replace(/^\/static/, ""),
  }),
);

// Wrap a section-fetcher in a try/catch so one section failing doesn't blow
// up the whole page. Result shape mirrors what the views expect.
async function safe<T>(fn: () => Promise<T>): Promise<SectionResult<T>> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function gatherSections(): Promise<SectionData> {
  // Fire all reads in parallel — they're independent.
  const [
    pending,
    wiki,
    activity,
    commits,
    workingTree,
    checkpoints,
    backlog,
  ] = await Promise.all([
    safe(() => getPendingRequests()),
    safe(() => getWikiState()),
    safe(() => getRecentActivity(15, 30)),
    safe(() => getRecentCommits(20)),
    safe(() => getWorkingTreeStatus()),
    safe(() => getCheckpoints()),
    safe(() => getBacklogMarkdown()),
  ]);

  // Bundle commits + workingTree into a single section result.
  let commitsSection: SectionResult<{
    commits: Awaited<ReturnType<typeof getRecentCommits>>;
    workingTree: Awaited<ReturnType<typeof getWorkingTreeStatus>>;
  }>;
  if (commits.ok && workingTree.ok) {
    commitsSection = {
      ok: true,
      value: { commits: commits.value!, workingTree: workingTree.value! },
    };
  } else {
    commitsSection = {
      ok: false,
      error: [commits.error, workingTree.error].filter(Boolean).join("; "),
    };
  }

  return {
    pending,
    wiki,
    activity,
    commits: commitsSection,
    checkpoints,
    backlog,
  };
}

app.get("/", async (c) => {
  const data = await gatherSections();
  const generatedAt =
    new Date().toISOString().replace("T", " ").slice(0, 19) + "Z";
  const body = (<Page data={data} generatedAt={generatedAt} />).toString();
  // hono/jsx toString may return a Promise if children awaited; await both cases.
  const rendered = typeof body === "string" ? body : await body;
  return c.html("<!doctype html>\n" + rendered);
});

// Render each section to HTML as a string, so the poll can replace
// section innerHTML in place. JSX components render to strings via .toString().
app.get("/api/state", async (c) => {
  const data = await gatherSections();
  const generatedAt = new Date().toISOString();
  const sections: Record<string, string> = {
    "section-pending": (<PendingCallout data={data.pending} />).toString(),
    "section-wiki": (<WikiState data={data.wiki} />).toString(),
    "section-activity": (<RecentActivity data={data.activity} />).toString(),
    "section-commits": (<RecentCommits data={data.commits} />).toString(),
    "section-checkpoints": (<Checkpoints data={data.checkpoints} />).toString(),
    "section-backlog": (<Backlog data={data.backlog} />).toString(),
  };
  return c.json({ generatedAt, sections });
});

app.get("/api/commit/:hash", async (c) => {
  const hash = c.req.param("hash");
  try {
    const { diff, truncated } = await getCommitDiff(hash);
    return c.html(
      html`<pre class="diff${truncated ? " truncated" : ""}">${diff}</pre>`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.html(
      html`<div class="error">commit diff unavailable: ${msg}</div>`,
      500,
    );
  }
});

app.get("/api/checkpoint/:filename", async (c) => {
  const filename = c.req.param("filename");
  try {
    const md = await getCheckpointMarkdown(filename);
    const rendered = renderMarkdown(md);
    return c.html(
      html`<div class="checkpoint-content">${raw(rendered)}</div>`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.html(
      html`<div class="error">checkpoint unavailable: ${msg}</div>`,
      500,
    );
  }
});

app.get("/healthz", (c) => c.text("ok"));

const port = Number(process.env.PORT ?? 4001);
console.log(`status-dashboard listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
