import type { TokenStore } from '../auth/tokenStorage';
import type { TokenPair } from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean;
  idempotencyKey?: string;
  formData?: FormData;
  timeoutMs?: number;
}

export interface ApiClientConfig {
  baseUrl: string;
  tokens: TokenStore;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  /** Called once when the session can no longer be refreshed (forces sign-out). */
  onSessionExpired?: () => void;
  deviceInfo?: { deviceId?: string; deviceName?: string; platform?: string };
}

export function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    );
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Thin, typed REST client:
 *  - bearer auth with transparent, single-flight refresh-token rotation
 *  - per-request timeouts and network-error classification
 *  - consistent ApiError objects carrying the backend's machine-readable error codes
 */
export class ApiClient {
  private refreshing: Promise<TokenPair | null> | null = null;

  constructor(private readonly cfg: ApiClientConfig) {}

  /** Resolved per call, so fetch instrumentation installed after start-up is respected. */
  private get fetchImpl(): typeof fetch {
    return this.cfg.fetchImpl ?? globalThis.fetch;
  }

  get<T>(path: string, opts: RequestOptions = {}) {
    return this.request<T>('GET', path, opts);
  }
  post<T>(path: string, body?: unknown, opts: RequestOptions = {}) {
    return this.request<T>('POST', path, { ...opts, body });
  }
  patch<T>(path: string, body?: unknown, opts: RequestOptions = {}) {
    return this.request<T>('PATCH', path, { ...opts, body });
  }
  delete<T>(path: string, body?: unknown, opts: RequestOptions = {}) {
    return this.request<T>('DELETE', path, { ...opts, body });
  }

  async request<T>(
    method: string,
    path: string,
    opts: RequestOptions = {},
    retried = false,
  ): Promise<T> {
    const useAuth = opts.auth !== false;
    const tokens = useAuth ? await this.cfg.tokens.get() : null;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (!opts.formData) headers['Content-Type'] = 'application/json';
    if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    const res = await this.send(
      `${this.cfg.baseUrl}${path}${buildQuery(opts.query)}`,
      {
        method,
        headers,
        body:
          opts.formData ??
          (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      },
      opts.timeoutMs ?? this.cfg.timeoutMs,
    );

    if (res.status === 401 && useAuth && tokens && !retried) {
      const refreshed = await this.refreshTokens();
      if (refreshed) return this.request<T>(method, path, opts, true);
    }
    return this.parse<T>(res);
  }

  /** Ensures concurrent 401s trigger exactly ONE refresh (rotated tokens are single-use). */
  refreshTokens(): Promise<TokenPair | null> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<TokenPair | null> {
    const current = await this.cfg.tokens.get();
    if (!current) return null;
    try {
      const res = await this.send(
        `${this.cfg.baseUrl}/auth/refresh`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            refreshToken: current.refreshToken,
            ...this.cfg.deviceInfo,
          }),
        },
        this.cfg.timeoutMs,
      );
      if (res.status === 401 || res.status === 403) {
        await this.cfg.tokens.clear();
        this.cfg.onSessionExpired?.();
        return null;
      }
      const next = await this.parse<TokenPair>(res);
      await this.cfg.tokens.set(next);
      return next;
    } catch (err) {
      // Network failure during refresh: keep tokens so the user isn't signed out while offline.
      if (err instanceof ApiError && err.isNetworkError) return null;
      throw err;
    }
  }

  private async send(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new ApiError(
          0,
          'TIMEOUT',
          'The server took too long to respond. Check your connection and try again.',
        );
      }
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        'No internet connection. Please check your network and try again.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let body: unknown;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }
    if (res.ok) return body as T;
    const err = (
      body as
        | {
            error?: {
              code?: string;
              message?: string;
              details?: Record<string, unknown>;
              requestId?: string;
            };
          }
        | undefined
    )?.error;
    throw new ApiError(
      res.status,
      err?.code ?? (res.status >= 500 ? 'SERVER_ERROR' : 'UNKNOWN_ERROR'),
      err?.message ??
        (res.status >= 500
          ? 'Something went wrong on our side. Please try again.'
          : 'Request failed'),
      err?.details,
      err?.requestId,
    );
  }
}
