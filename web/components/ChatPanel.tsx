'use client';

import { useEffect, useRef, useState } from 'react';
import type { Conversation, ConversationMessage } from '@shared/types';

interface ChatPanelProps {
  recordingId: string;
  initialConversations: Conversation[];
  onSeek: (sec: number) => void;
}

// Parse [mm:ss] markers into clickable spans
function renderWithTimestamps(
  text: string,
  onSeek: (sec: number) => void
): React.ReactNode[] {
  const parts = text.split(/(\[\d{1,2}:\d{2}\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d{1,2}):(\d{2})\]$/);
    if (m) {
      const sec = parseInt(m[1]) * 60 + parseInt(m[2]);
      return (
        <button
          key={i}
          onClick={() => onSeek(sec)}
          className="text-[var(--accent)] hover:text-[var(--accent-hover)] font-mono text-xs underline"
        >
          {part}
        </button>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function ChatPanel({
  recordingId,
  initialConversations,
  onSeek,
}: ChatPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [activeConvId, setActiveConvId] = useState<string | null>(
    initialConversations[0]?._id ?? null
  );
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find((c) => c._id === activeConvId) ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages.length, streaming]);

  async function send() {
    if (!input.trim() || loading) return;
    const message = input.trim();
    setInput('');
    setLoading(true);
    setStreaming('');

    const res = await fetch(`/api/recordings/${recordingId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: activeConvId ?? undefined, message }),
    });

    if (!res.ok || !res.body) {
      setLoading(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      full += chunk;
      setStreaming(full);
    }

    setStreaming('');
    setLoading(false);

    // Reload conversations from server to get the persisted state + new conv id
    const updated = await fetch(`/api/recordings/${recordingId}`).then((r) => r.json());
    const convs: Conversation[] = updated.conversations ?? [];
    setConversations(convs);
    if (!activeConvId && convs.length > 0) {
      setActiveConvId(convs[convs.length - 1]._id);
    }
  }

  const messages: ConversationMessage[] = activeConv?.messages ?? [];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Conversation list */}
      {conversations.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-3">
          {conversations.map((c) => (
            <button
              key={c._id}
              onClick={() => setActiveConvId(c._id)}
              className={[
                'text-xs px-2 py-1 rounded border transition-colors',
                c._id === activeConvId
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-[var(--border)] text-muted hover:border-[var(--text-muted)]',
              ].join(' ')}
            >
              {c.title}
            </button>
          ))}
          <button
            onClick={() => setActiveConvId(null)}
            className="text-xs px-2 py-1 rounded border border-dashed border-[var(--border)] text-muted hover:border-[var(--text-muted)]"
          >
            + New
          </button>
        </div>
      )}

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-3 min-h-0 mb-3">
        {messages.length === 0 && !streaming && (
          <p className="text-muted text-sm text-center py-8">
            Ask a question about this recording.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={[
              'px-3 py-2 rounded-lg text-sm max-w-[85%]',
              msg.role === 'user'
                ? 'self-end bg-[var(--accent)] text-white'
                : 'self-start bg-[var(--bg-elevated)] text-[var(--text)]',
            ].join(' ')}
          >
            {msg.role === 'assistant'
              ? renderWithTimestamps(msg.content, onSeek)
              : msg.content}
          </div>
        ))}
        {streaming && (
          <div className="self-start bg-[var(--bg-elevated)] text-[var(--text)] px-3 py-2 rounded-lg text-sm max-w-[85%]">
            {renderWithTimestamps(streaming, onSeek)}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Ask about this recording…"
          disabled={loading}
          className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-3 py-2 text-sm text-default placeholder:text-muted focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded disabled:opacity-50 transition-colors"
        >
          {loading ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
