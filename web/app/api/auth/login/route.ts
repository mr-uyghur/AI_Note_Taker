import { NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies, headers } from 'next/headers';
import { timingSafeEqual } from 'crypto';
import { env } from '@/lib/env';
import { sessionOptions } from '@/lib/auth';
import type { SessionData } from '@/lib/auth';

// In-memory rate limit: 5 failures per IP per 60 s
const failMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = failMap.get(ip);
  if (!entry || now > entry.resetAt) {
    return true; // allowed
  }
  return entry.count < 5;
}

function recordFailure(ip: string) {
  const now = Date.now();
  const entry = failMap.get(ip);
  if (!entry || now > entry.resetAt) {
    failMap.set(ip, { count: 1, resetAt: now + 60_000 });
  } else {
    entry.count += 1;
  }
}

function clearFailures(ip: string) {
  failMap.delete(ip);
}

export async function POST(request: Request) {
  const headersList = await headers();
  const ip =
    headersList.get('x-forwarded-for')?.split(',')[0].trim() ?? '127.0.0.1';

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many failed attempts. Try again in 60 seconds.' },
      { status: 429 }
    );
  }

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
    recordFailure(ip);
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  clearFailures(ip);

  // iron-session v8 with Next.js App Router: pass the awaited cookie store
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  session.isLoggedIn = true;
  session.username = env.ADMIN_USERNAME;
  await session.save();

  return NextResponse.json({ ok: true });
}
