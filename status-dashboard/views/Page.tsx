// Top-level page layout. Server-rendered shell with embedded poll script.

import { PendingCallout } from "./PendingCallout.tsx";
import { WikiState } from "./WikiState.tsx";
import { RecentActivity } from "./RecentActivity.tsx";
import { RecentCommits } from "./RecentCommits.tsx";
import { Checkpoints } from "./Checkpoints.tsx";
import { Backlog } from "./Backlog.tsx";
import type { SectionData } from "./types.ts";

export function Page({ data, generatedAt }: { data: SectionData; generatedAt: string }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>play.ris.hair status</title>
        <link rel="stylesheet" href="/static/styles.css" />
      </head>
      <body>
        <header class="topbar">
          <h1>play.ris.hair / status</h1>
          <div class="meta">
            <span id="last-refresh">just now</span>
            <button type="button" id="refresh-now">Refresh now</button>
            <span class="generated">generated {generatedAt}</span>
          </div>
        </header>
        <main>
          <section id="section-pending" class="section section-pending">
            <PendingCallout data={data.pending} />
          </section>
          <section id="section-wiki" class="section">
            <WikiState data={data.wiki} />
          </section>
          <section id="section-activity" class="section">
            <RecentActivity data={data.activity} />
          </section>
          <section id="section-commits" class="section">
            <RecentCommits data={data.commits} />
          </section>
          <section id="section-checkpoints" class="section">
            <Checkpoints data={data.checkpoints} />
          </section>
          <section id="section-backlog" class="section">
            <Backlog data={data.backlog} />
          </section>
        </main>
        <script src="/static/poll.js" />
      </body>
    </html>
  );
}
