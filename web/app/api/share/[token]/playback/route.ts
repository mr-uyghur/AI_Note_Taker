import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { getSignedGetUrl } from '@/lib/r2';

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

  const url = await getSignedGetUrl(doc.videoKey as string, 1800);
  return NextResponse.redirect(url, 302);
}
