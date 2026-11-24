import { Injectable, Logger } from '@nestjs/common';
import { MatchConfidence, MatchType, Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { encodePolyline } from '../common/utils/geo.util';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { MatchingSettings } from '../settings/settings.schema';
import { analyzeOverlap, OverlapSample } from './domain/overlap.engine';
import { convergenceTime, evaluateMatch, samplingStep } from './domain/match-scoring';
import { CandidateRow, JourneyRouteInfo, MatchingRepository } from './matching.repository';

export interface ComputedMatch {
  journeyId: string;
  matchedJourneyId: string;
  matchedUserId: string;
  matchType: MatchType;
  sharedDistanceMeters: number;
  overlapRatioSelf: number;
  overlapRatioOther: number;
  directionSimilarity: number;
  departureDiffSeconds: number;
  convergenceTimeDiffSeconds: number;
  pickupDistanceMeters: number;
  destinationDistanceMeters: number;
  score: number;
  confidence: MatchConfidence;
  commonSegmentPolyline: string | null;
}

export interface MatchQuery {
  vehicleTypeCodes?: string[];
  minOverlapRatio?: number;
  matchTypes?: MatchType[];
  page: number;
  pageSize: number;
}

const MATCH_RESULTS_TTL_MS = 10 * 60_000;

export const MATCH_COUNT_DISCLAIMER =
  'Counts include only journeys registered in EmblemWay by people who opted in to matching. They are not a measure of all vehicles or people on the road.';

const LIVE_STATUSES = Prisma.sql`('PLANNED', 'ACTIVE')`;

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: MatchingRepository,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Computes matches for one journey against all compatible journeys and persists them
   * (both directions) atomically. Returns the newly computed matches.
   */
  async computeAndStore(journeyId: string): Promise<ComputedMatch[]> {
    const s = await this.settings.get('matching');
    const a = await this.repo.getRouteInfo(journeyId);
    if (!a || !(a.status === 'PLANNED' || a.status === 'ACTIVE')) {
      await this.clearMatches(journeyId);
      return [];
    }
    const matches = await this.compute(a, s);
    await this.prisma.withTransaction(async (tx) => {
      await tx.journeyMatch.deleteMany({
        where: { OR: [{ journeyId }, { matchedJourneyId: journeyId }] },
      });
      if (matches.length > 0) {
        await tx.journeyMatch.createMany({ data: matches, skipDuplicates: true });
        await tx.journeyMatch.createMany({
          data: matches.map((m) => mirror(m, a.userId)),
          skipDuplicates: true,
        });
      }
      // Raw update so updated_at (user edits) is not bumped by a background recomputation.
      await tx.$executeRaw`UPDATE journeys SET matches_computed_at = now() WHERE id = ${journeyId}::uuid`;
    });
    this.logger.log({ journeyId, matches: matches.length }, 'Matches computed');
    return matches;
  }

  async compute(
    a: JourneyRouteInfo,
    s: MatchingSettings,
    vehicleTypeIds?: string[],
  ): Promise<ComputedMatch[]> {
    if (a.lengthMeters <= 0) return [];
    const candidates = await this.repo.findCandidates(a, {
      corridorMeters: s.corridorWidthMeters,
      windowSeconds: s.departureWindowMinutes * 60,
      vehicleTypeIds,
      limit: s.maxCandidates,
    });
    if (candidates.length === 0) return [];
    const step = samplingStep(a.lengthMeters, s);
    const { samples, hits } = await this.repo.measureSamples(
      a.journeyId,
      candidates.map((c) => c.journey_id),
      step,
      a.lengthMeters,
      s.corridorWidthMeters,
    );
    const results: ComputedMatch[] = [];
    for (const c of candidates) {
      const m = this.evaluateCandidate(a, c, samples, hits.get(c.journey_id), step, s);
      if (m) results.push(m);
    }
    return results.sort((x, y) => y.score - x.score);
  }

  evaluateCandidate(
    a: JourneyRouteInfo,
    c: CandidateRow,
    baseSamples: Array<Omit<OverlapSample, 'withinCorridor' | 'bFraction'>>,
    candidateHits: Map<number, number> | undefined,
    step: number,
    s: MatchingSettings,
  ): ComputedMatch | null {
    const lengthB = Number(c.length_m);
    const samples: OverlapSample[] = baseSamples.map((p) => {
      const frac = candidateHits?.get(p.index);
      return { ...p, withinCorridor: frac !== undefined, bFraction: frac ?? null };
    });
    const overlap = analyzeOverlap(samples, {
      stepMeters: step,
      routeALengthMeters: a.lengthMeters,
      routeBLengthMeters: lengthB,
      corridorWidthMeters: s.corridorWidthMeters,
      maxGapSamples: s.maxGapSamples,
      minDirectionSimilarity: s.minDirectionSimilarity,
    });
    const tA = convergenceTime(a.departureAt, a.durationSeconds, overlap.firstSharedFractionA);
    const tB = convergenceTime(c.departure_at, c.duration_seconds, overlap.firstSharedFractionB);
    const ctx = {
      overlap,
      departureDiffSeconds: Math.round((a.departureAt.getTime() - c.departure_at.getTime()) / 1000),
      convergenceTimeDiffSeconds: Math.round((tA - tB) / 1000),
      sourceDistanceMeters: Number(c.source_distance_m),
      pickupDistanceMeters: Number(c.pickup_distance_m),
      destinationDistanceMeters: Number(c.destination_distance_m),
    };
    const verdict = evaluateMatch(ctx, s);
    if (!verdict.eligible) return null;
    return {
      journeyId: a.journeyId,
      matchedJourneyId: c.journey_id,
      matchedUserId: c.user_id,
      matchType: verdict.matchType,
      sharedDistanceMeters: overlap.sharedDistanceMeters,
      overlapRatioSelf: round4(overlap.overlapRatioA),
      overlapRatioOther: round4(overlap.overlapRatioB),
      directionSimilarity: round4(overlap.directionSimilarity),
      departureDiffSeconds: ctx.departureDiffSeconds,
      convergenceTimeDiffSeconds: ctx.convergenceTimeDiffSeconds,
      pickupDistanceMeters: Math.round(ctx.pickupDistanceMeters),
      destinationDistanceMeters: Math.round(ctx.destinationDistanceMeters),
      score: verdict.score,
      confidence: verdict.confidence,
      commonSegmentPolyline:
        overlap.commonSegment.length >= 2 ? encodePolyline(overlap.commonSegment) : null,
    };
  }

  async clearMatches(journeyId: string): Promise<void> {
    await this.prisma.journeyMatch.deleteMany({
      where: { OR: [{ journeyId }, { matchedJourneyId: journeyId }] },
    });
  }

  /** Matches for the owner's journey, deduplicated per traveller, with aggregate counts. */
  async getMatches(journeyId: string, userId: string, q: MatchQuery) {
    const journey = await this.prisma.journey.findFirst({
      where: { id: journeyId, userId },
      select: { id: true, status: true, matchesComputedAt: true, updatedAt: true },
    });
    if (!journey) throw AppError.notFound('Journey');
    const live = journey.status === 'PLANNED' || journey.status === 'ACTIVE';
    // Recompute when missing (edits clear it) or older than the TTL. New journeys mirror their
    // matches into existing journeys, so stored results stay current between recomputations.
    const stale =
      !journey.matchesComputedAt ||
      Date.now() - journey.matchesComputedAt.getTime() > MATCH_RESULTS_TTL_MS;
    if (live && stale) {
      await this.computeAndStore(journeyId);
    }

    const filters: Prisma.Sql[] = [Prisma.sql`m.journey_id = ${journeyId}::uuid`];
    if (q.vehicleTypeCodes?.length)
      filters.push(
        Prisma.sql`vt.code IN (${Prisma.join(q.vehicleTypeCodes.map((c) => c.toUpperCase()))})`,
      );
    if (q.minOverlapRatio !== undefined)
      filters.push(
        Prisma.sql`GREATEST(m.overlap_ratio_self, m.overlap_ratio_other) >= ${q.minOverlapRatio}`,
      );
    if (q.matchTypes?.length)
      filters.push(Prisma.sql`m.match_type::text IN (${Prisma.join(q.matchTypes)})`);
    const where = Prisma.join(filters, ' AND ');

    const base = Prisma.sql`
      SELECT m.*, j.departure_at AS matched_departure_at, j.status::text AS matched_status,
             vt.code AS vehicle_type_code, vt.name AS vehicle_type_name, vt.icon AS vehicle_type_icon,
             CASE WHEN p.show_first_name_to_matches THEN u.first_name ELSE NULL END AS display_name,
             o.id AS offer_id, o.available_seats AS offer_available_seats
        FROM journey_matches m
        JOIN journeys j ON j.id = m.matched_journey_id AND j.status IN ${LIVE_STATUSES}
        JOIN users u ON u.id = m.matched_user_id AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
        JOIN user_profiles p ON p.user_id = u.id AND p.share_journeys_for_matching
        JOIN vehicle_types vt ON vt.id = j.vehicle_type_id
        LEFT JOIN ride_pool_offers o ON o.journey_id = j.id AND o.status = 'OPEN'
       WHERE ${where}`;

    const [summaryRows, vehicleRows, items] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          total_journeys: bigint;
          distinct_users: bigint;
          same_route: bigint;
          same_destination: bigint;
          shared_start: bigint;
          partial: bigint;
        }>
      >`
        WITH m AS (${base}),
        best AS (SELECT DISTINCT ON (matched_user_id) * FROM m ORDER BY matched_user_id, score DESC, matched_journey_id)
        SELECT (SELECT count(*) FROM m) AS total_journeys,
               (SELECT count(DISTINCT matched_user_id) FROM m) AS distinct_users,
               count(*) FILTER (WHERE match_type = 'SAME_ROUTE') AS same_route,
               count(*) FILTER (WHERE match_type = 'SAME_DESTINATION') AS same_destination,
               count(*) FILTER (WHERE match_type = 'SHARED_START') AS shared_start,
               count(*) FILTER (WHERE match_type = 'PARTIAL_OVERLAP') AS partial
          FROM best`,
      this.prisma.$queryRaw<
        Array<{ code: string; name: string; travellers: bigint; journeys: bigint }>
      >`
        WITH m AS (${base})
        SELECT vehicle_type_code AS code, vehicle_type_name AS name,
               count(DISTINCT matched_user_id) AS travellers, count(*) AS journeys
          FROM m GROUP BY vehicle_type_code, vehicle_type_name ORDER BY travellers DESC, code`,
      this.prisma.$queryRaw<Array<Record<string, unknown>>>`
        WITH m AS (${base}),
        best AS (SELECT DISTINCT ON (matched_user_id) * FROM m ORDER BY matched_user_id, score DESC, matched_journey_id)
        SELECT * FROM best ORDER BY score DESC, matched_journey_id
         LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    ]);
    const sum = summaryRows[0];
    const distinctUsers = Number(sum?.distinct_users ?? 0);
    return {
      summary: {
        totalMatchingJourneys: Number(sum?.total_journeys ?? 0),
        distinctTravellers: distinctUsers,
        sameRouteTravellers: Number(sum?.same_route ?? 0),
        partialOverlapTravellers:
          Number(sum?.partial ?? 0) +
          Number(sum?.shared_start ?? 0) +
          Number(sum?.same_destination ?? 0),
        byMatchType: {
          SAME_ROUTE: Number(sum?.same_route ?? 0),
          SAME_DESTINATION: Number(sum?.same_destination ?? 0),
          SHARED_START: Number(sum?.shared_start ?? 0),
          PARTIAL_OVERLAP: Number(sum?.partial ?? 0),
        },
        byVehicleType: vehicleRows.map((v) => ({
          code: v.code,
          name: v.name,
          travellers: Number(v.travellers),
          journeys: Number(v.journeys),
        })),
        computedAt:
          (
            await this.prisma.journey.findUnique({
              where: { id: journeyId },
              select: { matchesComputedAt: true },
            })
          )?.matchesComputedAt ?? null,
        disclaimer: MATCH_COUNT_DISCLAIMER,
      },
      items: items.map(toMatchView),
      page: q.page,
      pageSize: q.pageSize,
      total: distinctUsers,
      totalPages: Math.max(1, Math.ceil(distinctUsers / q.pageSize)),
      hasNextPage: q.page * q.pageSize < distinctUsers,
    };
  }
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

/** The same pair seen from the other traveller's perspective. */
export function mirror(m: ComputedMatch, ownerUserId: string): ComputedMatch {
  return {
    ...m,
    journeyId: m.matchedJourneyId,
    matchedJourneyId: m.journeyId,
    matchedUserId: ownerUserId,
    overlapRatioSelf: m.overlapRatioOther,
    overlapRatioOther: m.overlapRatioSelf,
    departureDiffSeconds: -m.departureDiffSeconds,
    convergenceTimeDiffSeconds: -m.convergenceTimeDiffSeconds,
  };
}

function toMatchView(r: Record<string, unknown>) {
  return {
    matchedJourneyId: r.matched_journey_id as string,
    traveller: { displayName: (r.display_name as string | null) ?? 'EmblemWay traveller' },
    vehicleType: {
      code: r.vehicle_type_code as string,
      name: r.vehicle_type_name as string,
      icon: r.vehicle_type_icon as string,
    },
    matchType: r.match_type as MatchType,
    sharedDistanceMeters: Number(r.shared_distance_meters),
    overlapRatioSelf: Number(r.overlap_ratio_self),
    overlapRatioOther: Number(r.overlap_ratio_other),
    directionSimilarity: Number(r.direction_similarity),
    departureAt: (r.matched_departure_at as Date).toISOString(),
    departureDiffMinutes: Math.round(Number(r.departure_diff_seconds) / 60),
    convergenceTimeDiffMinutes: Math.round(Number(r.convergence_time_diff_seconds) / 60),
    pickupDistanceMeters: Number(r.pickup_distance_meters),
    destinationDistanceMeters: Number(r.destination_distance_meters),
    score: Number(r.score),
    confidence: r.confidence as MatchConfidence,
    commonSegmentPolyline: (r.common_segment_polyline as string | null) ?? null,
    ridePool: r.offer_id
      ? { offerId: r.offer_id as string, availableSeats: Number(r.offer_available_seats) }
      : null,
  };
}
