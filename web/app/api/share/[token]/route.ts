import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import type { Recording } from '@shared/types';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const db = await getDb();
  const doc = await db.collection('recordings').findOne({ 'share.token': token });

  if (!doc || !doc.share?.enabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const recording = doc as unknown as Recording;
  return NextResponse.json({
    id: doc._id.toHexString(),
    title: recording.title,
    durationSec: recording.durationSec,
    transcript: recording.transcript ?? null,
  });
}
