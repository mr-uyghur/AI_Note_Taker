import { NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongo';
import { getSignedGetUrl } from '@/lib/r2';
import { sessionOptions } from '@/lib/auth';
import type { SessionData } from '@/lib/auth';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const db = await getDb();
    const doc = await db.collection('recordings').findOne({ _id: new ObjectId(id) });
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const url = await getSignedGetUrl(doc.videoKey as string, 1800);
    return NextResponse.redirect(url, 302);
  } catch {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
}
