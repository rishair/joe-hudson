# Coding Architecture Playbook

## What this is

Conventions for organizing application code so concerns separate cleanly and pieces compose. Use when starting a new module with non-trivial data access, multiple sources, or behavior that needs to be swapped (cache layers, mocks for testing, etc.). Not for one-off scripts or pure UI components with no data.

## The primitive: Repository

A Repository **owns all data access** for a domain — both retrieval and mutation. It owns the question "where does this data live, how do I read it, and how do I write it?" Examples: `UserRepository`, `WikiRepository`, `ConversationRepository`.

**Prefer few methods with rich parameter objects over many narrow methods.** The standard shape is four methods: `find`, `create`, `update`, `delete`. Each takes an options object that captures all the variations you'd otherwise spread across `getByX`, `getByY`, `findByAandB`. Smaller surface area per class, easier to wrap with composition, fewer methods to keep in sync across implementations and wrappers.

```typescript
// PREFERRED: four methods, rich param objects
export interface UserRepository {
  find(criteria?: {
    id?: string;
    email?: string;
    orgId?: string;
    query?: string;        // free-text search
    orderBy?: 'createdAt' | 'updatedAt' | 'name';
    limit?: number;
    offset?: number;
  }): Promise<User[]>;

  create(input: { user: User }): Promise<void>;
  update(criteria: { id: string }, patch: Partial<User>): Promise<void>;
  delete(criteria: { id: string } | { orgId: string }): Promise<void>;
}
```

```typescript
// AVOID: many narrow methods
export interface UserRepository {
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  getByOrgId(orgId: string): Promise<User[]>;
  listAll(): Promise<User[]>;
  search(query: string): Promise<User[]>;
  searchInOrg(orgId: string, query: string): Promise<User[]>;
  create(user: User): Promise<void>;
  updateName(id: string, name: string): Promise<void>;
  updateEmail(id: string, email: string): Promise<void>;
  deleteById(id: string): Promise<void>;
  deleteByOrgId(orgId: string): Promise<void>;
}
```

The narrow form looks safer (each signature is exact) but in practice it explodes: every new filter combination adds a method, every wrapper has to wrap N methods correctly, and adding a new sort dimension is a code change everywhere instead of an options addition.

### Conventions for `find`

- `find` always returns an **array**. For unique lookups, callers do `(await repo.find({ id }))[0] ?? null`. If you want a `findOne` helper as syntactic sugar, define it as a thin wrapper (`findOne = (c) => find(c).then(r => r[0] ?? null)`) but don't bake it into the interface — it's derivable.
- An empty criteria (`find()` or `find({})`) returns "everything that matches no filters" — typically the full list. If that's dangerous (large tables), require at least one filter and throw on empty.
- Combine criteria with AND. If you need OR semantics, accept an array (`{ id: ['a', 'b', 'c'] }`) or a dedicated `or` field. Don't invent a query DSL.
- For pagination, always support `limit` and `offset` (or cursor-based equivalents).

### Conventions for `update` / `delete`

- The first argument is `criteria` (which records to touch). The second (for `update`) is the patch.
- Criteria for `update` and `delete` should be tight — usually `{ id }`. Letting `delete({ orgId })` cascade is intentional but should be obvious in the criteria type, which is why a union (`{ id } | { orgId }`) is clearer than a generic options bag.
- Updates are partial-patch by default (`Partial<T>`). If a field needs to be settable to `null`, use a discriminated union or a separate method (this is one of the rare cases where a narrow method is justified).

### When narrow methods are still right

- The data access genuinely has only one shape (e.g., a single-row config table — just `get()` and `set(value)`)
- The method is doing meaningfully different work, not just a different filter (e.g., `recalculateBalances()` is not a `find` variant)
- Type safety on a critical path is worth the surface area (rare; usually a discriminated union on the criteria fixes this)

**Don't split read and write into separate types.** Earlier versions of this playbook had a "Store" concept for state and "Repository" for retrieval. That split caused churn whenever something straddled the boundary (does "list current conversations" go in the Store because it's state, or the Repository because it's a read?). Single Repository per domain, read and write side by side. The composition pattern works for both.

## The composition pattern

Repositories implement an interface and are composed via constructor injection:

```typescript
class SqliteUserRepository implements UserRepository {
  constructor(private db: Database) {}
  async find(criteria) { /* build WHERE clause from criteria */ }
  async create({ user }) { /* INSERT */ }
  async update(criteria, patch) { /* UPDATE WHERE id = ? */ }
  async delete(criteria) { /* DELETE WHERE id = ? */ }
}

class CachedUserRepository implements UserRepository {
  private cache = new Map<string, User>();
  constructor(private inner: UserRepository) {}

  async find(criteria = {}) {
    // Only cache singleton-by-id lookups; everything else passes through
    if (criteria.id && Object.keys(criteria).length === 1) {
      if (this.cache.has(criteria.id)) return [this.cache.get(criteria.id)!];
      const result = await this.inner.find(criteria);
      if (result[0]) this.cache.set(criteria.id, result[0]);
      return result;
    }
    return this.inner.find(criteria);
  }

  async create(input) {
    await this.inner.create(input);
    this.cache.set(input.user.id, input.user);
  }

  async update(criteria, patch) {
    await this.inner.update(criteria, patch);
    if (criteria.id) this.cache.delete(criteria.id);  // invalidate
  }

  async delete(criteria) {
    await this.inner.delete(criteria);
    if ('id' in criteria) this.cache.delete(criteria.id);
    else this.cache.clear();  // delete-by-orgId could affect many; safest is full flush
  }
}

class LoggingUserRepository implements UserRepository {
  constructor(private inner: UserRepository) {}
  async find(criteria) { console.log('[user] find', criteria); return this.inner.find(criteria); }
  async create(input) { console.log('[user] create', input); return this.inner.create(input); }
  async update(criteria, patch) { console.log('[user] update', criteria, patch); return this.inner.update(criteria, patch); }
  async delete(criteria) { console.log('[user] delete', criteria); return this.inner.delete(criteria); }
}

// Wire at startup
const userRepo: UserRepository = new LoggingUserRepository(
  new CachedUserRepository(
    new SqliteUserRepository(db)
  )
);
```

Each wrapper adds one concern (caching, logging, retries, metrics, dedup). The inner repository never knows it's wrapped. Concerns stack as Russian dolls.

Note how compact the wrappers are: four methods to wrap, not twelve. A `LoggingUserRepository` for the narrow-method interface above would be ~11 method bodies; here it's 4.

A wrapper that adds caching must invalidate the cache on writes — otherwise a `create()` would leave the cache stale and the next `find()` would miss the new record. This is the kind of thing the unified Repository interface makes obvious: caching wraps everything, not just reads.

## When to compose

Add a wrapper when:

- **A cross-cutting concern applies** to multiple repository methods (caching, logging, metrics, retries, rate limiting, dedup, optimistic updates)
- **The concern can be toggled off** (e.g., disable caching in tests, disable logging in production)
- **Different environments need different stacks** (production = cache + log + base; tests = mock; dev = no cache + verbose log)

Don't compose when:

- The concern only applies to ONE method on ONE repository (inline it)
- The wrapper would have more boilerplate than the logic (use a function)
- The behavior is data-shape-specific (it belongs IN the base repository, not OUTSIDE it)

## Reactivity (for React / UI apps)

A Repository is a data-access primitive — it has no React opinions. UI components that need to re-render when data changes need a reactive layer ON TOP of the Repository, not instead of it.

Three reasonable patterns:

1. **Subscription on the Repository.** Repository exposes `onChange(callback)` or similar. Components use `useSyncExternalStore` to subscribe.
2. **Reactive wrapper (Zustand, Jotai).** A thin Zustand store holds the current snapshot of data; on Repository writes, the store is updated. Components subscribe to the Zustand store. The Repository is still the source of truth; Zustand is a reactive cache.
3. **TanStack Query / SWR.** A query library wraps Repository calls and handles caching, refetching, and reactivity. Repository methods become the `queryFn` and `mutationFn`.

Pick one per project and document it. For most Next.js apps, pattern 2 (thin Zustand layer) is the lightest weight. For data-heavy apps with lots of server state, pattern 3 (TanStack Query) earns its weight.

Whichever you pick, **the Repository is still the contract**. The reactive layer is plumbing.

## Wiring

Choose ONE wiring style per project, stick to it:

### Manual wiring (simplest, recommended for small-to-medium apps)

One file (`app/lib/container.ts`) constructs the dependency graph at startup. Modules import the wired instances by name. No magic.

```typescript
// app/lib/container.ts
import { SqliteUserRepository } from './users/sqlite-user-repository';
import { CachedUserRepository } from './users/cached-user-repository';
import { db } from './db';

export const userRepo: UserRepository = new CachedUserRepository(
  new SqliteUserRepository(db)
);
```

### Factory functions

Wrap construction in `createXRepository(...)` factories that return a configured instance. Useful when wiring depends on environment.

### DI container (Inversify, tsyringe)

Decorator-based DI. Only worth it for large apps with deep graphs and many environments. Don't reach for this on a Next.js app under 20 modules.

## Server vs client repositories

In a Next.js app:

- **Server-only repositories** (touch a DB, read filesystem, hold secrets) live in server-only modules (`'server-only'` import or in `app/api/.../`). They are not bundled into client JS.
- **Client-only repositories** (read browser storage, IndexedDB, browser SQLite) live in client modules. They access browser-only APIs.
- A **shared interface** can live in `app/lib/types/` so both sides talk in the same shape; the implementation that ships to each side differs.

If a feature needs BOTH server and client repositories of the same kind (e.g., a `ConversationRepository` that's browser-SQLite locally but server-DB if synced), build two implementations of the same interface and pick at composition time.

## Naming conventions

- `XRepository` — the interface and base class
- `<Tech>XRepository` — concrete implementation (`SqliteUserRepository`, `ApiUserRepository`, `BrowserSqliteUserRepository`)
- `<Concern>XRepository` — wrapper (`CachedUserRepository`, `LoggingUserRepository`, `RetryingUserRepository`)
- Files match class names: `cached-user-repository.ts`. One class per file unless they are tightly coupled.

## Quality checklist

- [ ] Every Repository has an interface, even if there's only one implementation today
- [ ] Reads and writes for one domain live in one Repository (don't split)
- [ ] Repository surface is the four-method shape (`find`/`create`/`update`/`delete`) unless there's a documented reason to add more
- [ ] Wrappers add one concern each; if a wrapper does two things, split it
- [ ] Caching wrappers handle write-invalidation (otherwise stale reads after a write)
- [ ] Components consume Repositories via the chosen reactive layer (not by importing and calling them directly inside `useEffect`)
- [ ] Tests can swap a Repository for a mock or in-memory implementation in one line
- [ ] Wiring is in one place (container, factory, or DI module), not scattered through the codebase
- [ ] Server-only repositories don't leak into client bundles

## Common pitfalls

- **Cache wrapper that only handles reads.** A common bug: `CachedUserRepository.getById` checks the cache, but `CachedUserRepository.create/update/delete` doesn't invalidate. Two seconds later, the cached read returns the stale value. Always handle both sides of the cache when you add caching as a wrapper.
- **Composition through inheritance.** `class CachedUserRepository extends SqliteUserRepository` couples the cache to the storage. Compose via constructor injection (`extends` is rarely the right tool here).
- **Wrapper interface drift.** A wrapper must implement the SAME interface as the inner. If `CachedUserRepository.getById` returns `User | null` but the inner returns `User`, callers break randomly. TypeScript will catch this if the interface is enforced.
- **Premature DI container.** A 10-module app does not need Inversify. Manual wiring in one file is faster to read and faster to debug.
- **Repositories in `useEffect`.** Calling a Repository from a component's `useEffect` and stashing the result in `useState` reinvents the reactivity layer poorly. Use the chosen reactive integration (Zustand / TanStack Query / subscription hook) so re-renders happen correctly when data changes elsewhere.
- **One Repository per table.** Tempting if you're coming from ORMs, but a Repository should be domain-shaped, not schema-shaped. A `ConversationRepository` that internally writes to a `conversations` table AND a `messages` table is correct if "conversation with messages" is the domain shape the rest of the app needs.
- **Method-explosion.** The strongest signal you're slipping back into the narrow-method anti-pattern is when you write `getBy<field>` for the fifth time. Stop and refactor to `find({ <field> })`. Same for `updateNameById`, `updateEmailById`, etc. — they collapse to one `update({ id }, patch)`.
- **Permissive `find({})`.** A `find` with no criteria returning the full table is a foot-gun on large data. Either disallow it at the type level (require at least one filter) or cap with a default `limit`.

## Resources to check

- Existing repositories in `app/lib/` for naming and structure conventions
- The container entry point (typically `app/lib/container.ts`) before adding a new repository
- [[ai-web-app]] playbook if this is in a Next.js + AI SDK context (covers the reactive integration choice for chat-style apps)
