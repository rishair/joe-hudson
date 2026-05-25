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
import type { CoachUIMessage, ProgressEvent, VariantTag } from '@/app/lib/coach/types';
import {
  COACH_PROFILE_META,
  COACH_PROFILE_ORDER,
  DEFAULT_COACH_PROFILE_ID,
  type CoachProfileId,
} from '@/app/lib/coach/profiles-meta';
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

  // E-054 (G-014): which coach variant answers this conversation. Defaults to
  // the baseline `v5b`. State lives here (per-conversation; HydratedChat is
  // remounted via `key={activeId}` when the user switches conversations, so
  // each conversation starts at the baseline). Switching mid-conversation is
  // allowed — the next turn picks up the new value because we read it at
  // send time, not at mount. A ref mirrors the state so the submit callback
  // always sees the latest value without re-subscribing.
  const [coachProfile, setCoachProfile] = useState<CoachProfileId>(
    DEFAULT_COACH_PROFILE_ID,
  );
  const coachProfileRef = useRef<CoachProfileId>(DEFAULT_COACH_PROFILE_ID);
  coachProfileRef.current = coachProfile;

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
      // E-054: pass the selected coach variant in the per-call request body.
      // The AI SDK merges this into the JSON the chat route receives, where
      // `resolveCoachProfile` looks it up (unknown → v5b baseline). Read from
      // the ref so the value is always the latest selection at send time.
      void sendMessage(
        { text },
        { body: { coachProfile: coachProfileRef.current } },
      );
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
        {/* E-054 (G-014): coach-variant selector. Switching applies to the
            next turn in this conversation. */}
        <div style={pageStyles.selectorRow}>
          <label htmlFor="coach-variant" style={pageStyles.selectorLabel}>
            Coach style
          </label>
          <select
            id="coach-variant"
            value={coachProfile}
            onChange={(e) => setCoachProfile(e.target.value as CoachProfileId)}
            disabled={isStreaming}
            style={pageStyles.selector}
            aria-label="Coach style"
            title={COACH_PROFILE_META[coachProfile].blurb}
          >
            {COACH_PROFILE_ORDER.map((id) => (
              <option key={id} value={id}>
                {COACH_PROFILE_META[id].label}
              </option>
            ))}
          </select>
          <span style={pageStyles.selectorBlurb}>
            {COACH_PROFILE_META[coachProfile].blurb}
          </span>
        </div>
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
        {messages.map((m) => {
          // E-047: extract the LATEST data-progress part on assistant messages.
          // Render it as a small inline status line that fades once text-delta
          // events start arriving (we detect that by checking whether any text
          // part has non-empty content).
          const latestProgress = m.role === 'assistant' ? extractLatestProgress(m) : null;
          const hasText = hasAnyText(m);
          const showProgress = latestProgress && !hasText;
          // E-054: the variant tag the route attached to this assistant turn.
          // Persisted inside parts, so it survives reload.
          const variantTag = m.role === 'assistant' ? extractVariantTag(m) : null;
          return (
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
              <div style={pageStyles.messageRole}>
                {m.role}
                {variantTag && (
                  <span style={pageStyles.variantTag} title={`Answered by the "${variantTag.label}" coach variant`}>
                    {variantTag.label}
                  </span>
                )}
              </div>
              {m.parts.map((part, i) =>
                part.type === 'text' ? (
                  <span key={i}>{part.text}</span>
                ) : null,
              )}
              {showProgress && (
                <div style={pageStyles.progressLine} aria-live="polite">
                  {formatProgress(latestProgress)}
                </div>
              )}
              {/* E-044: subtle resource strip on assistant messages only.
                  Renders null when there's no data-resources part or it's
                  empty (e.g., pre-retrieval intro messages). */}
              {m.role === 'assistant' && (
                <ResourceStrip message={m} onOpen={onOpenStrip} />
              )}
            </article>
          );
        })}
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

/**
 * E-047 — pull the latest `data-progress` part out of a CoachUIMessage.
 * Returns null if there isn't one (e.g., user messages, hydrated old messages
 * from before progress was wired). Picks the LAST progress part because the
 * server writes one per stage transition and we only render the most recent.
 */
function extractLatestProgress(
  m: CoachUIMessage | UIMessage,
): ProgressEvent | null {
  let latest: ProgressEvent | null = null;
  for (const part of m.parts) {
    if (part.type !== 'data-progress') continue;
    const data = (part as unknown as { data?: ProgressEvent }).data;
    if (data) latest = data;
  }
  return latest;
}

/**
 * E-054 — pull the `data-variant` tag the route attached to an assistant
 * message (which coach profile produced it). Returns null on user messages or
 * messages saved before the selector shipped. Picks the last variant part
 * (there is only ever one per turn).
 */
function extractVariantTag(m: CoachUIMessage | UIMessage): VariantTag | null {
  let tag: VariantTag | null = null;
  for (const part of m.parts) {
    if (part.type !== 'data-variant') continue;
    const data = (part as unknown as { data?: VariantTag }).data;
    if (data && typeof data.label === 'string') tag = data;
  }
  return tag;
}

/**
 * Returns true if the message has any non-empty text part. Used to decide
 * when to STOP rendering the progress line — once the coach starts streaming
 * text deltas, the progress info is obsolete.
 */
function hasAnyText(m: CoachUIMessage | UIMessage): boolean {
  for (const part of m.parts) {
    if (part.type === 'text' && part.text.length > 0) return true;
  }
  return false;
}

/**
 * Format a progress event for the inline status line. Includes the step
 * counter when present (e.g., "Following thread 3 of 8").
 */
function formatProgress(p: ProgressEvent): string {
  return p.message;
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
  selectorRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  selectorLabel: {
    fontSize: 12,
    color: '#555',
    fontWeight: 600,
  },
  selector: {
    padding: '4px 8px',
    fontSize: 13,
    border: '1px solid #ccc',
    borderRadius: 6,
    background: '#fff',
    cursor: 'pointer',
  },
  selectorBlurb: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
    flex: '1 1 200px',
    minWidth: 0,
  },
  variantTag: {
    marginLeft: 8,
    padding: '1px 6px',
    fontSize: 10,
    fontWeight: 600,
    color: '#3367d6',
    background: '#e8f0fe',
    borderRadius: 4,
    textTransform: 'none',
    letterSpacing: 0,
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
  progressLine: {
    marginTop: 4,
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
    transition: 'opacity 0.2s',
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
