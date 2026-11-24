import type { TokenPair } from './session';

export const API_BASE_URL = (process.env.ADMIN_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/+$/, '');

export class BackendError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
  query?: Record<string, string | number | undefined | null>;
  fetchImpl?: typeof fetch;
}

export function withQuery(path: string, query?: FetchOptions['query']): string {
  if (!query) return path;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${path}?${qs}` : path;
}

/** Server-side call to the EmblemWay API. Never used from the browser. */
export async function backendFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${API_BASE_URL}${withQuery(path, opts.query)}`, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BackendError(503, 'BACKEND_UNREACHABLE', 'The EmblemWay API is not reachable.');
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new BackendError(res.status, e?.code ?? 'ERROR', e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return json as T;
}

export interface LoginResult {
  tokens: TokenPair;
  user: { id: string; firstName: string; lastName: string; role: 'USER' | 'ADMIN' | 'SUPER_ADMIN' };
}

export async function adminLogin(email: string, password: string, fetchImpl?: typeof fetch): Promise<LoginResult> {
  const result = await backendFetch<LoginResult>('/auth/admin/login', { method: 'POST', body: { email, password }, fetchImpl });
  if (result.user.role === 'USER') throw new BackendError(403, 'FORBIDDEN', 'This account is not an administrator.');
  return result;
}

export function refreshSession(refreshToken: string, fetchImpl?: typeof fetch): Promise<TokenPair> {
  return backendFetch<TokenPair>('/auth/refresh', { method: 'POST', body: { refreshToken, platform: 'web' }, fetchImpl });
}
