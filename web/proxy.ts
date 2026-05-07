import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getIronSession } from 'iron-session';
import { sessionOptions } from './lib/auth';
import type { SessionData } from './lib/auth';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CORS preflight for API routes (Tauri webview is cross-origin)
  if (request.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
  }

  // Public routes — pass through without session check
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/s/') ||
    pathname.startsWith('/api/share/') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // Protected: /admin and any API routes not under /api/auth
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/')) {
    // Desktop app authenticates with Bearer token — bypass session check
    const auth = request.headers.get('Authorization');
    if (auth && auth === `Bearer ${process.env.INTERNAL_TOKEN}`) {
      const response = NextResponse.next();
      Object.entries(CORS_HEADERS).forEach(([k, v]) => response.headers.set(k, v));
      return response;
    }

    const response = NextResponse.next();
    // iron-session v8: pass (req, res) for proxy/middleware context
    const session = await getIronSession<SessionData>(request, response, sessionOptions);
    if (!session.isLoggedIn) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
