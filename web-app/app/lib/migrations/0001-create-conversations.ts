import type { Migration } from './types';

export class CreateConversations implements Migration {
  id = '0001-create-conversations';

  async up(tx: import('sqlocal').TransactionHandle): Promise<void> {
    await tx.sql`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
    await tx.sql`
      CREATE INDEX idx_conversations_updated_at
      ON conversations (updated_at DESC)
    `;
  }
}
