// GET /api/wiki/page?slug=<slug>
//
// Fetches a wiki page body for the resource modal (E-044). The modal's left
// panel is a client component (it lives inside the chat page so it can read
// nuqs URL state and the in-memory message list), but the page bodies are
// filesystem-backed and the slug index is a server-side singleton. This
// route is the thin bridge: the modal calls it on focus change and gets back
// the rewritten markdown body + title + category metadata.
//
// Why not call the existing /wiki/<cat>/<slug> server route from the modal?
// Two reasons: (1) that route returns a full HTML page including the chrome
// (breadcrumb, "back to chat" affordance) which would duplicate the modal's
// own header, and (2) it doesn't expose the slug index needed for resolving
// in-modal wikilink clicks. This dedicated endpoint returns just what the
// modal renders.
//
// Response shape:
//   {
//     slug: string,
//     category: string,
//     title: string,
//     body: string,          // already-rewritten markdown (Obsidian [[wikilinks]]
//                            // converted to standard [text](/wiki/...) form so
//                            // the client renderer can dispatch by URL shape)
//     related: string[],     // for the "Related" section the modal may render
//   }
// On not-found: 404 with { error: 'not_found', slug }.

import { NextResponse } from 'next/server';
import { getWikiRepo } from '@/app/lib/wiki/container';
import { rewriteWikilinks } from '@/app/lib/wiki/wikilinks';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'missing_slug' }, { status: 400 });
  }
  const repo = getWikiRepo();
  const [pages, slugIndex] = await Promise.all([
    repo.find({ slug }),
    repo.getSlugIndex(),
  ]);
  const page = pages[0];
  if (!page) {
    return NextResponse.json({ error: 'not_found', slug }, { status: 404 });
  }
  // Server-side wikilink processing so the slug index never reaches the client.
  const body = rewriteWikilinks(page.body, slugIndex);
  return NextResponse.json({
    slug: page.slug,
    category: page.category,
    title: page.title,
    body,
    related: page.related,
  });
}
