import { ApiError } from '../../src/api/client';
import { usePlannerStore } from '../../src/state/plannerStore';
import { errorMessage, isOffline } from '../../src/utils/errors';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatPercent,
  formatTime,
  relativeTime,
} from '../../src/utils/format';
import {
  decodePolyline,
  haversineMeters,
  isValidCoordinate,
  regionForPoints,
} from '../../src/utils/geo';
import { uuidv4 } from '../../src/utils/ids';
import { mapGeolocationError } from '../../src/utils/location';
import {
  journeySchema,
  loginSchema,
  normalizeIndianMobile,
  otpSchema,
  profileSchema,
  registerSchema,
} from '../../src/validation/schemas';

const kharadi = { name: 'Kharadi', latitude: 18.5515, longitude: 73.9348 };
const hinjewadi = { name: 'Hinjewadi', latitude: 18.5912, longitude: 73.7389 };

describe('validation', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['98765 43210', '9876543210'],
    ['+91 98765-43210', '9876543210'],
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['5876543210', null],
    ['98765', null],
    ['abcdefghij', null],
  ])('normalizeIndianMobile(%s) = %s', (input, out) => {
    expect(normalizeIndianMobile(input)).toBe(out);
  });

  it('login requires a valid mobile number', () => {
    expect(loginSchema.safeParse({ mobileNumber: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ mobileNumber: '12345' }).success).toBe(
      false,
    );
    expect(loginSchema.safeParse({ mobileNumber: '9876543210' }).success).toBe(
      true,
    );
  });

  it('registration validates names, mobile and optional email', () => {
    const ok = {
      firstName: 'Ananya',
      lastName: "D'Souza",
      mobileNumber: '9876543210',
      email: '',
    };
    expect(registerSchema.safeParse(ok).success).toBe(true);
    expect(registerSchema.safeParse({ ...ok, firstName: '' }).success).toBe(
      false,
    );
    expect(
      registerSchema.safeParse({ ...ok, firstName: 'An4nya' }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...ok, email: 'not-an-email' }).success,
    ).toBe(false);
    expect(registerSchema.safeParse({ ...ok, email: 'a@b.in' }).success).toBe(
      true,
    );
    expect(
      registerSchema.safeParse({ ...ok, lastName: 'x'.repeat(61) }).success,
    ).toBe(false);
  });

  it('OTP must be exactly N digits', () => {
    expect(otpSchema(6).safeParse({ code: '123456' }).success).toBe(true);
    expect(otpSchema(6).safeParse({ code: '12345' }).success).toBe(false);
    expect(otpSchema(6).safeParse({ code: '12a456' }).success).toBe(false);
    expect(otpSchema(4).safeParse({ code: '1234' }).success).toBe(true);
  });

  it('profile requires city and vehicle', () => {
    const base = {
      firstName: 'A',
      lastName: 'B',
      email: '',
      preferredCityCode: 'PUNE',
      defaultVehicleTypeCode: 'CAR',
    };
    expect(profileSchema.safeParse(base).success).toBe(true);
    expect(
      profileSchema.safeParse({ ...base, preferredCityCode: '' }).success,
    ).toBe(false);
    expect(
      profileSchema.safeParse({ ...base, defaultVehicleTypeCode: '' }).success,
    ).toBe(false);
  });

  describe('journey form', () => {
    const future = new Date(Date.now() + 3600_000);
    const valid = {
      source: hinjewadi,
      destination: kharadi,
      pickup: null,
      departureAt: future,
      vehicleTypeCode: 'CAR',
    };
    const issues = (v: object) => {
      const r = journeySchema.safeParse(v);
      return r.success
        ? []
        : r.error.issues.map(i => `${String(i.path[0])}:${i.message}`);
    };
    it('accepts a valid plan', () => expect(issues(valid)).toEqual([]));
    it('requires source, destination and vehicle', () => {
      expect(issues({ ...valid, source: null })).toContain(
        'source:Choose where you start',
      );
      expect(issues({ ...valid, destination: null })).toContain(
        'destination:Choose your destination',
      );
      expect(issues({ ...valid, vehicleTypeCode: '' })).toContain(
        'vehicleTypeCode:Choose a vehicle',
      );
    });
    it('rejects identical source and destination', () => {
      expect(
        issues({ ...valid, destination: { ...hinjewadi, name: 'x' } }),
      ).toContain('destination:Destination must be different from the start');
    });
    it('rejects pickup at the destination', () => {
      expect(issues({ ...valid, pickup: kharadi })).toContain(
        'pickup:Pickup cannot be the destination',
      );
    });
    it('rejects past and too-distant departures', () => {
      expect(
        issues({ ...valid, departureAt: new Date(Date.now() - 3600_000) }),
      ).toContain('departureAt:Departure time is in the past');
      expect(
        issues({
          ...valid,
          departureAt: new Date(Date.now() + 100 * 86_400_000),
        }),
      ).toContain('departureAt:You can plan up to 90 days ahead');
    });
    it('rejects invalid coordinates', () => {
      expect(
        issues({
          ...valid,
          source: { name: 'x', latitude: 120, longitude: 73 },
        }).length,
      ).toBeGreaterThan(0);
    });
  });
});

describe('formatting (IST)', () => {
  it.each([
    [null, '—'],
    [450, '450 m'],
    [1234, '1.2 km'],
    [25_600, '26 km'],
  ])('distance %s -> %s', (m, s) => expect(formatDistance(m)).toBe(s));
  it.each([
    [null, '—'],
    [59, '1 min'],
    [1800, '30 min'],
    [3600, '1 h'],
    [5400, '1 h 30 min'],
  ])('duration %s -> %s', (sec, s) => expect(formatDuration(sec)).toBe(s));
  it('shows times in Indian Standard Time regardless of device zone', () => {
    expect(formatTime('2026-11-25T04:00:00Z').toLowerCase()).toMatch(
      /9:30\s?am/,
    );
    expect(formatDateTime('2026-11-25T04:00:00Z')).toContain('25 Nov');
  });
  it('percent and relative time', () => {
    expect(formatPercent(0.456)).toBe('46%');
    expect(formatPercent(1.4)).toBe('100%');
    const now = Date.parse('2026-11-25T04:00:00Z');
    expect(relativeTime('2026-11-25T03:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-11-25T03:30:00Z', now)).toBe('30 min ago');
    expect(relativeTime('2026-11-25T01:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-11-23T04:00:00Z', now)).toBe('2 d ago');
  });
});

describe('geo helpers', () => {
  it('decodes the reference polyline and tolerates garbage', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ latitude: 38.5, longitude: -120.2 });
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline(null)).toEqual([]);
    expect(decodePolyline('_p~iF~ps|U_')).toEqual([]);
  });
  it('validates coordinates', () => {
    expect(isValidCoordinate(kharadi)).toBe(true);
    expect(isValidCoordinate({ latitude: 0, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: Number.NaN, longitude: 1 })).toBe(
      false,
    );
    expect(isValidCoordinate(null)).toBe(false);
  });
  it('distance and camera region', () => {
    expect(haversineMeters(hinjewadi, kharadi)).toBeGreaterThan(20_000);
    expect(regionForPoints([])).toBeNull();
    const r = regionForPoints([hinjewadi, kharadi])!;
    expect(r.latitude).toBeCloseTo(
      (hinjewadi.latitude + kharadi.latitude) / 2,
      5,
    );
    expect(r.longitudeDelta).toBeGreaterThan(
      kharadi.longitude - hinjewadi.longitude,
    );
  });
});

describe('errors & ids', () => {
  it('maps backend error codes to friendly messages', () => {
    expect(
      errorMessage(
        new ApiError(400, 'OTP_INVALID', 'x', { remainingAttempts: 2 }),
      ),
    ).toBe('That code is incorrect. 2 attempts left.');
    expect(
      errorMessage(
        new ApiError(400, 'OTP_INVALID', 'x', { remainingAttempts: 1 }),
      ),
    ).toBe('That code is incorrect. 1 attempt left.');
    expect(errorMessage(new ApiError(0, 'NETWORK_ERROR', 'x'))).toMatch(
      /offline/,
    );
    expect(
      errorMessage(new ApiError(409, 'SOMETHING_NEW', 'Server says no')),
    ).toBe('Server says no');
    expect(errorMessage(new Error('boom'))).toBe(
      'Something went wrong. Please try again.',
    );
    expect(isOffline(new ApiError(0, 'TIMEOUT', 'x'))).toBe(true);
    expect(isOffline(new ApiError(500, 'SERVER_ERROR', 'x'))).toBe(false);
  });
  it('generates RFC 4122 v4 UUIDs', () => {
    const ids = new Set(Array.from({ length: 200 }, uuidv4));
    expect(ids.size).toBe(200);
    for (const id of ids)
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
  });
  it('maps geolocation failures (GPS off, denied, timeout)', () => {
    expect(mapGeolocationError({ code: 1 })).toBe('PERMISSION_DENIED');
    expect(mapGeolocationError({ code: 2 })).toBe('GPS_DISABLED');
    expect(mapGeolocationError({ code: 3 })).toBe('TIMEOUT');
    expect(mapGeolocationError({ code: 5 })).toBe('UNAVAILABLE');
  });
});

describe('planner store', () => {
  it('invalidates the idempotency key whenever the plan changes', () => {
    const s = usePlannerStore.getState();
    s.setPlace('source', hinjewadi);
    s.setIdempotencyKey('key-1');
    expect(usePlannerStore.getState().idempotencyKey).toBe('key-1');
    s.setPlace('destination', kharadi);
    expect(usePlannerStore.getState().idempotencyKey).toBeNull();
    s.setIdempotencyKey('key-2');
    s.setVehicle('CAR');
    expect(usePlannerStore.getState().idempotencyKey).toBeNull();
  });
  it('swaps start and destination and clears pickup', () => {
    const s = usePlannerStore.getState();
    s.setPlace('source', hinjewadi);
    s.setPlace('destination', kharadi);
    s.setPlace('pickup', hinjewadi);
    s.swap();
    const after = usePlannerStore.getState();
    expect(after.source?.name).toBe('Kharadi');
    expect(after.destination?.name).toBe('Hinjewadi');
    expect(after.pickup).toBeNull();
  });
  it('loads a saved route and resets', () => {
    usePlannerStore
      .getState()
      .loadRoute({
        source: kharadi,
        destination: hinjewadi,
        vehicleTypeCode: 'SCOOTER',
      });
    expect(usePlannerStore.getState()).toMatchObject({
      vehicleTypeCode: 'SCOOTER',
      pickup: null,
    });
    usePlannerStore.getState().reset();
    expect(usePlannerStore.getState().source).toBeNull();
    expect(usePlannerStore.getState().departureAt.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });
});
