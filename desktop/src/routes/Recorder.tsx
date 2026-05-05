import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '../components/ui/Button';
import { StatusPill } from '../components/StatusPill';
import type { RecorderStatus } from '../lib/types';
import type { WindowsRecorder } from '../lib/recorder-windows';

export function Recorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<WindowsRecorder | null>(null);
  const recordingIdRef = useRef<string>('');

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function handleStart() {
    if (status === 'recording') return;
    setError('');
    setElapsedSec(0);
    try {
      // Get config from Rust
      const webBaseUrl = await invoke<string>('get_config', { key: 'WEB_BASE_URL' });
      const internalToken = await invoke<string>('get_config', { key: 'INTERNAL_TOKEN' });

      // Create recording stub in the web app
      let res: Response;
      try {
        res = await fetch(`${webBaseUrl}/api/recordings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${internalToken}`,
          },
          body: JSON.stringify({ title: `Recording — ${new Date().toLocaleString()}` }),
        });
      } catch (_fetchErr) {
        throw new Error(
          `Could not reach the web app at ${webBaseUrl}. Make sure the server is running.`
        );
      }

      if (!res.ok) {
        throw new Error(`Failed to create recording (HTTP ${res.status})`);
      }
      const { _id } = await res.json() as { _id: string };
      recordingIdRef.current = _id;

      // Init multipart upload in Rust
      await invoke('init_recording', { recordingId: _id });

      // Start MediaRecorder pipeline (Windows recorder for M4; macOS handled in M5)
      const { WindowsRecorder } = await import('../lib/recorder-windows');
      recorderRef.current = new WindowsRecorder({
        recordingId: _id,
        onError: (err) => setError(err.message),
      });
      await recorderRef.current.start();

      setStatus('recording');
      timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleStop() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setStatus('uploading');
    try {
      await recorderRef.current?.stop(elapsedSec);
      await invoke('finalize_recording', {
        recordingId: recordingIdRef.current,
        durationSec: elapsedSec,
      });
      setStatus('done');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  function formatTime(sec: number) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  return (
    <div className="min-h-screen bg-base flex flex-col">
      <header className="h-12 border-b border-border flex items-center justify-between px-6">
        <span className="text-default font-semibold tracking-tight text-sm">Utter</span>
        <StatusPill status={status} />
      </header>

      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
        <div className="text-center">
          <span className="font-mono text-5xl font-light text-default tabular-nums">
            {formatTime(elapsedSec)}
          </span>
        </div>

        <div>
          {status === 'idle' || status === 'done' || status === 'error' ? (
            <Button
              onClick={handleStart}
              className="w-36 h-12 text-base rounded-full"
            >
              {status === 'idle' ? 'Start' : 'New Recording'}
            </Button>
          ) : status === 'recording' ? (
            <Button
              variant="danger"
              onClick={handleStop}
              className="w-36 h-12 text-base rounded-full"
            >
              Stop
            </Button>
          ) : (
            <div className="text-muted text-sm">
              {status === 'uploading' ? 'Uploading…' : 'Transcribing…'}
            </div>
          )}
        </div>

        {error && <p className="text-danger text-xs max-w-xs text-center">{error}</p>}
      </div>
    </div>
  );
}
