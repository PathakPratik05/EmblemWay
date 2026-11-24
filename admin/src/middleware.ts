import { NextRequest, NextResponse } from 'next/server';
import { refreshSession } from './lib/backend';
import { clearedCookies, EXPIRY_COOKIE, needsRefresh, REFRESH_COOKIE, sessionCookies } from './lib/session';

const PUBLIC_PATHS = ['/login', '/api/auth/login'];

/**
 * Guards every dashboard route: no session → /login. When the access token is about to
 * expire it is refreshed here (rotating the refresh token) so pages always render with a
 * valid token. A failed refresh clears the session.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!refresh) return NextResponse.redirect(new URL('/login', req.url));
  if (!needsRefresh(req.cookies.get(EXPIRY_COOKIE)?.value)) return NextResponse.next();

  try {
    const tokens = await refreshSession(refresh);
    const res = NextResponse.next();
    for (const c of sessionCookies(tokens)) {
      res.cookies.set(c.name, c.value, c.options);
      // Make the new values visible to the Server Components rendering this request.
      req.cookies.set(c.name, c.value);
    }
    return res;
  } catch {
    const res = NextResponse.redirect(new URL('/login?reason=session', req.url));
    for (const c of clearedCookies()) res.cookies.set(c.name, c.value, c.options);
    return res;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
