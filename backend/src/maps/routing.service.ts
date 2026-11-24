import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { RoutingProfile } from '@prisma/client';
import { AppError, ErrorCode } from '../common/errors/app-error';
import {
  decodePolyline,
  dedupeConsecutive,
  haversineMeters,
  LatLng,
  pathLengthMeters,
} from '../common/utils/geo.util';
import { toAppError } from './maps-error.mapper';
import { ComputedRoute, ROUTING_PROVIDER, RoutingProvider } from './maps.types';

export interface PlannedRoute extends ComputedRoute {
  points: LatLng[];
  alternativeIndex: number;
}

export interface PlanRouteInput {
  source: LatLng;
  destination: LatLng;
  pickup?: LatLng | null;
  profile: RoutingProfile;
  alternatives?: boolean;
}

/** A pickup closer than this to the source is treated as the same point (no via-waypoint). */
export const PICKUP_VIA_THRESHOLD_M = 100;

/**
 * Journey route generation: calls the routing provider and validates the returned
 * geometry before it is allowed anywhere near the database or the matching engine.
 */
@Injectable()
export class RoutingService {
  constructor(@Inject(ROUTING_PROVIDER) private readonly provider: RoutingProvider) {}

  get providerName(): string {
    return this.provider.name;
  }

  get isLive(): boolean {
    return this.provider.isLive;
  }

  async planRoutes(input: PlanRouteInput): Promise<PlannedRoute[]> {
    const via =
      input.pickup && haversineMeters(input.source, input.pickup) > PICKUP_VIA_THRESHOLD_M
        ? [input.pickup]
        : undefined;
    const trafficAware = input.profile === 'DRIVE' || input.profile === 'TWO_WHEELER';
    let result;
    try {
      result = await this.provider.computeRoutes({
        origin: input.source,
        destination: input.destination,
        via,
        profile: input.profile,
        trafficAware,
        computeAlternatives: input.alternatives ?? true,
        highQualityPolyline: true,
      });
    } catch (err) {
      throw toAppError(err);
    }
    const planned = result.routes.map((r, i) => ({
      ...r,
      ...validateGeometry(r.encodedPolyline),
      alternativeIndex: i,
    }));
    return planned;
  }
}

/** Decode + sanity check a provider polyline. Throws ROUTE_GEOMETRY_INVALID on bad input. */
export function validateGeometry(encoded: string): { points: LatLng[] } {
  let points: LatLng[];
  try {
    points = dedupeConsecutive(decodePolyline(encoded));
  } catch {
    throw new AppError(
      ErrorCode.ROUTE_GEOMETRY_INVALID,
      'Route geometry could not be decoded',
      HttpStatus.BAD_GATEWAY,
    );
  }
  if (points.length < 2 || pathLengthMeters(points) < 1) {
    throw new AppError(
      ErrorCode.ROUTE_GEOMETRY_INVALID,
      'Route geometry is empty or zero-length',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (
    points.some(
      (p) =>
        !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180,
    )
  ) {
    throw new AppError(
      ErrorCode.ROUTE_GEOMETRY_INVALID,
      'Route geometry contains invalid coordinates',
      HttpStatus.BAD_GATEWAY,
    );
  }
  return { points };
}
