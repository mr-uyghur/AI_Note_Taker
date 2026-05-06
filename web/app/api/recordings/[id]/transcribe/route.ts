import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongo';
import { env } from '@/lib/env';
import { extractOrFetchAudio } from '@/lib/audio';
import { transcribe } from '@/lib/groq';
import type { Recording } from '@shared/types';
import * as fs from 'fs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${env.INTERNAL_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const db = await getDb();

  let recording: Recording | null;
  try {
    const doc = await db.collection('recordings').findOne({ _id: new ObjectId(id) });
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    recording = { ...doc, _id: doc._id.toHexString() } as Recording;
  } catch {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  // Already succeeded — skip
  if (recording.status === 'ready') {
    return NextResponse.json({ ok: true });
  }

  let audioPath: string | null = null;
  try {
    audioPath = await extractOrFetchAudio(recording);
    const transcript = await transcribe(audioPath);

    await db.collection('recordings').updateOne(
      { _id: new ObjectId(id) },
      { $set: { transcript, status: 'ready' } }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`transcribe ${id}:`, err);
    await db.collection('recordings').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'failed', error: message } }
    );
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (audioPath) await fs.promises.rm(audioPath, { force: true });
  }
}
