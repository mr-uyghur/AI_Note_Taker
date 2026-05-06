import Link from 'next/link';
import { getDb } from '@/lib/mongo';
import type { Recording } from '@shared/types';
import { ObjectId } from 'mongodb';

export const dynamic = 'force-dynamic';

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default async function AdminPage() {
  const db = await getDb();
  const docs = await db
    .collection('recordings')
    .find({})
    .sort({ createdAt: -1 })
    .toArray();

  const recordings = docs.map((d) => ({
    ...(d as unknown as Recording),
    _id: (d._id as ObjectId).toHexString(),
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : d.createdAt,
  }));

  return (
    <div>
      <h1 className="text-default text-xl font-semibold mb-6">Recordings</h1>
      {recordings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-muted text-sm">No recordings yet.</p>
          <p className="text-muted text-xs mt-1">
            Open the Utter desktop app to record your first meeting.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {recordings.map((r) => (
            <li key={r._id}>
              <Link
                href={`/admin/recordings/${r._id}`}
                className="flex items-center justify-between px-4 py-3 rounded-lg bg-[var(--bg-panel)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                <div>
                  <p className="text-default text-sm font-medium">{r.title}</p>
                  <p className="text-muted text-xs mt-0.5">
                    {new Date(r.createdAt as string).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span>{formatDuration(r.durationSec)}</span>
                  <span
                    className={
                      r.status === 'ready'
                        ? 'text-green-400'
                        : r.status === 'failed'
                          ? 'text-[var(--danger)]'
                          : ''
                    }
                  >
                    {r.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
