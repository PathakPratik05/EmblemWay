import { defaultSettings } from '../../settings/settings.schema';
import {
  classify,
  confidenceFor,
  convergenceTime,
  evaluateMatch,
  PairContext,
  samplingStep,
  SCORE_WEIGHTS,
} from './match-scoring';
import { OverlapResult } from './overlap.engine';

const s = defaultSettings('matching');

function overlap(partial: Partial<OverlapResult>): OverlapResult {
  return {
    sharedDistanceMeters: 10_000,
    overlapRatioA: 1,
    overlapRatioB: 1,
    directionSimilarity: 1,
    oppositeDirectionOnly: false,
    runs: [],
    firstSharedFractionA: 0,
    firstSharedFractionB: 0,
    lastSharedFractionA: 1,
    lastSharedFractionB: 1,
    commonSegment: [],
    ...partial,
  };
}

function ctx(
  o: Partial<OverlapResult> = {},
  rest: Partial<Omit<PairContext, 'overlap'>> = {},
): PairContext {
  return {
    overlap: overlap(o),
    departureDiffSeconds: 0,
    convergenceTimeDiffSeconds: 0,
    sourceDistanceMeters: 0,
    pickupDistanceMeters: 0,
    destinationDistanceMeters: 0,
    ...rest,
  };
}

describe('match scoring', () => {
  it('uses the brief defaults: 2 km, 30 %, 30 min, direction mandatory', () => {
    expect(s.minSharedDistanceMeters).toBe(2000);
    expect(s.minOverlapRatio).toBe(0.3);
    expect(s.departureWindowMinutes).toBe(30);
    expect(s.minDirectionSimilarity).toBeGreaterThan(0);
  });

  it('weights sum to 1', () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('a perfect same-route, same-time match scores 100 / HIGH / SAME_ROUTE', () => {
    const r = evaluateMatch(ctx(), s);
    expect(r).toMatchObject({
      eligible: true,
      score: 100,
      confidence: 'HIGH',
      matchType: 'SAME_ROUTE',
    });
  });

  it.each([
    [{ sharedDistanceMeters: 0, oppositeDirectionOnly: true }, {}, 'OPPOSITE_DIRECTION'],
    [{ sharedDistanceMeters: 0 }, {}, 'NO_OVERLAP'],
    [{ directionSimilarity: 0.2 }, {}, 'DIRECTION_INCOMPATIBLE'],
    [{ sharedDistanceMeters: 1_999 }, {}, 'SHARED_DISTANCE_TOO_SHORT'],
    [{ overlapRatioA: 0.2, overlapRatioB: 0.29 }, {}, 'OVERLAP_RATIO_TOO_LOW'],
    [{}, { convergenceTimeDiffSeconds: 31 * 60 }, 'TIME_INCOMPATIBLE'],
    [{}, { convergenceTimeDiffSeconds: -31 * 60 }, 'TIME_INCOMPATIBLE'],
  ] as const)('rejects %j %j with %s', (o, rest, reason) => {
    expect(evaluateMatch(ctx(o, rest), s)).toEqual({ eligible: false, reason });
  });

  it('accepts exactly at the thresholds (inclusive)', () => {
    const r = evaluateMatch(
      ctx(
        { sharedDistanceMeters: 2000, overlapRatioA: 0.3, overlapRatioB: 0.1 },
        { convergenceTimeDiffSeconds: 30 * 60 },
      ),
      s,
    );
    expect(r.eligible).toBe(true);
  });

  it('a long route overlapping a short one is accepted via the shorter route ratio', () => {
    // Mumbai -> Bengaluru (A) vs Mumbai -> Pune (C): 15 % of A but 100 % of C.
    const r = evaluateMatch(
      ctx(
        { sharedDistanceMeters: 150_000, overlapRatioA: 0.15, overlapRatioB: 1 },
        { destinationDistanceMeters: 700_000 },
      ),
      s,
    );
    expect(r.eligible).toBe(true);
  });

  it('pickup proximity is a hard filter only when enabled', () => {
    const far = ctx({}, { pickupDistanceMeters: 50_000 });
    expect(evaluateMatch(far, s).eligible).toBe(true);
    expect(evaluateMatch(far, { ...s, requirePickupProximity: true })).toEqual({
      eligible: false,
      reason: 'PICKUP_TOO_FAR',
    });
  });

  it('score decreases as time difference grows', () => {
    const near = evaluateMatch(ctx({}, { convergenceTimeDiffSeconds: 60 }), s);
    const far = evaluateMatch(ctx({}, { convergenceTimeDiffSeconds: 25 * 60 }), s);
    expect(near.eligible && far.eligible).toBe(true);
    if (near.eligible && far.eligible) expect(near.score).toBeGreaterThan(far.score);
  });

  it('score stays within 0..100', () => {
    const r = evaluateMatch(
      ctx(
        { overlapRatioA: 0.3, overlapRatioB: 0.3, directionSimilarity: 0.5 },
        {
          convergenceTimeDiffSeconds: 1800,
          pickupDistanceMeters: 1e9,
          destinationDistanceMeters: 1e9,
        },
      ),
      s,
    );
    expect(r.eligible).toBe(true);
    if (r.eligible) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.confidence).toBe('LOW');
    }
  });

  describe('classify', () => {
    it('SAME_ROUTE when both overlap ratios are high', () => {
      expect(classify(ctx({ overlapRatioA: 0.9, overlapRatioB: 0.9 }), s)).toBe('SAME_ROUTE');
    });
    it('SAME_DESTINATION when destinations are close but routes differ', () => {
      expect(
        classify(
          ctx({ overlapRatioA: 0.5, overlapRatioB: 0.6 }, { destinationDistanceMeters: 500 }),
          s,
        ),
      ).toBe('SAME_DESTINATION');
    });
    it('SHARED_START when they start together and diverge', () => {
      expect(
        classify(
          ctx(
            {
              overlapRatioA: 0.4,
              overlapRatioB: 0.4,
              firstSharedFractionA: 0,
              firstSharedFractionB: 0.02,
            },
            { sourceDistanceMeters: 200, destinationDistanceMeters: 9_000 },
          ),
          s,
        ),
      ).toBe('SHARED_START');
    });
    it('PARTIAL_OVERLAP otherwise', () => {
      expect(
        classify(
          ctx(
            { overlapRatioA: 0.4, overlapRatioB: 0.5, firstSharedFractionA: 0.5 },
            { sourceDistanceMeters: 8_000, destinationDistanceMeters: 9_000 },
          ),
          s,
        ),
      ).toBe('PARTIAL_OVERLAP');
    });
  });

  it.each([
    [100, 'HIGH'],
    [70, 'HIGH'],
    [69.9, 'MEDIUM'],
    [45, 'MEDIUM'],
    [44.9, 'LOW'],
    [0, 'LOW'],
  ] as const)('confidenceFor(%s) = %s', (score, conf) => {
    expect(confidenceFor(score)).toBe(conf);
  });

  it('convergence time adds the travelled fraction of the duration', () => {
    const dep = new Date('2026-11-25T03:00:00Z');
    expect(convergenceTime(dep, 3600, 0.5)).toBe(dep.getTime() + 1_800_000);
    expect(convergenceTime(dep, 3600, null)).toBe(dep.getTime());
  });

  it('sampling step is bounded for long routes and floored for short ones', () => {
    expect(samplingStep(5_000, s)).toBe(50);
    expect(samplingStep(1_000_000, s)).toBe(2_500);
  });
});
