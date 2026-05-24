// Migration runner (per [[data-migrations]] playbook).
//
// Called once per page load. The function is idempotent — second call is a
// no-op since the tracking table records which migrations have been applied.
//
// Multi-tab races: navigator.locks serializes startup across tabs of the
// same origin so two tabs never run the same migration concurrently. The
// fallback (if the lock acquisition fails for any reason) is to rely on the
// schema_migrations PRIMARY KEY conflict on the INSERT — that errors
// harmlessly because the table was already created by the first tab.

import type { SQLocal } from 'sqlocal';
import { ALL_MIGRATIONS } from './index';

const LOCK_NAME = 'web-app:migrations';

export async function applyMigrations(db: SQLocal): Promise<void> {
  const run = async (): Promise<void> => {
    await db.sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `;
    const rows = await db.sql<{ id: string }>`SELECT id FROM schema_migrations`;
    const applied = new Set(rows.map((r) => r.id));

    for (const migration of ALL_MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      try {
        await db.transaction(async (tx) => {
          await migration.up(tx);
          await tx.sql`
            INSERT INTO schema_migrations (id, applied_at)
            VALUES (${migration.id}, ${Date.now()})
          `;
        });
        // eslint-disable-next-line no-console
        console.log(`[migrations] applied ${migration.id}`);
      } catch (err) {
        // The most common race: a sibling tab applied it between our SELECT
        // and our INSERT. The PRIMARY KEY conflict surfaces as an error
        // mentioning "UNIQUE constraint failed: schema_migrations.id". If
        // that's what we saw, the schema is now correct anyway — re-read
        // and continue.
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('UNIQUE constraint') && message.includes('schema_migrations')) {
          // eslint-disable-next-line no-console
          console.warn(`[migrations] race resolved for ${migration.id}`);
          continue;
        }
        throw err;
      }
    }
  };

  if (typeof navigator !== 'undefined' && navigator.locks) {
    await navigator.locks.request(LOCK_NAME, run);
  } else {
    await run();
  }
}
