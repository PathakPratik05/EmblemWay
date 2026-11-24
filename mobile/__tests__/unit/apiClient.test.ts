import { ApiClient, ApiError, buildQuery } from '../../src/api/client';
import type { TokenStore } from '../../src/auth/tokenStorage';
import type { TokenPair } from '../../src/api/types';

const pair = (n: number): TokenPair => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  accessTokenExpiresAt: '',
  refreshTokenExpiresAt: '',
  tokenType: 'Bearer',
});

function memoryStore(
  initial: TokenPair | null,
): TokenStore & { value: TokenPair | null } {
  return {
    value: initial,
    async get() {
      return this.value;
    },
    async set(t) {
      this.value = t;
    },
    async clear() {
      this.value = null;
    },
  };
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? '' : JSON.stringify(body), { status });

function setup(
  fetchImpl: jest.Mock,
  tokens = memoryStore(pair(1)),
  onSessionExpired = jest.fn(),
) {
  const client = new ApiClient({
    baseUrl: 'https://api.test/api/v1',
    tokens,
    timeoutMs: 50,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    onSessionExpired,
  });
  return { client, tokens, onSessionExpired };
}

describe('ApiClient', () => {
  it('sends bearer token, JSON body, query string and idempotency key', async () => {
    const f = jest.fn().mockResolvedValue(json(201, { id: 'j1' }));
    const { client } = setup(f);
    await expect(
      client.post(
        '/journeys',
        { a: 1 },
        { idempotencyKey: 'k-123', query: { x: 'y z', skip: undefined } },
      ),
    ).resolves.toEqual({ id: 'j1' });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/api/v1/journeys?x=y%20z');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer access-1',
      'Idempotency-Key': 'k-123',
      'Content-Type': 'application/json',
    });
    expect(init.body).toBe('{"a":1}');
  });

  it('does not send auth for public endpoints', async () => {
    const f = jest.fn().mockResolvedValue(json(200, []));
    const { client } = setup(f);
    await client.get('/vehicle-types', { auth: false });
    expect(
      (f.mock.calls[0] as [string, RequestInit])[1].headers,
    ).not.toHaveProperty('Authorization');
  });

  it('refreshes once on 401 and retries the original request', async () => {
    const f = jest.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return json(200, pair(2));
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer access-2'
        ? json(200, { ok: true })
        : json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
    });
    const { client, tokens } = setup(f as unknown as jest.Mock);
    await expect(client.get('/users/me')).resolves.toEqual({ ok: true });
    expect(tokens.value?.refreshToken).toBe('refresh-2');
  });

  it('uses a single refresh for concurrent 401s (rotated refresh tokens are single-use)', async () => {
    let refreshCalls = 0;
    const f = jest.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await new Promise<void>(r => setTimeout(r, 5));
        return json(200, pair(2));
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer access-2'
        ? json(200, { url })
        : json(401, { error: { code: 'TOKEN_EXPIRED' } });
    });
    const { client } = setup(f as unknown as jest.Mock);
    const results = await Promise.all([
      client.get('/a'),
      client.get('/b'),
      client.get('/c'),
    ]);
    expect(results).toHaveLength(3);
    expect(refreshCalls).toBe(1);
  });

  it('clears tokens and signals session expiry when refresh is rejected', async () => {
    const f = jest.fn(async (url: string) =>
      url.endsWith('/auth/refresh')
        ? json(401, { error: { code: 'REFRESH_TOKEN_REUSED' } })
        : json(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } }),
    );
    const { client, tokens, onSessionExpired } = setup(
      f as unknown as jest.Mock,
    );
    await expect(client.get('/users/me')).rejects.toMatchObject({
      status: 401,
    });
    expect(tokens.value).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when refresh fails because the device is offline', async () => {
    const f = jest.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh'))
        throw new TypeError('Network request failed');
      return json(401, { error: { code: 'TOKEN_EXPIRED' } });
    });
    const { client, tokens, onSessionExpired } = setup(
      f as unknown as jest.Mock,
    );
    await expect(client.get('/users/me')).rejects.toBeInstanceOf(ApiError);
    expect(tokens.value).not.toBeNull();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('classifies network failures and timeouts', async () => {
    const offline = setup(
      jest.fn().mockRejectedValue(new TypeError('Network request failed')),
    ).client;
    await expect(offline.get('/x')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      isNetworkError: true,
    });
    const slow = setup(
      jest.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_res, rej) =>
            init.signal?.addEventListener('abort', () =>
              rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            ),
          ),
      ),
    ).client;
    await expect(slow.get('/x')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('surfaces backend error envelopes and handles non-JSON 5xx', async () => {
    const f = jest
      .fn()
      .mockResolvedValueOnce(
        json(409, {
          error: {
            code: 'VERSION_CONFLICT',
            message: 'changed',
            details: { currentVersion: 3 },
            requestId: 'r1',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response('<html>bad gateway</html>', { status: 502 }),
      );
    const { client } = setup(f);
    await expect(
      client.patch('/journeys/1', { version: 1 }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
      details: { currentVersion: 3 },
      requestId: 'r1',
    });
    await expect(client.get('/x')).rejects.toMatchObject({
      status: 502,
      code: 'SERVER_ERROR',
    });
  });

  it('returns undefined for empty 204 bodies', async () => {
    const { client } = setup(
      jest.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(client.post('/auth/logout')).resolves.toBeUndefined();
  });

  it('buildQuery skips empty values', () => {
    expect(buildQuery({ a: 1, b: '', c: null, d: undefined, e: true })).toBe(
      '?a=1&e=true',
    );
    expect(buildQuery()).toBe('');
  });
});
