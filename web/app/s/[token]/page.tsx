import { notFound } from 'next/navigation';
import { getDb } from '@/lib/mongo';
import type { Recording } from '@shared/types';
import SharePlayer from './SharePlayer';

export const dynamic = 'force-dynamic';

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = await getDb();
  const doc = await db.collection('recordings').findOne({ 'share.token': token });

  if (!doc || !doc.share?.enabled) notFound();

  const recording = doc as unknown as Recording;

  return (
    <div className="min-h-screen bg-[var(--bg-base)] p-6 max-w-3xl mx-auto">
      <h1 className="text-default text-xl font-semibold mb-1">{recording.title}</h1>
      <p className="text-muted text-xs mb-6">
        {new Date(recording.createdAt as string).toLocaleString()}
      </p>
      <SharePlayer token={token} transcript={recording.transcript ?? null} />
    </div>
  );
}
