# Data Migrations Playbook

## What this is

The canonical pattern for evolving any persistent data schema — browser SQLite, server-side DB, document stores, anything that holds data the app reads back. Use whenever you create or modify a schema (add/drop a table or column, change indexes, transform existing rows). Don't use for one-off scripts, ad-hoc data loads, or content directories like `coach/` (those are managed by ingestion scripts, not migrations).

## The pattern

- **Migrations are TypeScript classes**, one per file, numbered in order they should apply.
- **A tracking table** records which migration IDs have been applied to this database.
- **At startup**, the migration runner reads the tracking table, finds migrations not yet applied, and applies them in order. Each migration runs in a transaction; partial failure rolls back that migration only.
- **Migrations are append-only history**. Once a migration is shipped (applied to any production-equivalent DB), you do not edit it. Schema changes mean a new migration.

## File layout

```
app/lib/migrations/
  index.ts                       # registry — exports the ordered list
  0001-create-conversations.ts
  0002-create-messages.ts
  0003-add-message-position-idx.ts
  runner.ts                      # the apply logic
  types.ts                       # Migration interface
```

Numbering is zero-padded sequential (`0001`, `0002`, ...) for sortability. Date-prefixed (`20260524-...`) is also fine if you expect concurrent authors — pick one convention per project, stick with it.

## Migration class shape

```typescript
// app/lib/migrations/types.ts
export interface Migration {
  id: string;                          // matches the filename, e.g. "0001-create-conversations"
  up(db: Database): Promise<void>;     // forward
  down?(db: Database): Promise<void>;  // optional rollback — only write if you'll actually use it
}

// app/lib/migrations/0001-create-conversations.ts
import { Migration } from './types';

export class CreateConversations implements Migration {
  id = '0001-create-conversations';

  async up(db: Database) {
    await db.sql`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
  }
}
```

```typescript
// app/lib/migrations/index.ts
import { CreateConversations } from './0001-create-conversations';
import { CreateMessages } from './0002-create-messages';

export const ALL_MIGRATIONS = [
  new CreateConversations(),
  new CreateMessages(),
];
```

## Tracking table

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

The runner creates this table itself on first run if absent.

## Runner

```typescript
// app/lib/migrations/runner.ts
import { ALL_MIGRATIONS } from './index';
import type { Database } from '...';

export async function applyMigrations(db: Database): Promise<void> {
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
    await db.transaction(async (tx) => {
      await migration.up(tx);
      await tx.sql`INSERT INTO schema_migrations (id, applied_at) VALUES (${migration.id}, ${Date.now()})`;
    });
    console.log(`[migrations] applied ${migration.id}`);
  }
}
```

Call `applyMigrations(db)` once at app startup (in the browser, this is the first time the repository touches the DB; on the server, it's during process boot). The runner is idempotent — calling it twice in a row is a no-op the second time.

## Browser SQLite specifics

In the browser, the DB lives in OPFS (Origin Private File System) per [[ai-web-app]] / R-015. The migration runner pattern is the same, with three browser-specific notes:

- **Run migrations on a worker thread.** With `sqlocal`, the worker is implicit and `applyMigrations` runs there. Don't try to run migrations on the main thread — it blocks paint.
- **First-load latency.** On first visit (empty DB), every migration runs sequentially. Keep individual migrations small; if you have 30 of them and each takes 50ms, that's a 1.5s startup. Consolidate as the project matures (squash old migrations into a single "baseline" once they're irrelevant to existing users — but only after migrating production users past that point, never before).
- **Multi-tab races.** Two tabs opening at once could both try `applyMigrations`. Two mitigations: (a) use the WebLock API to serialize (`navigator.locks.request('migrations', ...)`); (b) accept that the second tab's `INSERT INTO schema_migrations` fails harmlessly with a primary-key conflict, which is fine because the table was already created by the first tab.

## Server-side specifics

If a server-side DB is added later (Postgres, Turso, etc.):

- Apply migrations on process boot, before serving any requests
- Use the DB's native transaction support (Postgres, SQLite, etc. all support transactional DDL — MySQL does not, so each DDL statement becomes its own commit boundary on MySQL)
- For zero-downtime deploys, follow the additive-first pattern: add new column/table → deploy app code that writes to both old and new → backfill → deploy app code that reads only new → drop old. Spread across multiple migrations + deploys, never one big migration.

## Quality checklist

- [ ] Every schema change is a numbered migration file, not an inline `CREATE TABLE` somewhere in the app
- [ ] Migration IDs match filenames exactly
- [ ] `ALL_MIGRATIONS` registry is up to date (every file in `migrations/` is in the registry; order matches filename order)
- [ ] Runner is called exactly once per process / DB connection lifecycle (not per-request, not per-component)
- [ ] No migration depends on application code that may change after the migration ships (e.g., calling `User.parse(...)` inside `up()` is a bug waiting to happen — use raw SQL or inlined Zod parsing)
- [ ] No edits to already-shipped migrations; new schema = new migration file

## Common pitfalls

- **Editing an applied migration.** Once a migration has run on any DB you care about (production, staging, even a teammate's laptop), it is frozen. Editing it means some DBs have the old version applied, some have the new — and the runner can't tell. New schema = new migration file.
- **Skipping the tracking table.** "I'll just `CREATE TABLE IF NOT EXISTS` on every startup" works until you need to change a column. Then you're in DDL-detection territory. Use the tracking pattern from day one even if you have only one migration.
- **Non-idempotent `up()`.** If a migration's `up()` partially succeeds and the transaction doesn't roll back cleanly (e.g., DDL on MySQL), the next run will fail. Wrap in transactions; for engines without transactional DDL, structure each migration so it's either fully applied or fully not (one DDL statement per migration is the strictest version).
- **Coupling migrations to app types.** A migration that imports `import { User } from '@/types/user'` will break the day the `User` type changes (which it will). Migrations should be self-contained — raw SQL plus literal values only.
- **`down()` migrations that don't actually work.** If you write a `down()`, test it. Many "rollback" migrations were never tried and silently broken. If you don't have a strict need to roll back (which most apps don't — they roll forward with a new migration), don't write `down()` at all.
- **Squashing too early.** Squashing old migrations into a baseline is fine IF all live databases have already passed that baseline. Squash too early and a new install can't get to the current state. Only squash after you've verified every environment is past the squash point.

## Resources to check

- The browser SQLite stack chosen in R-015 (sqlocal) — its `sql` tagged-template API is what migration `up()` methods call
- [[ai-web-app]] playbook for OPFS / Web Workers context
- [[coding-architecture]] playbook — the migration runner is invoked by the Repository that owns the DB connection; runner is not a Repository itself
