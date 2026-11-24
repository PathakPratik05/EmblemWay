import { MaintenanceService } from '../../src/jobs/maintenance.service';
import {
  auth,
  createJourney,
  createTestApp,
  inMinutes,
  PLACES,
  registerUser,
  resetDatabase,
  TestContext,
  TestUser,
} from '../utils/test-app';

describe('Journeys (integration, real PostgreSQL/PostGIS)', () => {
  let ctx: TestContext;
  let user: TestUser;
  const api = '/api/v1/journeys';

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
    user = await registerUser(ctx, 'Meera', 'Joshi');
  });
  afterAll(async () => ctx.close());

  it('creates a journey with locations, route geometry and segments persisted in PostGIS', async () => {
    const res = await createJourney(ctx, user, {
      pickup: PLACES.baner,
      purpose: 'COMMUTE',
      notes: 'Office',
    }).expect(201);
    expect(res.body).toMatchObject({
      status: 'PLANNED',
      vehicleType: { code: 'CAR' },
      source: { name: 'Hinjewadi Phase 1' },
      destination: { name: 'Kharadi' },
      pickup: { name: 'Baner' },
      version: 1,
      route: { provider: 'mock', isLiveData: false },
    });
    expect(res.body.route.distanceMeters).toBeGreaterThan(20_000);
    expect(res.body.route.encodedPolyline.length).toBeGreaterThan(10);

    const geo = await ctx.prisma.$queryRaw<
      Array<{ srid: number; npts: number; len: number; valid: boolean; type: string }>
    >`
      SELECT ST_SRID(geom) AS srid, ST_NPoints(geom) AS npts, ST_Length(geom::geography) AS len, ST_IsValid(geom) AS valid, GeometryType(geom) AS type
        FROM journey_routes WHERE journey_id = ${res.body.id}::uuid AND is_selected`;
    expect(geo[0]).toMatchObject({ srid: 4326, valid: true, type: 'LINESTRING' });
    expect(Number(geo[0]!.len)).toBeGreaterThan(20_000);
    // Route passes through the pickup (Baner) as a via-waypoint.
    const viaPickup = await ctx.prisma.$queryRaw<Array<{ d: number }>>`
      SELECT ST_Distance(r.geom::geography, ST_SetSRID(ST_MakePoint(${PLACES.baner.longitude}, ${PLACES.baner.latitude}), 4326)::geography) AS d
        FROM journey_routes r WHERE r.journey_id = ${res.body.id}::uuid`;
    expect(Number(viaPickup[0]!.d)).toBeLessThan(5);
    expect(await ctx.prisma.journeyLocation.count({ where: { journeyId: res.body.id } })).toBe(3);
    expect(
      await ctx.prisma.journeyRouteSegment.count({ where: { journeyId: res.body.id } }),
    ).toBeGreaterThan(20);

    const j = await ctx.prisma.journey.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { city: true },
    });
    expect(j.city?.code).toBe('PUNE');
  });

  it('stores departure in UTC and keeps the IST timezone for display', async () => {
    const local = new Date(Date.now() + 2 * 3600_000);
    const ist = new Date(local.getTime() + 330 * 60_000).toISOString().replace('Z', '+05:30');
    const res = await createJourney(ctx, user, { departureAt: ist }).expect(201);
    expect(new Date(res.body.departureAt).getTime()).toBeCloseTo(local.getTime(), -3);
    expect(res.body.departureAt.endsWith('Z')).toBe(true);
    expect(res.body.timezone).toBe('Asia/Kolkata');
  });

  it.each([
    ['identical source/destination', { destination: PLACES.hinjewadi }, 'SAME_SOURCE_DESTINATION'],
    ['past departure', { departureAt: inMinutes(-60) }, 'DEPARTURE_IN_PAST'],
    ['too far in the future', { departureAt: inMinutes(60 * 24 * 120) }, 'DEPARTURE_TOO_FAR'],
    ['departure without offset', { departureAt: '2027-01-01T09:00:00' }, 'VALIDATION_FAILED'],
    ['invalid vehicle category', { vehicleTypeCode: 'SPACESHIP' }, 'INVALID_VEHICLE_TYPE'],
    [
      'outside service area',
      { destination: { name: 'London', latitude: 51.5, longitude: -0.12 } },
      'OUTSIDE_SERVICE_AREA',
    ],
    [
      'invalid latitude',
      { source: { name: 'x', latitude: 120, longitude: 73 } },
      'VALIDATION_FAILED',
    ],
    ['missing departure time', { departureAt: undefined }, 'VALIDATION_FAILED'],
    ['missing destination', { destination: undefined }, 'VALIDATION_FAILED'],
    ['unknown fields', { hack: true }, 'VALIDATION_FAILED'],
  ])('rejects %s', async (_label, body, code) => {
    const res = await createJourney(ctx, user, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
    expect(await ctx.prisma.journey.count()).toBe(0);
  });

  it('is idempotent: duplicate submissions with the same key create one journey', async () => {
    const key = 'retry-key-0001';
    const body = { departureAt: inMinutes(60) }; // a retry sends the identical payload
    const results = await Promise.all([
      createJourney(ctx, user, body, { 'Idempotency-Key': key }),
      createJourney(ctx, user, body, { 'Idempotency-Key': key }),
      createJourney(ctx, user, body, { 'Idempotency-Key': key }),
    ]);
    const created = results.filter((r) => r.status === 201);
    expect(created).toHaveLength(1);
    // Others are either an exact replay (200) or told the original is still in flight (409).
    for (const r of results.filter((x) => x.status !== 201)) {
      expect([200, 409]).toContain(r.status);
      if (r.status === 200) expect(r.body.id).toBe(created[0]!.body.id);
      if (r.status === 409) expect(r.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    }
    const replay = await createJourney(ctx, user, body, { 'Idempotency-Key': key }).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(created[0]!.body.id);
    expect(await ctx.prisma.journey.count()).toBe(1);
  });

  it('rejects reuse of an idempotency key with a different body', async () => {
    await createJourney(ctx, user, {}, { 'Idempotency-Key': 'key-different-body' }).expect(201);
    const res = await createJourney(
      ctx,
      user,
      { vehicleTypeCode: 'BUS' },
      { 'Idempotency-Key': 'key-different-body' },
    ).expect(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('releases the idempotency key when creation fails so the client can retry', async () => {
    await createJourney(
      ctx,
      user,
      { departureAt: inMinutes(-90) },
      { 'Idempotency-Key': 'key-after-failure' },
    ).expect(400);
    expect(await ctx.prisma.idempotencyRecord.count()).toBe(0);
  });

  it('edits with optimistic concurrency and recalculates the route when places change', async () => {
    const created = await createJourney(ctx, user).expect(201);
    const before = created.body.route.distanceMeters as number;
    const updated = await ctx
      .http()
      .patch(`${api}/${created.body.id}`)
      .set(auth(user.accessToken))
      .send({ version: 1, destination: PLACES.vimanNagar })
      .expect(200);
    expect(updated.body.version).toBe(2);
    expect(updated.body.destination.name).toBe('Viman Nagar');
    expect(updated.body.route.distanceMeters).not.toBe(before);

    const stale = await ctx
      .http()
      .patch(`${api}/${created.body.id}`)
      .set(auth(user.accessToken))
      .send({ version: 1, notes: 'lost update' })
      .expect(409);
    expect(stale.body.error).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: 2 },
    });
  });

  it('concurrent edits: exactly one wins', async () => {
    const created = await createJourney(ctx, user).expect(201);
    const results = await Promise.all([
      ctx
        .http()
        .patch(`${api}/${created.body.id}`)
        .set(auth(user.accessToken))
        .send({ version: 1, notes: 'A' }),
      ctx
        .http()
        .patch(`${api}/${created.body.id}`)
        .set(auth(user.accessToken))
        .send({ version: 1, notes: 'B' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await ctx.prisma.journey.findUniqueOrThrow({ where: { id: created.body.id } })).version,
    ).toBe(2);
  });

  it('lifecycle: start -> complete; invalid transitions are refused', async () => {
    const j = await createJourney(ctx, user).expect(201);
    await ctx.http().post(`${api}/${j.body.id}/complete`).set(auth(user.accessToken)).expect(409);
    const started = await ctx
      .http()
      .post(`${api}/${j.body.id}/start`)
      .set(auth(user.accessToken))
      .expect(200);
    expect(started.body.status).toBe('ACTIVE');
    await ctx
      .http()
      .patch(`${api}/${j.body.id}`)
      .set(auth(user.accessToken))
      .send({ version: started.body.version, notes: 'x' })
      .expect(409);
    const done = await ctx
      .http()
      .post(`${api}/${j.body.id}/complete`)
      .set(auth(user.accessToken))
      .expect(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', completedAt: expect.any(String) });
    const again = await ctx
      .http()
      .post(`${api}/${j.body.id}/cancel`)
      .set(auth(user.accessToken))
      .expect(409);
    expect(again.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('cancellation records reason and moves the journey to history', async () => {
    const j = await createJourney(ctx, user).expect(201);
    const c = await ctx
      .http()
      .post(`${api}/${j.body.id}/cancel`)
      .set(auth(user.accessToken))
      .send({ reason: 'Plans changed' })
      .expect(200);
    expect(c.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Plans changed' });
    const upcoming = await ctx.http().get(api).set(auth(user.accessToken)).expect(200);
    expect(upcoming.body.total).toBe(0);
    const history = await ctx
      .http()
      .get(`${api}?scope=history`)
      .set(auth(user.accessToken))
      .expect(200);
    expect(history.body.items.map((x: { id: string }) => x.id)).toEqual([j.body.id]);
  });

  it('drafts are excluded from upcoming and can be published', async () => {
    const d = await createJourney(ctx, user, { saveAsDraft: true }).expect(201);
    expect(d.body.status).toBe('DRAFT');
    expect((await ctx.http().get(api).set(auth(user.accessToken))).body.total).toBe(0);
    expect(
      (await ctx.http().get(`${api}?scope=drafts`).set(auth(user.accessToken))).body.total,
    ).toBe(1);
    const p = await ctx
      .http()
      .post(`${api}/${d.body.id}/publish`)
      .set(auth(user.accessToken))
      .expect(200);
    expect(p.body.status).toBe('PLANNED');
  });

  it('paginates history ordered by most recent departure', async () => {
    for (let i = 1; i <= 5; i += 1) {
      const j = await createJourney(ctx, user, { departureAt: inMinutes(60 * i) }).expect(201);
      await ctx.http().post(`${api}/${j.body.id}/cancel`).set(auth(user.accessToken)).expect(200);
    }
    const page1 = await ctx
      .http()
      .get(`${api}?scope=history&page=1&pageSize=2`)
      .set(auth(user.accessToken))
      .expect(200);
    expect(page1.body).toMatchObject({ total: 5, totalPages: 3, hasNextPage: true });
    const deps = page1.body.items.map((x: { departureAt: string }) => x.departureAt);
    expect(new Date(deps[0]).getTime()).toBeGreaterThan(new Date(deps[1]).getTime());
    expect(page1.body.items[0].route.encodedPolyline).toBeUndefined(); // lists are lightweight
    await ctx.http().get(`${api}?pageSize=500`).set(auth(user.accessToken)).expect(400);
  });

  it('users can never see or modify other users’ journeys', async () => {
    const j = await createJourney(ctx, user).expect(201);
    const other = await registerUser(ctx, 'Other', 'Person');
    await ctx.http().get(`${api}/${j.body.id}`).set(auth(other.accessToken)).expect(404);
    await ctx.http().post(`${api}/${j.body.id}/cancel`).set(auth(other.accessToken)).expect(404);
    await ctx
      .http()
      .patch(`${api}/${j.body.id}`)
      .set(auth(other.accessToken))
      .send({ version: 1 })
      .expect(404);
    expect((await ctx.http().get(api).set(auth(other.accessToken))).body.total).toBe(0);
  });

  it('expiry job expires unstarted journeys and auto-completes stale active ones', async () => {
    const planned = await createJourney(ctx, user).expect(201);
    const active = await createJourney(ctx, user, { departureAt: inMinutes(90) }).expect(201);
    await ctx.http().post(`${api}/${active.body.id}/start`).set(auth(user.accessToken)).expect(200);
    // Move both into the past.
    await ctx.prisma.journey.update({
      where: { id: planned.body.id },
      data: { departureAt: new Date(Date.now() - 5 * 3600_000) },
    });
    await ctx.prisma.journey.update({
      where: { id: active.body.id },
      data: {
        departureAt: new Date(Date.now() - 24 * 3600_000),
        startedAt: new Date(Date.now() - 24 * 3600_000),
      },
    });
    const maintenance = ctx.app.get(MaintenanceService);
    expect(await maintenance.expireStaleJourneys()).toBe(1);
    expect(await maintenance.autoCompleteJourneys()).toBe(1);
    expect(
      (await ctx.prisma.journey.findUniqueOrThrow({ where: { id: planned.body.id } })).status,
    ).toBe('EXPIRED');
    expect(
      (await ctx.prisma.journey.findUniqueOrThrow({ where: { id: active.body.id } })).status,
    ).toBe('COMPLETED');
    const n = await ctx.prisma.notification.findFirst({
      where: { userId: user.userId, type: 'JOURNEY_STATUS' },
    });
    expect(n?.title).toBe('Journey expired');
    // Idempotent: running again changes nothing.
    expect(await maintenance.expireStaleJourneys()).toBe(0);
  });

  it('retention purges precise locations of old finished journeys but keeps history rows', async () => {
    const j = await createJourney(ctx, user).expect(201);
    await ctx.http().post(`${api}/${j.body.id}/cancel`).set(auth(user.accessToken)).expect(200);
    await ctx.prisma.journey.update({
      where: { id: j.body.id },
      data: { departureAt: new Date(Date.now() - 400 * 86_400_000) },
    });
    const res = await ctx.app.get(MaintenanceService).applyRetention();
    expect(res.purgedJourneys).toBe(1);
    expect(await ctx.prisma.journeyLocation.count({ where: { journeyId: j.body.id } })).toBe(0);
    expect(await ctx.prisma.journeyRoute.count({ where: { journeyId: j.body.id } })).toBe(0);
    const view = await ctx
      .http()
      .get(`${api}/${j.body.id}`)
      .set(auth(user.accessToken))
      .expect(200);
    expect(view.body).toMatchObject({
      status: 'CANCELLED',
      locationsPurged: true,
      source: null,
      route: null,
    });
  });
});
