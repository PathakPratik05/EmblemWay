import type { RoutingProfile } from '@prisma/client';
import type { LatLng } from '../common/utils/geo.util';

export type SpeedCategory = 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM';

export interface SpeedInterval {
  startIndex: number;
  endIndex: number;
  speed: SpeedCategory;
}

export interface RouteRequest {
  origin: LatLng;
  destination: LatLng;
  /** Pass-through waypoints (e.g. a pickup point). */
  via?: LatLng[];
  profile: RoutingProfile;
  /** undefined = depart now. Must be in the future when set. */
  departureTime?: Date;
  trafficAware: boolean;
  computeAlternatives?: boolean;
  highQualityPolyline?: boolean;
  includeSpeedIntervals?: boolean;
}

export interface ComputedRoute {
  encodedPolyline: string;
  distanceMeters: number;
  durationSeconds: number;
  /** Duration without traffic, when the provider reports it. */
  staticDurationSeconds: number | null;
  speedIntervals: SpeedInterval[] | null;
  labels: string[];
}

export interface RoutesResult {
  routes: ComputedRoute[];
  provider: string;
  fetchedAt: Date;
}

export interface PlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
}

export interface PlaceDetails {
  placeId: string;
  name: string;
  address: string;
  location: LatLng;
}

export interface ReverseGeocodeResult {
  placeId: string | null;
  address: string;
  name: string;
}

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');
export const PLACES_PROVIDER = Symbol('PLACES_PROVIDER');

export interface RoutingProvider {
  readonly name: string;
  /** Whether results come from a real live provider (false for the dev mock). */
  readonly isLive: boolean;
  computeRoutes(req: RouteRequest): Promise<RoutesResult>;
}

export interface PlacesProvider {
  readonly name: string;
  autocomplete(
    input: string,
    sessionToken: string | undefined,
    bias?: { center: LatLng; radiusMeters: number },
  ): Promise<PlaceSuggestion[]>;
  details(placeId: string, sessionToken: string | undefined): Promise<PlaceDetails>;
  reverseGeocode(point: LatLng): Promise<ReverseGeocodeResult>;
}

export type MapsErrorKind =
  | 'QUOTA'
  | 'UNAVAILABLE'
  | 'REJECTED'
  | 'NOT_FOUND'
  | 'UNSUPPORTED'
  | 'TIMEOUT';

export class MapsProviderError extends Error {
  constructor(
    public readonly kind: MapsErrorKind,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'MapsProviderError';
  }

  get retryable(): boolean {
    return this.kind === 'UNAVAILABLE' || this.kind === 'TIMEOUT';
  }
}
