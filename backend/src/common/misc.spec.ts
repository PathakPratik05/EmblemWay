import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { sanitize } from '../audit/audit.service';
import { assignLevels, HotspotCell } from '../hotspots/hotspots.service';
import { RouteSegmentsService } from '../hotspots/route-segments.service';
import { validateGeometry } from '../maps/routing.service';
import { mirror } from '../matching/matching.service';
import { defaultSettings, settingsSchemas } from '../settings/settings.schema';
import { AppError, ErrorCode } from './errors/app-error';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { encodePolyline } from './utils/geo.util';
import { paginate } from './pagination/pagination';
import {
  addDays,
  floorToBucket,
  formatLocal,
  formatLocalTime,
  isValidTimeZone,
} from './utils/time.util';

function runFilter(err: unknown) {
  const res = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const response = {
    status(c: number) {
      res.statusCode = c;
      return this;
    },
    json(b: unknown) {
      res.body = b;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ id: 'req-1', path: '/x' }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(err, host);
  return res;
}

describe('AllExceptionsFilter', () => {
  it('maps AppError with code and details, adding Retry-After for 429', () => {
    const r = runFilter(AppError.tooMany('slow down', ErrorCode.OTP_RESEND_COOLDOWN, 42));
    expect(r.statusCode).toBe(429);
    expect(r.headers['Retry-After']).toBe('42');
    expect(r.body).toEqual({
      error: {
        code: 'OTP_RESEND_COOLDOWN',
        message: 'slow down',
        requestId: 'req-1',
        details: { retryAfterSeconds: 42 },
      },
    });
  });

  it('maps validation errors to VALIDATION_FAILED with field messages', () => {
    const r = runFilter(new BadRequestException(['name must be a string']));
    expect(r.statusCode).toBe(400);
    expect(r.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { fields: ['name must be a string'] } },
    });
  });

  it('maps throttling, 404 and Prisma errors', () => {
    expect(runFilter(new ThrottlerException()).body).toMatchObject({
      error: { code: 'RATE_LIMITED' },
    });
    expect(runFilter(new NotFoundException()).body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    expect(runFilter(p2002).statusCode).toBe(409);
    const p1001 = new Prisma.PrismaClientKnownRequestError('down', {
      code: 'P1001',
      clientVersion: 'x',
    });
    expect(runFilter(p1001)).toMatchObject({
      statusCode: 503,
      body: { error: { code: 'DATABASE_UNAVAILABLE' } },
    });
  });

  it('never leaks internal error messages for unknown errors', () => {
    const r = runFilter(new Error('SELECT * FROM secrets failed at 10.0.0.5'));
    expect(r.statusCode).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('secrets');
  });
});

describe('misc domain helpers', () => {
  it('audit sanitize redacts sensitive keys', () => {
    expect(
      sanitize({ otpCode: '1', refreshToken: 'x', latitude: 1, phone: '+91', action: 'ok' }),
    ).toEqual({
      otpCode: '[redacted]',
      refreshToken: '[redacted]',
      latitude: '[redacted]',
      phone: '[redacted]',
      action: 'ok',
    });
  });

  it('hotspot demand levels need both relative rank and absolute volume', () => {
    const cells = (values: number[]) =>
      values.map((v, i) => ({ cellKey: `c${i}`, intensity: v, level: 'LOW' }) as HotspotCell);
    const sparse = cells([1, 1, 2, 3]);
    assignLevels(sparse, false);
    expect(sparse.map((c) => c.level)).not.toContain('VERY_HIGH');
    const busy = cells([1, 2, 3, 5, 8, 12, 20, 30, 40, 60]);
    assignLevels(busy, false);
    expect(busy[busy.length - 1]!.level).toBe('VERY_HIGH');
    expect(busy[0]!.level).toBe('LOW');
    const traffic = cells([0.1, 0.3, 0.6, 0.9]);
    assignLevels(traffic, true);
    expect(traffic.map((c) => c.level)).toEqual(['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH']);
  });

  it('route segment cells are ordered and de-duplicated', () => {
    const cells = RouteSegmentsService.cellsForRoute(
      [
        { latitude: 18.5, longitude: 73.8 },
        { latitude: 18.5, longitude: 73.85 },
      ],
      500,
    );
    expect(new Set(cells.map((c) => c.key)).size).toBe(cells.length);
    expect(cells.length).toBeGreaterThanOrEqual(10);
    expect(cells[0]!.center.longitude).toBeLessThan(cells[cells.length - 1]!.center.longitude);
  });

  it('validateGeometry rejects empty, zero-length and malformed polylines', () => {
    expect(() => validateGeometry('')).toThrow(AppError);
    expect(() =>
      validateGeometry(
        encodePolyline([
          { latitude: 18.5, longitude: 73.8 },
          { latitude: 18.5, longitude: 73.8 },
        ]),
      ),
    ).toThrow(/empty or zero-length/);
    expect(() => validateGeometry('_p~iF~ps|U_')).toThrow(/could not be decoded/);
    expect(
      validateGeometry(
        encodePolyline([
          { latitude: 18.5, longitude: 73.8 },
          { latitude: 18.51, longitude: 73.8 },
        ]),
      ).points,
    ).toHaveLength(2);
  });

  it('mirror swaps perspective for the other traveller', () => {
    const m = mirror(
      {
        journeyId: 'a',
        matchedJourneyId: 'b',
        matchedUserId: 'ub',
        matchType: 'PARTIAL_OVERLAP',
        sharedDistanceMeters: 5000,
        overlapRatioSelf: 0.2,
        overlapRatioOther: 0.9,
        directionSimilarity: 1,
        departureDiffSeconds: 120,
        convergenceTimeDiffSeconds: -60,
        pickupDistanceMeters: 1,
        destinationDistanceMeters: 2,
        score: 50,
        confidence: 'MEDIUM',
        commonSegmentPolyline: null,
      },
      'ua',
    );
    expect(m).toMatchObject({
      journeyId: 'b',
      matchedJourneyId: 'a',
      matchedUserId: 'ua',
      overlapRatioSelf: 0.9,
      overlapRatioOther: 0.2,
      departureDiffSeconds: -120,
      convergenceTimeDiffSeconds: 60,
    });
  });

  it('settings schemas reject invalid admin input', () => {
    expect(
      settingsSchemas.matching.safeParse({ ...defaultSettings('matching'), minOverlapRatio: 2 })
        .success,
    ).toBe(false);
    expect(
      settingsSchemas.matching.safeParse({ ...defaultSettings('matching'), unknownKey: 1 }).success,
    ).toBe(false);
    expect(
      settingsSchemas.hotspots.safeParse({ ...defaultSettings('hotspots'), bucketMinutes: 7 })
        .success,
    ).toBe(false);
  });

  it('time helpers', () => {
    expect(floorToBucket(new Date('2026-11-25T03:17:45Z'), 15).toISOString()).toBe(
      '2026-11-25T03:15:00.000Z',
    );
    expect(addDays(new Date('2026-11-25T00:00:00Z'), 1).toISOString()).toBe(
      '2026-11-26T00:00:00.000Z',
    );
    expect(formatLocal(new Date('2026-11-25T04:00:00Z'))).toContain('09:30');
    expect(formatLocalTime(new Date('2026-11-25T04:00:00Z')).toLowerCase()).toContain('9:30');
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Nowhere/Land')).toBe(false);
  });

  it('paginate computes page metadata', () => {
    expect(paginate([1, 2], 5, { page: 2, pageSize: 2 })).toEqual({
      items: [1, 2],
      page: 2,
      pageSize: 2,
      total: 5,
      totalPages: 3,
      hasNextPage: true,
    });
    expect(paginate([], 0, { page: 1, pageSize: 20 })).toMatchObject({
      totalPages: 1,
      hasNextPage: false,
    });
  });
});
