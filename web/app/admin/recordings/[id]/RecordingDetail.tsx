'use client';

import { useRef, useState } from 'react';
import type { Recording } from '@shared/types';
import Player, { type PlayerHandle } from '@/components/Player';
import Transcript from '@/components/Transcript';
import ShareToggle from '@/components/ShareToggle';
import ChatPanel from '@/components/ChatPanel';
import InlineEdit from '@/components/InlineEdit';

export default function RecordingDetail({ recording }: { recording: Recording }) {
  const playerRef = useRef<PlayerHandle>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [title, setTitle] = useState(recording.title);

  function seekTo(sec: number) {
    playerRef.current?.seekTo(sec);
  }

  async function renameRecording(newTitle: string) {
    const res = await fetch(`/api/recordings/${recording._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    if (res.ok) setTitle(newTitle);
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div>
        <h1 className="text-default text-xl font-semibold">
          <InlineEdit value={title} onSave={renameRecording} className="text-xl font-semibold" />
        </h1>
        <p className="text-muted text-xs mt-1">
          {new Date(recording.createdAt).toLocaleString()} ·{' '}
          {Math.round(recording.durationSec / 60)} min
        </p>
      </div>

      <Player
        ref={playerRef}
        recordingId={recording._id}
        onTimeUpdate={setCurrentTime}
      />

      <ShareToggle recording={recording} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section>
          <h2 className="text-default text-sm font-semibold mb-3">Transcript</h2>
          {recording.status === 'transcribing' && (
            <p className="text-muted text-sm">Transcribing…</p>
          )}
          {recording.status === 'failed' && (
            <div className="flex flex-col gap-2">
              <p className="text-[var(--danger)] text-sm">
                Transcription failed: {recording.error ?? 'unknown error'}
              </p>
              <RetryButton recordingId={recording._id} />
            </div>
          )}
          {recording.status === 'ready' && recording.transcript && (
            <Transcript
              segments={recording.transcript.segments}
              currentTime={currentTime}
              onSeek={seekTo}
            />
          )}
        </section>

        <section className="flex flex-col" style={{ minHeight: '400px' }}>
          <h2 className="text-default text-sm font-semibold mb-3">Chat</h2>
          {recording.status !== 'ready' ? (
            <p className="text-muted text-sm">Available after transcription.</p>
          ) : (
            <ChatPanel
              recordingId={recording._id}
              initialConversations={recording.conversations}
              onSeek={seekTo}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function RetryButton({ recordingId }: { recordingId: string }) {
  const [loading, setLoading] = useState(false);

  async function retry() {
    setLoading(true);
    await fetch(`/api/recordings/${recordingId}/transcribe`, { method: 'POST' });
    setLoading(false);
    window.location.reload();
  }

  return (
    <button
      onClick={retry}
      disabled={loading}
      className="text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] disabled:opacity-50"
    >
      {loading ? 'Retrying…' : 'Retry transcription'}
    </button>
  );
}
