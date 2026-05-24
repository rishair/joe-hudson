// Logging wrapper around any ConversationRepository (composition pattern
// per [[coding-architecture]]). Not wired in by default — included so the
// composition shape is already in place for E-041's success criterion
// ("composition pattern is set up even if no wrapper is needed yet"). Toggle
// in via `app/lib/repos/container.ts` when noisier debugging is wanted.

import type {
  Conversation,
  ConversationRepository,
  FindConversationsCriteria,
} from '../types/conversation';

export class LoggingConversationRepository implements ConversationRepository {
  constructor(private inner: ConversationRepository) {}

  async find(criteria?: FindConversationsCriteria): Promise<Conversation[]> {
    // eslint-disable-next-line no-console
    console.log('[conversation] find', criteria);
    return this.inner.find(criteria);
  }

  async create(input: { title: string }): Promise<Conversation> {
    // eslint-disable-next-line no-console
    console.log('[conversation] create', input);
    return this.inner.create(input);
  }

  async update(
    criteria: { id: string },
    patch: Partial<Pick<Conversation, 'title' | 'updatedAt'>>,
  ): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[conversation] update', criteria, patch);
    return this.inner.update(criteria, patch);
  }

  async delete(criteria: { id: string }): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[conversation] delete', criteria);
    return this.inner.delete(criteria);
  }
}
