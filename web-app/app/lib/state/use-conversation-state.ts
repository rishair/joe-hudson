// Thin Zustand reactive layer over the conversation repositories.
//
// The repositories are the source of truth (per [[coding-architecture]]).
// This store is plumbing: it caches the list of conversations and the active
// conversation id for UI re-render, and mirrors repository writes back into
// itself. Components subscribe via the `useConversationState` hook.
//
// Hydration: callers must call `bootstrap()` on first mount. It loads the
// conversation list from SQLite and, if there are no conversations yet,
// creates a starter one so the chat UI has an active conversation to bind to.

'use client';

import { create } from 'zustand';
import { getRepos } from '../repos/container';
import type {
  Conversation,
  ConversationMessage,
} from '../types/conversation';

type StoreState = {
  ready: boolean;
  bootstrapping: boolean;
  conversations: Conversation[];
  activeId: string | null;

  bootstrap: () => Promise<void>;
  selectConversation: (id: string) => void;
  newConversation: (title?: string) => Promise<Conversation>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  // For the chat page to call after each completed assistant turn.
  persistMessage: (conversationId: string, message: ConversationMessage) => Promise<void>;
  // For the chat page to load the saved messages of a conversation.
  loadMessages: (conversationId: string) => Promise<ConversationMessage[]>;
};

const STARTER_TITLE = 'New conversation';

export const useConversationState = create<StoreState>((set, get) => ({
  ready: false,
  bootstrapping: false,
  conversations: [],
  activeId: null,

  bootstrap: async () => {
    if (get().ready || get().bootstrapping) return;
    set({ bootstrapping: true });
    try {
      const repos = await getRepos();
      let list = await repos.conversations.find({ orderBy: 'updatedAt', order: 'desc' });
      if (list.length === 0) {
        const created = await repos.conversations.create({ title: STARTER_TITLE });
        list = [created];
      }
      set({
        ready: true,
        bootstrapping: false,
        conversations: list,
        activeId: list[0]?.id ?? null,
      });
    } catch (err) {
      set({ bootstrapping: false });
      throw err;
    }
  },

  selectConversation: (id: string) => {
    set({ activeId: id });
  },

  newConversation: async (title?: string) => {
    const repos = await getRepos();
    const created = await repos.conversations.create({ title: title ?? STARTER_TITLE });
    set((state) => ({
      conversations: [created, ...state.conversations],
      activeId: created.id,
    }));
    return created;
  },

  renameConversation: async (id: string, title: string) => {
    const repos = await getRepos();
    await repos.conversations.update({ id }, { title });
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, title, updatedAt: Date.now() } : c,
      ),
    }));
  },

  deleteConversation: async (id: string) => {
    const repos = await getRepos();
    await repos.conversations.delete({ id });
    set((state) => {
      const remaining = state.conversations.filter((c) => c.id !== id);
      const nextActive = state.activeId === id
        ? remaining[0]?.id ?? null
        : state.activeId;
      return { conversations: remaining, activeId: nextActive };
    });
  },

  persistMessage: async (conversationId: string, message: ConversationMessage) => {
    const repos = await getRepos();
    await repos.messages.create({ conversationId, message });
    // Reflect the new updated_at on the conversation in the sidebar.
    const now = Date.now();
    set((state) => {
      // Move the touched conversation to the top, updating updatedAt.
      const touched = state.conversations.find((c) => c.id === conversationId);
      if (!touched) return state;
      const rest = state.conversations.filter((c) => c.id !== conversationId);
      return {
        conversations: [{ ...touched, updatedAt: now }, ...rest],
      };
    });
  },

  loadMessages: async (conversationId: string) => {
    const repos = await getRepos();
    return repos.messages.find({ conversationId });
  },
}));
