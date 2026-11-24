import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminLogin, BackendError } from '@/lib/backend';
import { sessionCookies } from '@/lib/session';

const bodySchema = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(200) });

/** Exchanges admin credentials for httpOnly session cookies. Tokens never reach the browser JS. */
export async function POST(req: Request): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid email and password.' }, { status: 400 });
  try {
    const { tokens, user } = await adminLogin(parsed.data.email, parsed.data.password);
    const res = NextResponse.json({ ok: true, user: { firstName: user.firstName, role: user.role } });
    for (const c of sessionCookies(tokens)) res.cookies.set(c.name, c.value, c.options);
    return res;
  } catch (err) {
    if (err instanceof BackendError) {
      const status = err.status === 429 ? 429 : err.status >= 500 ? 503 : 401;
      const message =
        status === 429 ? 'Too many attempts. Please wait a minute.' : status === 503 ? 'The EmblemWay API is unavailable.' : err.code === 'FORBIDDEN' ? err.message : 'Invalid email or password.';
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ error: 'Unexpected error.' }, { status: 500 });
  }
}
