/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as logoutRoute } from '@/app/api/auth/logout/route';
import { adminLogin, BackendError, backendFetch, withQuery } from '@/lib/backend';
import { clearedCookies, needsRefresh, sessionCookies } from '@/lib/session';
import { parseSettingsForm } from '@/lib/settings-form';
import { middleware } from '@/middleware';

const tokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => jest.restoreAllMocks());

describe('session cookies', () => {
  it('are httpOnly, SameSite=Strict and carry the access-token expiry', () => {
    const cookies = sessionCookies(tokens);
    expect(cookies.map((c) => c.name)).toEqual(['ew_admin_at', 'ew_admin_rt', 'ew_admin_exp']);
    for (const c of cookies) expect(c.options).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/' });
    expect(Number(cookies[2]!.value)).toBe(new Date(tokens.accessTokenExpiresAt).getTime());
  });

  it('cleared cookies expire immediately', () => {
    expect(clearedCookies().every((c) => c.value === '' && c.options.expires.getTime() === 0)).toBe(true);
  });

  it('refreshes one minute before expiry or when expiry is unknown', () => {
    const now = Date.now();
    expect(needsRefresh(String(now + 5 * 60_000), now)).toBe(false);
    expect(needsRefresh(String(now + 30_000), now)).toBe(true);
    expect(needsRefresh(undefined, now)).toBe(true);
    expect(needsRefresh('garbage', now)).toBe(true);
  });
});

describe('backend client', () => {
  it('builds query strings without empty values', () => {
    expect(withQuery('/x', { a: 1, b: '', c: undefined, d: 'two words' })).toBe('/x?a=1&d=two%20words');
    expect(withQuery('/x')).toBe('/x');
  });

  it('sends the bearer token and parses JSON', async () => {
    const f = jest.fn().mockResolvedValue(json(200, { ok: true }));
    await expect(backendFetch('/admin/stats/overview', { token: 't', fetchImpl: f })).resolves.toEqual({ ok: true });
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer t' });
  });

  it('maps API error envelopes and network failures', async () => {
    const f = jest.fn().mockResolvedValue(json(400, { error: { code: 'VALIDATION_FAILED', message: 'bad', details: { fields: ['x'] } } }));
    await expect(backendFetch('/x', { fetchImpl: f })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED', details: { fields: ['x'] } });
    const down = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(backendFetch('/x', { fetchImpl: down })).rejects.toMatchObject({ status: 503, code: 'BACKEND_UNREACHABLE' });
  });

  it('refuses non-admin accounts at login', async () => {
    const f = jest.fn().mockResolvedValue(json(200, { tokens, user: { id: 'u', firstName: 'A', lastName: 'B', role: 'USER' } }));
    await expect(adminLogin('a@b.in', 'password1', f)).rejects.toBeInstanceOf(BackendError);
  });
});

describe('settings form parsing', () => {
  it('keeps numbers, converts checkboxes and ignores control fields', () => {
    const fd = new FormData();
    fd.set('section', 'matching');
    fd.set('$booleans', 'requirePickupProximity');
    fd.set('minOverlapRatio', '0.4');
    fd.set('departureWindowMinutes', '45');
    fd.set('blank', '');
    expect(parseSettingsForm(fd, ['requirePickupProximity'])).toEqual({ minOverlapRatio: 0.4, departureWindowMinutes: 45, requirePickupProximity: false });
    fd.set('requirePickupProximity', 'on');
    expect(parseSettingsForm(fd, ['requirePickupProximity']).requirePickupProximity).toBe(true);
  });
});

describe('login route handler (BFF)', () => {
  const req = (body: unknown) => new Request('http://admin.test/api/auth/login', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

  it('sets httpOnly session cookies and never returns tokens to the browser', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(json(200, { tokens, user: { id: 'u', firstName: 'Ada', lastName: 'A', role: 'ADMIN' } }));
    const res = await loginRoute(req({ email: 'ada@emblemway.in', password: 'Sup3r-secret' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('access-token');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('ew_admin_at=access-token');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=strict');
  });

  it('validates input and maps backend failures', async () => {
    expect((await loginRoute(req({ email: 'nope', password: 'x' }))).status).toBe(400);
    jest.spyOn(global, 'fetch').mockResolvedValue(json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid' } }));
    const r401 = await loginRoute(req({ email: 'a@b.in', password: 'wrong-pass' }));
    expect(r401.status).toBe(401);
    expect((await r401.json()).error).toBe('Invalid email or password.');
    jest.spyOn(global, 'fetch').mockResolvedValue(json(429, { error: { code: 'RATE_LIMITED' } }));
    expect((await loginRoute(req({ email: 'a@b.in', password: 'wrong-pass' }))).status).toBe(429);
  });

  it('logout clears cookies and revokes the backend session', async () => {
    const f = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const res = await logoutRoute(new NextRequest('http://admin.test/api/auth/logout', { method: 'POST', headers: { cookie: 'ew_admin_at=abc' } }));
    expect(res.status).toBe(303);
    expect(f).toHaveBeenCalledWith(expect.stringContaining('/auth/logout'), expect.objectContaining({ method: 'POST' }));
    expect(res.headers.get('set-cookie')).toContain('ew_admin_at=;');
  });
});

describe('middleware (route protection & token refresh)', () => {
  const request = (path: string, cookie = '') => new NextRequest(`http://admin.test${path}`, { headers: cookie ? { cookie } : {} });

  it('lets the login page through', async () => {
    const res = await middleware(request('/login'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects to login without a session', async () => {
    const res = await middleware(request('/users'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://admin.test/login');
  });

  it('passes through with a fresh token', async () => {
    const f = jest.spyOn(global, 'fetch');
    const res = await middleware(request('/users', `ew_admin_rt=r; ew_admin_exp=${Date.now() + 10 * 60_000}`));
    expect(res.headers.get('location')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('rotates tokens when close to expiry', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(json(200, { ...tokens, accessToken: 'new-access', refreshToken: 'new-refresh' }));
    const res = await middleware(request('/users', `ew_admin_rt=r; ew_admin_exp=${Date.now() + 10_000}`));
    expect(res.headers.get('set-cookie')).toContain('ew_admin_at=new-access');
  });

  it('clears the session when refresh fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(json(401, { error: { code: 'REFRESH_TOKEN_REUSED' } }));
    const res = await middleware(request('/users', 'ew_admin_rt=stolen; ew_admin_exp=0'));
    expect(res.headers.get('location')).toBe('http://admin.test/login?reason=session');
    expect(res.headers.get('set-cookie')).toContain('ew_admin_rt=;');
  });
});
