'use client';

import { useChat } from '@ai-sdk/react';
import Link from 'next/link';
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type { UIMessage } from 'ai';
import { useConversationState } from '@/app/lib/state/use-conversation-state';
import { useResourceModal } from '@/app/lib/state/use-resource-modal';
import type { ConversationMessage } from '@/app/lib/types/conversation';
import type { CoachUIMessage } from '@/app/lib/coach/types';
import { ChatScrollRestorer } from './components/chat-scroll-restorer';
import { ResourceStrip } from './components/resource-strip';
import { ResourceModal } from './components/resource-modal';

// E-041 chat surface. Adds client-side SQLite persistence on top of E-040.
//
// What's wired:
// - bootstrap loads the conversation list from OPFS on mount; if none
//   exist, creates a starter conversation
// - the active conversation's messages are hydrated into useChat's initial
//   state when the active id changes (key swap remounts the Chat)
// - on each completed assistant turn, persist BOTH the user message that
//   triggered the turn AND the assistant message — onFinish gives us the
//   full messages array; we diff against persistedIds to figure out what's
//   new and write each one once
// - a sidebar lists conversations; click switches; "New" creates one
//
// What's NOT wired (deferred):
// - resource-attribution strip / modal -> E-044
// - first-visit welcome -> E-045
// - real coach -> E-043
// - title auto-naming from first user message (future polish)

export default function ChatPage(): React.ReactElement {
  const {
    ready,
    bootstrap,
    conversations,
    activeId,
    selectConversation,
    newConversation,
    deleteConversation,
  } = useConversationState();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!ready || activeId === null) {
    return (
      <main style={pageStyles.loading}>
        <p>Loading conversations...</p>
      </main>
    );
  }

  return (
    <main style={pageStyles.shell}>
      {/* E-042: handles ?scrollToMessage=<id> from a wiki page's "Back to
          chat at message N" fallback push. Suspense boundary required by
          Next.js for useSearchParams. */}
      <Suspense fallback={null}>
        <ChatScrollRestorer />
      </Suspense>
      <aside style={pageStyles.sidebar}>
        <Link
          href="/wiki"
          style={{
            display: 'block',
            padding: '8px 12px',
            fontSize: 13,
            color: '#1a73e8',
            background: 'transparent',
            border: '1px solid #d0d5dd',
            borderRadius: 8,
            textAlign: 'center',
            textDecoration: 'none',
          }}
        >
          Browse Wiki
        </Link>
        <button
          type="button"
          onClick={() => void newConversation()}
          style={pageStyles.newButton}
        >
          + New conversation
        </button>
        <ul style={pageStyles.convoList}>
          {conversations.map((c) => {
            const isActive = c.id === activeId;
            return (
              <li key={c.id} style={pageStyles.convoItem}>
                <button
                  type="button"
                  onClick={() => selectConversation(c.id)}
                  style={{
                    ...pageStyles.convoBtn,
                    background: isActive ? '#e8f0fe' : 'transparent',
                    fontWeight: isActive ? 600 : 400,
                  }}
                  title={c.title}
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete "${c.title}"?`)) {
                      void deleteConversation(c.id);
                    }
                  }}
                  style={pageStyles.deleteBtn}
                  aria-label={`Delete ${c.title}`}
                  title="Delete"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section style={pageStyles.chatPane}>
        <ConversationChat key={activeId} conversationId={activeId} />
      </section>
    </main>
  );
}

// Per-conversation Chat. Remounted via React `key={activeId}` when the user
// switches conversations, which resets useChat's internal state and lets us
// hand it a fresh `messages` array from SQLite.
function ConversationChat({ conversationId }: { conversationId: string }): React.ReactElement {
  const persistMessage = useConversationState((s) => s.persistMessage);
  const loadMessages = useConversationState((s) => s.loadMessages);

  const [initialMessages, setInitialMessages] = useState<ConversationMessage[] | null>(null);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  // Tracks ids already persisted so onFinish doesn't double-write user
  // messages or re-persist hydrated history.
  const persistedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setInitialMessages(null);
    setHydrationError(null);
    persistedIds.current = new Set();
    loadMessages(conversationId)
      .then((msgs) => {
        if (cancelled) return;
        for (const m of msgs) persistedIds.current.add(m.id);
        setInitialMessages(msgs);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHydrationError(err instanceof Error ? err.message : String(err));
        setInitialMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, loadMessages]);

  if (initialMessages === null) {
    return (
      <main style={pageStyles.loading}>
        <p>Loading conversation...</p>
      </main>
    );
  }

  return (
    <HydratedChat
      conversationId={conversationId}
      initialMessages={initialMessages}
      persistMessage={persistMessage}
      persistedIds={persistedIds}
      hydrationError={hydrationError}
    />
  );
}

type HydratedChatProps = {
  conversationId: string;
  initialMessages: ConversationMessage[];
  persistMessage: (
    conversationId: string,
    message: ConversationMessage,
  ) => Promise<void>;
  persistedIds: React.MutableRefObject<Set<string>>;
  hydrationError: string | null;
};

function HydratedChat({
  conversationId,
  initialMessages,
  persistMessage,
  persistedIds,
  hydrationError,
}: HydratedChatProps): React.ReactElement {
  // E-044: type the chat as CoachUIMessage so message.parts statically
  // includes the data-resources part that E-043 emits. The persisted form
  // in SQLite is the bare UIMessage shape (E-041); typing it up here is a
  // contract refinement, not a schema change.
  const { messages, sendMessage, status, error } = useChat<CoachUIMessage>({
    messages: initialMessages as CoachUIMessage[],
    onFinish: async ({ messages: settled }: { messages: CoachUIMessage[] }) => {
      // Persist any message we haven't persisted yet. Settled includes both
      // user and assistant messages by the time onFinish fires. We iterate
      // in order so position columns end up sequential per R-015 schema.
      for (const m of settled) {
        if (persistedIds.current.has(m.id)) continue;
        persistedIds.current.add(m.id);
        try {
          await persistMessage(conversationId, m as ConversationMessage);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[chat] failed to persist message', m.id, err);
          // Don't remove from persistedIds — retrying on the next turn would
          // race against the user typing.
        }
      }
    },
  });

  const [input, setInput] = useState('');

  // E-044: open the resource modal from a per-message strip click. The
  // hook lives here (not inside ResourceStrip) because Suspense + nuqs
  // requires the URL state hook to be available at a stable component
  // identity. Passing the open function down keeps the strip dumb.
  const { open: openModal } = useResourceModal(messages);

  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>): void => {
      e.preventDefault();
      const text = input.trim();
      if (!text) return;
      void sendMessage({ text });
      setInput('');
    },
    [input, sendMessage],
  );

  const onOpenStrip = useCallback(
    (messageId: string, firstSlug: string): void => {
      void openModal(messageId, firstSlug);
    },
    [openModal],
  );

  const isStreaming = status === 'streaming' || status === 'submitted';

  return (
    <div style={pageStyles.chatColumn}>
      <header>
        <h1 style={pageStyles.title}>Joe Hudson Coach</h1>
        <p style={pageStyles.subtitle}>
          Local-first chat. Conversations live in browser SQLite (OPFS); only the message body
          leaves your machine, sent to OpenRouter for the coach reply.
        </p>
      </header>

      <section
        style={pageStyles.transcript}
        aria-live="polite"
        aria-label="Conversation"
      >
        {messages.length === 0 && (
          <p style={pageStyles.empty}>
            Say something to start the conversation.
          </p>
        )}
        {messages.map((m) => (
          <article
            key={m.id}
            // E-042: id allows ChatScrollRestorer to scroll to a specific
            // message when returning from a wiki page via the
            // ?scrollToMessage=<id> fallback path.
            id={`msg-${m.id}`}
            style={{
              ...pageStyles.message,
              background: m.role === 'user' ? '#e8f0fe' : '#fff',
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div style={pageStyles.messageRole}>{m.role}</div>
            {m.parts.map((part, i) =>
              part.type === 'text' ? (
                <span key={i}>{part.text}</span>
              ) : null,
            )}
            {/* E-044: subtle resource strip on assistant messages only.
                Renders null when there's no data-resources part or it's
                empty (e.g., pre-retrieval intro messages). */}
            {m.role === 'assistant' && (
              <ResourceStrip message={m} onOpen={onOpenStrip} />
            )}
          </article>
        ))}
        {hydrationError && (
          <div style={pageStyles.errorBanner} role="alert">
            Couldn't load saved messages: {hydrationError}
          </div>
        )}
        {error && (
          <div style={pageStyles.errorBanner} role="alert">
            Error: {error.message}
          </div>
        )}
      </section>

      <form onSubmit={onSubmit} style={pageStyles.composerForm}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          aria-label="Message"
          disabled={isStreaming}
          style={pageStyles.composerInput}
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          style={{
            ...pageStyles.sendButton,
            cursor: isStreaming ? 'not-allowed' : 'pointer',
            opacity: isStreaming || !input.trim() ? 0.6 : 1,
          }}
        >
          {isStreaming ? 'Sending...' : 'Send'}
        </button>
      </form>

      {/* E-044: resource modal renders alongside chat. Reads same messages
          array so it always reflects the current conversation. Returns null
          when the URL has no ?resourceModal= state. */}
      <ResourceModal messages={messages} />
    </div>
  );
}

// Inline styles (consistent with E-040's deliberate barebones approach;
// proper styling lands once E-044/E-045 settle the visual design).
const pageStyles: Record<string, React.CSSProperties> = {
  loading: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#666',
  },
  shell: {
    display: 'flex',
    minHeight: '100vh',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  sidebar: {
    width: 240,
    background: '#f7f7f8',
    borderRight: '1px solid #e0e0e0',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  newButton: {
    padding: '8px 12px',
    fontSize: 14,
    background: '#1a73e8',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  convoList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    overflowY: 'auto',
  },
  convoItem: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 4,
  },
  convoBtn: {
    flex: 1,
    textAlign: 'left',
    padding: '8px 10px',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  deleteBtn: {
    width: 28,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: 18,
    color: '#999',
    borderRadius: 6,
  },
  chatPane: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  chatColumn: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '24px 16px',
    minHeight: '100vh',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  title: {
    fontSize: 18,
    margin: 0,
    fontWeight: 600,
  },
  subtitle: {
    fontSize: 13,
    color: '#666',
    margin: '4px 0 0',
  },
  transcript: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflowY: 'auto',
  },
  empty: {
    color: '#888',
    fontStyle: 'italic',
  },
  message: {
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid #e0e0e0',
    maxWidth: '85%',
    whiteSpace: 'pre-wrap',
    fontSize: 14,
    lineHeight: 1.5,
  },
  messageRole: {
    fontSize: 11,
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  errorBanner: {
    padding: '10px 14px',
    borderRadius: 10,
    background: '#fdecea',
    color: '#b00020',
    fontSize: 13,
  },
  composerForm: {
    display: 'flex',
    gap: 8,
  },
  composerInput: {
    flex: 1,
    padding: '10px 12px',
    fontSize: 14,
    border: '1px solid #ccc',
    borderRadius: 8,
    outline: 'none',
  },
  sendButton: {
    padding: '10px 18px',
    fontSize: 14,
    background: '#1a73e8',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
  },
};
