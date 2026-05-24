// SQLite-backed ConversationRepository (per [[coding-architecture]] playbook).
//
// Tagged-template `sql` calls are parameterized — SQLocal handles binding.
// Methods are all small; the bulk of complexity is in the WHERE-clause
// assembly inside find().

import type { SQLocal } from 'sqlocal';
import type {
  Conversation,
  ConversationRepository,
  FindConversationsCriteria,
} from '../types/conversation';

type Row = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

function rowToConversation(row: Row): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const MAX_RETRIES = 3;

async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  // SQLITE_BUSY can occur on the default `opfs` VFS when two tabs write at
  // the same instant. SQLocal handles a lot of this internally; the retry
  // here is defense-in-depth per R-015 implication 8.
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('SQLITE_BUSY')) throw err;
      // Exponential backoff: 25ms, 50ms, 100ms.
      const delay = 25 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export class SqliteConversationRepository implements ConversationRepository {
  constructor(private db: SQLocal) {}

  async find(criteria: FindConversationsCriteria = {}): Promise<Conversation[]> {
    const { id, orderBy = 'updatedAt', order = 'desc', limit, offset } = criteria;
    const orderColumn = orderBy === 'createdAt' ? 'created_at' : 'updated_at';
    const direction = order === 'asc' ? 'ASC' : 'DESC';

    // SQLocal's tagged-template `sql` parameterizes via ${} but the ORDER BY
    // direction and column are NOT user-controllable — they come from a
    // typed enum above, so direct string interpolation is safe here.
    // Parameterizing identifiers is not supported by SQLite anyway.
    if (id !== undefined) {
      const rows = await this.db.sql<Row>`
        SELECT id, title, created_at, updated_at
        FROM conversations
        WHERE id = ${id}
      `;
      return rows.map(rowToConversation);
    }

    if (limit !== undefined && offset !== undefined) {
      const rows = await this.db.sql<Row>(
        `SELECT id, title, created_at, updated_at FROM conversations ORDER BY ${orderColumn} ${direction} LIMIT ? OFFSET ?`,
        limit,
        offset,
      );
      return rows.map(rowToConversation);
    }
    if (limit !== undefined) {
      const rows = await this.db.sql<Row>(
        `SELECT id, title, created_at, updated_at FROM conversations ORDER BY ${orderColumn} ${direction} LIMIT ?`,
        limit,
      );
      return rows.map(rowToConversation);
    }
    const rows = await this.db.sql<Row>(
      `SELECT id, title, created_at, updated_at FROM conversations ORDER BY ${orderColumn} ${direction}`,
    );
    return rows.map(rowToConversation);
  }

  async create(input: { title: string }): Promise<Conversation> {
    const now = Date.now();
    const conv: Conversation = {
      id: crypto.randomUUID(),
      title: input.title,
      createdAt: now,
      updatedAt: now,
    };
    await withBusyRetry(async () => {
      await this.db.sql`
        INSERT INTO conversations (id, title, created_at, updated_at)
        VALUES (${conv.id}, ${conv.title}, ${conv.createdAt}, ${conv.updatedAt})
      `;
    });
    return conv;
  }

  async update(
    criteria: { id: string },
    patch: Partial<Pick<Conversation, 'title' | 'updatedAt'>>,
  ): Promise<void> {
    // Build the SET clause from non-undefined patch keys only. Both columns
    // are optional in the patch — the most common case is touching
    // updatedAt after appending a message; renaming sets title.
    const nextTitle = patch.title;
    const nextUpdatedAt = patch.updatedAt ?? Date.now();

    await withBusyRetry(async () => {
      if (nextTitle !== undefined) {
        await this.db.sql`
          UPDATE conversations
          SET title = ${nextTitle}, updated_at = ${nextUpdatedAt}
          WHERE id = ${criteria.id}
        `;
      } else {
        await this.db.sql`
          UPDATE conversations
          SET updated_at = ${nextUpdatedAt}
          WHERE id = ${criteria.id}
        `;
      }
    });
  }

  async delete(criteria: { id: string }): Promise<void> {
    // CASCADE on the messages FK handles the message rows.
    await withBusyRetry(async () => {
      await this.db.sql`DELETE FROM conversations WHERE id = ${criteria.id}`;
    });
  }
}
