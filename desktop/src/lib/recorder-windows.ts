import { invoke } from '@tauri-apps/api/core';

export interface WindowsRecorderOptions {
  recordingId: string;
  onChunkUploaded?: (partNumber: number) => void;
  onError?: (err: Error) => void;
}

export class WindowsRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private partNumber = 1;
  private options: WindowsRecorderOptions;
  private stopped = false;

  constructor(options: WindowsRecorderOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    // Get screen + system audio (Windows supports audio in getDisplayMedia)
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
    });

    // Get microphone
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });

    // Mix audio tracks via Web Audio API
    const audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();

    const displayAudioTracks = displayStream.getAudioTracks();
    if (displayAudioTracks.length > 0) {
      const displaySource = audioCtx.createMediaStreamSource(
        new MediaStream(displayAudioTracks)
      );
      displaySource.connect(dest);
    }

    const micSource = audioCtx.createMediaStreamSource(micStream);
    micSource.connect(dest);

    // Combine video track with mixed audio
    const videoTrack = displayStream.getVideoTracks()[0];
    const combinedStream = new MediaStream([videoTrack, dest.stream.getAudioTracks()[0]]);

    const mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      throw new Error('video/webm;codecs=vp9,opus is not supported in this WebView');
    }

    this.mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 2_500_000,
    });

    this.mediaRecorder.ondataavailable = async (event) => {
      if (event.data.size === 0 || this.stopped) return;
      try {
        const bytes = Array.from(new Uint8Array(await event.data.arrayBuffer()));
        await invoke('upload_chunk', {
          recordingId: this.options.recordingId,
          partNumber: this.partNumber,
          bytes,
        });
        this.options.onChunkUploaded?.(this.partNumber);
        this.partNumber++;
      } catch (err) {
        this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };

    this.mediaRecorder.start(5000); // emit chunk every 5 seconds
  }

  async stop(_durationSec: number): Promise<void> {
    this.stopped = true;
    return new Promise((resolve) => {
      if (!this.mediaRecorder) { resolve(); return; }
      this.mediaRecorder.onstop = () => resolve();
      this.mediaRecorder.stop();
    });
  }
}
