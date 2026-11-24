/**
 * Matching benchmark (run against the TEST database - it is wiped first).
 *
 *   npx dotenv -e .env.test -- npm run benchmark:matching -- --journeys 2000 --runs 50
 *
 * Loads N planned journeys between real Pune localities within a 3-hour window (well above the
 * 1,000 journeys/day launch target concentrated into a peak), then measures the latency of a
 * full match computation (candidate search + per-sample measurement + scoring + persistence)
 * and prints the query plan of the candidate search to prove the GiST index is used.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MatchingService } from '../src/matching/matching.service';
import { MockRoutingProvider } from '../src/maps/providers/mock-maps.providers';
import { decodePolyline, encodePolyline, LatLng } from '../src/common/utils/geo.util';
import { PrismaService } from '../src/prisma/prisma.service';

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};

const LOCALITIES: LatLng[] = [
  { latitude: 18.5912, longitude: 73.7389 }, // Hinjewadi Ph1
  { latitude: 18.5826, longitude: 73.6868 }, // Hinjewadi Ph3
  { latitude: 18.5515, longitude: 73.9348 }, // Kharadi
  { latitude: 18.5679, longitude: 73.9143 }, // Viman Nagar
  { latitude: 18.5308, longitude: 73.8475 }, // Shivajinagar
  { latitude: 18.5074, longitude: 73.8077 }, // Kothrud
  { latitude: 18.559, longitude: 73.7868 }, // Baner
  { latitude: 18.5975, longitude: 73.7707 }, // Wakad
  { latitude: 18.5158, longitude: 73.9272 }, // Magarpatta
  { latitude: 18.5018, longitude: 73.8636 }, // Swargate
  { latitude: 18.6298, longitude: 73.7997 }, // Pimpri
  { latitude: 18.4529, longitude: 73.8652 }, // Katraj
];

const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!;

async function main(): Promise<void> {
  const n = arg('journeys', 2000);
  const runs = arg('runs', 50);
  if (!process.env.DATABASE_URL?.includes('_test'))
    throw new Error('Refusing to run: point DATABASE_URL at the test database');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const matching = app.get(MatchingService);
  const routing = new MockRoutingProvider();

  console.log(`Seeding ${n} journeys…`);
  await prisma.$executeRawUnsafe(
    'TRUNCATE journey_matches, journey_route_segments, journey_routes, journey_locations, journeys, user_profiles, users RESTART IDENTITY CASCADE',
  );
  const car = await prisma.vehicleType.findUniqueOrThrow({ where: { code: 'CAR' } });
  const users = await Promise.all(
    Array.from({ length: Math.ceil(n / 2) }, (_, i) =>
      prisma.user.create({
        data: {
          firstName: `Bench${i}`,
          lastName: 'User',
          phoneE164: `+919${String(100000000 + i)}`,
          profile: { create: {} },
        },
      }),
    ),
  );
  const base = Date.now() + 3600_000;
  const jitter = () => (Math.random() - 0.5) * 0.01;
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = LOCALITIES[i % LOCALITIES.length]!;
    const b = LOCALITIES[(i * 7 + 3) % LOCALITIES.length]!;
    if (a === b) continue;
    // Bent route via a mid locality so geometries resemble real, partially shared roads.
    const via = LOCALITIES[(i * 5 + 1) % LOCALITIES.length]!;
    const route = (
      await routing.computeRoutes({
        origin: { latitude: a.latitude + jitter(), longitude: a.longitude + jitter() },
        destination: b,
        via: [via],
        profile: 'DRIVE',
        trafficAware: false,
      })
    ).routes[0]!;
    const pts = decodePolyline(route.encodedPolyline);
    const j = await prisma.journey.create({
      data: {
        userId: users[i % users.length]!.id,
        vehicleTypeId: car.id,
        departureAt: new Date(base + Math.random() * 3 * 3600_000),
      },
    });
    ids.push(j.id);
    for (const [kind, p] of [
      ['SOURCE', pts[0]!],
      ['DESTINATION', pts[pts.length - 1]!],
      ['PICKUP', pts[0]!],
    ] as const) {
      await prisma.$executeRaw`INSERT INTO journey_locations (journey_id, kind, name, latitude, longitude, geom)
        VALUES (${j.id}::uuid, ${kind}::"LocationKind", ${kind}, ${p.latitude}, ${p.longitude}, ST_SetSRID(ST_MakePoint(${p.longitude}, ${p.latitude}), 4326))`;
    }
    const enc = encodePolyline(pts);
    await prisma.$executeRaw`INSERT INTO journey_routes (journey_id, provider, routing_profile, encoded_polyline, geom, distance_meters, duration_seconds)
      VALUES (${j.id}::uuid, 'bench', 'DRIVE', ${enc}, ST_LineFromEncodedPolyline(${enc}, 5), ${route.distanceMeters}, ${route.durationSeconds})`;
  }
  for (const t of ['journeys', 'journey_routes', 'journey_locations'])
    await prisma.$executeRawUnsafe(`ANALYZE ${t}`);

  console.log(`Running ${runs} full match computations…`);
  const times: number[] = [];
  let totalMatches = 0;
  for (let r = 0; r < runs; r += 1) {
    const id = ids[Math.floor(Math.random() * ids.length)]!;
    const t0 = performance.now();
    totalMatches += (await matching.computeAndStore(id)).length;
    times.push(performance.now() - t0);
  }

  const sample = ids[0]!;
  const plan = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT r.journey_id FROM journey_routes r, (SELECT geom FROM journey_routes WHERE journey_id = '${sample}' AND is_selected) a
     WHERE r.is_selected AND r.geom && ST_Expand(a.geom, 0.0007)`);
  const usesIndex = plan.some((p) =>
    /journey_routes_geom_gix|Index Scan|Bitmap Index Scan/.test(p['QUERY PLAN']),
  );

  console.log(
    JSON.stringify(
      {
        journeys: ids.length,
        runs,
        averageMatchesPerJourney: Math.round((totalMatches / runs) * 10) / 10,
        latencyMs: {
          p50: Math.round(pct(times, 50)),
          p95: Math.round(pct(times, 95)),
          max: Math.round(Math.max(...times)),
        },
        candidateSearchUsesSpatialIndex: usesIndex,
      },
      null,
      2,
    ),
  );
  console.log(
    plan
      .map((p) => p['QUERY PLAN'])
      .slice(0, 8)
      .join('\n'),
  );
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
