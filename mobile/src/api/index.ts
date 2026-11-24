import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '../config/env';
import { tokenStore } from '../auth/tokenStorage';
import { ApiClient } from './client';
import type {
  AppNotification,
  AuthResult,
  City,
  HotspotModel,
  HotspotResponse,
  Journey,
  JourneyPurpose,
  LatLng,
  MatchesResponse,
  Me,
  OtpChallenge,
  Paginated,
  Place,
  PlaceSuggestion,
  RoutePreview,
  SavedPlace,
  SavedRoute,
  SegmentCounts,
  TrafficPrediction,
  UserVehicle,
  VehicleType,
} from './types';

let sessionExpiredHandler: (() => void) | undefined;
export function setSessionExpiredHandler(fn: () => void): void {
  sessionExpiredHandler = fn;
}

export const client = new ApiClient({
  baseUrl: API_BASE_URL,
  tokens: tokenStore,
  timeoutMs: REQUEST_TIMEOUT_MS,
  onSessionExpired: () => sessionExpiredHandler?.(),
  deviceInfo: { platform: 'android' },
});

const coords = (p: LatLng): LatLng => ({
  latitude: p.latitude,
  longitude: p.longitude,
});

export interface CreateJourneyInput {
  source: Place;
  destination: Place;
  pickup?: Place | null;
  departureAt: string;
  vehicleTypeCode: string;
  purpose?: JourneyPurpose;
  notes?: string;
  saveAsDraft?: boolean;
  routeAlternativeIndex?: number;
}

const placeBody = (p: Place) => ({
  name: p.name.slice(0, 200),
  latitude: p.latitude,
  longitude: p.longitude,
  ...(p.address ? { address: p.address.slice(0, 400) } : {}),
  ...(p.placeId ? { placeId: p.placeId } : {}),
});

export const api = {
  auth: {
    requestOtp: (mobileNumber: string, countryCode = '+91') =>
      client.post<OtpChallenge>(
        '/auth/otp/request',
        { countryCode, mobileNumber },
        { auth: false },
      ),
    verifyOtp: (body: {
      requestId: string;
      code: string;
      firstName?: string;
      lastName?: string;
      email?: string;
    }) =>
      client.post<AuthResult>(
        '/auth/otp/verify',
        { ...body, platform: 'android' },
        { auth: false },
      ),
    logout: () => client.post<void>('/auth/logout'),
  },
  users: {
    me: () => client.get<Me>('/users/me'),
    update: (
      body: Partial<{
        firstName: string;
        lastName: string;
        email: string;
        preferredCityCode: string;
        defaultVehicleTypeCode: string;
        completeProfile: boolean;
      }>,
    ) => client.patch<Me>('/users/me', body),
    updatePreferences: (
      body: Partial<
        Record<
          | 'shareJourneysForMatching'
          | 'showFirstNameToMatches'
          | 'notifyJourneyReminders'
          | 'notifyMatches'
          | 'notifyStatusUpdates'
          | 'notifyTrafficAlerts'
          | 'locationConsent',
          boolean
        >
      >,
    ) => client.patch<Me>('/users/me/preferences', body),
    uploadAvatar: (file: { uri: string; type: string; name: string }) => {
      const form = new FormData();
      form.append('file', file as unknown as Blob);
      return client.post<Me>('/users/me/avatar', undefined, {
        formData: form,
        timeoutMs: 60_000,
      });
    },
    deleteAccount: () => client.delete<void>('/users/me'),
    exportData: () => client.get<Record<string, unknown>>('/users/me/export'),
    vehicles: () => client.get<UserVehicle[]>('/users/me/vehicles'),
    addVehicle: (body: {
      vehicleTypeCode: string;
      nickname?: string;
      isDefault?: boolean;
    }) => client.post<UserVehicle>('/users/me/vehicles', body),
    removeVehicle: (id: string) =>
      client.delete<void>(`/users/me/vehicles/${id}`),
  },
  meta: {
    vehicleTypes: () =>
      client.get<VehicleType[]>('/vehicle-types', { auth: false }),
    cities: () => client.get<City[]>('/cities', { auth: false }),
  },
  maps: {
    autocomplete: (input: string, sessionToken: string, near?: LatLng) =>
      client.get<{ provider: string; suggestions: PlaceSuggestion[] }>(
        '/places/autocomplete',
        {
          query: {
            input,
            sessionToken,
            lat: near?.latitude,
            lng: near?.longitude,
          },
        },
      ),
    placeDetails: (placeId: string, sessionToken: string) =>
      client.get<{
        placeId: string;
        name: string;
        address: string;
        location: LatLng;
      }>(`/places/${encodeURIComponent(placeId)}`, { query: { sessionToken } }),
    reverseGeocode: (p: LatLng) =>
      client.get<{ placeId: string | null; address: string; name: string }>(
        '/places/reverse-geocode',
        { query: { lat: p.latitude, lng: p.longitude } },
      ),
    previewRoute: (body: {
      source: LatLng;
      destination: LatLng;
      pickup?: LatLng | null;
      vehicleTypeCode: string;
    }) =>
      client.post<RoutePreview>('/routes/preview', {
        source: coords(body.source),
        destination: coords(body.destination),
        ...(body.pickup ? { pickup: coords(body.pickup) } : {}),
        vehicleTypeCode: body.vehicleTypeCode,
      }),
  },
  journeys: {
    create: (input: CreateJourneyInput, idempotencyKey: string) =>
      client.post<Journey>(
        '/journeys',
        {
          ...input,
          source: placeBody(input.source),
          destination: placeBody(input.destination),
          ...(input.pickup ? { pickup: placeBody(input.pickup) } : {}),
        },
        { idempotencyKey, timeoutMs: 30_000 },
      ),
    list: (
      scope: 'upcoming' | 'history' | 'drafts',
      page = 1,
      status?: string,
    ) =>
      client.get<Paginated<Journey>>('/journeys', {
        query: { scope, page, pageSize: 20, status },
      }),
    get: (id: string) => client.get<Journey>(`/journeys/${id}`),
    update: (id: string, body: Record<string, unknown> & { version: number }) =>
      client.patch<Journey>(`/journeys/${id}`, body),
    cancel: (id: string, reason?: string) =>
      client.post<Journey>(`/journeys/${id}/cancel`, { reason }),
    start: (id: string) => client.post<Journey>(`/journeys/${id}/start`),
    complete: (id: string) => client.post<Journey>(`/journeys/${id}/complete`),
    publish: (id: string) => client.post<Journey>(`/journeys/${id}/publish`),
    matches: (
      id: string,
      q: { vehicleTypes?: string[]; minOverlap?: number; page?: number },
    ) =>
      client.get<MatchesResponse>(`/journeys/${id}/matches`, {
        query: {
          vehicleTypes: q.vehicleTypes?.join(','),
          minOverlap: q.minOverlap,
          page: q.page ?? 1,
          pageSize: 20,
        },
      }),
    segments: (id: string) =>
      client.get<SegmentCounts>(`/journeys/${id}/segments`),
  },
  traffic: {
    forJourney: (id: string) =>
      client.get<TrafficPrediction>(`/traffic/journeys/${id}/predictions`),
    adHoc: (body: {
      source: LatLng;
      destination: LatLng;
      pickup?: LatLng | null;
      vehicleTypeCode: string;
    }) =>
      client.post<TrafficPrediction>('/traffic/predictions', {
        source: coords(body.source),
        destination: coords(body.destination),
        ...(body.pickup ? { pickup: coords(body.pickup) } : {}),
        vehicleTypeCode: body.vehicleTypeCode,
      }),
  },
  hotspots: {
    get: (q: {
      model: HotspotModel;
      city?: string;
      vehicleType?: string;
      from?: string;
      to?: string;
      hourFrom?: number;
      hourTo?: number;
    }) => client.get<HotspotResponse>('/hotspots', { query: q }),
  },
  notifications: {
    list: (page = 1) =>
      client.get<Paginated<AppNotification> & { unreadCount: number }>(
        '/notifications',
        { query: { page, pageSize: 30 } },
      ),
    markRead: (id: string) => client.post<void>(`/notifications/${id}/read`),
    markAllRead: () =>
      client.post<{ updated: number }>('/notifications/read-all'),
    registerDevice: (token: string) =>
      client.post<void>('/notifications/devices', {
        token,
        platform: 'android',
      }),
  },
  saved: {
    routes: () => client.get<SavedRoute[]>('/users/me/saved-routes'),
    createRoute: (body: {
      name: string;
      source: Place;
      destination: Place;
      pickup?: Place | null;
      vehicleTypeCode?: string;
      usualDepartureTime?: string;
    }) =>
      client.post<SavedRoute>('/users/me/saved-routes', {
        ...body,
        source: placeBody(body.source),
        destination: placeBody(body.destination),
        pickup: body.pickup ? placeBody(body.pickup) : undefined,
      }),
    deleteRoute: (id: string) =>
      client.delete<void>(`/users/me/saved-routes/${id}`),
    places: () => client.get<SavedPlace[]>('/users/me/saved-places'),
    createPlace: (p: Place & { label: SavedPlace['label'] }) =>
      client.post<SavedPlace>('/users/me/saved-places', {
        ...placeBody(p),
        label: p.label,
      }),
  },
  ridePool: {
    offer: (journeyId: string, totalSeats: number) =>
      client.post<{ id: string }>(`/journeys/${journeyId}/ride-pool/offer`, {
        totalSeats,
      }),
    requestSeat: (offerId: string, journeyId: string, seats = 1) =>
      client.post<{ id: string }>(`/ride-pool/offers/${offerId}/requests`, {
        journeyId,
        seats,
      }),
  },
};
