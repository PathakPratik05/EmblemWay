import * as Keychain from 'react-native-keychain';
import { api, client } from '../../src/api';
import { ApiError } from '../../src/api/client';
import { tokenStore } from '../../src/auth/tokenStorage';
import { queryClient } from '../../src/hooks/queryClient';

type Call = {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
};
let calls: Call[] = [];

beforeEach(async () => {
  calls = [];
  await tokenStore.set({
    accessToken: 'tok',
    refreshToken: 'ref',
    accessTokenExpiresAt: '',
    refreshTokenExpiresAt: '',
    tokenType: 'Bearer',
  });
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      headers: init.headers as Record<string, string>,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});

const last = () => calls[calls.length - 1]!;
const place = {
  name: 'Baner',
  latitude: 18.559,
  longitude: 73.7868,
  address: 'Baner, Pune',
  placeId: 'pid',
};

describe('API endpoint contract (matches backend routes)', () => {
  it('auth endpoints are unauthenticated and send the platform', async () => {
    await api.auth.requestOtp('9876543210');
    expect(last()).toMatchObject({
      method: 'POST',
      body: { countryCode: '+91', mobileNumber: '9876543210' },
    });
    expect(last().url).toBe('http://10.0.2.2:3000/api/v1/auth/otp/request');
    expect(last().headers.Authorization).toBeUndefined();
    await api.auth.verifyOtp({ requestId: 'r', code: '123456' });
    expect(last().body).toMatchObject({ platform: 'android', code: '123456' });
    await api.auth.logout();
    expect(last().headers.Authorization).toBe('Bearer tok');
  });

  it('journey creation sends places, UTC departure and an Idempotency-Key', async () => {
    await api.journeys.create(
      {
        source: place,
        destination: {
          ...place,
          name: 'Kharadi',
          latitude: 18.55,
          longitude: 73.93,
        },
        departureAt: '2026-11-25T04:00:00.000Z',
        vehicleTypeCode: 'CAR',
      },
      'idem-key-123',
    );
    expect(last()).toMatchObject({
      method: 'POST',
      url: expect.stringMatching(/\/journeys$/),
    });
    expect(last().headers['Idempotency-Key']).toBe('idem-key-123');
    expect(last().body).toMatchObject({
      source: { name: 'Baner', placeId: 'pid', address: 'Baner, Pune' },
      departureAt: '2026-11-25T04:00:00.000Z',
    });
  });

  it('maps & traffic requests strip names and send only coordinates', async () => {
    await api.maps.previewRoute({
      source: place,
      destination: { ...place, latitude: 18.6 },
      pickup: null,
      vehicleTypeCode: 'CAR',
    });
    expect(last().body).toEqual({
      source: { latitude: 18.559, longitude: 73.7868 },
      destination: { latitude: 18.6, longitude: 73.7868 },
      vehicleTypeCode: 'CAR',
    });
    await api.traffic.adHoc({
      source: place,
      destination: place,
      pickup: place,
      vehicleTypeCode: 'CAR',
    });
    expect(Object.keys(last().body as object)).toEqual([
      'source',
      'destination',
      'pickup',
      'vehicleTypeCode',
    ]);
    await api.maps.autocomplete('ban', 'sess', {
      latitude: 18.5,
      longitude: 73.8,
    });
    expect(last().url).toContain(
      '/places/autocomplete?input=ban&sessionToken=sess&lat=18.5&lng=73.8',
    );
    await api.maps.placeDetails('a/b', 'sess');
    expect(last().url).toContain('/places/a%2Fb?sessionToken=sess');
    await api.maps.reverseGeocode(place);
    expect(last().url).toContain(
      '/places/reverse-geocode?lat=18.559&lng=73.7868',
    );
  });

  it('matches query encodes filters', async () => {
    await api.journeys.matches('j1', {
      vehicleTypes: ['CAR', 'MOTORCYCLE'],
      minOverlap: 0.5,
    });
    expect(last().url).toContain(
      '/journeys/j1/matches?vehicleTypes=CAR%2CMOTORCYCLE&minOverlap=0.5&page=1&pageSize=20',
    );
  });

  it('covers every remaining endpoint path and method', async () => {
    const expectations: Array<[() => Promise<unknown>, string, string]> = [
      [() => api.users.me(), 'GET', '/users/me'],
      [() => api.users.update({ firstName: 'A' }), 'PATCH', '/users/me'],
      [
        () => api.users.updatePreferences({ notifyMatches: false }),
        'PATCH',
        '/users/me/preferences',
      ],
      [() => api.users.deleteAccount(), 'DELETE', '/users/me'],
      [() => api.users.exportData(), 'GET', '/users/me/export'],
      [() => api.users.vehicles(), 'GET', '/users/me/vehicles'],
      [
        () => api.users.addVehicle({ vehicleTypeCode: 'CAR' }),
        'POST',
        '/users/me/vehicles',
      ],
      [() => api.users.removeVehicle('v1'), 'DELETE', '/users/me/vehicles/v1'],
      [() => api.meta.vehicleTypes(), 'GET', '/vehicle-types'],
      [() => api.meta.cities(), 'GET', '/cities'],
      [
        () => api.journeys.list('history', 2, 'CANCELLED'),
        'GET',
        '/journeys?scope=history&page=2&pageSize=20&status=CANCELLED',
      ],
      [() => api.journeys.get('j1'), 'GET', '/journeys/j1'],
      [
        () => api.journeys.update('j1', { version: 2 }),
        'PATCH',
        '/journeys/j1',
      ],
      [() => api.journeys.cancel('j1', 'x'), 'POST', '/journeys/j1/cancel'],
      [() => api.journeys.start('j1'), 'POST', '/journeys/j1/start'],
      [() => api.journeys.complete('j1'), 'POST', '/journeys/j1/complete'],
      [() => api.journeys.publish('j1'), 'POST', '/journeys/j1/publish'],
      [() => api.journeys.segments('j1'), 'GET', '/journeys/j1/segments'],
      [
        () => api.traffic.forJourney('j1'),
        'GET',
        '/traffic/journeys/j1/predictions',
      ],
      [
        () => api.hotspots.get({ model: 'TRAFFIC', city: 'PUNE' }),
        'GET',
        '/hotspots?model=TRAFFIC&city=PUNE',
      ],
      [
        () => api.notifications.list(),
        'GET',
        '/notifications?page=1&pageSize=30',
      ],
      [
        () => api.notifications.markRead('n1'),
        'POST',
        '/notifications/n1/read',
      ],
      [
        () => api.notifications.markAllRead(),
        'POST',
        '/notifications/read-all',
      ],
      [
        () => api.notifications.registerDevice('t'),
        'POST',
        '/notifications/devices',
      ],
      [() => api.saved.routes(), 'GET', '/users/me/saved-routes'],
      [
        () =>
          api.saved.createRoute({
            name: 'R',
            source: place,
            destination: place,
          }),
        'POST',
        '/users/me/saved-routes',
      ],
      [
        () => api.saved.deleteRoute('r1'),
        'DELETE',
        '/users/me/saved-routes/r1',
      ],
      [() => api.saved.places(), 'GET', '/users/me/saved-places'],
      [
        () => api.saved.createPlace({ ...place, label: 'HOME' }),
        'POST',
        '/users/me/saved-places',
      ],
      [
        () => api.ridePool.offer('j1', 2),
        'POST',
        '/journeys/j1/ride-pool/offer',
      ],
      [
        () => api.ridePool.requestSeat('o1', 'j2'),
        'POST',
        '/ride-pool/offers/o1/requests',
      ],
    ];
    for (const [fn, method, path] of expectations) {
      await fn();
      expect(last().method).toBe(method);
      expect(last().url).toBe(`http://10.0.2.2:3000/api/v1${path}`);
    }
  });

  it('uploads avatars as multipart without forcing a JSON content type', async () => {
    await api.users.uploadAvatar({
      uri: 'file:///a.jpg',
      type: 'image/jpeg',
      name: 'a.jpg',
    });
    expect(last().headers['Content-Type']).toBeUndefined();
    expect(last().body).toBeInstanceOf(FormData);
  });

  it('exposes the shared client', () => {
    expect(client).toBeDefined();
  });
});

describe('query client retry policy', () => {
  const retry = queryClient.getDefaultOptions().queries!.retry as (
    n: number,
    e: unknown,
  ) => boolean;
  const delay = queryClient.getDefaultOptions().queries!.retryDelay as (
    n: number,
  ) => number;
  it('never retries client errors, retries transient ones twice', () => {
    expect(retry(0, new ApiError(404, 'NOT_FOUND', 'x'))).toBe(false);
    expect(retry(0, new ApiError(0, 'NETWORK_ERROR', 'x'))).toBe(true);
    expect(retry(1, new ApiError(503, 'X', 'x'))).toBe(true);
    expect(retry(2, new ApiError(503, 'X', 'x'))).toBe(false);
    expect(delay(1)).toBe(2000);
    expect(delay(10)).toBe(8000);
  });
});

describe('secure token storage', () => {
  it('stores tokens in the keychain with device-only accessibility', async () => {
    await tokenStore.set({
      accessToken: 'a',
      refreshToken: 'b',
      accessTokenExpiresAt: '',
      refreshTokenExpiresAt: '',
      tokenType: 'Bearer',
    });
    expect(Keychain.setGenericPassword).toHaveBeenLastCalledWith(
      'emblemway',
      expect.any(String),
      expect.objectContaining({ accessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' }),
    );
    await tokenStore.clear();
    expect(await tokenStore.get()).toBeNull();
  });

  it('treats a corrupted keychain entry as signed out', async () => {
    jest.isolateModules(() => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce({
        password: '{not json',
      });
      const fresh = require('../../src/auth/tokenStorage')
        .tokenStore as typeof tokenStore;
      return expect(fresh.get()).resolves.toBeNull();
    });
  });
});
