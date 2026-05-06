'use client';

import { useEffect, useRef } from 'react';
import type { TranscriptSegment } from '@shared/types';

interface TranscriptProps {
  segments: TranscriptSegment[];
  currentTime: number;
  onSeek: (sec: number) => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Transcript({ segments, currentTime, onSeek }: TranscriptProps) {
  const activeIdx = segments.findLastIndex((s) => currentTime >= s.start);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIdx]);

  if (segments.length === 0) {
    return <p className="text-muted text-sm">No transcript available.</p>;
  }

  return (
    <div className="flex flex-col gap-1 overflow-y-auto max-h-[60vh] pr-1">
      {segments.map((seg, i) => (
        <button
          key={i}
          ref={i === activeIdx ? activeRef : undefined}
          onClick={() => onSeek(seg.start)}
          className={[
            'text-left px-3 py-2 rounded-md text-sm transition-colors',
            i === activeIdx
              ? 'bg-[var(--bg-elevated)] text-[var(--text)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]',
          ].join(' ')}
        >
          <span className="text-xs text-[var(--accent)] mr-2 font-mono">
            {formatTime(seg.start)}
          </span>
          {seg.text}
        </button>
      ))}
    </div>
  );
}
