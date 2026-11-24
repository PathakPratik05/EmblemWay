import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OverlapSample } from './domain/overlap.engine';

/**
 * Geometry used for corridor tests. Simplification removes redundant vertices (dense provider
 * polylines can have 10k+ points), then segmentizing at ~1 km keeps the geography (great-circle)
 * interpretation within centimetres of the original planar path. Error <= tolerance (~3 m / ~11 m).
 */
const SIMPLIFY_MEASURE_DEG = 0.00003; // ~3 m
const SIMPLIFY_PREFILTER_DEG = 0.0001; // ~11 m
const SIMPLIFY_PREFILTER_SLACK_M = 12;
const SEGMENTIZE_DEG = 0.01; // ~1 km
const simplified = (col: Prisma.Sql, tol: number) =>
  Prisma.sql`ST_Segmentize(ST_Simplify(${col}, ${tol}::float8), ${SEGMENTIZE_DEG}::float8)::geography`;

export interface JourneyRouteInfo {
  journeyId: string;
  userId: string;
  departureAt: Date;
  durationSeconds: number;
  lengthMeters: number;
  vehicleTypeId: string;
  status: string;
}

export interface CandidateRow {
  journey_id: string;
  user_id: string;
  departure_at: Date;
  duration_seconds: number;
  length_m: number;
  vehicle_type_id: string;
  vehicle_type_code: string;
  source_distance_m: number;
  pickup_distance_m: number;
  destination_distance_m: number;
}

export interface CandidateFilter {
  corridorMeters: number;
  windowSeconds: number;
  vehicleTypeIds?: string[];
  limit: number;
}

/**
 * All geographic comparison happens here, in PostGIS. Candidate selection is index-driven
 * (status/time btree + GiST on the route geography), so we never load every journey into
 * memory; only the bounded candidate set is measured sample-by-sample.
 */
@Injectable()
export class MatchingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getRouteInfo(journeyId: string): Promise<JourneyRouteInfo | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        journey_id: string;
        user_id: string;
        departure_at: Date;
        duration_seconds: number;
        length_m: number;
        vehicle_type_id: string;
        status: string;
      }>
    >`
      SELECT j.id AS journey_id, j.user_id, j.departure_at, r.duration_seconds,
             ST_Length(r.geom::geography) AS length_m, j.vehicle_type_id, j.status::text AS status
        FROM journeys j
        JOIN journey_routes r ON r.journey_id = j.id AND r.is_selected
       WHERE j.id = ${journeyId}::uuid`;
    const r = rows[0];
    return r
      ? {
          journeyId: r.journey_id,
          userId: r.user_id,
          departureAt: r.departure_at,
          durationSeconds: r.duration_seconds,
          lengthMeters: Number(r.length_m),
          vehicleTypeId: r.vehicle_type_id,
          status: r.status,
        }
      : null;
  }

  /**
   * Candidate journeys: other users, PLANNED/ACTIVE, opted in to matching, time-compatible
   * (departure window widened by both route durations so long journeys that join later are
   * still considered) and whose route passes within the corridor of A's route.
   */
  async findCandidates(a: JourneyRouteInfo, f: CandidateFilter): Promise<CandidateRow[]> {
    const vehicleFilter = f.vehicleTypeIds?.length
      ? Prisma.sql`AND j.vehicle_type_id IN (${Prisma.join(f.vehicleTypeIds.map((id) => Prisma.sql`${id}::uuid`))})`
      : Prisma.empty;
    return this.prisma.$queryRaw<CandidateRow[]>`
      WITH a AS (
        SELECT r.geom,
               ${simplified(Prisma.sql`r.geom`, SIMPLIFY_PREFILTER_DEG)} AS sg,
               -- Bounding box grown by the corridor (degrees; cos(lat) >= 0.79 inside India).
               ST_Expand(r.geom, ${(f.corridorMeters / 111_320) * 1.3}::float8) AS box,
               (SELECT geom FROM journey_locations WHERE journey_id = ${a.journeyId}::uuid AND kind = 'SOURCE') AS src,
               (SELECT geom FROM journey_locations WHERE journey_id = ${a.journeyId}::uuid AND kind = 'PICKUP') AS pick,
               (SELECT geom FROM journey_locations WHERE journey_id = ${a.journeyId}::uuid AND kind = 'DESTINATION') AS dst
          FROM journey_routes r
         WHERE r.journey_id = ${a.journeyId}::uuid AND r.is_selected
      )
      SELECT j.id AS journey_id, j.user_id, j.departure_at, r.duration_seconds,
             ST_Length(r.geom::geography) AS length_m,
             j.vehicle_type_id, vt.code AS vehicle_type_code,
             COALESCE(ST_Distance(a.src::geography, ls.geom::geography), 0) AS source_distance_m,
             COALESCE(ST_Distance(COALESCE(a.pick, a.src)::geography, COALESCE(lp.geom, ls.geom)::geography), 0) AS pickup_distance_m,
             COALESCE(ST_Distance(a.dst::geography, ld.geom::geography), 0) AS destination_distance_m
        FROM a
        JOIN journey_routes r
          ON r.is_selected
         AND r.geom && a.box -- GiST index on geometry
         AND ST_DWithin(${simplified(Prisma.sql`r.geom`, SIMPLIFY_PREFILTER_DEG)}, a.sg, ${f.corridorMeters + SIMPLIFY_PREFILTER_SLACK_M}::float8)
        JOIN journeys j ON j.id = r.journey_id
        JOIN users u ON u.id = j.user_id AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
        JOIN user_profiles p ON p.user_id = j.user_id AND p.share_journeys_for_matching
        JOIN vehicle_types vt ON vt.id = j.vehicle_type_id
        LEFT JOIN journey_locations ls ON ls.journey_id = j.id AND ls.kind = 'SOURCE'
        LEFT JOIN journey_locations lp ON lp.journey_id = j.id AND lp.kind = 'PICKUP'
        LEFT JOIN journey_locations ld ON ld.journey_id = j.id AND ld.kind = 'DESTINATION'
       WHERE j.id <> ${a.journeyId}::uuid
         AND j.user_id <> ${a.userId}::uuid
         AND j.status IN ('PLANNED', 'ACTIVE')
         AND j.departure_at >= ${a.departureAt}::timestamptz - make_interval(secs => (${f.windowSeconds}::int + r.duration_seconds)::float8)
         AND j.departure_at <= ${a.departureAt}::timestamptz + make_interval(secs => (${f.windowSeconds}::int + ${a.durationSeconds}::int)::float8)
         ${vehicleFilter}
       ORDER BY abs(extract(epoch FROM j.departure_at - ${a.departureAt}::timestamptz))
       LIMIT ${f.limit}`;
  }

  /**
   * Samples A every `stepMeters` (spheroidal distance) and, for every candidate B, returns the
   * samples that fall inside B's corridor with their fractional position along B.
   * Samples outside the corridor are implied by absence.
   */
  async measureSamples(
    journeyId: string,
    candidateIds: string[],
    stepMeters: number,
    lengthMeters: number,
    corridorMeters: number,
  ): Promise<{
    samples: Array<Omit<OverlapSample, 'withinCorridor' | 'bFraction'>>;
    hits: Map<string, Map<number, number>>;
  }> {
    const fraction = Math.min(1, stepMeters / lengthMeters);
    const sampleRows = await this.prisma.$queryRaw<
      Array<{ idx: number; lat: number; lng: number }>
    >`
      WITH a AS (SELECT geom FROM journey_routes WHERE journey_id = ${journeyId}::uuid AND is_selected),
      pts AS (
        SELECT 0 AS idx, ST_StartPoint(a.geom) AS pt FROM a
        UNION ALL
        SELECT dp.path[1] AS idx, dp.geom AS pt
          FROM a, LATERAL ST_DumpPoints(ST_LineInterpolatePoints(a.geom::geography, ${fraction}::float8, true, true)::geometry) dp
      )
      SELECT idx, ST_Y(pt) AS lat, ST_X(pt) AS lng FROM pts ORDER BY idx`;
    const samples = sampleRows.map((s) => ({
      index: s.idx,
      distanceAlongA: Math.min(lengthMeters, s.idx * stepMeters),
      latitude: Number(s.lat),
      longitude: Number(s.lng),
    }));
    // The last interpolated point sits at the end of A even if the step doesn't divide evenly.
    if (samples.length > 1) samples[samples.length - 1]!.distanceAlongA = lengthMeters;

    const hits = new Map<string, Map<number, number>>();
    if (candidateIds.length === 0) return { samples, hits };
    const rows = await this.prisma.$queryRaw<
      Array<{ journey_id: string; idx: number; frac: number }>
    >`
      WITH a AS (SELECT geom FROM journey_routes WHERE journey_id = ${journeyId}::uuid AND is_selected),
      pts AS (
        SELECT 0 AS idx, ST_StartPoint(a.geom)::geography AS pt FROM a
        UNION ALL
        SELECT dp.path[1] AS idx, dp.geom::geography AS pt
          FROM a, LATERAL ST_DumpPoints(ST_LineInterpolatePoints(a.geom::geography, ${fraction}::float8, true, true)::geometry) dp
      ),
      c AS (
        SELECT journey_id, ${simplified(Prisma.sql`geom`, SIMPLIFY_MEASURE_DEG)} AS g
          FROM journey_routes
         WHERE is_selected AND journey_id IN (${Prisma.join(candidateIds.map((id) => Prisma.sql`${id}::uuid`))})
      )
      SELECT c.journey_id, pts.idx, ST_LineLocatePoint(c.g, pts.pt) AS frac
        FROM c JOIN pts ON ST_DWithin(pts.pt, c.g, ${corridorMeters})`;
    for (const r of rows) {
      let m = hits.get(r.journey_id);
      if (!m) {
        m = new Map<number, number>();
        hits.set(r.journey_id, m);
      }
      m.set(r.idx, Number(r.frac));
    }
    return { samples, hits };
  }
}
