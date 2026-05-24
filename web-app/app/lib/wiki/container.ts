// Server-side wiki repository wiring. Separate from app/lib/repos/container
// (which is client-side and holds the conversation/message repos for E-041)
// because the wiki repo is filesystem-backed and must not ship to the
// client bundle.

import 'server-only';
import path from 'node:path';
import type { WikiRepository } from './types';
import { FsWikiRepository } from './fs-wiki-repository';

// Singleton — the filesystem is process-global and the manifest cache is
// safe to share across requests. Next.js may re-construct the module on
// hot reload, which naturally invalidates the cache too.
let wikiRepoSingleton: WikiRepository | null = null;

export function getWikiRepo(): WikiRepository {
  if (wikiRepoSingleton) return wikiRepoSingleton;
  const contentRoot = path.join(process.cwd(), 'content', 'wiki');
  wikiRepoSingleton = new FsWikiRepository(contentRoot);
  return wikiRepoSingleton;
}
