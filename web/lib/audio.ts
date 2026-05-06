import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable } from 'stream';
import type { Recording } from '@shared/types';
import { getSignedGetUrl } from './r2';
import { toOpus } from './groq';

async function downloadToTemp(key: string, ext: string): Promise<string> {
  const url = await getSignedGetUrl(key, 900);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`R2 download failed: ${resp.status}`);

  const tmpPath = path.join(os.tmpdir(), `utter-dl-${Date.now()}${ext}`);
  const dest = fs.createWriteStream(tmpPath);
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(resp.body as import('stream/web').ReadableStream).pipe(dest)
      .on('finish', resolve)
      .on('error', reject);
  });
  return tmpPath;
}

// Returns a local path to an opus file suitable for Whisper.
// Caller is responsible for deleting the file when done.
export async function extractOrFetchAudio(recording: Recording): Promise<string> {
  const outPath = path.join(os.tmpdir(), `utter-audio-${recording._id}.opus`);

  if (recording.audioKey) {
    // Download the m4a sidecar audio the Swift recorder wrote
    const m4aPath = await downloadToTemp(recording.audioKey, '.m4a');
    try {
      await toOpus(m4aPath, outPath);
    } finally {
      await fs.promises.rm(m4aPath, { force: true });
    }
  } else {
    // No dedicated audio track — extract from the video
    const videoExt = recording.videoKey.endsWith('.mp4') ? '.mp4' : '.webm';
    const videoPath = await downloadToTemp(recording.videoKey, videoExt);
    try {
      await toOpus(videoPath, outPath);
    } finally {
      await fs.promises.rm(videoPath, { force: true });
    }
  }

  return outPath;
}
