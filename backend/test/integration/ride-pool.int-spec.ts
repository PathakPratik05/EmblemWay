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

describe('Ride pooling (integration)', () => {
  let ctx: TestContext;
  let driver: TestUser;
  let driverJourney: string;
  const departureAt = () => inMinutes(120);

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
    driver = await registerUser(ctx, 'Dev', 'Driver');
    driverJourney = (await createJourney(ctx, driver, { departureAt: departureAt() }).expect(201))
      .body.id;
  });
  afterAll(async () => ctx.close());

  async function rider(name: string) {
    const u = await registerUser(ctx, name, 'Rider');
    const j = await createJourney(ctx, u, { departureAt: departureAt() }).expect(201);
    return { user: u, journeyId: j.body.id as string };
  }

  const offer = (seats: number) =>
    ctx
      .http()
      .post(`/api/v1/journeys/${driverJourney}/ride-pool/offer`)
      .set(auth(driver.accessToken))
      .send({ totalSeats: seats });

  it('full flow: offer → request → accept; contact details are never exposed', async () => {
    const o = await offer(2).expect(201);
    const r = await rider('Riya');
    const req = await ctx
      .http()
      .post(`/api/v1/ride-pool/offers/${o.body.id}/requests`)
      .set(auth(r.user.accessToken))
      .send({ journeyId: r.journeyId, message: 'Near Baner' })
      .expect(201);
    const view = await ctx
      .http()
      .get(`/api/v1/ride-pool/offers/${o.body.id}`)
      .set(auth(driver.accessToken))
      .expect(200);
    expect(view.body.requests[0]).toMatchObject({
      status: 'PENDING',
      requester: { displayName: 'Riya' },
    });
    expect(JSON.stringify(view.body)).not.toMatch(/\+91|phone/);

    await ctx
      .http()
      .post(`/api/v1/ride-pool/requests/${req.body.id}/accept`)
      .set(auth(driver.accessToken))
      .expect(200);
    const after = await ctx.prisma.ridePoolOffer.findUniqueOrThrow({ where: { id: o.body.id } });
    expect(after.availableSeats).toBe(1);
    expect(await ctx.prisma.ridePoolMember.count({ where: { offerId: o.body.id } })).toBe(1);
    const note = await ctx.prisma.notification.findFirst({
      where: { userId: r.user.userId, type: 'RIDE_POOL' },
    });
    expect(note?.title).toBe('Seat request accepted');
  });

  it('matching journeys alone do not make anyone a pool member', async () => {
    await rider('Sam');
    expect(await ctx.prisma.ridePoolMember.count()).toBe(0);
    expect(await ctx.prisma.ridePoolRequest.count()).toBe(0);
  });

  it('prevents overbooking under concurrent accepts', async () => {
    const o = await offer(1).expect(201);
    const riders = await Promise.all(['Ana', 'Ben', 'Cal'].map(rider));
    const reqs = await Promise.all(
      riders.map((r) =>
        ctx
          .http()
          .post(`/api/v1/ride-pool/offers/${o.body.id}/requests`)
          .set(auth(r.user.accessToken))
          .send({ journeyId: r.journeyId })
          .expect(201),
      ),
    );
    const results = await Promise.all(
      reqs.map((r) =>
        ctx
          .http()
          .post(`/api/v1/ride-pool/requests/${r.body.id}/accept`)
          .set(auth(driver.accessToken)),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'POOL_FULL'),
    ).toBe(true);
    const after = await ctx.prisma.ridePoolOffer.findUniqueOrThrow({ where: { id: o.body.id } });
    expect(after).toMatchObject({ availableSeats: 0, status: 'FULL' });
    expect(await ctx.prisma.ridePoolMember.count()).toBe(1);
  });

  it('withdrawing an accepted request frees the seat and reopens the offer', async () => {
    const o = await offer(1).expect(201);
    const r = await rider('Wen');
    const req = await ctx
      .http()
      .post(`/api/v1/ride-pool/offers/${o.body.id}/requests`)
      .set(auth(r.user.accessToken))
      .send({ journeyId: r.journeyId })
      .expect(201);
    await ctx
      .http()
      .post(`/api/v1/ride-pool/requests/${req.body.id}/accept`)
      .set(auth(driver.accessToken))
      .expect(200);
    await ctx
      .http()
      .post(`/api/v1/ride-pool/requests/${req.body.id}/withdraw`)
      .set(auth(r.user.accessToken))
      .expect(200);
    expect(
      await ctx.prisma.ridePoolOffer.findUniqueOrThrow({ where: { id: o.body.id } }),
    ).toMatchObject({ availableSeats: 1, status: 'OPEN' });
    await ctx
      .http()
      .post(`/api/v1/ride-pool/requests/${req.body.id}/withdraw`)
      .set(auth(r.user.accessToken))
      .expect(409);
  });

  it('rejects invalid requests: own ride, non-matching journey, duplicate, wrong owner deciding', async () => {
    const o = await offer(2).expect(201);
    await ctx
      .http()
      .post(`/api/v1/ride-pool/offers/${o.body.id}/requests`)
      .set(auth(driver.accessToken))
      .send({ journeyId: driverJourney })
      .expect(400);

    const opposite = await registerUser(ctx, 'Opp', 'Site');
    const oj = await createJourney(ctx, opposite, {
      source: PLACES.kharadi,
      destination: PLACES.hinjewadi,
      departureAt: departureAt(),
    }).expect(201);
    const nm = await ctx
      .http()
      .post(`/api/v1/ride-pool/offers/${o.body.id}/requests`)
      .set(auth(opposite.accessToken))
      .send({ journeyId: oj.body.id })
      .expect(422);
    expect(nm.body.error.code).toBe('POOL_REQUEST_INVALID');

    const r = await rider('Dup');
    const req = await ctx
      .http()
      .post(`/api/v1/ride-pool/offers/${o.body.id}/requests`)
      .set(auth(r.user.accessToken))
      .send({ journeyId: r.journeyId })
      .expect(201);
    await ctx
      .http()
      .post(`/api/v1/ride-pool/offers/${o.body.id}/requests`)
      .set(auth(r.user.accessToken))
      .send({ journeyId: r.journeyId })
      .expect(409);
    await ctx
      .http()
      .post(`/api/v1/ride-pool/requests/${req.body.id}/accept`)
      .set(auth(r.user.accessToken))
      .expect(403);
  });

  it('only pooling-eligible vehicles can offer seats, within capacity', async () => {
    const bus = await createJourney(ctx, driver, {
      vehicleTypeCode: 'BICYCLE',
      departureAt: departureAt(),
    }).expect(201);
    await ctx
      .http()
      .post(`/api/v1/journeys/${bus.body.id}/ride-pool/offer`)
      .set(auth(driver.accessToken))
      .send({ totalSeats: 1 })
      .expect(422);
    await offer(9).expect(400); // car capacity is 4
  });

  it('cancelling the driver’s journey cancels pending/accepted requests and notifies riders', async () => {
    const o = await offer(2).expect(201);
    const r = await rider('Ira');
    const req = await ctx
      .http()
      .post(`/api/v1/ride-pool/offers/${o.body.id}/requests`)
      .set(auth(r.user.accessToken))
      .send({ journeyId: r.journeyId })
      .expect(201);
    await ctx
      .http()
      .post(`/api/v1/ride-pool/requests/${req.body.id}/accept`)
      .set(auth(driver.accessToken))
      .expect(200);
    await ctx
      .http()
      .post(`/api/v1/journeys/${driverJourney}/cancel`)
      .set(auth(driver.accessToken))
      .expect(200);
    expect(
      (await ctx.prisma.ridePoolRequest.findUniqueOrThrow({ where: { id: req.body.id } })).status,
    ).toBe('CANCELLED');
    expect(
      (await ctx.prisma.ridePoolOffer.findUniqueOrThrow({ where: { id: o.body.id } })).status,
    ).toBe('CANCELLED');
    expect(
      await ctx.prisma.notification.count({
        where: { userId: r.user.userId, title: 'Ride cancelled' },
      }),
    ).toBe(1);
  });
});
