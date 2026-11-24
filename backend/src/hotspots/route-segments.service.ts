import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { boxToPolygonWkt, gridCellFor, GridCell, LatLng, resample } from '../common/utils/geo.util';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Road-corridor segments: a route is resampled every quarter-cell and each sample is
 * snapped to a metric grid cell. The ordered, de-duplicated list of cells a journey
 * passes through lets us count travellers per stretch of road with a simple GROUP BY.
 */
@Injectable()
export class RouteSegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  static cellsForRoute(points: readonly LatLng[], cellSizeMeters: number): GridCell[] {
    const seen = new Set<string>();
    const cells: GridCell[] = [];
    for (const p of resample(points, Math.max(25, cellSizeMeters / 4))) {
      const cell = gridCellFor(p, cellSizeMeters);
      if (!seen.has(cell.key)) {
        seen.add(cell.key);
        cells.push(cell);
      }
    }
    return cells;
  }

  async assign(
    tx: Tx,
    journeyId: string,
    cityId: string | null,
    points: readonly LatLng[],
  ): Promise<number> {
    const { segmentCellSizeMeters } = await this.settings.get('hotspots');
    const cells = RouteSegmentsService.cellsForRoute(points, segmentCellSizeMeters);
    await tx.journeyRouteSegment.deleteMany({ where: { journeyId } });
    if (cells.length === 0) return 0;
    // Insert in key order so concurrent transactions lock rows in the same order (no deadlocks).
    const sorted = [...cells].sort((a, b) => a.key.localeCompare(b.key));
    for (let i = 0; i < sorted.length; i += 500) {
      const chunk = sorted.slice(i, i + 500);
      await tx.$executeRaw`
        INSERT INTO route_segments (id, city_id, cell_key, center_latitude, center_longitude, geom)
        VALUES ${Prisma.join(
          chunk.map(
            (
              c,
            ) => Prisma.sql`(gen_random_uuid(), ${cityId}::uuid, ${c.key}, ${c.center.latitude}, ${c.center.longitude},
                              ST_GeomFromText(${boxToPolygonWkt(c.bounds)}, 4326))`,
          ),
        )}
        ON CONFLICT (cell_key) DO NOTHING`;
    }
    const order = new Map(cells.map((c, i) => [c.key, i]));
    const rows = await tx.routeSegment.findMany({
      where: { cellKey: { in: cells.map((c) => c.key) } },
      select: { id: true, cellKey: true },
    });
    await tx.journeyRouteSegment.createMany({
      data: rows.map((r) => ({ journeyId, segmentId: r.id, sequence: order.get(r.cellKey)! })),
      skipDuplicates: true,
    });
    return rows.length;
  }

  /**
   * Distinct OTHER travellers (planned/active, time compatible) passing through each
   * segment of the given journey. A journey is counted at most once per segment.
   */
  async segmentCounts(journeyId: string, userId: string) {
    const journey = await this.prisma.journey.findFirst({
      where: { id: journeyId, userId },
      select: { id: true, departureAt: true },
    });
    if (!journey) throw AppError.notFound('Journey');
    const { departureWindowMinutes } = await this.settings.get('matching');
    const rows = await this.prisma.$queryRaw<
      Array<{
        segment_id: string;
        sequence: number;
        lat: number;
        lng: number;
        travellers: bigint;
        journeys: bigint;
        by_vehicle: Record<string, number> | null;
      }>
    >`
      WITH mine AS (
        SELECT s.id, jrs.sequence, s.center_latitude AS lat, s.center_longitude AS lng
          FROM journey_route_segments jrs JOIN route_segments s ON s.id = jrs.segment_id
         WHERE jrs.journey_id = ${journeyId}::uuid
      ),
      others AS (
        SELECT jrs.segment_id, j.id AS journey_id, j.user_id, vt.code
          FROM journey_route_segments jrs
          JOIN journeys j ON j.id = jrs.journey_id
          JOIN users u ON u.id = j.user_id AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
          JOIN user_profiles p ON p.user_id = u.id AND p.share_journeys_for_matching
          JOIN vehicle_types vt ON vt.id = j.vehicle_type_id
         WHERE jrs.segment_id IN (SELECT id FROM mine)
           AND j.id <> ${journeyId}::uuid AND j.user_id <> ${userId}::uuid
           AND j.status IN ('PLANNED', 'ACTIVE')
           AND j.departure_at BETWEEN ${journey.departureAt}::timestamptz - make_interval(mins => ${departureWindowMinutes * 4}::int)
                                  AND ${journey.departureAt}::timestamptz + make_interval(mins => ${departureWindowMinutes * 4}::int)
      ),
      per_vehicle AS (
        SELECT segment_id, code, count(DISTINCT user_id) AS n FROM others GROUP BY segment_id, code
      )
      SELECT mine.id AS segment_id, mine.sequence, mine.lat, mine.lng,
             count(DISTINCT o.user_id) AS travellers, count(DISTINCT o.journey_id) AS journeys,
             (SELECT jsonb_object_agg(code, n) FROM per_vehicle pv WHERE pv.segment_id = mine.id) AS by_vehicle
        FROM mine LEFT JOIN others o ON o.segment_id = mine.id
       GROUP BY mine.id, mine.sequence, mine.lat, mine.lng
       ORDER BY mine.sequence`;
    return {
      cellSizeMeters: (await this.settings.get('hotspots')).segmentCellSizeMeters,
      timeWindowMinutes: departureWindowMinutes * 4,
      segments: rows.map((r) => ({
        segmentId: r.segment_id,
        sequence: r.sequence,
        center: { latitude: Number(r.lat), longitude: Number(r.lng) },
        travellers: Number(r.travellers),
        journeys: Number(r.journeys),
        byVehicleType: r.by_vehicle ?? {},
      })),
      disclaimer: 'Counts reflect registered EmblemWay journeys only, not all road traffic.',
    };
  }
}
