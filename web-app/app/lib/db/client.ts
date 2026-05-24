// Client-side SQLite singleton.
//
// SQLocal wraps @sqlite.org/sqlite-wasm and runs the engine on a dedicated
// worker. The instance is created lazily on first access (NEVER at module
// import time on the server, which would crash — the import only runs in
// client modules under 'use client' anyway).
//
// One SQLocal instance per tab. Both ConversationRepository and
// MessageRepository wire to the same instance via constructor injection.

import { SQLocal } from 'sqlocal';
import { applyMigrations } from '../migrations/runner';

const DB_PATH = 'web-app.sqlite3';

// Module-scope singleton. Holds the in-flight init promise so concurrent
// callers all share one initialization rather than racing.
let dbPromise: Promise<SQLocal> | null = null;

export async function getDb(): Promise<SQLocal> {
  if (typeof window === 'undefined') {
    // Defense in depth — the only callers are client components, but if a
    // server-rendered code path somehow imports this we want to fail
    // immediately rather than hand back a broken SQLocal.
    throw new Error('getDb() can only be called in the browser.');
  }
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const db = new SQLocal(DB_PATH);
    // sqlocal's worker boots on first query. SELECT 1 forces the WASM load
    // and OPFS handle to open before any real query runs, so the first
    // user-triggered query doesn't pay the worker-bootstrap cost.
    await db.sql`SELECT 1`;
    // SQLite ships with FK constraints disabled per-connection. The
    // `messages.conversation_id REFERENCES conversations(id) ON DELETE
    // CASCADE` only works when PRAGMA foreign_keys is ON. Enable here for
    // every connection (browser tab) so a conversation delete cascades.
    await db.sql`PRAGMA foreign_keys = ON`;
    await applyMigrations(db);
    return db;
  })();
  return dbPromise;
}

// Test/dev escape hatch — call from devtools to wipe and re-init. Not
// exported from a public surface; intentionally requires a manual reach in.
export async function __resetDbForTests(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  await db.deleteDatabaseFile(undefined, true);
  dbPromise = null;
}
