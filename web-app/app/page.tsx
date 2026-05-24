'use client';

import { useChat } from '@ai-sdk/react';
import { useState, type FormEvent } from 'react';

// E-040 minimal chat UI. No persistence (E-041), no resource attribution
// (E-044), no multi-conversation (E-041), no welcome flow (E-045).
// One conversation, in-memory, default model, default route handler.
export default function ChatPage(): React.ReactElement {
  const { messages, sendMessage, status, error } = useChat();
  const [input, setInput] = useState('');

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    void sendMessage({ text });
    setInput('');
  };

  const isStreaming = status === 'streaming' || status === 'submitted';

  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 16px',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <header>
        <h1 style={{ fontSize: 18, margin: 0, fontWeight: 600 }}>
          Joe Hudson Coach (E-040 scaffold)
        </h1>
        <p style={{ fontSize: 13, color: '#666', margin: '4px 0 0' }}>
          Minimal chat. No persistence, no retrieval. Real coach lands in E-043.
        </p>
      </header>

      <section
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          overflowY: 'auto',
        }}
        aria-live="polite"
        aria-label="Conversation"
      >
        {messages.length === 0 && (
          <p style={{ color: '#888', fontStyle: 'italic' }}>
            Say something to start the conversation.
          </p>
        )}
        {messages.map((m) => (
          <article
            key={m.id}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              background: m.role === 'user' ? '#e8f0fe' : '#fff',
              border: '1px solid #e0e0e0',
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              whiteSpace: 'pre-wrap',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#999',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 4,
              }}
            >
              {m.role}
            </div>
            {m.parts.map((part, i) =>
              part.type === 'text' ? (
                <span key={i}>{part.text}</span>
              ) : null,
            )}
          </article>
        ))}
        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              background: '#fdecea',
              color: '#b00020',
              fontSize: 13,
            }}
            role="alert"
          >
            Error: {error.message}
          </div>
        )}
      </section>

      <form
        onSubmit={onSubmit}
        style={{ display: 'flex', gap: 8 }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          aria-label="Message"
          disabled={isStreaming}
          style={{
            flex: 1,
            padding: '10px 12px',
            fontSize: 14,
            border: '1px solid #ccc',
            borderRadius: 8,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          style={{
            padding: '10px 18px',
            fontSize: 14,
            background: '#1a73e8',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: isStreaming ? 'not-allowed' : 'pointer',
            opacity: isStreaming || !input.trim() ? 0.6 : 1,
          }}
        >
          {isStreaming ? 'Sending...' : 'Send'}
        </button>
      </form>
    </main>
  );
}
