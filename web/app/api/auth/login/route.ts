import { NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { timingSafeEqual } from 'crypto';
import { env } from '@/lib/env';
import { sessionOptions } from '@/lib/auth';
import type { SessionData } from '@/lib/auth';

export async function POST(request: Request) {
  const body = (await request.json()) as { username?: string; password?: string };

  // Note: timingSafeEqual requires equal-length buffers. If the lengths differ,
  // this will throw — and the catch path returns 401. For a local single-user
  // admin app this is acceptable; a multi-user system should pad to equal length.
  let usernameMatch = false;
  let passwordMatch = false;

  try {
    usernameMatch = timingSafeEqual(
      Buffer.from(body.username ?? ''),
      Buffer.from(env.ADMIN_USERNAME),
    );
  } catch {
    usernameMatch = false;
  }

  try {
    passwordMatch = timingSafeEqual(
      Buffer.from(body.password ?? ''),
      Buffer.from(env.ADMIN_PASSWORD),
    );
  } catch {
    passwordMatch = false;
  }

  if (!usernameMatch || !passwordMatch) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // iron-session v8 with Next.js App Router: pass the awaited cookie store
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  session.isLoggedIn = true;
  session.username = env.ADMIN_USERNAME;
  await session.save();

  return NextResponse.json({ ok: true });
}
