/**
 * Admin session cookies. Tokens are httpOnly (never readable by browser JavaScript, so an
 * XSS bug cannot steal them), SameSite=Strict (CSRF protection) and Secure behind HTTPS.
 */
export const ACCESS_COOKIE = 'ew_admin_at';
export const REFRESH_COOKIE = 'ew_admin_rt';
export const EXPIRY_COOKIE = 'ew_admin_exp';

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface CookieSpec {
  name: string;
  value: string;
  options: { httpOnly: boolean; secure: boolean; sameSite: 'strict'; path: string; expires: Date };
}

export function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.ADMIN_SECURE_COOKIES === 'true';
}

export function sessionCookies(t: TokenPair): CookieSpec[] {
  const base = { httpOnly: true, secure: secureCookies(), sameSite: 'strict' as const, path: '/' };
  const refreshExpires = new Date(t.refreshTokenExpiresAt);
  return [
    { name: ACCESS_COOKIE, value: t.accessToken, options: { ...base, expires: refreshExpires } },
    { name: REFRESH_COOKIE, value: t.refreshToken, options: { ...base, expires: refreshExpires } },
    { name: EXPIRY_COOKIE, value: String(new Date(t.accessTokenExpiresAt).getTime()), options: { ...base, expires: refreshExpires } },
  ];
}

export function clearedCookies(): CookieSpec[] {
  const base = { httpOnly: true, secure: secureCookies(), sameSite: 'strict' as const, path: '/', expires: new Date(0) };
  return [ACCESS_COOKIE, REFRESH_COOKIE, EXPIRY_COOKIE].map((name) => ({ name, value: '', options: base }));
}

/** Refresh slightly before expiry so a request never starts with an about-to-expire token. */
export function needsRefresh(expiryCookie: string | undefined, now = Date.now()): boolean {
  const exp = Number(expiryCookie);
  return !Number.isFinite(exp) || exp - now < 60_000;
}
