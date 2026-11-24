import { gridCellFor } from '../../src/common/utils/geo.util';
import { HotspotsService } from '../../src/hotspots/hotspots.service';
import {
  MapsProviderError,
  ROUTING_PROVIDER,
  RouteRequest,
  RoutingProvider,
  RoutesResult,
} from '../../src/maps/maps.types';
import { MockRoutingProvider } from '../../src/maps/providers/mock-maps.providers';
import { RedisService } from '../../src/redis/redis.service';
import {
  auth,
  createJourney,
  createTestApp,
  inMinutes,
  PLACES,
  registerUser,
  resetDatabase,
  TestContext,
} from '../utils/test-app';

const coords = (p: { latitude: number; longitude: number }) => ({
  latitude: p.latitude,
  longitude: p.longitude,
});

/** Wraps the mock provider so tests can switch it into failure modes. */
class SwitchableProvider implements RoutingProvider {
  readonly name = 'mock';
  readonly isLive = false;
  mode: 'ok' | 'down' | 'quota' = 'ok';
  calls = 0;
  private readonly inner = new MockRoutingProvider();
  async computeRoutes(req: RouteRequest): Promise<RoutesResult> {
    this.calls += 1;
    if (this.mode === 'down') throw new MapsProviderError('UNAVAILABLE', 'provider down');
    if (this.mode === 'quota') throw new MapsProviderError('QUOTA', 'quota exceeded');
    return this.inner.computeRoutes(req);
  }
}

describe('Traffic prediction & hotspots (integration)', () => {
  let ctx: TestContext;
  const provider = new SwitchableProvider();

  beforeAll(async () => {
    ctx = await createTestApp([{ token: ROUTING_PROVIDER, useValue: provider }]);
  });
  beforeEach(async () => {
    provider.mode = 'ok';
    provider.calls = 0;
    await resetDatabase(ctx);
  });
  afterAll(async () => ctx.close());

  it('returns five labelled scenarios, caches them and stores snapshots', async () => {
    const u = await registerUser(ctx);
    const j = await createJourney(ctx, u).expect(201);
    provider.calls = 0;
    const res = await ctx
      .http()
      .get(`/api/v1/traffic/journeys/${j.body.id}/predictions`)
      .set(auth(u.accessToken))
      .expect(200);
    expect(res.body.estimates.map((e: { scenario: string }) => e.scenario)).toEqual([
      'NOW',
      'PLUS_15_MINUTES',
      'PLUS_30_MINUTES',
      'PLUS_45_MINUTES',
      'PLUS_60_MINUTES',
    ]);
    expect(res.body).toMatchObject({
      provider: 'mock',
      isLiveData: false,
      disclaimer: expect.stringMatching(/not guaranteed/),
    });
    for (const e of res.body.estimates) {
      expect(e).toMatchObject({ status: 'OK', freshness: 'LIVE' });
      expect(e.durationSeconds).toBeGreaterThan(0);
      expect(new Date(e.arrivalAt).getTime() - new Date(e.departureAt).getTime()).toBe(
        e.durationSeconds * 1000,
      );
    }
    expect(provider.calls).toBe(5);
    expect(await ctx.prisma.trafficSnapshot.count({ where: { status: 'OK' } })).toBe(5);

    const cached = await ctx
      .http()
      .get(`/api/v1/traffic/journeys/${j.body.id}/predictions`)
      .set(auth(u.accessToken))
      .expect(200);
    expect(provider.calls).toBe(5);
    expect(
      cached.body.estimates.every((e: { freshness: string }) => e.freshness === 'CACHED'),
    ).toBe(true);
  });

  it('bicycle journeys get honest UNSUPPORTED estimates', async () => {
    const u = await registerUser(ctx);
    const res = await ctx
      .http()
      .post('/api/v1/traffic/predictions')
      .set(auth(u.accessToken))
      .send({
        source: coords(PLACES.baner),
        destination: coords(PLACES.shivajinagar),
        vehicleTypeCode: 'BICYCLE',
      })
      .expect(200);
    expect(
      res.body.estimates.every(
        (e: { status: string; durationSeconds: null }) =>
          e.status === 'UNSUPPORTED' && e.durationSeconds === null,
      ),
    ).toBe(true);
    expect(res.body.recommendation.scenario).toBeNull();
  });

  it('provider outage: stale fallback is labelled, never presented as live', async () => {
    const u = await registerUser(ctx);
    const body = {
      source: coords(PLACES.hinjewadi),
      destination: coords(PLACES.kharadi),
      vehicleTypeCode: 'CAR',
    };
    await ctx
      .http()
      .post('/api/v1/traffic/predictions')
      .set(auth(u.accessToken))
      .send(body)
      .expect(200);
    // Expire the cache so the next request must hit the (now failing) provider.
    const redis = ctx.app.get(RedisService).client;
    const keys = await redis.keys('traffic:*');
    if (keys.length) await redis.del(...keys);
    provider.mode = 'down';
    const res = await ctx
      .http()
      .post('/api/v1/traffic/predictions')
      .set(auth(u.accessToken))
      .send(body)
      .expect(200);
    expect(res.body.estimates.every((e: { freshness: string }) => e.freshness === 'STALE')).toBe(
      true,
    );
    expect(res.body.recommendation.significant).toBe(false);
  });

  it('quota exhaustion with no history: UNAVAILABLE, no fabricated numbers, request still succeeds', async () => {
    const u = await registerUser(ctx);
    provider.mode = 'quota';
    const res = await ctx
      .http()
      .post('/api/v1/traffic/predictions')
      .set(auth(u.accessToken))
      .send({
        source: coords(PLACES.baner),
        destination: coords(PLACES.kharadi),
        vehicleTypeCode: 'CAR',
      })
      .expect(200);
    expect(
      res.body.estimates.every(
        (e: { status: string; durationSeconds: null }) =>
          e.status === 'UNAVAILABLE' && e.durationSeconds === null,
      ),
    ).toBe(true);
    expect(
      await ctx.prisma.trafficSnapshot.count({
        where: { status: 'UNAVAILABLE', errorCode: 'QUOTA' },
      }),
    ).toBe(5);
  });

  it('journey creation fails cleanly (503) when the routing provider is down', async () => {
    const u = await registerUser(ctx);
    provider.mode = 'down';
    const res = await createJourney(ctx, u).expect(503);
    expect(res.body.error.code).toBe('MAPS_PROVIDER_UNAVAILABLE');
    expect(await ctx.prisma.journey.count()).toBe(0);
  });

  it('SQL grid function is identical to the TypeScript implementation', async () => {
    const pts = [
      [18.5204, 73.8567],
      [19.076, 72.8777],
      [12.9716, 77.5946],
      [8.5241, 76.9366],
      [34.0837, 74.7973],
    ];
    for (const size of [250, 500, 1000, 2000]) {
      for (const [lat, lng] of pts) {
        const rows = await ctx.prisma.$queryRaw<
          Array<{ cell_key: string; center_lat: number; center_lng: number }>
        >`SELECT * FROM emblemway_grid_cell(${lat}::float8, ${lng}::float8, ${size}::int)`;
        const ts = gridCellFor({ latitude: lat!, longitude: lng! }, size);
        expect(rows[0]!.cell_key).toBe(ts.key);
        expect(rows[0]!.center_lat).toBeCloseTo(ts.center.latitude, 9);
        expect(rows[0]!.center_lng).toBeCloseTo(ts.center.longitude, 9);
      }
    }
  });

  it('aggregates demand, origin/destination and traffic hotspots separately', async () => {
    const users = await Promise.all(
      [1, 2, 3].map((i) => registerUser(ctx, ['Asha', 'Bala', 'Chetan'][i - 1], 'X')),
    );
    for (const u of users) await createJourney(ctx, u, { departureAt: inMinutes(60) }).expect(201);
    await createJourney(ctx, users[0]!, {
      departureAt: inMinutes(120),
      vehicleTypeCode: 'MOTORCYCLE',
    }).expect(201);
    const cancelled = await createJourney(ctx, users[1]!, {
      departureAt: inMinutes(180),
      source: PLACES.baner,
      destination: PLACES.vimanNagar,
    }).expect(201);
    await ctx
      .http()
      .post(`/api/v1/journeys/${cancelled.body.id}/cancel`)
      .set(auth(users[1]!.accessToken))
      .expect(200);
    // NOW predictions store speed intervals for the traffic model.
    await ctx
      .http()
      .get(`/api/v1/traffic/journeys/${cancelled.body.id}/predictions`)
      .set(auth(users[1]!.accessToken))
      .expect(200);

    const hs = ctx.app.get(HotspotsService);
    const counts = await hs.aggregate();
    expect(counts.JOURNEY_DEMAND).toBeGreaterThan(0);
    expect(counts.ORIGIN).toBeGreaterThan(0);
    expect(counts.TRAFFIC).toBeGreaterThan(0);

    const demand = await ctx
      .http()
      .get('/api/v1/hotspots?model=JOURNEY_DEMAND&city=PUNE')
      .set(auth(users[0]!.accessToken))
      .expect(200);
    expect(demand.body.legend.map((l: { color: string }) => l.color)).toEqual([
      '#2E9E5B',
      '#F2C230',
      '#F08A24',
      '#D93B3B',
    ]);
    expect(demand.body.disclaimer).toMatch(/not the number of vehicles/);
    const maxJourneys = Math.max(...demand.body.cells.map((c: { journeys: number }) => c.journeys));
    expect(maxJourneys).toBe(4); // cancelled journey excluded; each journey counted once per cell
    expect(
      Math.max(...demand.body.cells.map((c: { peakTravellers: number }) => c.peakTravellers)),
    ).toBeLessThanOrEqual(3);

    const moto = await ctx
      .http()
      .get('/api/v1/hotspots?model=JOURNEY_DEMAND&vehicleType=MOTORCYCLE')
      .set(auth(users[0]!.accessToken))
      .expect(200);
    expect(Math.max(...moto.body.cells.map((c: { journeys: number }) => c.journeys))).toBe(1);

    const origins = await ctx
      .http()
      .get('/api/v1/hotspots?model=ORIGIN')
      .set(auth(users[0]!.accessToken))
      .expect(200);
    expect(origins.body.cells).toHaveLength(1);
    expect(origins.body.cells[0].journeys).toBe(4);

    const traffic = await ctx
      .http()
      .get('/api/v1/hotspots?model=TRAFFIC')
      .set(auth(users[0]!.accessToken))
      .expect(200);
    expect(traffic.body.cells.length).toBeGreaterThan(0);
    expect(
      traffic.body.cells.every(
        (c: { congestionIndex: number }) => c.congestionIndex >= 0 && c.congestionIndex <= 1,
      ),
    ).toBe(true);

    const hourly = await ctx
      .http()
      .get('/api/v1/hotspots/hourly?model=JOURNEY_DEMAND')
      .set(auth(users[0]!.accessToken))
      .expect(200);
    expect(hourly.body.hours).toHaveLength(24);

    // Idempotent re-aggregation.
    await hs.aggregate();
    const again = await ctx
      .http()
      .get('/api/v1/hotspots?model=JOURNEY_DEMAND&city=PUNE')
      .set(auth(users[0]!.accessToken))
      .expect(200);
    expect(again.body.cells.length).toBe(demand.body.cells.length);
  });
});
