import { Prisma } from '@prisma/client';
import { encodePolyline } from '../../src/common/utils/geo.util';
import { MatchingService } from '../../src/matching/matching.service';
import {
  createPlainUser,
  E,
  insertJourney,
  jitter,
  line,
  offsetNorth,
  path,
} from '../utils/geometry-fixtures';
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

describe('Route matching engine (integration, real PostGIS geometry)', () => {
  let ctx: TestContext;
  let matching: MatchingService;
  let a: string; // user A
  let b: string; // user B

  beforeAll(async () => {
    ctx = await createTestApp();
    matching = ctx.app.get(MatchingService);
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
    a = await createPlainUser(ctx, 'Anil');
    b = await createPlainUser(ctx, 'Bhavna');
  });
  afterAll(async () => ctx.close());

  const matchFor = async (journeyId: string, other: string) =>
    (await matching.computeAndStore(journeyId)).find((m) => m.matchedJourneyId === other);

  it('same source & destination: SAME_ROUTE with ~100 % overlap, stored for both travellers', async () => {
    const ja = await insertJourney(ctx, { userId: a, points: line(E(0), E(10)) });
    const jb = await insertJourney(ctx, {
      userId: b,
      points: line(E(0), E(10)),
      departureAt: new Date(Date.now() + 3600_000 + 5 * 60_000),
    });
    const m = await matchFor(ja, jb);
    expect(m).toMatchObject({ matchType: 'SAME_ROUTE', confidence: 'HIGH' });
    expect(m!.overlapRatioSelf).toBeGreaterThan(0.97);
    expect(m!.directionSimilarity).toBeGreaterThan(0.97);
    expect(m!.sharedDistanceMeters).toBeGreaterThan(9_500);
    expect(m!.departureDiffSeconds).toBe(-300);
    const rows = await ctx.prisma.journeyMatch.findMany();
    expect(rows.map((r) => `${r.journeyId}>${r.matchedJourneyId}`).sort()).toEqual(
      [`${ja}>${jb}`, `${jb}>${ja}`].sort(),
    );
  });

  it('rejects opposite-direction travel on the same road', async () => {
    const ja = await insertJourney(ctx, { userId: a, points: line(E(0), E(10)) });
    await insertJourney(ctx, { userId: b, points: line(E(10), E(0)) });
    expect(await matching.computeAndStore(ja)).toHaveLength(0);
  });

  it('same destination, different starting points: converging routes', async () => {
    // B starts 3 km north and joins A's road at km 4.
    const ja = await insertJourney(ctx, { userId: a, points: line(E(0), E(12)) });
    const jb = await insertJourney(ctx, {
      userId: b,
      points: path(line(E(4, 3), E(4)), line(E(4), E(12))),
      departureAt: new Date(Date.now() + 3600_000 + 2 * 60_000),
    });
    const m = await matchFor(ja, jb);
    expect(m?.matchType).toBe('SAME_DESTINATION');
    expect(m!.sharedDistanceMeters).toBeGreaterThan(7_500);
    expect(m!.sharedDistanceMeters).toBeLessThan(8_300);
    expect(m!.overlapRatioOther).toBeGreaterThan(0.7);
  });

  it('different destinations with a shared initial route: SHARED_START', async () => {
    const ja = await insertJourney(ctx, {
      userId: a,
      points: path(line(E(0), E(6)), line(E(6), E(6, 6))),
    }); // turns north
    const jb = await insertJourney(ctx, {
      userId: b,
      points: path(line(E(0), E(6)), line(E(6), E(6, -6))),
    }); // turns south
    const m = await matchFor(ja, jb);
    expect(m?.matchType).toBe('SHARED_START');
    expect(m!.sharedDistanceMeters).toBeGreaterThan(5_700);
    expect(m!.sharedDistanceMeters).toBeLessThan(6_200);
  });

  it('partial overlap in the middle of both routes', async () => {
    const ja = await insertJourney(ctx, {
      userId: a,
      points: path(line(E(0, -4), E(0)), line(E(0), E(8)), line(E(8), E(8, 4))),
    });
    const jb = await insertJourney(ctx, {
      userId: b,
      points: path(line(E(-3, 3), E(0)), line(E(0), E(8)), line(E(8), E(11, -3))),
    });
    const m = await matchFor(ja, jb);
    expect(m?.matchType).toBe('PARTIAL_OVERLAP');
    expect(m!.sharedDistanceMeters).toBeGreaterThan(7_600);
    expect(m!.sharedDistanceMeters).toBeLessThan(8_400);
  });

  it('a parallel road 150 m away is not the same route', async () => {
    const ja = await insertJourney(ctx, { userId: a, points: line(E(0), E(10)) });
    await insertJourney(ctx, { userId: b, points: offsetNorth(line(E(0), E(10)), 150) });
    expect(await matching.computeAndStore(ja)).toHaveLength(0);
  });

  it('only a small shared segment (< 2 km) is rejected', async () => {
    const ja = await insertJourney(ctx, {
      userId: a,
      points: path(line(E(0), E(5)), line(E(5), E(6)), line(E(6), E(6, 8))),
    });
    await insertJourney(ctx, {
      userId: b,
      points: path(line(E(5, -8), E(5)), line(E(5), E(6)), line(E(6), E(14))),
    });
    expect(await matching.computeAndStore(ja)).toHaveLength(0);
  });

  it('routes that diverge and converge again: both shared stretches counted, nothing twice', async () => {
    // Shared 0-4 km, B detours 2 km north for 4 km, shared again 8-12 km.
    const ja = await insertJourney(ctx, { userId: a, points: line(E(0), E(12)) });
    const jb = await insertJourney(ctx, {
      userId: b,
      points: path(
        line(E(0), E(4)),
        line(E(4), E(4, 2)),
        line(E(4, 2), E(8, 2)),
        line(E(8, 2), E(8)),
        line(E(8), E(12)),
      ),
    });
    const m = await matchFor(ja, jb);
    expect(m).toBeDefined();
    expect(m!.sharedDistanceMeters).toBeGreaterThan(7_600);
    expect(m!.sharedDistanceMeters).toBeLessThan(8_400);
  });

  it('tolerates GPS inaccuracy (±15 m jitter) on the same road', async () => {
    const ja = await insertJourney(ctx, { userId: a, points: line(E(0), E(8)) });
    const jb = await insertJourney(ctx, { userId: b, points: jitter(line(E(0), E(8)), 15) });
    const m = await matchFor(ja, jb);
    expect(m?.matchType).toBe('SAME_ROUTE');
    expect(m!.overlapRatioSelf).toBeGreaterThan(0.9);
  });

  it('roundabout: a small loop on one route does not break the match', async () => {
    const loop = [E(4), E(4.15, 0.1), E(4.3, 0), E(4.15, -0.1), E(4)];
    const ja = await insertJourney(ctx, { userId: a, points: line(E(0), E(8)) });
    const jb = await insertJourney(ctx, {
      userId: b,
      points: path(line(E(0), E(4)), loop, line(E(4), E(8))),
    });
    const m = await matchFor(ja, jb);
    expect(m).toBeDefined();
    expect(m!.directionSimilarity).toBeGreaterThan(0.8);
    expect(m!.sharedDistanceMeters).toBeGreaterThan(7_000);
  });

  it('self-crossing route is measured without double counting', async () => {
    // B goes east 0->6, loops north and back across its own path, then continues to 10.
    const ja = await insertJourney(ctx, { userId: a, points: line(E(0), E(10)) });
    const jb = await insertJourney(ctx, {
      userId: b,
      points: path(
        line(E(0), E(6)),
        line(E(6), E(6, 2)),
        line(E(6, 2), E(4, 2)),
        line(E(4, 2), E(4, -1)),
        line(E(4, -1), E(7, -1)),
        line(E(7, -1), E(7)),
        line(E(7), E(10)),
      ),
    });
    const m = await matchFor(ja, jb);
    expect(m).toBeDefined();
    expect(m!.sharedDistanceMeters).toBeLessThanOrEqual(10_000);
    expect(m!.overlapRatioSelf).toBeLessThanOrEqual(1);
    expect(m!.sharedDistanceMeters).toBeGreaterThan(8_000);
  });

  it('departure-time compatibility uses the time both reach the shared stretch', async () => {
    const ja = await insertJourney(ctx, {
      userId: a,
      points: line(E(0), E(10)),
      departureAt: new Date(Date.now() + 3600_000),
    });
    await insertJourney(ctx, {
      userId: b,
      points: line(E(0), E(10)),
      departureAt: new Date(Date.now() + 3 * 3600_000),
    });
    expect(await matching.computeAndStore(ja)).toHaveLength(0);
  });

  it('Mumbai → Bengaluru, Pune → Bengaluru, Mumbai → Pune: overlaps follow actual road geometry', async () => {
    const mumbai = { latitude: 19.076, longitude: 72.8777 };
    const pune = { latitude: 18.5204, longitude: 73.8567 };
    const bengaluru = { latitude: 12.9716, longitude: 77.5946 };
    const c = await createPlainUser(ctx, 'Chirag');
    const t0 = new Date(Date.now() + 3600_000);
    // Speeds of 60 km/h: A reaches Pune ~2 h after leaving Mumbai, so B leaves Pune then.
    const mToP = line(mumbai, pune);
    const pToB = line(pune, bengaluru);
    const ja = await insertJourney(ctx, {
      userId: a,
      points: path(mToP, pToB),
      departureAt: t0,
      speedKmh: 60,
    });
    const jb = await insertJourney(ctx, {
      userId: b,
      points: pToB,
      departureAt: new Date(t0.getTime() + 2 * 3600_000),
      speedKmh: 60,
    });
    const jc = await insertJourney(ctx, {
      userId: c,
      points: mToP,
      departureAt: new Date(t0.getTime() + 5 * 60_000),
      speedKmh: 60,
    });

    const forA = await matching.computeAndStore(ja);
    const ab = forA.find((m) => m.matchedJourneyId === jb);
    const ac = forA.find((m) => m.matchedJourneyId === jc);
    expect(ab).toBeDefined();
    expect(ab!.overlapRatioOther).toBeGreaterThan(0.95); // all of B's trip is on A's road
    // B's whole trip lies on A's road and they end together: SAME_ROUTE once A's overlap
    // passes the 85 % threshold, otherwise SAME_DESTINATION.
    expect(['SAME_ROUTE', 'SAME_DESTINATION']).toContain(ab!.matchType);
    expect(Math.abs(ab!.convergenceTimeDiffSeconds)).toBeLessThan(30 * 60);
    expect(ac).toBeDefined();
    expect(ac!.overlapRatioOther).toBeGreaterThan(0.95); // all of C's trip is on A's road
    expect(ac!.matchType).toBe('SHARED_START');

    // B and C only touch at Pune - a point, not a shared road.
    const forB = await matching.computeAndStore(jb);
    expect(forB.find((m) => m.matchedJourneyId === jc)).toBeUndefined();
  });

  it('excludes cancelled, completed and draft journeys from matching', async () => {
    const ja = await insertJourney(ctx, { userId: a, points: line(E(0), E(10)) });
    for (const status of ['CANCELLED', 'COMPLETED', 'DRAFT', 'EXPIRED'] as const) {
      const u = await createPlainUser(ctx, status);
      await insertJourney(ctx, { userId: u, points: line(E(0), E(10)), status });
    }
    expect(await matching.computeAndStore(ja)).toHaveLength(0);
  });

  it('never matches a user with themselves', async () => {
    const ja = await insertJourney(ctx, { userId: a, points: line(E(0), E(10)) });
    await insertJourney(ctx, { userId: a, points: line(E(0), E(10)) });
    expect(await matching.computeAndStore(ja)).toHaveLength(0);
  });

  it('users who opted out of matching are invisible to others', async () => {
    const hidden = await createPlainUser(ctx, 'Hidden', false);
    const ja = await insertJourney(ctx, { userId: a, points: line(E(0), E(10)) });
    await insertJourney(ctx, { userId: hidden, points: line(E(0), E(10)) });
    expect(await matching.computeAndStore(ja)).toHaveLength(0);
  });

  it('journey without route geometry is handled gracefully', async () => {
    const vehicle = await ctx.prisma.vehicleType.findUniqueOrThrow({ where: { code: 'CAR' } });
    const j = await ctx.prisma.journey.create({
      data: { userId: a, vehicleTypeId: vehicle.id, departureAt: new Date(Date.now() + 3600_000) },
    });
    await expect(matching.computeAndStore(j.id)).resolves.toEqual([]);
  });

  it('database rejects zero-length and invalid route geometry', async () => {
    const ja = await insertJourney(ctx, { userId: a, points: line(E(0), E(1)) });
    const p = E(0);
    const zero = encodePolyline([p, p]);
    await expect(
      ctx.prisma
        .$executeRaw`INSERT INTO journey_routes (journey_id, is_selected, provider, routing_profile, encoded_polyline, geom, distance_meters, duration_seconds)
        VALUES (${ja}::uuid, false, 'x', 'DRIVE', ${zero}, ST_LineFromEncodedPolyline(${zero}, 5), 1, 1)`,
    ).rejects.toThrow(/journey_routes_geom_chk/);
    await expect(
      ctx.prisma
        .$executeRaw`INSERT INTO journey_routes (journey_id, is_selected, provider, routing_profile, encoded_polyline, geom, distance_meters, duration_seconds)
        VALUES (${ja}::uuid, false, 'x', 'DRIVE', 'x', ST_GeomFromText('LINESTRING(73.8 18.5, 73.9 18.5)', 3857), 1, 1)`,
    ).rejects.toThrow();
    await expect(
      ctx.prisma
        .$executeRaw`INSERT INTO journey_routes (journey_id, is_selected, provider, routing_profile, encoded_polyline, geom, distance_meters, duration_seconds)
        VALUES (${ja}::uuid, true, 'x', 'DRIVE', 'x', ST_GeomFromText('LINESTRING(73.8 18.5, 73.9 18.5)', 4326), 1, 1)`,
    ).rejects.toThrow(/23505|already exists/); // a second *selected* route violates the partial unique index
  });

  describe('API: counts, deduplication and filters', () => {
    it('deduplicates per traveller and reports vehicle-wise and type counts', async () => {
      const me = await registerUser(ctx, 'Me', 'Traveller');
      const mine = await createJourney(ctx, me, {
        source: { ...PLACES.hinjewadi },
        destination: { ...PLACES.kharadi },
      }).expect(201);
      const route = await ctx.prisma.journeyRoute.findFirstOrThrow({
        where: { journeyId: mine.body.id, isSelected: true },
      });
      const { decodePolyline } = await import('../../src/common/utils/geo.util');
      const pts = decodePolyline(route.encodedPolyline);
      // B has TWO matching journeys (car + motorcycle); C has one on a motorcycle.
      await insertJourney(ctx, { userId: b, points: pts, vehicleCode: 'CAR' });
      await insertJourney(ctx, {
        userId: b,
        points: pts,
        vehicleCode: 'MOTORCYCLE',
        departureAt: new Date(Date.now() + 3600_000 + 10 * 60_000),
      });
      const c = await createPlainUser(ctx, 'Chitra');
      await insertJourney(ctx, {
        userId: c,
        points: pts.slice(Math.floor(pts.length / 2)),
        vehicleCode: 'MOTORCYCLE',
      });
      // Fixtures bypass the API, so trigger the computation a new journey would normally cause.
      await matching.computeAndStore(mine.body.id);

      const res = await ctx
        .http()
        .get(`/api/v1/journeys/${mine.body.id}/matches`)
        .set(auth(me.accessToken))
        .expect(200);
      expect(res.body.summary).toMatchObject({ totalMatchingJourneys: 3, distinctTravellers: 2 });
      expect(res.body.items).toHaveLength(2);
      expect(
        new Set(
          res.body.items.map(
            (i: { traveller: { displayName: string } }) => i.traveller.displayName,
          ),
        ),
      ).toEqual(new Set(['Bhavna', 'Chitra']));
      const byVehicle = Object.fromEntries(
        res.body.summary.byVehicleType.map((v: { code: string; travellers: number }) => [
          v.code,
          v.travellers,
        ]),
      );
      expect(byVehicle).toEqual({ CAR: 1, MOTORCYCLE: 2 });
      expect(res.body.summary.sameRouteTravellers + res.body.summary.partialOverlapTravellers).toBe(
        2,
      );
      expect(res.body.summary.disclaimer).toMatch(/not a measure of all vehicles/);
      // Private data is never exposed.
      const dump = JSON.stringify(res.body);
      expect(dump).not.toMatch(/\+91\d{10}/);
      expect(dump).not.toContain('phone');

      const filtered = await ctx
        .http()
        .get(`/api/v1/journeys/${mine.body.id}/matches?vehicleTypes=CAR`)
        .set(auth(me.accessToken))
        .expect(200);
      expect(filtered.body.summary.distinctTravellers).toBe(1);
      const highOverlap = await ctx
        .http()
        .get(`/api/v1/journeys/${mine.body.id}/matches?minOverlap=0.9`)
        .set(auth(me.accessToken))
        .expect(200);
      expect(
        highOverlap.body.items.every(
          (i: { overlapRatioSelf: number; overlapRatioOther: number }) =>
            Math.max(i.overlapRatioSelf, i.overlapRatioOther) >= 0.9,
        ),
      ).toBe(true);

      // Segment counts: each traveller is counted at most once per segment.
      const seg = await ctx
        .http()
        .get(`/api/v1/journeys/${mine.body.id}/segments`)
        .set(auth(me.accessToken))
        .expect(200);
      expect(seg.body.segments.length).toBeGreaterThan(10);
      expect(Math.max(...seg.body.segments.map((s: { travellers: number }) => s.travellers))).toBe(
        0,
      ); // fixtures inserted without segments
    });

    it('concurrent journey creation: both travellers see each other exactly once', async () => {
      const u1 = await registerUser(ctx, 'One', 'X');
      const u2 = await registerUser(ctx, 'Two', 'Y');
      const departureAt = inMinutes(90);
      const [r1, r2] = await Promise.all([
        createJourney(ctx, u1, { departureAt }),
        createJourney(ctx, u2, { departureAt }),
      ]);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      const m1 = await ctx
        .http()
        .get(`/api/v1/journeys/${r1.body.id}/matches`)
        .set(auth(u1.accessToken))
        .expect(200);
      const m2 = await ctx
        .http()
        .get(`/api/v1/journeys/${r2.body.id}/matches`)
        .set(auth(u2.accessToken))
        .expect(200);
      expect(m1.body.summary.distinctTravellers).toBe(1);
      expect(m2.body.summary.distinctTravellers).toBe(1);
      const dupes = await ctx.prisma.$queryRaw<Array<{ n: bigint }>>(
        Prisma.sql`SELECT count(*) AS n FROM journey_matches GROUP BY journey_id, matched_journey_id HAVING count(*) > 1`,
      );
      expect(dupes).toHaveLength(0);
      // Segment counts now include the other traveller.
      const seg = await ctx
        .http()
        .get(`/api/v1/journeys/${r1.body.id}/segments`)
        .set(auth(u1.accessToken))
        .expect(200);
      expect(Math.max(...seg.body.segments.map((s: { travellers: number }) => s.travellers))).toBe(
        1,
      );
    });

    it('cancelling a journey removes it from the other traveller’s counts; route recalculation updates matches', async () => {
      const u1 = await registerUser(ctx, 'One', 'X');
      const u2 = await registerUser(ctx, 'Two', 'Y');
      const departureAt = inMinutes(90);
      const j1 = await createJourney(ctx, u1, { departureAt }).expect(201);
      const j2 = await createJourney(ctx, u2, { departureAt }).expect(201);
      expect(
        (await ctx.http().get(`/api/v1/journeys/${j1.body.id}/matches`).set(auth(u1.accessToken)))
          .body.summary.distinctTravellers,
      ).toBe(1);

      // Recalculate u2's route to a non-overlapping trip (opposite direction).
      await ctx
        .http()
        .patch(`/api/v1/journeys/${j2.body.id}`)
        .set(auth(u2.accessToken))
        .send({ version: 1, source: PLACES.kharadi, destination: PLACES.hinjewadi })
        .expect(200);
      expect(
        (await ctx.http().get(`/api/v1/journeys/${j1.body.id}/matches`).set(auth(u1.accessToken)))
          .body.summary.distinctTravellers,
      ).toBe(0);

      await ctx
        .http()
        .patch(`/api/v1/journeys/${j2.body.id}`)
        .set(auth(u2.accessToken))
        .send({ version: 2, source: PLACES.hinjewadi, destination: PLACES.kharadi })
        .expect(200);
      expect(
        (await ctx.http().get(`/api/v1/journeys/${j1.body.id}/matches`).set(auth(u1.accessToken)))
          .body.summary.distinctTravellers,
      ).toBe(1);

      await ctx
        .http()
        .post(`/api/v1/journeys/${j2.body.id}/cancel`)
        .set(auth(u2.accessToken))
        .expect(200);
      const after = await ctx
        .http()
        .get(`/api/v1/journeys/${j1.body.id}/matches`)
        .set(auth(u1.accessToken))
        .expect(200);
      expect(after.body.summary).toMatchObject({ totalMatchingJourneys: 0, distinctTravellers: 0 });
      expect(after.body.items).toEqual([]);
    });

    it('cannot read matches of someone else’s journey', async () => {
      const u1 = await registerUser(ctx, 'One', 'X');
      const u2 = await registerUser(ctx, 'Two', 'Y');
      const j1 = await createJourney(ctx, u1).expect(201);
      await ctx
        .http()
        .get(`/api/v1/journeys/${j1.body.id}/matches`)
        .set(auth(u2.accessToken))
        .expect(404);
      await ctx
        .http()
        .get(`/api/v1/journeys/${j1.body.id}/segments`)
        .set(auth(u2.accessToken))
        .expect(404);
    });

    it('a new match notifies the other traveller once', async () => {
      const u1 = await registerUser(ctx, 'One', 'X');
      const u2 = await registerUser(ctx, 'Two', 'Y');
      const departureAt = inMinutes(90);
      const j1 = await createJourney(ctx, u1, { departureAt }).expect(201);
      await createJourney(ctx, u2, { departureAt }).expect(201);
      await matching.computeAndStore(j1.body.id); // recompute must not re-notify
      const n = await ctx.prisma.notification.findMany({
        where: { userId: u1.userId, type: 'MATCH_FOUND' },
      });
      expect(n.filter((x) => x.title === 'New traveller on your route')).toHaveLength(1);
    });
  });
});
