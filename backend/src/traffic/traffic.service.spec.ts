import { VehicleType } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { MapsProviderError, RouteRequest, RoutingProvider, RoutesResult } from '../maps/maps.types';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SettingsService } from '../settings/settings.service';
import { defaultSettings } from '../settings/settings.schema';
import { VehiclesService } from '../vehicles/vehicles.service';
import { freshnessOf, toIntervalGeo, TrafficService } from './traffic.service';
import { encodePolyline } from '../common/utils/geo.util';

const car = {
  id: 'v1',
  code: 'CAR',
  name: 'Car',
  routingProfile: 'DRIVE',
  trafficSupported: true,
  approximationNote: null,
} as VehicleType;
const bicycle = {
  id: 'v2',
  code: 'BICYCLE',
  name: 'Bicycle',
  routingProfile: 'BICYCLE',
  trafficSupported: false,
  approximationNote: 'n/a',
} as VehicleType;
const input = {
  source: { latitude: 18.59, longitude: 73.74 },
  destination: { latitude: 18.55, longitude: 73.93 },
};

class FakeRedis {
  store = new Map<string, unknown>();
  async getJson<T>(k: string): Promise<T | null> {
    return (this.store.get(k) as T) ?? null;
  }
  async setJson(k: string, v: unknown): Promise<void> {
    this.store.set(k, v);
  }
}

function build(provider: RoutingProvider, lastSnapshot: unknown = null) {
  const created: unknown[] = [];
  const prisma = {
    trafficSnapshot: {
      create: jest.fn(async (args: { data: unknown }) => created.push(args.data)),
      findFirst: jest.fn().mockResolvedValue(lastSnapshot),
    },
  } as unknown as PrismaService;
  const redis = new FakeRedis();
  const settings = {
    get: jest.fn(async (k: 'traffic') => defaultSettings(k)),
  } as unknown as SettingsService;
  const config = { get: () => 300 } as unknown as AppConfigService;
  const svc = new TrafficService(
    provider,
    prisma,
    redis as unknown as RedisService,
    settings,
    config,
    {} as VehiclesService,
  );
  return { svc, created, redis };
}

function fixedProvider(
  durationFor: (req: RouteRequest) => number,
): RoutingProvider & { calls: RouteRequest[] } {
  const calls: RouteRequest[] = [];
  return {
    name: 'fake',
    isLive: true,
    calls,
    async computeRoutes(req: RouteRequest): Promise<RoutesResult> {
      calls.push(req);
      return {
        provider: 'fake',
        fetchedAt: new Date(),
        routes: [
          {
            encodedPolyline: encodePolyline([input.source, input.destination]),
            distanceMeters: 21_000,
            durationSeconds: durationFor(req),
            staticDurationSeconds: 1500,
            speedIntervals: null,
            labels: [],
          },
        ],
      };
    },
  };
}

describe('TrafficService', () => {
  const now = new Date('2026-11-25T03:00:00Z');

  beforeAll(() =>
    jest.useFakeTimers({ now, doNotFake: ['setTimeout', 'setImmediate', 'nextTick'] }),
  );
  afterAll(() => jest.useRealTimers());

  it('requests five scenarios with correct departure timestamps and computes delay/arrival', async () => {
    const provider = fixedProvider((r) => (r.departureTime ? 1800 : 2400));
    const { svc, created } = build(provider);
    const res = await svc.predict({ ...input, vehicleType: car }, now);
    expect(res.estimates.map((e) => e.offsetMinutes)).toEqual([0, 15, 30, 45, 60]);
    expect(provider.calls[0]!.departureTime).toBeUndefined(); // "now" is sent without departureTime
    expect(provider.calls[2]!.departureTime!.toISOString()).toBe('2026-11-25T03:30:30.000Z'); // +30 min (+30 s headroom)
    const nowEst = res.estimates[0]!;
    expect(nowEst).toMatchObject({
      status: 'OK',
      durationSeconds: 2400,
      delaySeconds: 900,
      freshness: 'LIVE',
      arrivalAt: '2026-11-25T03:40:00.000Z',
    });
    expect(res.recommendation).toMatchObject({ scenario: 'PLUS_15_MINUTES', significant: true });
    expect(created).toHaveLength(5);
    expect(res.disclaimer).toMatch(/not guaranteed/);
  });

  it('serves repeated requests from cache, labelled CACHED (not LIVE)', async () => {
    const provider = fixedProvider(() => 2000);
    const { svc } = build(provider);
    await svc.predict({ ...input, vehicleType: car }, now);
    const second = await svc.predict({ ...input, vehicleType: car }, now);
    expect(provider.calls).toHaveLength(5);
    expect(second.estimates.every((e) => e.freshness === 'CACHED')).toBe(true);
  });

  it('labels unsupported vehicle types honestly without calling the provider', async () => {
    const provider = fixedProvider(() => 2000);
    const { svc } = build(provider);
    const res = await svc.predict({ ...input, vehicleType: bicycle }, now);
    expect(provider.calls).toHaveLength(0);
    expect(
      res.estimates.every((e) => e.status === 'UNSUPPORTED' && e.durationSeconds === null),
    ).toBe(true);
    expect(res.recommendation.scenario).toBeNull();
  });

  it('handles partial provider failures (some scenarios unavailable)', async () => {
    const provider = fixedProvider((r) => {
      if (r.departureTime && r.departureTime.getTime() > now.getTime() + 40 * 60_000)
        throw new MapsProviderError('UNAVAILABLE', 'down');
      return 2000;
    });
    const { svc } = build(provider);
    const res = await svc.predict({ ...input, vehicleType: car }, now);
    expect(res.estimates.map((e) => e.status)).toEqual([
      'OK',
      'OK',
      'OK',
      'UNAVAILABLE',
      'UNAVAILABLE',
    ]);
    expect(res.estimates[3]!.reason).toMatch(/temporarily unavailable/);
  });

  it('on outage falls back to the last snapshot, clearly labelled STALE', async () => {
    const provider: RoutingProvider = {
      name: 'fake',
      isLive: true,
      computeRoutes: () => Promise.reject(new MapsProviderError('QUOTA', 'quota')),
    };
    const snapshot = {
      durationSeconds: 2222,
      staticDurationSeconds: 1500,
      distanceMeters: 21_000,
      fetchedAt: new Date(now.getTime() - 3600_000),
    };
    const { svc } = build(provider, snapshot);
    const res = await svc.predict({ ...input, vehicleType: car }, now);
    expect(res.estimates.every((e) => e.status === 'OK' && e.freshness === 'STALE')).toBe(true);
    expect(res.estimates[0]!.reason).toMatch(/last known/);
    expect(res.recommendation.significant).toBe(false);
  });

  it('reports UNAVAILABLE (never fabricated numbers) when there is no fallback', async () => {
    const provider: RoutingProvider = {
      name: 'fake',
      isLive: true,
      computeRoutes: () => Promise.reject(new MapsProviderError('QUOTA', 'quota')),
    };
    const { svc } = build(provider, null);
    const res = await svc.predict({ ...input, vehicleType: car }, now);
    expect(
      res.estimates.every((e) => e.status === 'UNAVAILABLE' && e.durationSeconds === null),
    ).toBe(true);
    expect(res.estimates[0]!.reason).toMatch(/quota/i);
  });

  it('freshness classification', () => {
    expect(freshnessOf(new Date(now.getTime() - 60_000).toISOString(), now, 15, true)).toBe(
      'CACHED',
    );
    expect(freshnessOf(new Date(now.getTime() - 60_000).toISOString(), now, 15, false)).toBe(
      'LIVE',
    );
    expect(freshnessOf(new Date(now.getTime() - 16 * 60_000).toISOString(), now, 15, true)).toBe(
      'STALE',
    );
  });

  it('converts speed intervals to sampled coordinates with congestion values', () => {
    const pts = [
      { latitude: 18.5, longitude: 73.8 },
      { latitude: 18.5, longitude: 73.81 },
      { latitude: 18.5, longitude: 73.82 },
    ];
    const res = toIntervalGeo(encodePolyline(pts), [
      { startIndex: 0, endIndex: 1, speed: 'NORMAL' },
      { startIndex: 1, endIndex: 2, speed: 'TRAFFIC_JAM' },
      { startIndex: 5, endIndex: 9, speed: 'SLOW' }, // out of range -> dropped
    ]);
    expect(res.map((r) => r.congestion)).toEqual([0, 1]);
    expect(res[0]!.points.length).toBeGreaterThan(4);
  });
});
