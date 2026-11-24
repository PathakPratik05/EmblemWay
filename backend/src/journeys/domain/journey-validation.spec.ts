import { AppError } from '../../common/errors/app-error';
import { defaultSettings } from '../../settings/settings.schema';
import {
  parseDepartureIso,
  validateDeparture,
  validateJourneyGeo,
  validateTimezone,
} from './journey-validation';

const pune = { latitude: 18.5308, longitude: 73.8475 };
const kharadi = { latitude: 18.5515, longitude: 73.9348 };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof AppError ? e.code : 'NOT_APP_ERROR';
  }
}

describe('journey validation', () => {
  describe('validateJourneyGeo', () => {
    it('accepts a normal Pune journey', () => {
      expect(
        codeOf(() => validateJourneyGeo({ source: pune, destination: kharadi })),
      ).toBeUndefined();
    });
    it('rejects identical source and destination', () => {
      expect(codeOf(() => validateJourneyGeo({ source: pune, destination: { ...pune } }))).toBe(
        'SAME_SOURCE_DESTINATION',
      );
    });
    it('rejects source and destination 50 m apart', () => {
      expect(
        codeOf(() =>
          validateJourneyGeo({
            source: pune,
            destination: { latitude: pune.latitude + 0.00045, longitude: pune.longitude },
          }),
        ),
      ).toBe('SAME_SOURCE_DESTINATION');
    });
    it('rejects pickup at the destination', () => {
      expect(
        codeOf(() => validateJourneyGeo({ source: pune, destination: kharadi, pickup: kharadi })),
      ).toBe('SAME_SOURCE_DESTINATION');
    });
    it.each([
      [{ latitude: 95, longitude: 73 }],
      [{ latitude: Number.NaN, longitude: 73 }],
      [{ latitude: 0, longitude: 0 }],
    ])('rejects invalid coordinates %j', (bad) => {
      expect(codeOf(() => validateJourneyGeo({ source: bad, destination: kharadi }))).toBe(
        'INVALID_COORDINATES',
      );
    });
    it('rejects points outside the service area', () => {
      expect(
        codeOf(() =>
          validateJourneyGeo({
            source: { latitude: 51.5, longitude: -0.12 },
            destination: kharadi,
          }),
        ),
      ).toBe('OUTSIDE_SERVICE_AREA');
    });
    it('rejects a missing destination', () => {
      expect(
        codeOf(() => validateJourneyGeo({ source: pune, destination: undefined as never })),
      ).toBe('INVALID_COORDINATES');
    });
  });

  describe('departure time', () => {
    const s = defaultSettings('journeys');
    const now = new Date('2026-11-25T03:00:00Z');
    it('accepts a time within the grace period', () => {
      expect(
        codeOf(() => validateDeparture(new Date(now.getTime() - 4 * 60_000), s, now)),
      ).toBeUndefined();
    });
    it('rejects past departures', () => {
      expect(codeOf(() => validateDeparture(new Date(now.getTime() - 10 * 60_000), s, now))).toBe(
        'DEPARTURE_IN_PAST',
      );
    });
    it('rejects departures beyond the scheduling horizon', () => {
      expect(
        codeOf(() => validateDeparture(new Date(now.getTime() + 91 * 86_400_000), s, now)),
      ).toBe('DEPARTURE_TOO_FAR');
    });
    it('rejects invalid dates', () => {
      expect(codeOf(() => validateDeparture(new Date('nope'), s, now))).toBe('VALIDATION_FAILED');
    });
  });

  describe('parseDepartureIso', () => {
    it('parses IST input and stores the UTC instant', () => {
      expect(parseDepartureIso('2026-11-25T09:30:00+05:30').toISOString()).toBe(
        '2026-11-25T04:00:00.000Z',
      );
    });
    it('accepts Z and milliseconds', () => {
      expect(parseDepartureIso('2026-11-25T04:00:00.123Z').toISOString()).toBe(
        '2026-11-25T04:00:00.123Z',
      );
    });
    it.each(['2026-11-25T09:30:00', '2026-11-25', '25/11/2026 09:30', ''])(
      'rejects ambiguous value %p',
      (v) => {
        expect(codeOf(() => parseDepartureIso(v))).toBe('VALIDATION_FAILED');
      },
    );
  });

  it('validates IANA time zones', () => {
    expect(codeOf(() => validateTimezone('Asia/Kolkata'))).toBeUndefined();
    expect(codeOf(() => validateTimezone('Mars/Olympus'))).toBe('VALIDATION_FAILED');
  });
});
