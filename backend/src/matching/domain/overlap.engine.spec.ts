import { analyzeOverlap, OverlapOptions, OverlapSample } from './overlap.engine';

/**
 * Synthetic measurement builder. Route A is sampled every `step` metres. `bAt(i, distA)`
 * returns B's matched position in metres along B (or null when the sample is outside B's
 * corridor). This mirrors exactly what PostGIS returns in production.
 */
function samplesFor(
  lengthA: number,
  step: number,
  lengthB: number,
  bAt: (i: number, distA: number) => number | null,
): OverlapSample[] {
  const out: OverlapSample[] = [];
  const n = Math.floor(lengthA / step);
  for (let i = 0; i <= n; i += 1) {
    const d = Math.min(lengthA, i * step);
    const b = bAt(i, d);
    out.push({
      index: i,
      distanceAlongA: d,
      latitude: 18.5 + d / 111_320,
      longitude: 73.8,
      withinCorridor: b !== null,
      bFraction: b === null ? null : Math.min(1, Math.max(0, b / lengthB)),
    });
  }
  return out;
}

const opts = (
  lengthA: number,
  lengthB: number,
  extra: Partial<OverlapOptions> = {},
): OverlapOptions => ({
  stepMeters: 50,
  routeALengthMeters: lengthA,
  routeBLengthMeters: lengthB,
  corridorWidthMeters: 60,
  maxGapSamples: 2,
  minDirectionSimilarity: 0.5,
  ...extra,
});

describe('analyzeOverlap', () => {
  it('identical routes overlap 100% in the same direction', () => {
    const r = analyzeOverlap(
      samplesFor(10_000, 50, 10_000, (_i, d) => d),
      opts(10_000, 10_000),
    );
    expect(r.sharedDistanceMeters).toBe(10_000);
    expect(r.overlapRatioA).toBeCloseTo(1, 5);
    expect(r.overlapRatioB).toBeCloseTo(1, 5);
    expect(r.directionSimilarity).toBeCloseTo(1, 5);
    expect(r.firstSharedFractionA).toBe(0);
    expect(r.commonSegment.length).toBe(201);
  });

  it('rejects opposite-direction travel on the same road', () => {
    const r = analyzeOverlap(
      samplesFor(10_000, 50, 10_000, (_i, d) => 10_000 - d),
      opts(10_000, 10_000),
    );
    expect(r.sharedDistanceMeters).toBe(0);
    expect(r.oppositeDirectionOnly).toBe(true);
    expect(r.runs.every((run) => !run.accepted && run.direction < -0.9)).toBe(true);
  });

  it('parallel roads outside the corridor never overlap', () => {
    const r = analyzeOverlap(
      samplesFor(8_000, 50, 8_000, () => null),
      opts(8_000, 8_000),
    );
    expect(r.sharedDistanceMeters).toBe(0);
    expect(r.oppositeDirectionOnly).toBe(false);
    expect(r.runs).toHaveLength(0);
  });

  it('partial overlap: B covers only the second half of A', () => {
    // A: 0..10 km. B: 5..10 km of the same road (B length 5 km).
    const r = analyzeOverlap(
      samplesFor(10_000, 50, 5_000, (_i, d) => (d >= 5_000 ? d - 5_000 : null)),
      opts(10_000, 5_000),
    );
    expect(r.sharedDistanceMeters).toBe(5_000);
    expect(r.overlapRatioA).toBeCloseTo(0.5, 2);
    expect(r.overlapRatioB).toBeCloseTo(1, 2);
    expect(r.firstSharedFractionA).toBeCloseTo(0.5, 2);
    expect(r.firstSharedFractionB).toBeCloseTo(0, 2);
  });

  it('routes that converge after a point (different starts, same end)', () => {
    // B starts elsewhere (3 km of its own road) and joins A at A's 4 km mark.
    const r = analyzeOverlap(
      samplesFor(10_000, 50, 9_000, (_i, d) => (d >= 4_000 ? 3_000 + (d - 4_000) : null)),
      opts(10_000, 9_000),
    );
    expect(r.sharedDistanceMeters).toBe(6_000);
    expect(r.firstSharedFractionA).toBeCloseTo(0.4, 2);
    expect(r.firstSharedFractionB).toBeCloseTo(3_000 / 9_000, 2);
    expect(r.lastSharedFractionA).toBeCloseTo(1, 2);
  });

  it('routes that share the start then diverge', () => {
    const r = analyzeOverlap(
      samplesFor(10_000, 50, 12_000, (_i, d) => (d <= 3_000 ? d : null)),
      opts(10_000, 12_000),
    );
    expect(r.sharedDistanceMeters).toBe(3_000);
    expect(r.firstSharedFractionA).toBe(0);
    expect(r.lastSharedFractionA).toBeCloseTo(0.3, 2);
  });

  it('diverge and converge again: both shared stretches counted once each', () => {
    // Shared 0-3 km, separate 3-6 km (B takes a detour of 5 km), shared again 6-10 km.
    const r = analyzeOverlap(
      samplesFor(10_000, 50, 12_000, (_i, d) =>
        d <= 3_000 ? d : d >= 6_000 ? 8_000 + (d - 6_000) : null,
      ),
      opts(10_000, 12_000),
    );
    const accepted = r.runs.filter((x) => x.accepted);
    expect(accepted).toHaveLength(2);
    expect(r.sharedDistanceMeters).toBe(7_000);
    expect(r.overlapRatioA).toBeCloseTo(0.7, 2);
  });

  it('a perpendicular crossing is not an overlap', () => {
    // A crosses B at A=5 km; only ~120 m of A is within B's corridor and B barely advances.
    const r = analyzeOverlap(
      samplesFor(10_000, 50, 10_000, (_i, d) => (Math.abs(d - 5_000) <= 60 ? 4_000 : null)),
      opts(10_000, 10_000),
    );
    expect(r.sharedDistanceMeters).toBe(0);
    expect(r.oppositeDirectionOnly).toBe(false);
  });

  it('bridges short GPS gaps but not long ones', () => {
    // Two samples missing (100 m) in the middle of a shared run -> bridged.
    const shortGap = analyzeOverlap(
      samplesFor(4_000, 50, 4_000, (i, d) => (i === 40 || i === 41 ? null : d)),
      opts(4_000, 4_000),
    );
    expect(shortGap.runs.filter((x) => x.accepted)).toHaveLength(1);
    expect(shortGap.sharedDistanceMeters).toBe(4_000);

    // Ten missing samples (500 m) -> two separate runs, gap excluded.
    const longGap = analyzeOverlap(
      samplesFor(4_000, 50, 4_000, (i, d) => (i >= 40 && i < 50 ? null : d)),
      opts(4_000, 4_000),
    );
    expect(longGap.runs.filter((x) => x.accepted)).toHaveLength(2);
    expect(longGap.sharedDistanceMeters).toBeLessThan(4_000);
    expect(longGap.sharedDistanceMeters).toBeGreaterThanOrEqual(3_450);
  });

  it('GPS jitter in the matched position still counts as same direction', () => {
    const r = analyzeOverlap(
      samplesFor(5_000, 50, 5_000, (i, d) => Math.max(0, d + (i % 2 === 0 ? 15 : -15))),
      opts(5_000, 5_000),
    );
    expect(r.sharedDistanceMeters).toBe(5_000);
    expect(r.directionSimilarity).toBeGreaterThan(0.95);
  });

  it('splits a run when B jumps to a different part of itself (self-crossing / loop)', () => {
    // B visits the area of A's 2-4 km twice: first at B=1..3 km, and after a loop at B=9..11 km.
    // From the 3 km mark on, the closest point on B jumps to the second visit.
    const r = analyzeOverlap(
      samplesFor(4_000, 50, 12_000, (_i, d) =>
        d < 2_000 ? null : d < 3_000 ? d - 1_000 : 9_000 + (d - 3_000),
      ),
      opts(4_000, 12_000),
    );
    const accepted = r.runs.filter((x) => x.accepted);
    expect(accepted.length).toBe(2);
    // Each piece is measured separately; the jump itself is never counted as shared distance.
    expect(r.sharedDistanceMeters).toBeLessThanOrEqual(2_000);
    expect(r.sharedDistanceMeters).toBeGreaterThanOrEqual(1_850);
  });

  it('roundabout: a short circular detour on B does not break the shared run direction', () => {
    // B goes round a roundabout (adds 300 m) at A=2 km, then continues on A's road.
    const r = analyzeOverlap(
      samplesFor(4_000, 50, 4_300, (_i, d) => (d <= 2_000 ? d : d + 300)),
      opts(4_000, 4_300),
    );
    expect(r.directionSimilarity).toBeGreaterThan(0.9);
    expect(r.sharedDistanceMeters).toBeGreaterThanOrEqual(3_900);
  });

  it('only a small shared segment is reported as small (threshold applied later)', () => {
    const r = analyzeOverlap(
      samplesFor(20_000, 100, 20_000, (_i, d) => (d >= 10_000 && d <= 10_800 ? d : null)),
      opts(20_000, 20_000, { stepMeters: 100 }),
    );
    expect(r.sharedDistanceMeters).toBe(800);
    expect(r.overlapRatioA).toBeCloseTo(0.04, 2);
  });

  it('zero-length geometry produces no overlap and no division by zero', () => {
    const r = analyzeOverlap([], opts(0, 1_000));
    expect(r.sharedDistanceMeters).toBe(0);
    expect(r.overlapRatioA).toBe(0);
    const r2 = analyzeOverlap(
      samplesFor(1_000, 50, 1_000, (_i, d) => d),
      opts(1_000, 0),
    );
    expect(r2.sharedDistanceMeters).toBe(0);
  });

  it('a single in-corridor sample is not an overlap', () => {
    const r = analyzeOverlap(
      samplesFor(1_000, 50, 1_000, (i) => (i === 5 ? 250 : null)),
      opts(1_000, 1_000),
    );
    expect(r.sharedDistanceMeters).toBe(0);
  });

  it('very short journeys (< 1 step) are handled', () => {
    const r = analyzeOverlap(
      [
        {
          index: 0,
          distanceAlongA: 0,
          latitude: 18.5,
          longitude: 73.8,
          withinCorridor: true,
          bFraction: 0,
        },
        {
          index: 1,
          distanceAlongA: 30,
          latitude: 18.5003,
          longitude: 73.8,
          withinCorridor: true,
          bFraction: 1,
        },
      ],
      opts(30, 30),
    );
    expect(r.sharedDistanceMeters).toBe(30);
    expect(r.overlapRatioA).toBe(1);
  });

  it('very long journeys (Mumbai-Bengaluru scale) with coarse sampling', () => {
    const lenA = 980_000;
    const step = lenA / 400;
    // B (Pune-Bengaluru, 840 km) joins A after 140 km.
    const r = analyzeOverlap(
      samplesFor(lenA, step, 840_000, (_i, d) => (d >= 140_000 ? d - 140_000 : null)),
      opts(lenA, 840_000, { stepMeters: step }),
    );
    expect(r.overlapRatioB).toBeGreaterThan(0.99);
    expect(r.overlapRatioA).toBeCloseTo(840_000 / lenA, 2);
    expect(r.firstSharedFractionA).toBeCloseTo(140_000 / lenA, 2);
  });

  it('is independent of sample ordering', () => {
    const s = samplesFor(3_000, 50, 3_000, (_i, d) => d);
    const shuffled = [...s].reverse();
    expect(analyzeOverlap(shuffled, opts(3_000, 3_000)).sharedDistanceMeters).toBe(3_000);
  });

  it('never reports more shared distance than route A length', () => {
    const r = analyzeOverlap(
      samplesFor(1_000, 50, 1_000, (_i, d) => d),
      opts(900, 1_000),
    );
    expect(r.sharedDistanceMeters).toBeLessThanOrEqual(900);
    expect(r.overlapRatioA).toBeLessThanOrEqual(1);
  });

  it('rejects an invalid step', () => {
    expect(() => analyzeOverlap([], opts(100, 100, { stepMeters: 0 }))).toThrow();
  });
});
