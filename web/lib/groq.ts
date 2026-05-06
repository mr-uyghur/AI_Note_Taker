import Groq from 'groq-sdk';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Transcript, TranscriptSegment, TranscriptWord } from '@shared/types';
import { env } from './env';

const execFileAsync = promisify(execFile);

// ffmpeg-static provides the binary path as its default export
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require('ffmpeg-static');

let _groq: Groq | undefined;
function getGroq() {
  if (!_groq) _groq = new Groq({ apiKey: env.GROQ_API_KEY });
  return _groq;
}

const MAX_FILE_BYTES = 24 * 1024 * 1024; // 24 MiB — Groq limit is 25 MiB

async function transcribeSingle(audioPath: string): Promise<Transcript> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp = (await getGroq().audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-large-v3',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment', 'word'],
  })) as any;

  const segments: TranscriptSegment[] = (resp.segments ?? []).map((s: any) => ({
    start: s.start,
    end: s.end,
    text: s.text,
  }));

  const words: TranscriptWord[] = (resp.words ?? []).map((w: any) => ({
    start: w.start,
    end: w.end,
    word: w.word,
  }));

  return { full: resp.text as string, segments, words };
}

// Split audio into ~20-min chunks, transcribe each, offset timestamps, stitch.
async function transcribeLarge(audioPath: string): Promise<Transcript> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'utter-chunks-'));
  const chunkSec = 20 * 60;

  // Get total duration
  const { stdout } = await execFileAsync(ffmpegPath, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', audioPath,
  ]).catch(() => ({ stdout: '0' }));
  const totalSec = parseFloat(stdout.trim()) || 0;

  const chunks: string[] = [];
  for (let start = 0; start < totalSec; start += chunkSec) {
    const outPath = path.join(tmpDir, `chunk-${start}.opus`);
    await execFileAsync(ffmpegPath, [
      '-ss', String(start), '-t', String(chunkSec),
      '-i', audioPath, '-vn', '-c:a', 'libopus', '-b:a', '24k',
      '-y', outPath,
    ]);
    chunks.push(outPath);
  }

  const results = await Promise.all(
    chunks.map((p, i) => transcribeSingle(p).then((t) => ({ t, offset: i * chunkSec })))
  );

  // Clean up chunks
  await fs.promises.rm(tmpDir, { recursive: true, force: true });

  const full = results.map((r) => r.t.full).join(' ');
  const segments: TranscriptSegment[] = results.flatMap(({ t, offset }) =>
    t.segments.map((s) => ({ ...s, start: s.start + offset, end: s.end + offset }))
  );
  const words: TranscriptWord[] = results.flatMap(({ t, offset }) =>
    (t.words ?? []).map((w) => ({ ...w, start: w.start + offset, end: w.end + offset }))
  );

  return { full, segments, words };
}

export async function transcribe(audioPath: string): Promise<Transcript> {
  const stat = await fs.promises.stat(audioPath);
  if (stat.size > MAX_FILE_BYTES) {
    return transcribeLarge(audioPath);
  }
  return transcribeSingle(audioPath);
}

// Convert any audio/video to opus 24 kbps mono
export async function toOpus(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync(ffmpegPath, [
    '-i', inputPath, '-vn', '-c:a', 'libopus', '-b:a', '24k', '-ac', '1',
    '-y', outputPath,
  ]);
}
