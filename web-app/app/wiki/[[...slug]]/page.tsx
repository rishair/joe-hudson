// Wiki catch-all route (E-042).
//
// URL shapes handled:
//   /wiki                          → category index (all categories, counts)
//   /wiki/{category}               → category listing (all pages in that
//                                     category, sorted by title)
//   /wiki/{category}/{slug}        → individual wiki page
//   /wiki/_broken/{slug}           → broken-link landing (rendered as a
//                                     not-found page; the slug is included
//                                     so a future "create this page" UI
//                                     could be added without re-routing)
//
// The optional-catch-all `[[...slug]]` shape captures `/wiki` too (with
// slug = undefined).
//
// Server component: all parsing happens at request time. The wiki repo
// caches the manifest in memory so subsequent requests are fast.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { getWikiRepo } from '../../lib/wiki/container';
import { rewriteWikilinks, BROKEN_LINK_SENTINEL } from '../../lib/wiki/wikilinks';
import { WikiRenderer } from '../../components/wiki-renderer';
import { BackToChat } from '../../components/back-to-chat';
import type { WikiCategory } from '../../lib/wiki/types';

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'anti-patterns',
  'applications',
  'concepts',
  'concerns',
  'distinctions',
  'examples',
  'frameworks',
  'moves',
  'patterns',
  'practices',
  'principles',
  'questions',
  'reads',
]);

type PageProps = {
  params: Promise<{ slug?: string[] }>;
};

export default async function WikiCatchAllPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const { slug } = await params;
  const segments = slug ?? [];
  const repo = getWikiRepo();

  // /wiki → category index
  if (segments.length === 0) {
    return <WikiIndexView />;
  }

  // /wiki/{category} → category listing
  if (segments.length === 1) {
    const cat = segments[0];
    if (cat === BROKEN_LINK_SENTINEL) {
      // The slug-only broken sentinel is malformed (it needs a target);
      // 404 rather than confuse the user with an empty broken page.
      notFound();
    }
    if (!VALID_CATEGORIES.has(cat)) {
      notFound();
    }
    return <CategoryView category={cat as WikiCategory} />;
  }

  // /wiki/{category}/{slug} → page render (or broken-link landing)
  if (segments.length === 2) {
    const [category, pageSlug] = segments;

    if (category === BROKEN_LINK_SENTINEL) {
      return <BrokenLinkLanding slug={pageSlug} />;
    }

    if (!VALID_CATEGORIES.has(category)) {
      notFound();
    }

    const pages = await repo.find({
      slug: pageSlug,
      category: category as WikiCategory,
    });
    const page = pages[0];

    if (!page) {
      // Try to recover via the slug index — a typo in the category URL
      // shouldn't 404 if the slug exists elsewhere. R-018 confirmed slug
      // uniqueness, so we can resolve confidently.
      const idx = await repo.getSlugIndex();
      const entry = idx.get(pageSlug);
      if (entry) {
        return <PageView slug={pageSlug} category={entry.category} />;
      }
      notFound();
    }

    return <PageView slug={pageSlug} category={page.category} />;
  }

  // /wiki/a/b/c/... → too deep
  notFound();
}

// --------------------------------------------------------------------------

async function PageView({
  slug,
  category,
}: {
  slug: string;
  category: WikiCategory;
}): Promise<React.ReactElement> {
  const repo = getWikiRepo();
  const [pages, slugIndex] = await Promise.all([
    repo.find({ slug, category }),
    repo.getSlugIndex(),
  ]);
  const page = pages[0];
  if (!page) notFound();

  // Process wikilinks server-side so the client component receives plain
  // markdown links. Reduces client bundle (no slug index sent over the
  // wire) and keeps the renderer reusable for E-044's modal context.
  const processedBody = rewriteWikilinks(page.body, slugIndex);

  return (
    <WikiLayout>
      <Suspense fallback={null}>
        <BackToChat />
      </Suspense>
      <nav
        aria-label="Breadcrumb"
        style={{
          fontSize: 13,
          color: '#666',
          marginBottom: 12,
          display: 'flex',
          gap: 6,
          alignItems: 'center',
        }}
      >
        <Link href="/wiki" style={crumbLink}>
          Wiki
        </Link>
        <span>/</span>
        <Link href={`/wiki/${page.category}`} style={crumbLink}>
          {page.category}
        </Link>
        <span>/</span>
        <span style={{ color: '#1a1a1a' }}>{page.title}</span>
      </nav>
      <h1
        style={{
          fontSize: 30,
          fontWeight: 600,
          margin: '4px 0 8px',
          lineHeight: 1.2,
        }}
      >
        {page.title}
      </h1>
      <div
        style={{
          fontSize: 12,
          color: '#888',
          marginBottom: 24,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {page.category} · {page.slug}
      </div>
      <article style={{ color: '#222', fontSize: 16 }}>
        <WikiRenderer body={processedBody} linkBehavior="route" />
      </article>
      {page.related.length > 0 && (
        <section style={{ marginTop: 40, borderTop: '1px solid #e0e0e0', paddingTop: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>
            Related
          </h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {page.related.map((rslug) => {
              const entry = slugIndex.get(rslug);
              if (entry) {
                return (
                  <li key={rslug} style={{ marginBottom: 4, lineHeight: 1.5 }}>
                    <Link
                      href={`/wiki/${entry.category}/${rslug}`}
                      style={{ color: '#1a73e8', textDecoration: 'underline' }}
                    >
                      {entry.title}
                    </Link>
                  </li>
                );
              }
              return (
                <li
                  key={rslug}
                  style={{ marginBottom: 4, lineHeight: 1.5, color: '#999' }}
                  title={`Missing target: ${rslug}`}
                >
                  <span
                    style={{
                      color: '#b00020',
                      textDecoration: 'underline wavy #b00020',
                    }}
                  >
                    {rslug}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </WikiLayout>
  );
}

async function CategoryView({
  category,
}: {
  category: WikiCategory;
}): Promise<React.ReactElement> {
  const repo = getWikiRepo();
  const refs = await repo.list({ category });
  return (
    <WikiLayout>
      <nav
        aria-label="Breadcrumb"
        style={{ fontSize: 13, color: '#666', marginBottom: 12 }}
      >
        <Link href="/wiki" style={crumbLink}>
          Wiki
        </Link>{' '}
        / <span style={{ color: '#1a1a1a' }}>{category}</span>
      </nav>
      <h1
        style={{
          fontSize: 28,
          fontWeight: 600,
          margin: '4px 0 4px',
          lineHeight: 1.2,
          textTransform: 'capitalize',
        }}
      >
        {category}
      </h1>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 24 }}>
        {refs.length} {refs.length === 1 ? 'entry' : 'entries'}
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {refs.map((ref) => (
          <li
            key={ref.slug}
            style={{
              padding: '10px 0',
              borderBottom: '1px solid #eee',
            }}
          >
            <Link
              href={`/wiki/${ref.category}/${ref.slug}`}
              style={{
                color: '#1a73e8',
                textDecoration: 'none',
                fontSize: 15,
                fontWeight: 500,
              }}
            >
              {ref.title}
            </Link>
            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
              {ref.slug}
            </div>
          </li>
        ))}
      </ul>
    </WikiLayout>
  );
}

async function WikiIndexView(): Promise<React.ReactElement> {
  const repo = getWikiRepo();
  const refs = await repo.list();
  const counts = new Map<string, number>();
  for (const r of refs) {
    counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  }
  const categories = Array.from(VALID_CATEGORIES).sort();
  return (
    <WikiLayout>
      <h1
        style={{
          fontSize: 28,
          fontWeight: 600,
          margin: '4px 0 4px',
        }}
      >
        Joe Hudson Compendium
      </h1>
      <p
        style={{
          color: '#666',
          marginBottom: 28,
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        {refs.length} entries across {categories.length} categories. Browse a
        category or jump straight to a page from the chat by clicking a
        resource attribution.
      </p>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 14,
        }}
      >
        {categories.map((cat) => {
          const count = counts.get(cat) ?? 0;
          if (count === 0) return null;
          return (
            <li key={cat}>
              <Link
                href={`/wiki/${cat}`}
                style={{
                  display: 'block',
                  padding: '14px 16px',
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  background: '#fff',
                  color: '#1a1a1a',
                  textDecoration: 'none',
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 15,
                    textTransform: 'capitalize',
                  }}
                >
                  {cat}
                </div>
                <div style={{ color: '#888', fontSize: 13, marginTop: 2 }}>
                  {count} {count === 1 ? 'entry' : 'entries'}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </WikiLayout>
  );
}

async function BrokenLinkLanding({
  slug,
}: {
  slug: string;
}): Promise<React.ReactElement> {
  // Reached only when a user clicks a broken-link sentinel directly
  // (which shouldn't happen because the renderer renders broken links as
  // non-clickable spans). Render a polite 404-like page with the slug so
  // a returning user has context. Also try a "did you mean" suggestion
  // from the slug index.
  const repo = getWikiRepo();
  const slugIndex = await repo.getSlugIndex();
  const suggestion = findClosestSlug(slug, slugIndex);
  return (
    <WikiLayout>
      <nav
        aria-label="Breadcrumb"
        style={{ fontSize: 13, color: '#666', marginBottom: 12 }}
      >
        <Link href="/wiki" style={crumbLink}>
          Wiki
        </Link>{' '}
        / <span style={{ color: '#b00020' }}>broken link</span>
      </nav>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: '4px 0 12px' }}>
        Missing page
      </h1>
      <p style={{ lineHeight: 1.6, color: '#333' }}>
        No page in the compendium matches the slug{' '}
        <code
          style={{
            background: '#f4f4f4',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          {slug}
        </code>
        .
      </p>
      {suggestion && (
        <p style={{ lineHeight: 1.6, color: '#333', marginTop: 12 }}>
          Did you mean{' '}
          <Link
            href={`/wiki/${suggestion.category}/${suggestion.slug}`}
            style={{ color: '#1a73e8' }}
          >
            {suggestion.title}
          </Link>
          ?
        </p>
      )}
      <p style={{ marginTop: 16, fontSize: 13, color: '#666' }}>
        This link refers to a page that does not yet exist in the
        compendium. The 466 broken body links and 231 broken{' '}
        <code>related:</code> entries are tracked for the G-007 compendium
        work; missing pages get authored over time.
      </p>
    </WikiLayout>
  );
}

// Lightweight "closest slug" suggestion. The slug index is small (~2,400
// entries); a single linear pass with Levenshtein bounded at length-3 is
// cheap and good enough for a 404 hint.
function findClosestSlug(
  needle: string,
  idx: Map<string, { category: WikiCategory; title: string }>,
): { slug: string; category: WikiCategory; title: string } | null {
  const needleLower = needle.toLowerCase();
  let bestScore = Infinity;
  let best: { slug: string; category: WikiCategory; title: string } | null =
    null;
  for (const [slug, entry] of idx) {
    // Quick reject: skip if length differs by more than 5
    if (Math.abs(slug.length - needleLower.length) > 5) continue;
    const d = levenshtein(slug, needleLower, 5);
    if (d < bestScore) {
      bestScore = d;
      best = { slug, category: entry.category, title: entry.title };
    }
  }
  // Threshold: half the length of the longer string, capped at 5.
  // Avoids "did you mean X" for completely unrelated needles.
  const longer = Math.max(needleLower.length, best?.slug.length ?? 0);
  if (bestScore > Math.min(5, Math.floor(longer / 2))) return null;
  return best;
}

function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = Array.from({ length: bl + 1 }, (_, j) => j);
  let curr = new Array<number>(bl + 1);
  for (let i = 1; i <= al; i += 1) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= bl; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

// --------------------------------------------------------------------------

const crumbLink: React.CSSProperties = {
  color: '#1a73e8',
  textDecoration: 'none',
};

function WikiLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <main
      style={{
        maxWidth: 860,
        margin: '0 auto',
        padding: '24px 16px 48px',
        minHeight: '100vh',
      }}
    >
      {children}
    </main>
  );
}
