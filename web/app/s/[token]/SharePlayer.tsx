'use client';

import { useRef, useState } from 'react';
import type { Transcript } from '@shared/types';
import TranscriptPanel from '@/components/Transcript';

interface SharePlayerProps {
  token: string;
  transcript: Transcript | null;
}

export default function SharePlayer({ token, transcript }: SharePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <video
        ref={videoRef}
        src={`/api/share/${token}/playback`}
        controls
        className="w-full rounded-lg bg-black"
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
      />
      {transcript ? (
        <TranscriptPanel
          segments={transcript.segments}
          currentTime={currentTime}
          onSeek={(sec: number) => {
            if (videoRef.current) videoRef.current.currentTime = sec;
          }}
        />
      ) : (
        <p className="text-muted text-sm">No transcript available.</p>
      )}
    </div>
  );
}
