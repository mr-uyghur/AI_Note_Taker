import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongo';

export async function GET() {
  const db = await getDb();
  const recordings = await db
    .collection('recordings')
    .find({})
    .sort({ createdAt: -1 })
    .toArray();

  // Serialize ObjectId → string for the shared Recording type
  const serialized = recordings.map((r) => ({
    ...r,
    _id: r._id.toHexString(),
    conversations: (r.conversations ?? []).map((c: any) => ({
      ...c,
      _id: c._id.toHexString(),
      createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
      messages: (c.messages ?? []).map((m: any) => ({
        ...m,
        createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
      })),
    })),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
  }));

  return NextResponse.json(serialized);
}

export async function POST(request: Request) {
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
    share: { enabled: false, token: null },
    conversations: [],
  };

  await db.collection('recordings').insertOne(doc);

  return NextResponse.json({ _id: doc._id.toHexString() }, { status: 201 });
}
