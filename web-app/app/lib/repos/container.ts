// Repository wiring for the client.
//
// One place that builds the dependency graph (per [[coding-architecture]]'s
// "Manual wiring" pattern). Components and reactive hooks call getRepos()
// to obtain a stable pair of repositories, lazily constructed on first use.
//
// To turn on logging: wrap with LoggingConversationRepository here. To swap
// the storage backend (e.g. tests, future server-sync): replace
// SqliteConversationRepository / SqliteMessageRepository with the alternate
// implementation. The rest of the app doesn't change.

import { getDb } from '../db/client';
import type {
  ConversationRepository,
  MessageRepository,
} from '../types/conversation';
import { SqliteConversationRepository } from './sqlite-conversation-repository';
import { SqliteMessageRepository } from './sqlite-message-repository';

export type Repos = {
  conversations: ConversationRepository;
  messages: MessageRepository;
};

let reposPromise: Promise<Repos> | null = null;

export async function getRepos(): Promise<Repos> {
  if (reposPromise) return reposPromise;
  reposPromise = (async () => {
    const db = await getDb();
    return {
      conversations: new SqliteConversationRepository(db),
      messages: new SqliteMessageRepository(db),
    };
  })();
  return reposPromise;
}
