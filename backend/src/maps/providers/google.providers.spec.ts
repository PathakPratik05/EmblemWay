import { MapsProviderError } from '../maps.types';
import { CircuitBreaker } from '../resilience/circuit-breaker';
import { QuotaGuard } from '../resilience/quota.guard';
import { GoogleHttpClient, mapHttpStatus } from './google-http.client';
import { GooglePlacesProvider } from './google-places.provider';
import { GoogleRoutesProvider, parseDuration, toComputedRoute } from './google-routes.provider';
import {
  MockPlacesProvider,
  MockRoutingProvider,
  mockCongestionFactor,
} from './mock-maps.providers';

const noSleep = () => Promise.resolve();
const okQuota = { acquire: jest.fn().mockResolvedValue(undefined) } as unknown as QuotaGuard;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function client(fetchImpl: jest.Mock, maxRetries = 2, breaker?: CircuitBreaker) {
  return new GoogleHttpClient(
    {
      timeoutMs: 1000,
      maxRetries,
      fetchImpl: fetchImpl,
      sleepFn: noSleep,
    },
    breaker,
  );
}

const origin = { latitude: 18.5912, longitude: 73.7389 };
const destination = { latitude: 18.5515, longitude: 73.9348 };

describe('GoogleHttpClient', () => {
  it('retries transient 5xx errors and then succeeds', async () => {
    const f = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: 1 }));
    await expect(client(f).request({ url: 'u', method: 'GET', headers: {} }, 't')).resolves.toEqual(
      { ok: 1 },
    );
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('does not retry 4xx rejections', async () => {
    const f = jest
      .fn()
      .mockResolvedValue(jsonResponse(403, { error: { status: 'PERMISSION_DENIED' } }));
    await expect(
      client(f).request({ url: 'u', method: 'GET', headers: {} }, 't'),
    ).rejects.toMatchObject({ kind: 'REJECTED' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('maps quota exhaustion and does not retry it', async () => {
    const f = jest
      .fn()
      .mockResolvedValue(jsonResponse(429, { error: { status: 'RESOURCE_EXHAUSTED' } }));
    await expect(
      client(f).request({ url: 'u', method: 'GET', headers: {} }, 't'),
    ).rejects.toMatchObject({ kind: 'QUOTA' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('treats timeouts as retryable and gives up after maxRetries', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const f = jest.fn().mockRejectedValue(timeout);
    await expect(
      client(f, 2).request({ url: 'u', method: 'GET', headers: {} }, 't'),
    ).rejects.toMatchObject({ kind: 'TIMEOUT' });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('opens the circuit after repeated failures and fails fast', async () => {
    const breaker = new CircuitBreaker(2, 60_000);
    const f = jest.fn().mockImplementation(() => Promise.resolve(jsonResponse(500, {})));
    const c = client(f, 0, breaker);
    await expect(c.request({ url: 'u', method: 'GET', headers: {} }, 't')).rejects.toBeInstanceOf(
      MapsProviderError,
    );
    await expect(c.request({ url: 'u', method: 'GET', headers: {} }, 't')).rejects.toBeInstanceOf(
      MapsProviderError,
    );
    f.mockClear();
    await expect(c.request({ url: 'u', method: 'GET', headers: {} }, 't')).rejects.toThrow(
      /circuit open/,
    );
    expect(f).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies', async () => {
    const f = jest.fn().mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(
      client(f, 0).request({ url: 'u', method: 'GET', headers: {} }, 't'),
    ).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it.each([
    [429, undefined, 'QUOTA'],
    [400, 'RESOURCE_EXHAUSTED', 'QUOTA'],
    [404, undefined, 'NOT_FOUND'],
    [500, undefined, 'UNAVAILABLE'],
    [401, undefined, 'REJECTED'],
    [400, 'INVALID_ARGUMENT', 'REJECTED'],
  ])('mapHttpStatus(%s, %s) = %s', (status, g, kind) => {
    expect(mapHttpStatus(status, g)).toBe(kind);
  });
});

describe('CircuitBreaker', () => {
  it('half-opens after cooldown and closes on success', () => {
    let now = 0;
    const b = new CircuitBreaker(1, 1000, () => now);
    b.recordFailure();
    expect(b.state).toBe('OPEN');
    expect(b.canRequest()).toBe(false);
    now = 1000;
    expect(b.state).toBe('HALF_OPEN');
    b.recordSuccess();
    expect(b.state).toBe('CLOSED');
  });

  it('re-opens immediately if the half-open trial fails', () => {
    let now = 0;
    const b = new CircuitBreaker(3, 1000, () => now);
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    now = 2000;
    b.recordFailure();
    expect(b.state).toBe('OPEN');
  });
});

describe('GoogleRoutesProvider', () => {
  const provider = (f: jest.Mock) => new GoogleRoutesProvider(client(f, 0), 'test-key', okQuota);

  it('builds a traffic-aware request with field mask and future departure', async () => {
    const f = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        routes: [
          {
            distanceMeters: 21000,
            duration: '2400s',
            staticDuration: '1800s',
            polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' },
            travelAdvisory: {
              speedReadingIntervals: [{ endPolylinePointIndex: 1, speed: 'SLOW' }],
            },
          },
        ],
      }),
    );
    const departure = new Date(Date.now() + 30 * 60_000);
    const res = await provider(f).computeRoutes({
      origin,
      destination,
      profile: 'TWO_WHEELER',
      trafficAware: true,
      departureTime: departure,
      includeSpeedIntervals: true,
    });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('test-key');
    expect(headers['X-Goog-FieldMask']).toContain('routes.staticDuration');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      travelMode: 'TWO_WHEELER',
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      departureTime: departure.toISOString(),
      extraComputations: ['TRAFFIC_ON_POLYLINE'],
      regionCode: 'IN',
    });
    expect(res.routes[0]).toMatchObject({
      distanceMeters: 21000,
      durationSeconds: 2400,
      staticDurationSeconds: 1800,
    });
    // proto3 omits zero: missing start index means 0
    expect(res.routes[0]!.speedIntervals).toEqual([{ startIndex: 0, endIndex: 1, speed: 'SLOW' }]);
  });

  it('adds the pickup as a pass-through waypoint and disables alternatives then', () => {
    const body = provider(jest.fn()).buildBody({
      origin,
      destination,
      via: [{ latitude: 18.57, longitude: 73.8 }],
      profile: 'DRIVE',
      trafficAware: true,
      computeAlternatives: true,
    });
    expect(body.intermediates).toEqual([
      { location: { latLng: { latitude: 18.57, longitude: 73.8 } }, via: true },
    ]);
    expect(body.computeAlternativeRoutes).toBe(false);
  });

  it('refuses traffic-aware bicycle routing honestly', () => {
    expect(() =>
      provider(jest.fn()).buildBody({
        origin,
        destination,
        profile: 'BICYCLE',
        trafficAware: true,
      }),
    ).toThrow(/not available for BICYCLE/);
  });

  it('refuses departure times in the past', () => {
    expect(() =>
      provider(jest.fn()).buildBody({
        origin,
        destination,
        profile: 'DRIVE',
        trafficAware: true,
        departureTime: new Date(Date.now() - 1000),
      }),
    ).toThrow(/future/);
  });

  it('reports NOT_FOUND for empty responses', async () => {
    const f = jest.fn().mockResolvedValue(jsonResponse(200, {}));
    await expect(
      provider(f).computeRoutes({ origin, destination, profile: 'DRIVE', trafficAware: false }),
    ).rejects.toMatchObject({ kind: 'NOT_FOUND' });
  });

  it('parses durations and skips incomplete routes', () => {
    expect(parseDuration('123s')).toBe(123);
    expect(parseDuration('12.6s')).toBe(13);
    expect(parseDuration(undefined)).toBeNull();
    expect(parseDuration('PT5M')).toBeNull();
    expect(toComputedRoute({ duration: '10s', distanceMeters: 5 })).toBeNull();
  });
});

describe('GooglePlacesProvider', () => {
  it('maps autocomplete suggestions and restricts to India', async () => {
    const f = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        suggestions: [
          {
            placePrediction: {
              placeId: 'ChIJabc',
              text: { text: 'Hinjewadi, Pune' },
              structuredFormat: {
                mainText: { text: 'Hinjewadi' },
                secondaryText: { text: 'Pune' },
              },
            },
          },
          { queryPrediction: { text: { text: 'ignored' } } },
        ],
      }),
    );
    const p = new GooglePlacesProvider(client(f, 0), 'k', okQuota);
    const res = await p.autocomplete('hinj', 'session-1', { center: origin, radiusMeters: 99_999 });
    expect(res).toEqual([
      {
        placeId: 'ChIJabc',
        primaryText: 'Hinjewadi',
        secondaryText: 'Pune',
        fullText: 'Hinjewadi, Pune',
      },
    ]);
    const body = JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      includedRegionCodes: string[];
      locationBias: { circle: { radius: number } };
    };
    expect(body.includedRegionCodes).toEqual(['in']);
    expect(body.locationBias.circle.radius).toBe(50_000);
  });

  it('returns details with location and rejects malformed place ids', async () => {
    const f = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, {
          id: 'ChIJabcdefghij',
          displayName: { text: 'EON IT Park' },
          formattedAddress: 'Kharadi',
          location: { latitude: 18.55, longitude: 73.93 },
        }),
      );
    const p = new GooglePlacesProvider(client(f, 0), 'k', okQuota);
    await expect(p.details('ChIJabcdefghij', undefined)).resolves.toMatchObject({
      name: 'EON IT Park',
      location: { latitude: 18.55 },
    });
    await expect(p.details('../../etc', undefined)).rejects.toMatchObject({ kind: 'REJECTED' });
  });

  it.each([
    ['ZERO_RESULTS', undefined],
    ['OVER_QUERY_LIMIT', 'QUOTA'],
    ['REQUEST_DENIED', 'REJECTED'],
    ['UNKNOWN_ERROR', 'UNAVAILABLE'],
  ])('reverse geocode status %s', async (status, kind) => {
    const f = jest.fn().mockResolvedValue(jsonResponse(200, { status, results: [] }));
    const p = new GooglePlacesProvider(client(f, 0), 'k', okQuota);
    if (kind) await expect(p.reverseGeocode(origin)).rejects.toMatchObject({ kind });
    else
      await expect(p.reverseGeocode(origin)).resolves.toMatchObject({
        placeId: null,
        name: expect.stringContaining('Pinned location') as string,
      });
  });
});

describe('mock providers (development only)', () => {
  it('produces deterministic, tagged, non-live routes', async () => {
    const p = new MockRoutingProvider();
    const a = await p.computeRoutes({ origin, destination, profile: 'DRIVE', trafficAware: true });
    const b = await p.computeRoutes({ origin, destination, profile: 'DRIVE', trafficAware: true });
    expect(p.isLive).toBe(false);
    expect(a.provider).toBe('mock');
    expect(a.routes[0]!.encodedPolyline).toBe(b.routes[0]!.encodedPolyline);
    expect(a.routes[0]!.distanceMeters).toBeGreaterThan(20_000);
  });

  it('refuses traffic for bicycles and identical points', async () => {
    const p = new MockRoutingProvider();
    await expect(
      p.computeRoutes({ origin, destination, profile: 'BICYCLE', trafficAware: true }),
    ).rejects.toMatchObject({ kind: 'UNSUPPORTED' });
    await expect(
      p.computeRoutes({ origin, destination: origin, profile: 'DRIVE', trafficAware: false }),
    ).rejects.toMatchObject({ kind: 'NOT_FOUND' });
  });

  it('applies IST peak-hour congestion', () => {
    expect(mockCongestionFactor(new Date('2026-11-25T03:30:00Z'))).toBe(1.6); // 09:00 IST
    expect(mockCongestionFactor(new Date('2026-11-25T20:30:00Z'))).toBe(1.05); // 02:00 IST
  });

  it('searches the gazetteer and reverse geocodes', async () => {
    const p = new MockPlacesProvider();
    expect((await p.autocomplete('kharadi'))[0]?.primaryText).toContain('Kharadi');
    expect(await p.autocomplete('  ')).toEqual([]);
    await expect(p.details('nope')).rejects.toMatchObject({ kind: 'NOT_FOUND' });
    expect((await p.reverseGeocode({ latitude: 18.552, longitude: 73.935 })).name).toMatch(
      /Near Kharadi/,
    );
  });
});
