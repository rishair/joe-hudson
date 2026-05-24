// Domain types and repository interfaces for conversation persistence (E-041).
//
// These interfaces are framework-agnostic. Concrete implementations live in
// `app/lib/repos/`. The Repository pattern owns reads + writes for a domain
// (per [[coding-architecture]]) and we use the four-method shape:
// find/create/update/delete with rich criteria objects. Callers needing a
// single record do `(await repo.find({ id }))[0] ?? null`.

import type { UIMessage } from 'ai';

// AI SDK v5+'s UIMessage is the canonical persistence unit. We persist the
// whole structured message — text parts, tool calls, tool results, all
// message parts — by serializing to JSON. The byte-equality round-trip test
// (E-041 success criterion) relies on JSON.parse(JSON.stringify(msg)) being
// the persistence path, with nothing in the middle reshaping the object.
//
// R-016 adds typed `data-resources` parts via custom UIMessage type params.
// We define the conversation message as the bare `UIMessage` here; E-043 will
// parameterize this to `UIMessage<never, { resources: ResourceAttribution }>`
// or similar when the typed data parts land. Either way, this layer stores
// it as JSON and doesn't care about the part shapes.
export type ConversationMessage = UIMessage;

export type Conversation = {
  id: string;
  title: string;
  createdAt: number; // unix millis
  updatedAt: number; // unix millis
};

// --- Repository interfaces ---

// ConversationRepository owns conversation metadata only (id, title, timestamps).
// MessageRepository owns the per-conversation message list. They're split into
// two interfaces because each has independent lifecycle: conversation metadata
// updates on rename/touch, messages append on every turn. (Audit issue #2(e)
// considered collapsing them; keeping them split because the chat UI reads
// the conversation list independently of any specific conversation's messages,
// and the two repositories share one SQLocal instance via constructor
// injection — so coupling at the wiring layer captures the cohesion without
// fattening either interface.)

export type FindConversationsCriteria = {
  id?: string;
  orderBy?: 'createdAt' | 'updatedAt';
  // 'asc' is rarely useful for chat lists; default 'desc' so most-recent
  // appears at the top of the sidebar without callers re-sorting.
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

export interface ConversationRepository {
  find(criteria?: FindConversationsCriteria): Promise<Conversation[]>;
  create(input: { title: string }): Promise<Conversation>;
  update(criteria: { id: string }, patch: Partial<Pick<Conversation, 'title' | 'updatedAt'>>): Promise<void>;
  delete(criteria: { id: string }): Promise<void>;
}

export type FindMessagesCriteria = {
  conversationId: string;
  limit?: number;
  offset?: number;
};

export interface MessageRepository {
  find(criteria: FindMessagesCriteria): Promise<ConversationMessage[]>;
  create(input: { conversationId: string; message: ConversationMessage }): Promise<void>;
  // No update — messages are immutable once written. If a message's content
  // needs to change (e.g. a regeneration replaces the last assistant turn),
  // delete + create is the supported flow.
  delete(criteria: { conversationId: string } | { conversationId: string; messageId: string }): Promise<void>;
}
