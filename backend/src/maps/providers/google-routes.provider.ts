import {
  MapsProviderError,
  RouteRequest,
  RoutesResult,
  RoutingProvider,
  SpeedInterval,
  ComputedRoute,
} from '../maps.types';
import { GoogleHttpClient } from './google-http.client';
import { QuotaGuard } from '../resilience/quota.guard';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const FIELD_MASK = [
  'routes.distanceMeters',
  'routes.duration',
  'routes.staticDuration',
  'routes.polyline.encodedPolyline',
  'routes.routeLabels',
  'routes.travelAdvisory.speedReadingIntervals',
].join(',');

interface GoogleRoute {
  distanceMeters?: number;
  duration?: string;
  staticDuration?: string;
  polyline?: { encodedPolyline?: string };
  routeLabels?: string[];
  travelAdvisory?: {
    speedReadingIntervals?: Array<{
      startPolylinePointIndex?: number;
      endPolylinePointIndex?: number;
      speed?: string;
    }>;
  };
}

/** "1234s" / "12.5s" -> 1234 / 13 */
export function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return m ? Math.round(Number(m[1])) : null;
}

const TRAFFIC_PROFILES = new Set(['DRIVE', 'TWO_WHEELER']);

/** Google Routes API (v2 computeRoutes). Traffic-aware for DRIVE and TWO_WHEELER. */
export class GoogleRoutesProvider implements RoutingProvider {
  readonly name = 'google';
  readonly isLive = true;

  constructor(
    private readonly http: GoogleHttpClient,
    private readonly apiKey: string,
    private readonly quota: QuotaGuard,
  ) {}

  buildBody(req: RouteRequest): Record<string, unknown> {
    const traffic = req.trafficAware && TRAFFIC_PROFILES.has(req.profile);
    if (req.trafficAware && !traffic) {
      throw new MapsProviderError(
        'UNSUPPORTED',
        `Traffic-aware routing is not available for ${req.profile}`,
      );
    }
    if (req.departureTime && req.departureTime.getTime() <= Date.now()) {
      throw new MapsProviderError('REJECTED', 'departureTime must be in the future');
    }
    const loc = (p: { latitude: number; longitude: number }) => ({
      location: { latLng: { latitude: p.latitude, longitude: p.longitude } },
    });
    return {
      origin: loc(req.origin),
      destination: loc(req.destination),
      ...(req.via?.length ? { intermediates: req.via.map((p) => ({ ...loc(p), via: true })) } : {}),
      travelMode: req.profile,
      ...(traffic ? { routingPreference: 'TRAFFIC_AWARE_OPTIMAL' } : {}),
      ...(req.departureTime ? { departureTime: req.departureTime.toISOString() } : {}),
      computeAlternativeRoutes: !!req.computeAlternatives && !req.via?.length,
      polylineQuality: req.highQualityPolyline ? 'HIGH_QUALITY' : 'OVERVIEW',
      polylineEncoding: 'ENCODED_POLYLINE',
      ...(traffic && req.includeSpeedIntervals
        ? { extraComputations: ['TRAFFIC_ON_POLYLINE'] }
        : {}),
      languageCode: 'en-IN',
      regionCode: 'IN',
      units: 'METRIC',
    };
  }

  async computeRoutes(req: RouteRequest): Promise<RoutesResult> {
    const body = this.buildBody(req);
    await this.quota.acquire('routes');
    const res = await this.http.request<{ routes?: GoogleRoute[] }>(
      {
        url: ROUTES_URL,
        method: 'POST',
        headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': FIELD_MASK },
        body,
      },
      'routes.computeRoutes',
    );
    const routes = (res.routes ?? [])
      .map(toComputedRoute)
      .filter((r): r is ComputedRoute => r !== null);
    if (routes.length === 0)
      throw new MapsProviderError('NOT_FOUND', 'No drivable route found between these points');
    return { routes, provider: this.name, fetchedAt: new Date() };
  }
}

export function toComputedRoute(r: GoogleRoute): ComputedRoute | null {
  const encoded = r.polyline?.encodedPolyline;
  const duration = parseDuration(r.duration);
  if (!encoded || duration === null || !r.distanceMeters) return null;
  const intervals: SpeedInterval[] | null = r.travelAdvisory?.speedReadingIntervals
    ? r.travelAdvisory.speedReadingIntervals
        .filter((i) => i.speed === 'NORMAL' || i.speed === 'SLOW' || i.speed === 'TRAFFIC_JAM')
        .map((i) => ({
          // proto3 omits zero values, so a missing start index means 0.
          startIndex: i.startPolylinePointIndex ?? 0,
          endIndex: i.endPolylinePointIndex ?? 0,
          speed: i.speed as SpeedInterval['speed'],
        }))
    : null;
  return {
    encodedPolyline: encoded,
    distanceMeters: r.distanceMeters,
    durationSeconds: duration,
    staticDurationSeconds: parseDuration(r.staticDuration),
    speedIntervals: intervals,
    labels: r.routeLabels ?? [],
  };
}
