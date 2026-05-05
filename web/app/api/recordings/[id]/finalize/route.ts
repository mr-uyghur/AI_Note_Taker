import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongo';
import { env } from '@/lib/env';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify internal token
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${env.INTERNAL_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json()) as {
    videoKey: string;
    audioKey?: string;
    durationSec: number;
    sizeBytes: number;
  };

  try {
    const db = await getDb();
    await db.collection('recordings').updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          videoKey: body.videoKey,
          audioKey: body.audioKey,
          durationSec: body.durationSec,
          sizeBytes: body.sizeBytes,
          status: 'transcribing', // triggers transcription in M6
        },
      }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/recordings/[id]/finalize', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
