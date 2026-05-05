import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongo';
import { env } from '@/lib/env';

function serializeDoc(r: Record<string, unknown>) {
  return {
    ...r,
    _id: (r._id as ObjectId).toHexString(),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    conversations: ((r.conversations as Record<string, unknown>[]) ?? []).map((c) => ({
      ...c,
      _id: (c._id as ObjectId).toHexString(),
      createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
      messages: ((c.messages as Record<string, unknown>[]) ?? []).map((m) => ({
        ...m,
        createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
      })),
    })),
  };
}

export async function GET() {
  try {
    const db = await getDb();
    const recordings = await db
      .collection('recordings')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    return NextResponse.json(recordings.map(serializeDoc));
  } catch (err) {
    console.error('GET /api/recordings', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // Verify internal token from the desktop app
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${env.INTERNAL_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { title?: string };
    const db = await getDb();

    const doc = {
      _id: new ObjectId(),
      title: body.title ?? `Recording — ${new Date().toLocaleDateString()}`,
      createdAt: new Date(),
      durationSec: 0,
      sizeBytes: 0,
      videoKey: '',
      status: 'uploading' as const,
      share: { enabled: false, token: null as string | null },
      conversations: [] as unknown[],
    };

    await db.collection('recordings').insertOne(doc);
    return NextResponse.json({ _id: doc._id.toHexString() }, { status: 201 });
  } catch (err) {
    console.error('POST /api/recordings', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
