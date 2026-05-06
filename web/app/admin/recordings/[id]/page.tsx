import { notFound } from 'next/navigation';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongo';
import type { Recording } from '@shared/types';
import RecordingDetail from './RecordingDetail';

export const dynamic = 'force-dynamic';

function serializeRecording(doc: Record<string, unknown>): Recording {
  return {
    ...(doc as Recording),
    _id: (doc._id as ObjectId).toHexString(),
    createdAt:
      doc.createdAt instanceof Date ? doc.createdAt.toISOString() : (doc.createdAt as string),
    conversations: ((doc.conversations as Record<string, unknown>[]) ?? []).map((c) => ({
      ...(c as import('@shared/types').Conversation),
      _id: (c._id as ObjectId).toHexString(),
      createdAt:
        c.createdAt instanceof Date ? c.createdAt.toISOString() : (c.createdAt as string),
    })),
  };
}

export default async function RecordingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let recording: Recording;
  try {
    const db = await getDb();
    const doc = await db.collection('recordings').findOne({ _id: new ObjectId(id) });
    if (!doc) notFound();
    recording = serializeRecording(doc as Record<string, unknown>);
  } catch {
    notFound();
  }

  return <RecordingDetail recording={recording} />;
}
