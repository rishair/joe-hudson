import type { Migration } from './types';

export class CreateMessages implements Migration {
  id = '0002-create-messages';

  async up(tx: import('sqlocal').TransactionHandle): Promise<void> {
    // Single-table denormalized schema, per R-015. payload is the full
    // JSON.stringify(UIMessage). Normalizing tool calls into typed columns
    // would break byte-equality round-trip (E-041 success criterion).
    //
    // id is the message's UIMessage.id (provided by useChat). position is
    // the ordering within a conversation; we set it explicitly at insert
    // time rather than using ROWID so the index is stable across reorderings.
    await tx.sql`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        role TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `;
    await tx.sql`
      CREATE INDEX idx_messages_conv_pos
      ON messages (conversation_id, position)
    `;
  }
}
