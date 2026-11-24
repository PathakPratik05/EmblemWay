import { AppConfigService } from '../../config/app-config.service';
import { FcmPushProvider, NoopPushProvider } from '../../notifications/push.provider';
import { RedisService } from '../../redis/redis.service';
import { toAppError } from '../maps-error.mapper';
import { MapsProviderError } from '../maps.types';
import { QuotaGuard } from './quota.guard';

const sendEachForMulticast = jest.fn();
jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(() => ({ name: 'emblemway' })),
  cert: jest.fn(),
  getApps: jest.fn(() => []),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ sendEachForMulticast })),
}));

function guard(counts: number[], fail = false) {
  let i = 0;
  const redis = {
    incrWithTtl: jest.fn(async () => {
      if (fail) throw new Error('ECONNREFUSED');
      return counts[i++] ?? 1;
    }),
    client: { get: jest.fn(async () => (fail ? Promise.reject(new Error('down')) : '7')) },
  } as unknown as RedisService;
  const config = {
    get: (k: string) => (k === 'GOOGLE_ROUTES_DAILY_QUOTA' ? 100 : 5),
  } as unknown as AppConfigService;
  return new QuotaGuard(redis, config);
}

describe('QuotaGuard', () => {
  it('allows calls within daily quota and rate', async () => {
    await expect(guard([10, 1]).acquire('routes')).resolves.toBeUndefined();
  });
  it('rejects when the daily quota is exhausted', async () => {
    await expect(guard([101, 1]).acquire('routes')).rejects.toMatchObject({ kind: 'QUOTA' });
  });
  it('places get twice the routes quota', async () => {
    await expect(guard([150, 1]).acquire('places')).resolves.toBeUndefined();
  });
  it('rejects bursts above the per-second limit', async () => {
    await expect(guard([1, 6]).acquire('routes')).rejects.toThrow(/Rate limit/);
  });
  it('fails open (with logging) when Redis is down', async () => {
    await expect(guard([], true).acquire('routes')).resolves.toBeUndefined();
    await expect(guard([], true).usage('routes')).resolves.toBe(-1);
    await expect(guard([]).usage('routes')).resolves.toBe(7);
  });
});

describe('maps error mapper', () => {
  it.each([
    ['QUOTA', 503, 'MAPS_QUOTA_EXCEEDED'],
    ['NOT_FOUND', 422, 'ROUTE_NOT_FOUND'],
    ['REJECTED', 502, 'MAPS_REQUEST_REJECTED'],
    ['UNSUPPORTED', 422, 'MAPS_REQUEST_REJECTED'],
    ['TIMEOUT', 503, 'MAPS_PROVIDER_UNAVAILABLE'],
    ['UNAVAILABLE', 503, 'MAPS_PROVIDER_UNAVAILABLE'],
  ] as const)('%s -> %s %s', (kind, status, code) => {
    expect(toAppError(new MapsProviderError(kind, 'x'))).toMatchObject({ status, code });
  });
  it('maps unknown errors to INTERNAL_ERROR without leaking details', () => {
    expect(toAppError(new Error('secret key=abc'))).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Unexpected maps error',
    });
  });
});

describe('push providers', () => {
  it('noop provider reports skipped delivery (never pretends to send)', async () => {
    const p = new NoopPushProvider();
    expect(p.configured).toBe(false);
    await expect(p.send()).resolves.toMatchObject({ delivered: 0, skipped: true });
  });

  it('FCM provider sends to all tokens and reports invalid ones for cleanup', async () => {
    sendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 2,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: false, error: { code: 'messaging/internal-error' } },
      ],
    });
    const p = new FcmPushProvider(Buffer.from('{"project_id":"x"}').toString('base64'));
    const res = await p.send(['t1', 't2', 't3'], { title: 'Hi', body: 'There', data: { a: '1' } });
    expect(res).toEqual({ delivered: 1, failed: 2, invalidTokens: ['t2'], skipped: false });
    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['t1', 't2', 't3'],
        notification: { title: 'Hi', body: 'There' },
      }),
    );
    await expect(p.send([], { title: '', body: '' })).resolves.toMatchObject({ delivered: 0 });
  });
});
