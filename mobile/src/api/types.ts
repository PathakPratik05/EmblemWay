/** Types mirroring the EmblemWay REST API (backend/src). */

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Place extends LatLng {
  name: string;
  address?: string | null;
  placeId?: string | null;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tokenType: 'Bearer';
}

export interface OtpChallenge {
  requestId: string;
  expiresAt: string;
  resendAvailableAt: string;
  codeLength: number;
}

export type UserRole = 'USER' | 'ADMIN' | 'SUPER_ADMIN';

export interface AuthResult {
  tokens: TokenPair;
  user: { id: string; firstName: string; lastName: string; role: UserRole };
  isNewUser: boolean;
  profileComplete: boolean;
}

export interface Me {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  mobileNumberMasked: string | null;
  role: UserRole;
  profileImageUrl: string | null;
  preferredCity: { code: string; name: string } | null;
  defaultVehicleType: { code: string; name: string } | null;
  profileComplete: boolean;
  privacy: {
    shareJourneysForMatching: boolean;
    showFirstNameToMatches: boolean;
  };
  notifications: {
    journeyReminders: boolean;
    matches: boolean;
    statusUpdates: boolean;
    trafficAlerts: boolean;
  };
  locationConsentAt: string | null;
}

export type RoutingProfile = 'DRIVE' | 'TWO_WHEELER' | 'BICYCLE' | 'WALK';

export interface VehicleType {
  id: string;
  code: string;
  name: string;
  icon: string;
  routingProfile: RoutingProfile;
  trafficSupported: boolean;
  approximationNote: string | null;
  poolingEligible: boolean;
  defaultSeats: number;
}

export interface City {
  id: string;
  code: string;
  name: string;
  state: string;
  center: LatLng;
}

export type JourneyStatus =
  | 'DRAFT'
  | 'PLANNED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';
export type JourneyPurpose =
  | 'COMMUTE'
  | 'BUSINESS'
  | 'EDUCATION'
  | 'LEISURE'
  | 'ERRAND'
  | 'OTHER';

export interface Journey {
  id: string;
  status: JourneyStatus;
  purpose: JourneyPurpose;
  departureAt: string;
  estimatedArrivalAt: string | null;
  timezone: string;
  version: number;
  notes: string | null;
  vehicleType: {
    code: string;
    name: string;
    icon: string;
    routingProfile: RoutingProfile;
  };
  source: Place | null;
  destination: Place | null;
  pickup: Place | null;
  route: {
    encodedPolyline?: string;
    distanceMeters: number;
    durationSeconds: number;
    staticDurationSeconds: number | null;
    provider: string;
    isLiveData: boolean;
    computedAt: string;
    alternatives: number;
  } | null;
  ridePoolOffer: {
    id: string;
    status: string;
    totalSeats: number;
    availableSeats: number;
  } | null;
  matchesComputedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  completedAt: string | null;
  locationsPurged: boolean;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
}

export type MatchType =
  | 'SAME_ROUTE'
  | 'SAME_DESTINATION'
  | 'SHARED_START'
  | 'PARTIAL_OVERLAP';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface MatchItem {
  matchedJourneyId: string;
  traveller: { displayName: string };
  vehicleType: { code: string; name: string; icon: string };
  matchType: MatchType;
  sharedDistanceMeters: number;
  overlapRatioSelf: number;
  overlapRatioOther: number;
  directionSimilarity: number;
  departureAt: string;
  departureDiffMinutes: number;
  convergenceTimeDiffMinutes: number;
  pickupDistanceMeters: number;
  destinationDistanceMeters: number;
  score: number;
  confidence: Confidence;
  commonSegmentPolyline: string | null;
  ridePool: { offerId: string; availableSeats: number } | null;
}

export interface MatchesResponse extends Paginated<MatchItem> {
  summary: {
    totalMatchingJourneys: number;
    distinctTravellers: number;
    sameRouteTravellers: number;
    partialOverlapTravellers: number;
    byMatchType: Record<MatchType, number>;
    byVehicleType: Array<{
      code: string;
      name: string;
      travellers: number;
      journeys: number;
    }>;
    computedAt: string | null;
    disclaimer: string;
  };
}

export interface SegmentCounts {
  cellSizeMeters: number;
  timeWindowMinutes: number;
  segments: Array<{
    segmentId: string;
    sequence: number;
    center: LatLng;
    travellers: number;
    journeys: number;
    byVehicleType: Record<string, number>;
  }>;
  disclaimer: string;
}

export type Scenario =
  | 'NOW'
  | 'PLUS_15_MINUTES'
  | 'PLUS_30_MINUTES'
  | 'PLUS_45_MINUTES'
  | 'PLUS_60_MINUTES';

export interface TrafficEstimate {
  scenario: Scenario;
  offsetMinutes: number;
  departureAt: string;
  status: 'OK' | 'UNSUPPORTED' | 'UNAVAILABLE';
  durationSeconds: number | null;
  staticDurationSeconds: number | null;
  delaySeconds: number | null;
  arrivalAt: string | null;
  distanceMeters: number | null;
  fetchedAt: string | null;
  freshness: 'LIVE' | 'CACHED' | 'STALE' | null;
  reason: string | null;
}

export interface TrafficPrediction {
  provider: string;
  isLiveData: boolean;
  routingProfile: RoutingProfile;
  vehicleType: { code: string; name: string };
  approximationNote: string | null;
  generatedAt: string;
  estimates: TrafficEstimate[];
  recommendation: {
    scenario: Scenario | null;
    savingsSeconds: number;
    significant: boolean;
    message: string;
  };
  disclaimer: string;
}

export interface RoutePreview {
  provider: string;
  isLiveData: boolean;
  routingProfile: RoutingProfile;
  approximationNote: string | null;
  routes: Array<{
    alternativeIndex: number;
    encodedPolyline: string;
    distanceMeters: number;
    durationSeconds: number;
    staticDurationSeconds: number | null;
    labels: string[];
  }>;
}

export interface PlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
}

export type HotspotModel =
  | 'JOURNEY_DEMAND'
  | 'TRAFFIC'
  | 'ORIGIN'
  | 'DESTINATION';
export type HotspotLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';

export interface HotspotResponse {
  model: HotspotModel;
  cellSizeMeters: number;
  from: string;
  to: string;
  legend: Array<{ level: HotspotLevel; color: string; label: string }>;
  disclaimer: string;
  lastAggregatedAt: string | null;
  cells: Array<{
    cellKey: string;
    center: LatLng;
    journeys: number;
    peakTravellers: number;
    congestionIndex: number | null;
    intensity: number;
    level: HotspotLevel;
    changeRatio: number | null;
  }>;
}

export interface AppNotification {
  id: string;
  type:
    | 'JOURNEY_REMINDER'
    | 'MATCH_FOUND'
    | 'JOURNEY_STATUS'
    | 'TRAFFIC_ALERT'
    | 'RIDE_POOL'
    | 'SYSTEM';
  title: string;
  body: string;
  data: Record<string, string> | null;
  readAt: string | null;
  createdAt: string;
}

export interface SavedRoute {
  id: string;
  name: string;
  sourceName: string;
  sourceLatitude: number;
  sourceLongitude: number;
  destinationName: string;
  destinationLatitude: number;
  destinationLongitude: number;
  pickupName: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  usualDepartureTime: string | null;
  vehicleType: { code: string; name: string; icon: string } | null;
}

export interface SavedPlace extends LatLng {
  id: string;
  label: 'HOME' | 'WORK' | 'OTHER';
  name: string;
  address: string | null;
}

export interface UserVehicle {
  id: string;
  nickname: string | null;
  makeModel: string | null;
  isDefault: boolean;
  vehicleType: VehicleType;
}
