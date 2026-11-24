import {
  auth,
  createAdmin,
  createJourney,
  createTestApp,
  PLACES,
  registerUser,
  resetDatabase,
  TestContext,
} from '../utils/test-app';

describe('Users, admin, notifications, saved places & schema (integration)', () => {
  let ctx: TestContext;
  const api = '/api/v1';

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => resetDatabase(ctx));
  afterAll(async () => ctx.close());

  describe('database schema & migrations', () => {
    it('has all required tables, PostGIS and spatial indexes', async () => {
      const tables = (
        await ctx.prisma.$queryRaw<
          Array<{ t: string }>
        >`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'`
      ).map((r) => r.t);
      for (const t of [
        'users',
        'user_sessions',
        'otp_verifications',
        'user_profiles',
        'vehicle_types',
        'user_vehicles',
        'journeys',
        'journey_locations',
        'journey_routes',
        'journey_matches',
        'route_segments',
        'traffic_snapshots',
        'hotspot_aggregations',
        'ride_pool_requests',
        'ride_pool_members',
        'notifications',
        'saved_places',
        'audit_logs',
      ])
        expect(tables).toContain(t);
      const gist = await ctx.prisma.$queryRaw<
        Array<{ indexname: string }>
      >`SELECT indexname FROM pg_indexes WHERE indexdef ILIKE '%USING gist%'`;
      expect(gist.map((g) => g.indexname)).toEqual(
        expect.arrayContaining([
          'journey_routes_geom_gix',
          'journey_routes_geog_gix',
          'journey_locations_geom_gix',
        ]),
      );
      const geomType = await ctx.prisma.$queryRaw<
        Array<{ type: string; srid: number }>
      >`SELECT type, srid FROM geometry_columns WHERE f_table_name = 'journey_routes'`;
      expect(geomType[0]).toEqual({ type: 'LINESTRING', srid: 4326 });
      const pending = await ctx.prisma.$queryRaw<
        Array<{ n: bigint }>
      >`SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NULL`;
      expect(Number(pending[0]!.n)).toBe(0);
    });

    it('seeds 11 configurable vehicle categories served by the API', async () => {
      const res = await ctx.http().get(`${api}/vehicle-types`).expect(200);
      expect(res.body.map((v: { code: string }) => v.code)).toEqual([
        'MOTORCYCLE',
        'SCOOTER',
        'CAR',
        'TAXI',
        'AUTO_RICKSHAW',
        'BUS',
        'BICYCLE',
        'ELECTRIC_VEHICLE',
        'VAN',
        'TRUCK',
        'OTHER',
      ]);
    });

    it('rejects a self-match row via CHECK constraint', async () => {
      const u = await registerUser(ctx);
      const j = await createJourney(ctx, u).expect(201);
      await expect(
        ctx.prisma.journeyMatch.create({
          data: {
            journeyId: j.body.id,
            matchedJourneyId: j.body.id,
            matchedUserId: u.userId,
            matchType: 'SAME_ROUTE',
            sharedDistanceMeters: 1,
            overlapRatioSelf: 1,
            overlapRatioOther: 1,
            directionSimilarity: 1,
            departureDiffSeconds: 0,
            convergenceTimeDiffSeconds: 0,
            pickupDistanceMeters: 0,
            destinationDistanceMeters: 0,
            score: 1,
            confidence: 'LOW',
          },
        }),
      ).rejects.toThrow(/journey_matches_not_self_chk/);
    });

    it('health endpoints report database and redis', async () => {
      const res = await ctx.http().get(`${api}/health/ready`).expect(200);
      expect(res.body).toMatchObject({
        ok: true,
        checks: { database: { ok: true }, redis: { ok: true } },
      });
    });
  });

  describe('profile, privacy, export & deletion', () => {
    it('completes profile setup with city and default vehicle', async () => {
      const u = await registerUser(ctx, 'Kavya', 'Iyer');
      const res = await ctx
        .http()
        .patch(`${api}/users/me`)
        .set(auth(u.accessToken))
        .send({
          preferredCityCode: 'PUNE',
          defaultVehicleTypeCode: 'SCOOTER',
          email: 'kavya@example.com',
          completeProfile: true,
        })
        .expect(200);
      expect(res.body).toMatchObject({
        profileComplete: true,
        preferredCity: { code: 'PUNE' },
        defaultVehicleType: { code: 'SCOOTER' },
        email: 'kavya@example.com',
      });
      await ctx
        .http()
        .patch(`${api}/users/me`)
        .set(auth(u.accessToken))
        .send({ firstName: 'K4vya' })
        .expect(400);
      await ctx
        .http()
        .patch(`${api}/users/me`)
        .set(auth(u.accessToken))
        .send({ role: 'ADMIN' })
        .expect(400);
    });

    it('manages user vehicles with a single default', async () => {
      const u = await registerUser(ctx);
      await ctx
        .http()
        .post(`${api}/users/me/vehicles`)
        .set(auth(u.accessToken))
        .send({ vehicleTypeCode: 'CAR', nickname: 'Nexon' })
        .expect(201);
      const second = await ctx
        .http()
        .post(`${api}/users/me/vehicles`)
        .set(auth(u.accessToken))
        .send({ vehicleTypeCode: 'SCOOTER', isDefault: true })
        .expect(201);
      const list = await ctx
        .http()
        .get(`${api}/users/me/vehicles`)
        .set(auth(u.accessToken))
        .expect(200);
      expect(
        list.body
          .filter((v: { isDefault: boolean }) => v.isDefault)
          .map((v: { id: string }) => v.id),
      ).toEqual([second.body.id]);
      await ctx
        .http()
        .post(`${api}/users/me/vehicles`)
        .set(auth(u.accessToken))
        .send({ vehicleTypeCode: 'HOVERCRAFT' })
        .expect(400);
    });

    it('opting out of matching hides the user from others immediately', async () => {
      const a = await registerUser(ctx, 'Alok', 'A');
      const b = await registerUser(ctx, 'Beena', 'B');
      const departureAt = new Date(Date.now() + 2 * 3600_000).toISOString();
      const ja = await createJourney(ctx, a, { departureAt }).expect(201);
      await createJourney(ctx, b, { departureAt }).expect(201);
      expect(
        (await ctx.http().get(`${api}/journeys/${ja.body.id}/matches`).set(auth(a.accessToken)))
          .body.summary.distinctTravellers,
      ).toBe(1);
      await ctx
        .http()
        .patch(`${api}/users/me/preferences`)
        .set(auth(b.accessToken))
        .send({ shareJourneysForMatching: false })
        .expect(200);
      expect(
        (await ctx.http().get(`${api}/journeys/${ja.body.id}/matches`).set(auth(a.accessToken)))
          .body.summary.distinctTravellers,
      ).toBe(0);
    });

    it('hides first names when the traveller chooses', async () => {
      const a = await registerUser(ctx, 'Alok', 'A');
      const b = await registerUser(ctx, 'Beena', 'B');
      await ctx
        .http()
        .patch(`${api}/users/me/preferences`)
        .set(auth(b.accessToken))
        .send({ showFirstNameToMatches: false })
        .expect(200);
      const departureAt = new Date(Date.now() + 2 * 3600_000).toISOString();
      const ja = await createJourney(ctx, a, { departureAt }).expect(201);
      await createJourney(ctx, b, { departureAt }).expect(201);
      const res = await ctx
        .http()
        .get(`${api}/journeys/${ja.body.id}/matches`)
        .set(auth(a.accessToken))
        .expect(200);
      expect(res.body.items[0].traveller.displayName).toBe('EmblemWay traveller');
    });

    it('exports personal data and deletes all location history on account deletion', async () => {
      const u = await registerUser(ctx, 'Del', 'Me');
      await createJourney(ctx, u).expect(201);
      const exp = await ctx
        .http()
        .get(`${api}/users/me/export`)
        .set(auth(u.accessToken))
        .expect(200);
      expect(exp.body.journeys).toHaveLength(1);
      expect(exp.body.journeys[0].locations).toHaveLength(3);
      await ctx.http().delete(`${api}/users/me`).set(auth(u.accessToken)).expect(204);
      expect(await ctx.prisma.journey.count({ where: { userId: u.userId } })).toBe(0);
      expect(await ctx.prisma.journeyLocation.count()).toBe(0);
      const tomb = await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
      expect(tomb).toMatchObject({
        status: 'DELETED',
        phoneE164: null,
        firstName: 'Deleted',
        email: null,
      });
    });

    it('validates avatar uploads by content, not by declared type', async () => {
      const u = await registerUser(ctx);
      await ctx
        .http()
        .post(`${api}/users/me/avatar`)
        .set(auth(u.accessToken))
        .attach('file', Buffer.from('<script>alert(1)</script>'), {
          filename: 'x.png',
          contentType: 'image/png',
        })
        .expect(400);
      const png = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c10000000049454e44ae426082',
        'hex',
      );
      const ok = await ctx
        .http()
        .post(`${api}/users/me/avatar`)
        .set(auth(u.accessToken))
        .attach('file', png, { filename: 'a.png', contentType: 'image/png' })
        .expect(201);
      expect(ok.body.profileImageUrl).toMatch(/\/uploads\/avatars\/[0-9a-f-]{36}\.png$/);
      await ctx.http().delete(`${api}/users/me/avatar`).set(auth(u.accessToken)).expect(200);
    });
  });

  describe('saved places & routes', () => {
    it('saves routes and keeps only one HOME place', async () => {
      const u = await registerUser(ctx);
      await ctx
        .http()
        .post(`${api}/users/me/saved-places`)
        .set(auth(u.accessToken))
        .send({ ...PLACES.baner, label: 'HOME' })
        .expect(201);
      await ctx
        .http()
        .post(`${api}/users/me/saved-places`)
        .set(auth(u.accessToken))
        .send({ ...PLACES.kharadi, label: 'HOME' })
        .expect(201);
      const places = await ctx
        .http()
        .get(`${api}/users/me/saved-places`)
        .set(auth(u.accessToken))
        .expect(200);
      expect(
        places.body
          .filter((p: { label: string }) => p.label === 'HOME')
          .map((p: { name: string }) => p.name),
      ).toEqual(['Kharadi']);

      const r = await ctx
        .http()
        .post(`${api}/users/me/saved-routes`)
        .set(auth(u.accessToken))
        .send({
          name: 'Office',
          source: PLACES.hinjewadi,
          destination: PLACES.kharadi,
          vehicleTypeCode: 'CAR',
          usualDepartureTime: '08:45',
        })
        .expect(201);
      expect(r.body).toMatchObject({
        name: 'Office',
        usualDepartureTime: '08:45',
        vehicleType: { code: 'CAR' },
      });
      await ctx
        .http()
        .post(`${api}/users/me/saved-routes`)
        .set(auth(u.accessToken))
        .send({ name: 'Bad', source: PLACES.baner, destination: PLACES.baner })
        .expect(400);
      await ctx
        .http()
        .post(`${api}/users/me/saved-routes`)
        .set(auth(u.accessToken))
        .send({
          name: 'Bad time',
          source: PLACES.baner,
          destination: PLACES.kharadi,
          usualDepartureTime: '25:00',
        })
        .expect(400);
      const other = await registerUser(ctx);
      await ctx
        .http()
        .delete(`${api}/users/me/saved-routes/${r.body.id}`)
        .set(auth(other.accessToken))
        .expect(404);
      await ctx
        .http()
        .delete(`${api}/users/me/saved-routes/${r.body.id}`)
        .set(auth(u.accessToken))
        .expect(204);
    });
  });

  describe('notifications', () => {
    it('lists, counts unread and marks read; device tokens register', async () => {
      const a = await registerUser(ctx);
      const b = await registerUser(ctx);
      await ctx
        .http()
        .post(`${api}/notifications/devices`)
        .set(auth(a.accessToken))
        .send({ token: 'fcm-token-'.padEnd(40, 'x') })
        .expect(204);
      const departureAt = new Date(Date.now() + 2 * 3600_000).toISOString();
      await createJourney(ctx, a, { departureAt }).expect(201);
      await createJourney(ctx, b, { departureAt }).expect(201);
      const list = await ctx
        .http()
        .get(`${api}/notifications`)
        .set(auth(a.accessToken))
        .expect(200);
      expect(list.body.unreadCount).toBeGreaterThan(0);
      expect(list.body.items[0]).toMatchObject({ type: 'MATCH_FOUND' });
      // Push provider is not configured in tests: stored in-app, marked SKIPPED (never pretend sent).
      expect(
        (await ctx.prisma.notification.findFirstOrThrow({ where: { userId: a.userId } }))
          .pushStatus,
      ).toBe('SKIPPED');
      await ctx
        .http()
        .post(`${api}/notifications/${list.body.items[0].id}/read`)
        .set(auth(a.accessToken))
        .expect(204);
      await ctx.http().post(`${api}/notifications/read-all`).set(auth(a.accessToken)).expect(200);
      expect(
        (await ctx.http().get(`${api}/notifications`).set(auth(a.accessToken))).body.unreadCount,
      ).toBe(0);
      await ctx
        .http()
        .post(`${api}/notifications/${list.body.items[0].id}/read`)
        .set(auth(b.accessToken))
        .expect(404);
    });

    it('respects notification preferences', async () => {
      const a = await registerUser(ctx);
      const b = await registerUser(ctx);
      await ctx
        .http()
        .patch(`${api}/users/me/preferences`)
        .set(auth(a.accessToken))
        .send({ notifyMatches: false })
        .expect(200);
      const departureAt = new Date(Date.now() + 2 * 3600_000).toISOString();
      await createJourney(ctx, a, { departureAt }).expect(201);
      await createJourney(ctx, b, { departureAt }).expect(201);
      expect(
        await ctx.prisma.notification.count({ where: { userId: a.userId, type: 'MATCH_FOUND' } }),
      ).toBe(0);
    });
  });

  describe('admin (RBAC)', () => {
    it('ordinary users cannot reach any admin endpoint', async () => {
      const u = await registerUser(ctx);
      for (const path of [
        'stats/overview',
        'users',
        'journeys',
        'settings',
        'audit-logs',
        'health',
        'hotspots',
      ]) {
        await ctx.http().get(`${api}/admin/${path}`).set(auth(u.accessToken)).expect(403);
      }
      await ctx
        .http()
        .patch(`${api}/admin/settings/matching`)
        .set(auth(u.accessToken))
        .send({ minOverlapRatio: 0.1 })
        .expect(403);
    });

    it('admins see statistics, manage users/journeys and tune matching thresholds (audited)', async () => {
      const admin = await createAdmin(ctx);
      const u = await registerUser(ctx, 'Sanjay', 'Patil');
      const j = await createJourney(ctx, u).expect(201);

      const overview = await ctx
        .http()
        .get(`${api}/admin/stats/overview`)
        .set(auth(admin.token))
        .expect(200);
      expect(overview.body).toMatchObject({
        users: { total: 1 },
        journeys: { total: 1, byStatus: { PLANNED: 1 } },
      });
      const vehicles = await ctx
        .http()
        .get(`${api}/admin/stats/vehicles`)
        .set(auth(admin.token))
        .expect(200);
      expect(vehicles.body.find((v: { code: string }) => v.code === 'CAR').journeys).toBe(1);
      const cities = await ctx
        .http()
        .get(`${api}/admin/stats/cities`)
        .set(auth(admin.token))
        .expect(200);
      expect(cities.body[0]).toMatchObject({ code: 'PUNE', journeys: 1 });
      const popular = await ctx
        .http()
        .get(`${api}/admin/stats/popular-routes`)
        .set(auth(admin.token))
        .expect(200);
      expect(popular.body[0]).toMatchObject({ journeys: 1 });
      await ctx.http().get(`${api}/admin/stats/daily`).set(auth(admin.token)).expect(200);
      await ctx.http().get(`${api}/admin/stats/traffic`).set(auth(admin.token)).expect(200);

      const users = await ctx
        .http()
        .get(`${api}/admin/users?search=sanjay`)
        .set(auth(admin.token))
        .expect(200);
      expect(users.body.items[0]).toMatchObject({ firstName: 'Sanjay', journeys: 1 });
      expect(users.body.items[0].mobileNumberMasked).toMatch(/^\+91 ••••••\d{4}$/);

      const s = await ctx
        .http()
        .patch(`${api}/admin/settings/matching`)
        .set(auth(admin.token))
        .send({ minOverlapRatio: 0.4, departureWindowMinutes: 45 })
        .expect(200);
      expect(s.body).toMatchObject({
        minOverlapRatio: 0.4,
        departureWindowMinutes: 45,
        minSharedDistanceMeters: 2000,
      });
      const bad = await ctx
        .http()
        .patch(`${api}/admin/settings/matching`)
        .set(auth(admin.token))
        .send({ minOverlapRatio: 5 })
        .expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');

      await ctx
        .http()
        .post(`${api}/admin/journeys/${j.body.id}/cancel`)
        .set(auth(admin.token))
        .send({ reason: 'Spam' })
        .expect(200);
      await ctx
        .http()
        .patch(`${api}/admin/users/${u.userId}/status`)
        .set(auth(admin.token))
        .send({ status: 'SUSPENDED' })
        .expect(200);
      // Suspension revokes all sessions, so the user's token is rejected outright.
      await ctx.http().get(`${api}/users/me`).set(auth(u.accessToken)).expect(401);

      const logs = await ctx
        .http()
        .get(`${api}/admin/audit-logs?action=admin.`)
        .set(auth(admin.token))
        .expect(200);
      expect(logs.body.items.map((l: { action: string }) => l.action)).toEqual(
        expect.arrayContaining([
          'admin.settings_updated',
          'admin.journey_cancelled',
          'admin.user_suspended',
        ]),
      );
      const health = await ctx.http().get(`${api}/admin/health`).set(auth(admin.token)).expect(200);
      expect(health.body).toMatchObject({ ok: true, maps: { provider: 'mock', live: false } });
    });

    it('only super admins may run maintenance tasks', async () => {
      const admin = await createAdmin(ctx, 'ADMIN');
      const superAdmin = await createAdmin(ctx, 'SUPER_ADMIN');
      await ctx
        .http()
        .post(`${api}/admin/maintenance/expire-journeys`)
        .set(auth(admin.token))
        .expect(403);
      await ctx
        .http()
        .post(`${api}/admin/maintenance/aggregate-hotspots`)
        .set(auth(superAdmin.token))
        .expect(200);
      await ctx
        .http()
        .post(`${api}/admin/maintenance/unknown`)
        .set(auth(superAdmin.token))
        .expect(404);
    });
  });
});
