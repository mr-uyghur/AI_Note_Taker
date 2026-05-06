'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface PlayerHandle {
  seekTo(sec: number): void;
  getVideoEl(): HTMLVideoElement | null;
}

interface PlayerProps {
  recordingId: string;
  onTimeUpdate?: (currentTime: number) => void;
}

const Player = forwardRef<PlayerHandle, PlayerProps>(function Player(
  { recordingId, onTimeUpdate },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = videoRef.current;
      if (!el) return;
      // Don't intercept when user is typing in an input/textarea
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === ' ') {
        e.preventDefault();
        el.paused ? el.play() : el.pause();
      } else if (e.key === 'ArrowLeft') {
        el.currentTime = Math.max(0, el.currentTime - 5);
      } else if (e.key === 'ArrowRight') {
        el.currentTime = Math.min(el.duration || Infinity, el.currentTime + 5);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useImperativeHandle(ref, () => ({
    seekTo(sec: number) {
      if (videoRef.current) videoRef.current.currentTime = sec;
    },
    getVideoEl() {
      return videoRef.current;
    },
  }));

  return (
    <video
      ref={videoRef}
      src={`/api/recordings/${recordingId}/playback`}
      controls
      className="w-full rounded-lg bg-black"
      onTimeUpdate={() => onTimeUpdate?.(videoRef.current?.currentTime ?? 0)}
    />
  );
});

export default Player;
