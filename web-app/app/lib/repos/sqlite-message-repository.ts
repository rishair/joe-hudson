// SQLite-backed MessageRepository.
//
// Schema decision (per R-015): one row per UIMessage, with a single JSON
// payload column holding JSON.stringify(message). Byte-equality round-trip
// is the success criterion — the payload column is exactly what was passed
// in, with no reshaping. position is computed at insert time as
// MAX(position)+1 within the conversation.

import type { SQLocal } from 'sqlocal';
import type {
  ConversationMessage,
  FindMessagesCriteria,
  MessageRepository,
} from '../types/conversation';

type Row = {
  payload: string;
};

const MAX_RETRIES = 3;

async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('SQLITE_BUSY')) throw err;
      const delay = 25 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export class SqliteMessageRepository implements MessageRepository {
  constructor(private db: SQLocal) {}

  async find(criteria: FindMessagesCriteria): Promise<ConversationMessage[]> {
    const { conversationId, limit, offset } = criteria;
    let rows: Row[];
    if (limit !== undefined && offset !== undefined) {
      rows = await this.db.sql<Row>`
        SELECT payload FROM messages
        WHERE conversation_id = ${conversationId}
        ORDER BY position ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (limit !== undefined) {
      rows = await this.db.sql<Row>`
        SELECT payload FROM messages
        WHERE conversation_id = ${conversationId}
        ORDER BY position ASC
        LIMIT ${limit}
      `;
    } else {
      rows = await this.db.sql<Row>`
        SELECT payload FROM messages
        WHERE conversation_id = ${conversationId}
        ORDER BY position ASC
      `;
    }
    return rows.map((r) => JSON.parse(r.payload) as ConversationMessage);
  }

  async create(input: { conversationId: string; message: ConversationMessage }): Promise<void> {
    const { conversationId, message } = input;
    const payload = JSON.stringify(message);
    const createdAt = Date.now();

    // Compute position + insert atomically so two concurrent inserts in the
    // same conversation never collide on the same position. The transaction
    // is also what lets us share writes across the two repositories without
    // a separate cross-repo locking layer.
    await withBusyRetry(async () => {
      await this.db.transaction(async (tx) => {
        const positionRows = await tx.sql<{ next_position: number }>`
          SELECT COALESCE(MAX(position), -1) + 1 AS next_position
          FROM messages
          WHERE conversation_id = ${conversationId}
        `;
        const position = positionRows[0]?.next_position ?? 0;
        await tx.sql`
          INSERT INTO messages (id, conversation_id, position, role, payload, created_at)
          VALUES (${message.id}, ${conversationId}, ${position}, ${message.role}, ${payload}, ${createdAt})
        `;
        // Touch the parent so its updated_at reflects last activity.
        await tx.sql`
          UPDATE conversations
          SET updated_at = ${createdAt}
          WHERE id = ${conversationId}
        `;
      });
    });
  }

  async delete(
    criteria: { conversationId: string } | { conversationId: string; messageId: string },
  ): Promise<void> {
    await withBusyRetry(async () => {
      if ('messageId' in criteria) {
        await this.db.sql`
          DELETE FROM messages
          WHERE conversation_id = ${criteria.conversationId}
          AND id = ${criteria.messageId}
        `;
      } else {
        await this.db.sql`
          DELETE FROM messages
          WHERE conversation_id = ${criteria.conversationId}
        `;
      }
    });
  }
}
