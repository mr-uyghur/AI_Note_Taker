import { NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { ObjectId } from 'mongodb';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/mongo';
import { sessionOptions } from '@/lib/auth';
import type { SessionData } from '@/lib/auth';

async function requireAdmin() {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  return session.isLoggedIn;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireAdmin()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const db = await getDb();
    const doc = await db.collection('recordings').findOne({ _id: new ObjectId(id) });
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ...doc, _id: doc._id.toHexString() });
  } catch {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireAdmin()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json()) as {
    title?: string;
    share?: { enabled: boolean };
  };

  const $set: Record<string, unknown> = {};

  if (body.title !== undefined) {
    $set['title'] = body.title;
  }

  if (body.share !== undefined) {
    if (body.share.enabled) {
      $set['share.enabled'] = true;
      $set['share.token'] = nanoid(24);
    } else {
      $set['share.enabled'] = false;
      $set['share.token'] = null;
    }
  }

  try {
    const db = await getDb();
    const result = await db
      .collection('recordings')
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set },
        { returnDocument: 'after' }
      );
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ...result, _id: result._id.toHexString() });
  } catch {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
}
