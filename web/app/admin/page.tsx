import { getDb } from '@/lib/mongo';

// Force dynamic rendering — this page requires a live MongoDB connection
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const db = await getDb();
  const count = await db.collection('recordings').countDocuments();

  return (
    <div>
      <h1 className="text-default text-xl font-semibold mb-6">Recordings</h1>
      {count === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-muted text-sm">No recordings yet.</p>
          <p className="text-muted text-xs mt-1">
            Open the Utter desktop app to record your first meeting.
          </p>
        </div>
      ) : (
        <p className="text-muted text-sm">{count} recording(s) — full list coming in M6.</p>
      )}
    </div>
  );
}
