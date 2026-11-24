import { NextRequest, NextResponse } from 'next/server';
import { backendFetch } from '@/lib/backend';
import { ACCESS_COOKIE, clearedCookies } from '@/lib/session';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (token) {
    // Revoke server-side; local cookies are cleared regardless.
    await backendFetch('/auth/logout', { method: 'POST', token }).catch(() => undefined);
  }
  const res = NextResponse.redirect(new URL('/login', req.url), { status: 303 });
  for (const c of clearedCookies()) res.cookies.set(c.name, c.value, c.options);
  return res;
}
