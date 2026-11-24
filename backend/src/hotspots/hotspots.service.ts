import { Injectable, Logger } from '@nestjs/common';
import { HotspotModel, Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { addDays } from '../common/utils/time.util';
import { CitiesService } from '../cities/cities.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export type HotspotLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';

export const HOTSPOT_LEGEND = [
  { level: 'LOW', color: '#2E9E5B', label: 'Low' },
  { level: 'MODERATE', color: '#F2C230', label: 'Moderate' },
  { level: 'HIGH', color: '#F08A24', label: 'High' },
  { level: 'VERY_HIGH', color: '#D93B3B', label: 'Very high' },
] as const;

export const HOTSPOT_DISCLAIMERS: Record<HotspotModel, string> = {
  JOURNEY_DEMAND:
    'Shows where registered EmblemWay journeys overlap. It is journey demand, not the number of vehicles on the road.',
  ORIGIN: 'Shows where registered EmblemWay journeys start. It is not a measure of actual traffic.',
  DESTINATION:
    'Shows where registered EmblemWay journeys end. It is not a measure of actual traffic.',
  TRAFFIC:
    'Derived from traffic speed data returned by the routing provider for routes requested in EmblemWay. Coverage is limited to those routes.',
};

export interface HotspotQuery {
  model: HotspotModel;
  cityCode?: string;
  from?: Date;
  to?: Date;
  vehicleTypeCode?: string;
  hourFrom?: number;
  hourTo?: number;
}

export interface HotspotCell {
  cellKey: string;
  center: { latitude: number; longitude: number };
  journeys: number;
  peakTravellers: number;
  congestionIndex: number | null;
  intensity: number;
  level: HotspotLevel;
  previousIntensity: number | null;
  changeRatio: number | null;
}

/**
 * Three distinct hotspot models, aggregated into metric grid cells per time bucket:
 *   JOURNEY_DEMAND - registered journeys whose route crosses the cell
 *   ORIGIN / DESTINATION - registered journey starts / ends in the cell
 *   TRAFFIC - provider speed readings (NORMAL=0, SLOW=0.5, TRAFFIC_JAM=1) averaged per cell
 */
@Injectable()
export class HotspotsService {
  private readonly logger = new Logger(HotspotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cities: CitiesService,
  ) {}

  /** Recomputes all models for [now - lookbackDays, now + lookahead). Idempotent. */
  async aggregate(now = new Date()): Promise<Record<HotspotModel, number>> {
    const s = await this.settings.get('hotspots');
    const from = addDays(now, -s.lookbackDays);
    const to = addDays(now, 7); // include scheduled (future) journeys in demand
    const size = s.cellSizeMeters;
    const bucket = s.bucketMinutes;
    const result = {} as Record<HotspotModel, number>;

    await this.prisma.withTransaction(
      async (tx) => {
        await tx.$executeRaw`
          DELETE FROM hotspot_aggregations
           WHERE bucket_minutes = ${bucket} AND bucket_start >= ${from} AND bucket_start < ${to}`;

        const binned = (col: Prisma.Sql) =>
          Prisma.sql`date_bin(make_interval(mins => ${bucket}::int), ${col}, TIMESTAMPTZ '2000-01-01 00:00:00+00')`;

        result.JOURNEY_DEMAND = await tx.$executeRaw`
          WITH j AS (
            SELECT j.id, j.user_id, vt.code, ${binned(Prisma.sql`j.departure_at`)} AS bucket
              FROM journeys j JOIN vehicle_types vt ON vt.id = j.vehicle_type_id
             WHERE j.status IN ('PLANNED', 'ACTIVE', 'COMPLETED')
               AND j.departure_at >= ${from} AND j.departure_at < ${to}
          ), cells AS (
            SELECT DISTINCT j.id, j.user_id, j.code, j.bucket, g.cell_key, g.center_lat, g.center_lng
              FROM j
              JOIN journey_route_segments jrs ON jrs.journey_id = j.id
              JOIN route_segments s ON s.id = jrs.segment_id
              CROSS JOIN LATERAL emblemway_grid_cell(s.center_latitude, s.center_longitude, ${size}::int) g
          )
          INSERT INTO hotspot_aggregations (id, model, cell_key, center_latitude, center_longitude, cell_size_meters,
                                            bucket_start, bucket_minutes, vehicle_type_code, journey_count, distinct_users, sample_count)
          SELECT gen_random_uuid(), 'JOURNEY_DEMAND', cell_key, center_lat, center_lng, ${size}, bucket, ${bucket},
                 COALESCE(code, 'ALL'), count(DISTINCT id), count(DISTINCT user_id), count(*)
            FROM cells
           GROUP BY GROUPING SETS ((cell_key, center_lat, center_lng, bucket, code), (cell_key, center_lat, center_lng, bucket))`;

        for (const [model, kind] of [
          ['ORIGIN', 'SOURCE'],
          ['DESTINATION', 'DESTINATION'],
        ] as const) {
          result[model] = await tx.$executeRaw`
            WITH pts AS (
              SELECT j.id, j.user_id, vt.code, ${binned(Prisma.sql`j.departure_at`)} AS bucket, g.cell_key, g.center_lat, g.center_lng
                FROM journeys j
                JOIN vehicle_types vt ON vt.id = j.vehicle_type_id
                JOIN journey_locations l ON l.journey_id = j.id AND l.kind = ${kind}::"LocationKind"
                CROSS JOIN LATERAL emblemway_grid_cell(l.latitude, l.longitude, ${size}::int) g
               WHERE j.status IN ('PLANNED', 'ACTIVE', 'COMPLETED')
                 AND j.departure_at >= ${from} AND j.departure_at < ${to}
            )
            INSERT INTO hotspot_aggregations (id, model, cell_key, center_latitude, center_longitude, cell_size_meters,
                                              bucket_start, bucket_minutes, vehicle_type_code, journey_count, distinct_users, sample_count)
            SELECT gen_random_uuid(), ${model}::"HotspotModel", cell_key, center_lat, center_lng, ${size}, bucket, ${bucket},
                   COALESCE(code, 'ALL'), count(DISTINCT id), count(DISTINCT user_id), count(*)
              FROM pts
             GROUP BY GROUPING SETS ((cell_key, center_lat, center_lng, bucket, code), (cell_key, center_lat, center_lng, bucket))`;
        }

        result.TRAFFIC = await tx.$executeRaw`
          WITH pts AS (
            SELECT ${binned(Prisma.sql`ts.fetched_at`)} AS bucket, (iv->>'congestion')::float8 AS congestion,
                   g.cell_key, g.center_lat, g.center_lng
              FROM traffic_snapshots ts
              CROSS JOIN LATERAL jsonb_array_elements(ts.speed_intervals) iv
              CROSS JOIN LATERAL jsonb_array_elements(iv->'points') p
              CROSS JOIN LATERAL emblemway_grid_cell((p->>0)::float8, (p->>1)::float8, ${size}::int) g
             WHERE ts.status = 'OK' AND jsonb_typeof(ts.speed_intervals) = 'array'
               AND ts.fetched_at >= ${from} AND ts.fetched_at < ${to}
          )
          INSERT INTO hotspot_aggregations (id, model, cell_key, center_latitude, center_longitude, cell_size_meters,
                                            bucket_start, bucket_minutes, vehicle_type_code, congestion_index, sample_count)
          SELECT gen_random_uuid(), 'TRAFFIC', cell_key, center_lat, center_lng, ${size}, bucket, ${bucket}, 'ALL',
                 avg(congestion), count(*)
            FROM pts GROUP BY cell_key, center_lat, center_lng, bucket`;

        // Attribute cells to the nearest active city whose service radius contains them.
        await tx.$executeRaw`
          UPDATE hotspot_aggregations h
             SET city_id = (
               SELECT c.id FROM cities c
                WHERE ST_DWithin(ST_MakePoint(h.center_longitude, h.center_latitude)::geography,
                                 ST_MakePoint(c.center_longitude, c.center_latitude)::geography, c.radius_meters)
                ORDER BY ST_Distance(ST_MakePoint(h.center_longitude, h.center_latitude)::geography,
                                     ST_MakePoint(c.center_longitude, c.center_latitude)::geography)
                LIMIT 1)
           WHERE h.bucket_minutes = ${bucket} AND h.bucket_start >= ${from} AND h.bucket_start < ${to}`;
      },
      { timeoutMs: 120_000 },
    );
    this.logger.log({ result }, 'Hotspot aggregation complete');
    return result;
  }

  async query(q: HotspotQuery, now = new Date()) {
    const s = await this.settings.get('hotspots');
    const to = q.to ?? addDays(now, 1);
    const from = q.from ?? addDays(now, -7);
    if (from >= to) throw new AppError('VALIDATION_FAILED', '`from` must be before `to`');
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);

    let cityId: string | null = null;
    if (q.cityCode) {
      const city = await this.cities.findByCode(q.cityCode);
      if (!city) throw AppError.notFound('City');
      cityId = city.id;
    }
    const vehicle = (q.vehicleTypeCode ?? 'ALL').toUpperCase();
    const hourFilter =
      q.hourFrom !== undefined && q.hourTo !== undefined
        ? Prisma.sql`AND extract(hour FROM bucket_start AT TIME ZONE 'Asia/Kolkata') BETWEEN ${q.hourFrom} AND ${q.hourTo}`
        : Prisma.empty;
    const cityFilter = cityId ? Prisma.sql`AND city_id = ${cityId}::uuid` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        cell_key: string;
        lat: number;
        lng: number;
        journeys: bigint;
        peak: number;
        congestion: number | null;
        prev_journeys: bigint;
        prev_congestion: number | null;
      }>
    >`
      SELECT cell_key, min(center_latitude) AS lat, min(center_longitude) AS lng,
             COALESCE(sum(journey_count) FILTER (WHERE bucket_start >= ${from}), 0) AS journeys,
             COALESCE(max(distinct_users) FILTER (WHERE bucket_start >= ${from}), 0) AS peak,
             sum(congestion_index * sample_count) FILTER (WHERE bucket_start >= ${from})
               / NULLIF(sum(sample_count) FILTER (WHERE bucket_start >= ${from}), 0) AS congestion,
             COALESCE(sum(journey_count) FILTER (WHERE bucket_start < ${from}), 0) AS prev_journeys,
             sum(congestion_index * sample_count) FILTER (WHERE bucket_start < ${from})
               / NULLIF(sum(sample_count) FILTER (WHERE bucket_start < ${from}), 0) AS prev_congestion
        FROM hotspot_aggregations
       WHERE model = ${q.model}::"HotspotModel" AND vehicle_type_code = ${vehicle}
         AND bucket_minutes = ${s.bucketMinutes} AND cell_size_meters = ${s.cellSizeMeters}
         AND bucket_start >= ${prevFrom} AND bucket_start < ${to}
         ${cityFilter} ${hourFilter}
       GROUP BY cell_key
       HAVING COALESCE(sum(journey_count) FILTER (WHERE bucket_start >= ${from}), 0) > 0
           OR sum(sample_count) FILTER (WHERE bucket_start >= ${from}) > 0
       ORDER BY journeys DESC, congestion DESC NULLS LAST
       LIMIT 2000`;

    const isTraffic = q.model === 'TRAFFIC';
    const cells: HotspotCell[] = rows.map((r) => {
      const intensity = isTraffic ? Number(r.congestion ?? 0) : Number(r.journeys);
      const previous = isTraffic
        ? r.prev_congestion === null
          ? null
          : Number(r.prev_congestion)
        : Number(r.prev_journeys);
      return {
        cellKey: r.cell_key,
        center: { latitude: Number(r.lat), longitude: Number(r.lng) },
        journeys: Number(r.journeys),
        peakTravellers: Number(r.peak),
        congestionIndex:
          r.congestion === null ? null : Math.round(Number(r.congestion) * 1000) / 1000,
        intensity,
        level: 'LOW',
        previousIntensity: previous,
        changeRatio:
          previous && previous > 0
            ? Math.round(((intensity - previous) / previous) * 1000) / 1000
            : null,
      };
    });
    assignLevels(cells, isTraffic);
    return {
      model: q.model,
      cellSizeMeters: s.cellSizeMeters,
      bucketMinutes: s.bucketMinutes,
      from: from.toISOString(),
      to: to.toISOString(),
      comparisonFrom: prevFrom.toISOString(),
      vehicleTypeCode: vehicle,
      legend: HOTSPOT_LEGEND,
      disclaimer: HOTSPOT_DISCLAIMERS[q.model],
      lastAggregatedAt: (
        await this.prisma.hotspotAggregation.aggregate({ _max: { computedAt: true } })
      )._max.computedAt,
      cells,
    };
  }

  /** Demand per IST hour of day - for "when is it busiest" charts. */
  async hourlyProfile(q: HotspotQuery, now = new Date()) {
    const s = await this.settings.get('hotspots');
    const to = q.to ?? addDays(now, 1);
    const from = q.from ?? addDays(now, -7);
    const city = q.cityCode ? await this.cities.findByCode(q.cityCode) : null;
    const rows = await this.prisma.$queryRaw<
      Array<{ hour: number; journeys: bigint; congestion: number | null }>
    >`
      SELECT extract(hour FROM bucket_start AT TIME ZONE 'Asia/Kolkata')::int AS hour,
             COALESCE(sum(journey_count), 0) AS journeys,
             sum(congestion_index * sample_count) / NULLIF(sum(sample_count), 0) AS congestion
        FROM hotspot_aggregations
       WHERE model = ${q.model}::"HotspotModel" AND vehicle_type_code = ${(q.vehicleTypeCode ?? 'ALL').toUpperCase()}
         AND bucket_minutes = ${s.bucketMinutes} AND bucket_start >= ${from} AND bucket_start < ${to}
         ${city ? Prisma.sql`AND city_id = ${city.id}::uuid` : Prisma.empty}
       GROUP BY 1 ORDER BY 1`;
    const byHour = new Map(rows.map((r) => [r.hour, r]));
    return {
      model: q.model,
      hours: Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        journeys: Number(byHour.get(h)?.journeys ?? 0),
        congestionIndex:
          byHour.get(h)?.congestion === null || byHour.get(h) === undefined
            ? null
            : Number(byHour.get(h)!.congestion),
      })),
    };
  }
}

/**
 * Demand levels are relative to the busiest cells (percentile rank) but also require an
 * absolute minimum, so a handful of journeys can never be shown as "very high".
 * Traffic levels use the congestion index directly.
 */
export function assignLevels(cells: HotspotCell[], isTraffic: boolean): void {
  if (isTraffic) {
    for (const c of cells) {
      const v = c.intensity;
      c.level = v >= 0.75 ? 'VERY_HIGH' : v >= 0.5 ? 'HIGH' : v >= 0.25 ? 'MODERATE' : 'LOW';
    }
    return;
  }
  const sorted = cells.map((c) => c.intensity).sort((a, b) => a - b);
  const pct = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const p50 = pct(0.5);
  const p75 = pct(0.75);
  const p90 = pct(0.9);
  for (const c of cells) {
    const v = c.intensity;
    if (v >= Math.max(p90, 10)) c.level = 'VERY_HIGH';
    else if (v >= Math.max(p75, 5)) c.level = 'HIGH';
    else if (v >= Math.max(p50, 2)) c.level = 'MODERATE';
    else c.level = 'LOW';
  }
}
