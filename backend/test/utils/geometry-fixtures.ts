import { JourneyStatus } from '@prisma/client';
import {
  encodePolyline,
  LatLng,
  pathLengthMeters,
  resample,
} from '../../src/common/utils/geo.util';
import { TestContext } from './test-app';

/** Straight-line helper: points every ~50 m from a to b. */
export function line(a: LatLng, b: LatLng): LatLng[] {
  return resample([a, b], 50);
}

/** Concatenate legs, dropping duplicated joints. */
export function path(...legs: LatLng[][]): LatLng[] {
  const out: LatLng[] = [];
  for (const leg of legs) out.push(...(out.length ? leg.slice(1) : leg));
  return out;
}

/** Shift a path north by `meters` (parallel road). */
export function offsetNorth(points: LatLng[], meters: number): LatLng[] {
  return points.map((p) => ({ latitude: p.latitude + meters / 111_320, longitude: p.longitude }));
}

/** Deterministic pseudo-random jitter of up to `meters` (GPS noise). */
export function jitter(points: LatLng[], meters: number): LatLng[] {
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return points.map((p) => ({
    latitude: p.latitude + (rnd() * meters) / 111_320,
    longitude: p.longitude + (rnd() * meters) / 105_600,
  }));
}

/** East-west reference road through Pune at latitude 18.52; x is kilometres east of 73.80. */
export const E = (km: number, northKm = 0): LatLng => ({
  latitude: 18.52 + northKm / 111.32,
  longitude: 73.8 + km / 105.6,
});

export interface InsertOptions {
  userId: string;
  points: LatLng[];
  departureAt?: Date;
  status?: JourneyStatus;
  vehicleCode?: string;
  speedKmh?: number;
  pickup?: LatLng;
}

/**
 * Inserts a journey with an exact route geometry, bypassing the routing provider, so
 * matching can be tested against precisely controlled real-world-like shapes.
 */
export async function insertJourney(ctx: TestContext, o: InsertOptions): Promise<string> {
  const vehicle = await ctx.prisma.vehicleType.findUniqueOrThrow({
    where: { code: o.vehicleCode ?? 'CAR' },
  });
  const length = pathLengthMeters(o.points);
  const duration = Math.round((length / 1000 / (o.speedKmh ?? 30)) * 3600);
  const departureAt = o.departureAt ?? new Date(Date.now() + 3600_000);
  const status = o.status ?? 'PLANNED';
  const journey = await ctx.prisma.journey.create({
    data: {
      userId: o.userId,
      vehicleTypeId: vehicle.id,
      status,
      departureAt,
      ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
      ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
    },
  });
  const src = o.points[0]!;
  const dst = o.points[o.points.length - 1]!;
  const pick = o.pickup ?? src;
  for (const [kind, p] of [
    ['SOURCE', src],
    ['DESTINATION', dst],
    ['PICKUP', pick],
  ] as const) {
    await ctx.prisma.$executeRaw`
      INSERT INTO journey_locations (journey_id, kind, name, latitude, longitude, geom)
      VALUES (${journey.id}::uuid, ${kind}::"LocationKind", ${kind}, ${p.latitude}, ${p.longitude}, ST_SetSRID(ST_MakePoint(${p.longitude}, ${p.latitude}), 4326))`;
  }
  const encoded = encodePolyline(o.points);
  await ctx.prisma.$executeRaw`
    INSERT INTO journey_routes (journey_id, provider, routing_profile, encoded_polyline, geom, distance_meters, duration_seconds)
    VALUES (${journey.id}::uuid, 'fixture', 'DRIVE', ${encoded}, ST_LineFromEncodedPolyline(${encoded}, 5), ${Math.max(1, Math.round(length))}, ${duration})`;
  return journey.id;
}

export async function createPlainUser(
  ctx: TestContext,
  name: string,
  shareForMatching = true,
): Promise<string> {
  const u = await ctx.prisma.user.create({
    data: {
      firstName: name,
      lastName: 'Fixture',
      phoneE164: `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
      profile: { create: { shareJourneysForMatching: shareForMatching } },
    },
  });
  return u.id;
}
