import { invoke } from '@tauri-apps/api/core';

export interface MacosRecorderOptions {
  recordingId: string;
  onError?: (err: Error) => void;
}

export class MacosRecorder {
  private recordingId: string;

  constructor(options: MacosRecorderOptions) {
    this.recordingId = options.recordingId;
    // onError is not used: macOS errors propagate via thrown exceptions from invoke()
  }

  async start(): Promise<void> {
    await invoke('init_recording_macos', { recordingId: this.recordingId });
  }

  async stop(_durationSec: number): Promise<void> {
    await invoke('stop_recording_macos', {
      recordingId: this.recordingId,
    });
  }
}
