import {
  encodePolyline,
  haversineMeters,
  LatLng,
  pathLengthMeters,
  resample,
} from '../../common/utils/geo.util';
import {
  ComputedRoute,
  MapsProviderError,
  PlaceDetails,
  PlaceSuggestion,
  PlacesProvider,
  ReverseGeocodeResult,
  RouteRequest,
  RoutesResult,
  RoutingProvider,
  SpeedInterval,
} from '../maps.types';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DEVELOPMENT / AUTOMATED-TEST PROVIDERS. NOT REAL DATA.
 *  Environment validation refuses MAPS_PROVIDER=mock in staging/production and every
 *  response produced here is tagged provider="mock" so clients label it accordingly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const FREE_FLOW_KMH: Record<RouteRequest['profile'], number> = {
  DRIVE: 40,
  TWO_WHEELER: 38,
  BICYCLE: 14,
  WALK: 4.8,
};

/** Deterministic congestion multiplier by local (IST) hour - a crude stand-in for traffic. */
export function mockCongestionFactor(at: Date): number {
  const istHour = new Date(at.getTime() + 330 * 60_000).getUTCHours(); // IST = UTC+05:30
  if ((istHour >= 8 && istHour < 11) || (istHour >= 17 && istHour < 21)) return 1.6;
  if (istHour === 7 || istHour === 11 || istHour === 16 || istHour === 21) return 1.25;
  return 1.05;
}

export class MockRoutingProvider implements RoutingProvider {
  readonly name = 'mock';
  readonly isLive = false;

  async computeRoutes(req: RouteRequest): Promise<RoutesResult> {
    const traffic = req.trafficAware && (req.profile === 'DRIVE' || req.profile === 'TWO_WHEELER');
    if (req.trafficAware && !traffic)
      throw new MapsProviderError(
        'UNSUPPORTED',
        `Traffic-aware routing is not available for ${req.profile}`,
      );
    if (req.departureTime && req.departureTime.getTime() <= Date.now() - 1000) {
      throw new MapsProviderError('REJECTED', 'departureTime must be in the future');
    }
    const stops = [req.origin, ...(req.via ?? []), req.destination];
    if (haversineMeters(req.origin, req.destination) < 1 && !req.via?.length) {
      throw new MapsProviderError('NOT_FOUND', 'Origin and destination are the same point');
    }
    // Straight segments between stops, densified every 100 m so geometry behaves like a real polyline.
    const points: LatLng[] = [];
    for (let i = 1; i < stops.length; i += 1) {
      const leg = resample([stops[i - 1]!, stops[i]!], 100);
      points.push(...(i === 1 ? leg : leg.slice(1)));
    }
    const distance = Math.max(1, Math.round(pathLengthMeters(points)));
    const staticSeconds = Math.round((distance / 1000 / FREE_FLOW_KMH[req.profile]) * 3600);
    const factor = traffic ? mockCongestionFactor(req.departureTime ?? new Date()) : 1;
    const route: ComputedRoute = {
      encodedPolyline: encodePolyline(points),
      distanceMeters: distance,
      durationSeconds: Math.round(staticSeconds * factor),
      staticDurationSeconds: staticSeconds,
      speedIntervals:
        traffic && req.includeSpeedIntervals ? mockSpeedIntervals(points.length, factor) : null,
      labels: ['DEFAULT_ROUTE'],
    };
    return { routes: [route], provider: this.name, fetchedAt: new Date() };
  }
}

function mockSpeedIntervals(pointCount: number, factor: number): SpeedInterval[] {
  const last = pointCount - 1;
  if (factor < 1.2 || last < 3) return [{ startIndex: 0, endIndex: last, speed: 'NORMAL' }];
  const a = Math.floor(last / 3);
  const b = Math.floor((2 * last) / 3);
  return [
    { startIndex: 0, endIndex: a, speed: 'NORMAL' },
    { startIndex: a, endIndex: b, speed: factor >= 1.5 ? 'TRAFFIC_JAM' : 'SLOW' },
    { startIndex: b, endIndex: last, speed: 'SLOW' },
  ];
}

/** Small gazetteer of real Pune / Mumbai / Bengaluru landmarks for offline development. */
export const MOCK_GAZETTEER: ReadonlyArray<PlaceDetails> = [
  {
    placeId: 'mock-pune-station',
    name: 'Pune Railway Station',
    address: 'Agarkar Nagar, Pune, Maharashtra 411001',
    location: { latitude: 18.5289, longitude: 73.8744 },
  },
  {
    placeId: 'mock-shivajinagar',
    name: 'Shivajinagar',
    address: 'Shivajinagar, Pune, Maharashtra 411005',
    location: { latitude: 18.5308, longitude: 73.8475 },
  },
  {
    placeId: 'mock-hinjewadi-ph1',
    name: 'Hinjewadi Phase 1',
    address: 'Hinjewadi Rajiv Gandhi Infotech Park, Pune 411057',
    location: { latitude: 18.5912, longitude: 73.7389 },
  },
  {
    placeId: 'mock-hinjewadi-ph3',
    name: 'Hinjewadi Phase 3',
    address: 'Maan, Hinjewadi Phase 3, Pune 411057',
    location: { latitude: 18.5826, longitude: 73.6868 },
  },
  {
    placeId: 'mock-kharadi',
    name: 'Kharadi (EON IT Park)',
    address: 'Kharadi, Pune, Maharashtra 411014',
    location: { latitude: 18.5515, longitude: 73.9348 },
  },
  {
    placeId: 'mock-viman-nagar',
    name: 'Viman Nagar',
    address: 'Viman Nagar, Pune, Maharashtra 411014',
    location: { latitude: 18.5679, longitude: 73.9143 },
  },
  {
    placeId: 'mock-pune-airport',
    name: 'Pune International Airport',
    address: 'Lohegaon, Pune, Maharashtra 411032',
    location: { latitude: 18.5793, longitude: 73.9089 },
  },
  {
    placeId: 'mock-swargate',
    name: 'Swargate Bus Stand',
    address: 'Swargate, Pune, Maharashtra 411042',
    location: { latitude: 18.5018, longitude: 73.8636 },
  },
  {
    placeId: 'mock-kothrud',
    name: 'Kothrud',
    address: 'Kothrud, Pune, Maharashtra 411038',
    location: { latitude: 18.5074, longitude: 73.8077 },
  },
  {
    placeId: 'mock-baner',
    name: 'Baner',
    address: 'Baner, Pune, Maharashtra 411045',
    location: { latitude: 18.559, longitude: 73.7868 },
  },
  {
    placeId: 'mock-wakad',
    name: 'Wakad',
    address: 'Wakad, Pimpri-Chinchwad, Maharashtra 411057',
    location: { latitude: 18.5975, longitude: 73.7707 },
  },
  {
    placeId: 'mock-magarpatta',
    name: 'Magarpatta City',
    address: 'Hadapsar, Pune, Maharashtra 411013',
    location: { latitude: 18.5158, longitude: 73.9272 },
  },
  {
    placeId: 'mock-hadapsar',
    name: 'Hadapsar',
    address: 'Hadapsar, Pune, Maharashtra 411028',
    location: { latitude: 18.5089, longitude: 73.926 },
  },
  {
    placeId: 'mock-koregaon-park',
    name: 'Koregaon Park',
    address: 'Koregaon Park, Pune, Maharashtra 411001',
    location: { latitude: 18.5362, longitude: 73.8939 },
  },
  {
    placeId: 'mock-aundh',
    name: 'Aundh',
    address: 'Aundh, Pune, Maharashtra 411007',
    location: { latitude: 18.5584, longitude: 73.8077 },
  },
  {
    placeId: 'mock-pimpri',
    name: 'Pimpri',
    address: 'Pimpri, Pimpri-Chinchwad, Maharashtra 411018',
    location: { latitude: 18.6298, longitude: 73.7997 },
  },
  {
    placeId: 'mock-chinchwad',
    name: 'Chinchwad',
    address: 'Chinchwad, Pimpri-Chinchwad, Maharashtra 411033',
    location: { latitude: 18.6446, longitude: 73.7926 },
  },
  {
    placeId: 'mock-katraj',
    name: 'Katraj',
    address: 'Katraj, Pune, Maharashtra 411046',
    location: { latitude: 18.4529, longitude: 73.8652 },
  },
  {
    placeId: 'mock-mumbai-cst',
    name: 'Chhatrapati Shivaji Maharaj Terminus',
    address: 'Fort, Mumbai, Maharashtra 400001',
    location: { latitude: 18.9398, longitude: 72.8355 },
  },
  {
    placeId: 'mock-bandra-kurla',
    name: 'Bandra Kurla Complex',
    address: 'BKC, Mumbai, Maharashtra 400051',
    location: { latitude: 19.0607, longitude: 72.8633 },
  },
  {
    placeId: 'mock-bengaluru-majestic',
    name: 'Kempegowda Bus Station (Majestic)',
    address: 'Gandhi Nagar, Bengaluru, Karnataka 560009',
    location: { latitude: 12.9767, longitude: 77.5713 },
  },
  {
    placeId: 'mock-bengaluru-whitefield',
    name: 'Whitefield',
    address: 'Whitefield, Bengaluru, Karnataka 560066',
    location: { latitude: 12.9698, longitude: 77.75 },
  },
];

export class MockPlacesProvider implements PlacesProvider {
  readonly name = 'mock';

  async autocomplete(
    input: string,
    _sessionToken?: string,
    bias?: { center: LatLng; radiusMeters: number },
  ): Promise<PlaceSuggestion[]> {
    const q = input.trim().toLowerCase();
    if (q.length === 0) return [];
    return MOCK_GAZETTEER.filter(
      (p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q),
    )
      .sort((a, b) =>
        bias
          ? haversineMeters(bias.center, a.location) - haversineMeters(bias.center, b.location)
          : 0,
      )
      .slice(0, 8)
      .map((p) => ({
        placeId: p.placeId,
        primaryText: p.name,
        secondaryText: p.address,
        fullText: `${p.name}, ${p.address}`,
      }));
  }

  async details(placeId: string): Promise<PlaceDetails> {
    const p = MOCK_GAZETTEER.find((g) => g.placeId === placeId);
    if (!p) throw new MapsProviderError('NOT_FOUND', 'Place not found');
    return p;
  }

  async reverseGeocode(point: LatLng): Promise<ReverseGeocodeResult> {
    const nearest = [...MOCK_GAZETTEER].sort(
      (a, b) => haversineMeters(point, a.location) - haversineMeters(point, b.location),
    )[0]!;
    const d = haversineMeters(point, nearest.location);
    return d < 3000
      ? {
          placeId: null,
          address: `Near ${nearest.name}, ${nearest.address}`,
          name: `Near ${nearest.name}`,
        }
      : {
          placeId: null,
          address: '',
          name: `Pinned location (${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)})`,
        };
  }
}
