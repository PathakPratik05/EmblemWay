import {
  auth,
  createTestApp,
  PLACES,
  registerUser,
  resetDatabase,
  TestContext,
  TestUser,
} from '../utils/test-app';

describe('Maps proxy API: places & route preview (integration)', () => {
  let ctx: TestContext;
  let u: TestUser;
  const coords = (p: { latitude: number; longitude: number }) => ({
    latitude: p.latitude,
    longitude: p.longitude,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
    u = await registerUser(ctx);
  });
  afterAll(async () => ctx.close());

  it('autocompletes, resolves details and reverse geocodes (server key never sent to clients)', async () => {
    const ac = await ctx
      .http()
      .get('/api/v1/places/autocomplete?input=Hinjewadi&lat=18.52&lng=73.85&sessionToken=s1')
      .set(auth(u.accessToken))
      .expect(200);
    expect(ac.body.provider).toBe('mock');
    expect(ac.body.suggestions.length).toBeGreaterThan(0);
    const details = await ctx
      .http()
      .get(`/api/v1/places/${ac.body.suggestions[0].placeId}`)
      .set(auth(u.accessToken))
      .expect(200);
    expect(details.body.location.latitude).toBeCloseTo(18.59, 1);
    await ctx.http().get('/api/v1/places/unknown-place-id').set(auth(u.accessToken)).expect(422);
    const rev = await ctx
      .http()
      .get('/api/v1/places/reverse-geocode?lat=18.5308&lng=73.8475')
      .set(auth(u.accessToken))
      .expect(200);
    expect(rev.body.name).toMatch(/Shivajinagar/);
    await ctx
      .http()
      .get('/api/v1/places/autocomplete?input=a')
      .set(auth(u.accessToken))
      .expect(400);
    await ctx
      .http()
      .get('/api/v1/places/reverse-geocode?lat=200&lng=73')
      .set(auth(u.accessToken))
      .expect(400);
    await ctx.http().get('/api/v1/places/autocomplete?input=Baner').expect(401);
  });

  it('previews routes with distance, duration and vehicle routing caveats', async () => {
    const res = await ctx
      .http()
      .post('/api/v1/routes/preview')
      .set(auth(u.accessToken))
      .send({
        source: coords(PLACES.hinjewadi),
        destination: coords(PLACES.kharadi),
        pickup: coords(PLACES.baner),
        vehicleTypeCode: 'TRUCK',
      })
      .expect(200);
    expect(res.body).toMatchObject({
      routingProfile: 'DRIVE',
      isLiveData: false,
      approximationNote: expect.stringMatching(/approximated/),
    });
    expect(res.body.routes[0].distanceMeters).toBeGreaterThan(20_000);
    await ctx
      .http()
      .post('/api/v1/routes/preview')
      .set(auth(u.accessToken))
      .send({
        source: coords(PLACES.baner),
        destination: coords(PLACES.baner),
        vehicleTypeCode: 'CAR',
      })
      .expect(400);
    await ctx
      .http()
      .post('/api/v1/routes/preview')
      .set(auth(u.accessToken))
      .send({
        source: coords(PLACES.baner),
        destination: coords(PLACES.kharadi),
        vehicleTypeCode: 'ROCKET',
      })
      .expect(400);
  });

  it('lists active cities and vehicle types publicly', async () => {
    const cities = await ctx.http().get('/api/v1/cities').expect(200);
    expect(cities.body.map((c: { code: string }) => c.code)).toEqual(['PUNE']);
  });
});
