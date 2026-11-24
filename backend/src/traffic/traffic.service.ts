import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, RoutingProfile, VehicleType } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { AppError, ErrorCode } from '../common/errors/app-error';
import {
  decodePolyline,
  haversineMeters,
  LatLng,
  resample,
  roundedCoordKey,
} from '../common/utils/geo.util';
import { addMinutes, addSeconds, floorToBucket } from '../common/utils/time.util';
import {
  MapsProviderError,
  ROUTING_PROVIDER,
  RoutingProvider,
  SpeedInterval,
} from '../maps/maps.types';
import { PICKUP_VIA_THRESHOLD_M } from '../maps/routing.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SettingsService } from '../settings/settings.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import {
  DEPARTURE_SCENARIOS,
  Freshness,
  recommend,
  ScenarioEstimate,
  TRAFFIC_DISCLAIMER,
} from './domain/recommendation';

export interface TrafficRouteInput {
  source: LatLng;
  destination: LatLng;
  pickup?: LatLng | null;
  vehicleType: VehicleType;
  journeyId?: string;
}

interface CachedEstimate {
  durationSeconds: number;
  staticDurationSeconds: number | null;
  distanceMeters: number;
  fetchedAt: string;
}

const CONGESTION_VALUE: Record<SpeedInterval['speed'], number> = {
  NORMAL: 0,
  SLOW: 0.5,
  TRAFFIC_JAM: 1,
};

@Injectable()
export class TrafficService {
  private readonly logger = new Logger(TrafficService.name);

  constructor(
    @Inject(ROUTING_PROVIDER) private readonly provider: RoutingProvider,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly config: AppConfigService,
    private readonly vehicles: VehiclesService,
  ) {}

  async predictForJourney(journeyId: string, userId: string, now = new Date()) {
    const journey = await this.prisma.journey.findFirst({
      where: { id: journeyId, userId },
      include: { locations: true, vehicleType: true },
    });
    if (!journey) throw AppError.notFound('Journey');
    const get = (k: string) => journey.locations.find((l) => l.kind === k);
    const src = get('SOURCE');
    const dst = get('DESTINATION');
    if (!src || !dst)
      throw new AppError(
        ErrorCode.ROUTE_NOT_FOUND,
        'Journey locations are no longer available',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const pick = get('PICKUP');
    return this.predict(
      {
        source: src,
        destination: dst,
        pickup: pick ?? null,
        vehicleType: journey.vehicleType,
        journeyId,
      },
      now,
    );
  }

  async predictAdHoc(
    input: { source: LatLng; destination: LatLng; pickup?: LatLng; vehicleTypeCode: string },
    now = new Date(),
  ) {
    if (haversineMeters(input.source, input.destination) < 100) {
      throw new AppError(
        ErrorCode.SAME_SOURCE_DESTINATION,
        'Source and destination must be different places',
        HttpStatus.BAD_REQUEST,
      );
    }
    const vehicleType = await this.vehicles.getActiveByCode(input.vehicleTypeCode);
    return this.predict({ ...input, vehicleType }, now);
  }

  async predict(input: TrafficRouteInput, now = new Date()) {
    const tSettings = await this.settings.get('traffic');
    const profile = input.vehicleType.routingProfile;
    const via =
      input.pickup && haversineMeters(input.source, input.pickup) > PICKUP_VIA_THRESHOLD_M
        ? [input.pickup]
        : undefined;
    const routeKey = [
      roundedCoordKey(input.source),
      ...(via ?? []).map((p) => roundedCoordKey(p)),
      roundedCoordKey(input.destination),
    ].join('|');

    const estimates: ScenarioEstimate[] = await Promise.all(
      DEPARTURE_SCENARIOS.map(async ({ scenario, offsetMinutes }) => {
        const departure = addMinutes(now, offsetMinutes);
        const base: ScenarioEstimate = {
          scenario,
          offsetMinutes,
          departureAt: departure.toISOString(),
          status: 'UNAVAILABLE',
          durationSeconds: null,
          staticDurationSeconds: null,
          delaySeconds: null,
          arrivalAt: null,
          distanceMeters: null,
          fetchedAt: null,
          freshness: null,
          reason: null,
        };
        if (!input.vehicleType.trafficSupported) {
          return {
            ...base,
            status: 'UNSUPPORTED' as const,
            reason: `Traffic-aware estimates are not available for ${input.vehicleType.name.toLowerCase()} travel.`,
          };
        }
        return this.estimateScenario(base, {
          input,
          via,
          profile,
          routeKey,
          departure,
          offsetMinutes,
          now,
          staleAfterMinutes: tSettings.staleAfterMinutes,
        });
      }),
    );

    return {
      provider: this.provider.name,
      isLiveData: this.provider.isLive,
      routingProfile: profile,
      vehicleType: { code: input.vehicleType.code, name: input.vehicleType.name },
      approximationNote: input.vehicleType.approximationNote,
      generatedAt: now.toISOString(),
      estimates,
      recommendation: recommend(estimates, tSettings),
      disclaimer: TRAFFIC_DISCLAIMER,
    };
  }

  private async estimateScenario(
    base: ScenarioEstimate,
    ctx: {
      input: TrafficRouteInput;
      via?: LatLng[];
      profile: RoutingProfile;
      routeKey: string;
      departure: Date;
      offsetMinutes: number;
      now: Date;
      staleAfterMinutes: number;
    },
  ): Promise<ScenarioEstimate> {
    const bucket = floorToBucket(ctx.departure, 5).getTime();
    const cacheKey = `traffic:${this.provider.name}:${ctx.profile}:${ctx.routeKey}:${ctx.offsetMinutes}:${bucket}`;
    const cached = await this.redis.getJson<CachedEstimate>(cacheKey);
    if (cached)
      return this.toEstimate(
        base,
        cached,
        ctx.departure,
        freshnessOf(cached.fetchedAt, ctx.now, ctx.staleAfterMinutes, true),
      );

    try {
      const result = await this.provider.computeRoutes({
        origin: ctx.input.source,
        destination: ctx.input.destination,
        via: ctx.via,
        profile: ctx.profile,
        // "Now" is requested without departureTime; future scenarios add 30 s headroom so the
        // timestamp is still in the future when the provider receives it.
        departureTime: ctx.offsetMinutes === 0 ? undefined : addSeconds(ctx.departure, 30),
        trafficAware: true,
        includeSpeedIntervals: ctx.offsetMinutes === 0,
      });
      const route = result.routes[0]!;
      const fresh: CachedEstimate = {
        durationSeconds: route.durationSeconds,
        staticDurationSeconds: route.staticDurationSeconds,
        distanceMeters: route.distanceMeters,
        fetchedAt: result.fetchedAt.toISOString(),
      };
      await this.redis.setJson(cacheKey, fresh, this.config.get('TRAFFIC_CACHE_TTL_SECONDS'));
      await this.saveSnapshot(
        ctx,
        route.durationSeconds,
        route.staticDurationSeconds,
        route.distanceMeters,
        'OK',
        null,
        route.speedIntervals ? toIntervalGeo(route.encodedPolyline, route.speedIntervals) : null,
      );
      return this.toEstimate(base, fresh, ctx.departure, 'LIVE');
    } catch (err) {
      const kind = err instanceof MapsProviderError ? err.kind : 'UNAVAILABLE';
      if (kind === 'UNSUPPORTED')
        return { ...base, status: 'UNSUPPORTED', reason: (err as Error).message };
      this.logger.warn({ scenario: base.scenario, kind }, 'Traffic estimate failed');
      await this.saveSnapshot(ctx, null, null, null, 'UNAVAILABLE', kind, null);
      // Fall back to the most recent stored estimate - clearly labelled STALE, never as live.
      const last = await this.prisma.trafficSnapshot.findFirst({
        where: {
          routeKey: ctx.routeKey,
          routingProfile: ctx.profile,
          departureOffsetMinutes: ctx.offsetMinutes,
          status: 'OK',
          provider: this.provider.name,
        },
        orderBy: { fetchedAt: 'desc' },
      });
      if (last?.durationSeconds && ctx.now.getTime() - last.fetchedAt.getTime() < 6 * 3600_000) {
        return {
          ...this.toEstimate(
            base,
            {
              durationSeconds: last.durationSeconds,
              staticDurationSeconds: last.staticDurationSeconds,
              distanceMeters: last.distanceMeters ?? 0,
              fetchedAt: last.fetchedAt.toISOString(),
            },
            ctx.departure,
            'STALE',
          ),
          reason: 'Live traffic is temporarily unavailable; showing the last known estimate.',
        };
      }
      return { ...base, status: 'UNAVAILABLE', reason: reasonFor(kind) };
    }
  }

  private toEstimate(
    base: ScenarioEstimate,
    e: CachedEstimate,
    departure: Date,
    freshness: Freshness,
  ): ScenarioEstimate {
    const delay =
      e.staticDurationSeconds !== null
        ? Math.max(0, e.durationSeconds - e.staticDurationSeconds)
        : null;
    return {
      ...base,
      status: 'OK',
      durationSeconds: e.durationSeconds,
      staticDurationSeconds: e.staticDurationSeconds,
      delaySeconds: delay,
      arrivalAt: addSeconds(departure, e.durationSeconds).toISOString(),
      distanceMeters: e.distanceMeters,
      fetchedAt: e.fetchedAt,
      freshness,
    };
  }

  private async saveSnapshot(
    ctx: {
      input: TrafficRouteInput;
      profile: RoutingProfile;
      routeKey: string;
      departure: Date;
      offsetMinutes: number;
    },
    duration: number | null,
    staticDuration: number | null,
    distance: number | null,
    status: 'OK' | 'UNAVAILABLE',
    errorCode: string | null,
    intervals: Array<{ congestion: number; points: Array<[number, number]> }> | null,
  ): Promise<void> {
    try {
      await this.prisma.trafficSnapshot.create({
        data: {
          journeyId: ctx.input.journeyId ?? null,
          routeKey: ctx.routeKey,
          routingProfile: ctx.profile,
          departureOffsetMinutes: ctx.offsetMinutes,
          requestedDepartureAt: ctx.departure,
          status,
          durationSeconds: duration,
          staticDurationSeconds: staticDuration,
          distanceMeters: distance,
          speedIntervals: intervals
            ? (intervals as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          provider: this.provider.name,
          errorCode,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to persist traffic snapshot: ${(err as Error).message}`);
    }
  }

  async purgeSnapshotsOlderThan(cutoff: Date): Promise<number> {
    return (await this.prisma.trafficSnapshot.deleteMany({ where: { fetchedAt: { lt: cutoff } } }))
      .count;
  }
}

export function freshnessOf(
  fetchedAtIso: string,
  now: Date,
  staleAfterMinutes: number,
  fromCache: boolean,
): Freshness {
  const ageMs = now.getTime() - new Date(fetchedAtIso).getTime();
  if (ageMs > staleAfterMinutes * 60_000) return 'STALE';
  return fromCache ? 'CACHED' : 'LIVE';
}

function reasonFor(kind: string): string {
  switch (kind) {
    case 'QUOTA':
      return 'Traffic service quota reached. Please try again later.';
    case 'TIMEOUT':
      return 'Traffic service did not respond in time.';
    case 'REJECTED':
      return 'Traffic estimate is not available for this departure time.';
    case 'NOT_FOUND':
      return 'No route found for this trip.';
    default:
      return 'Traffic service is temporarily unavailable.';
  }
}

/** Converts polyline-index intervals to coordinate samples (~every 200 m) for hotspot aggregation. */
export function toIntervalGeo(
  encoded: string,
  intervals: SpeedInterval[],
): Array<{ congestion: number; points: Array<[number, number]> }> {
  const pts = decodePolyline(encoded);
  return intervals
    .filter((i) => i.endIndex > i.startIndex && i.startIndex < pts.length)
    .map((i) => ({
      congestion: CONGESTION_VALUE[i.speed],
      points: resample(pts.slice(i.startIndex, Math.min(pts.length, i.endIndex + 1)), 200).map(
        (p) => [round5(p.latitude), round5(p.longitude)] as [number, number],
      ),
    }));
}

function round5(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}
