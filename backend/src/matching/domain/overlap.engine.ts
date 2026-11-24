/**
 * ROUTE OVERLAP ENGINE (pure, no I/O)
 * ───────────────────────────────────
 * Route A is sampled every `stepMeters` along its length (PostGIS does the sampling).
 * For every sample PostGIS reports whether it lies within the corridor (± corridorWidth)
 * of route B, and where along B the closest point is (`bFraction` ∈ [0,1]).
 *
 * From those measurements this engine:
 *   1. builds contiguous "runs" of in-corridor samples, bridging short gaps (GPS noise,
 *      slightly different lane geometry at junctions);
 *   2. splits a run wherever the matched position on B jumps (B passes the same area
 *      twice - loops, self-crossing routes, roundabouts);
 *   3. measures each run's direction similarity: how far B advances while A advances.
 *      Same direction ≈ +1, opposite direction ≈ −1, a perpendicular crossing ≈ 0;
 *   4. keeps only runs travelling the same way (≥ minDirectionSimilarity);
 *   5. reports shared distance, overlap ratios for both routes and the common segment.
 *
 * Every accepted metre is counted once, so a route that touches many segments of the
 * other is never double counted.
 */

export interface OverlapSample {
  /** Sequential sample index along route A (0 = start). */
  index: number;
  /** Distance from the start of A, metres. */
  distanceAlongA: number;
  latitude: number;
  longitude: number;
  /** True when this sample lies inside B's corridor. */
  withinCorridor: boolean;
  /** Fractional position (0..1) of the closest point on B; null when not within corridor. */
  bFraction: number | null;
}

export interface OverlapOptions {
  stepMeters: number;
  routeALengthMeters: number;
  routeBLengthMeters: number;
  corridorWidthMeters: number;
  maxGapSamples: number;
  minDirectionSimilarity: number;
}

export interface OverlapRun {
  startIndex: number;
  endIndex: number;
  lengthMeters: number;
  direction: number;
  bFractionStart: number;
  bFractionEnd: number;
  accepted: boolean;
}

export interface OverlapResult {
  sharedDistanceMeters: number;
  overlapRatioA: number;
  overlapRatioB: number;
  /** Length-weighted direction similarity of accepted runs (−1..1); 0 when nothing shared. */
  directionSimilarity: number;
  /** True when the only overlaps found run in the opposite direction. */
  oppositeDirectionOnly: boolean;
  runs: OverlapRun[];
  /** Fraction along A / B where the first accepted shared stretch begins (convergence point). */
  firstSharedFractionA: number | null;
  firstSharedFractionB: number | null;
  /** Fraction along A / B where the last accepted shared stretch ends (divergence point). */
  lastSharedFractionA: number | null;
  lastSharedFractionB: number | null;
  /** Coordinates of the longest accepted run (for drawing the common route). */
  commonSegment: Array<{ latitude: number; longitude: number }>;
}

const EMPTY: Omit<OverlapResult, 'runs' | 'oppositeDirectionOnly'> = {
  sharedDistanceMeters: 0,
  overlapRatioA: 0,
  overlapRatioB: 0,
  directionSimilarity: 0,
  firstSharedFractionA: null,
  firstSharedFractionB: null,
  lastSharedFractionA: null,
  lastSharedFractionB: null,
  commonSegment: [],
};

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function analyzeOverlap(
  samplesInput: readonly OverlapSample[],
  opts: OverlapOptions,
): OverlapResult {
  if (opts.stepMeters <= 0) throw new Error('stepMeters must be positive');
  if (opts.routeALengthMeters <= 0 || opts.routeBLengthMeters <= 0) {
    // Zero-length geometry: nothing can overlap meaningfully.
    return { ...EMPTY, runs: [], oppositeDirectionOnly: false };
  }
  const samples = [...samplesInput].sort((a, b) => a.index - b.index);
  const rawRuns = buildRuns(samples, opts);

  const runs: OverlapRun[] = [];
  for (const run of rawRuns) {
    for (const piece of splitOnJumps(run, opts)) {
      const first = piece[0]!;
      const last = piece[piece.length - 1]!;
      const lengthMeters = Math.max(0, last.distanceAlongA - first.distanceAlongA);
      if (piece.length < 2 || lengthMeters <= 0) continue;
      const progressB = (last.bFraction! - first.bFraction!) * opts.routeBLengthMeters;
      const direction = clamp(progressB / lengthMeters, -1, 1);
      runs.push({
        startIndex: first.index,
        endIndex: last.index,
        lengthMeters,
        direction,
        bFractionStart: first.bFraction!,
        bFractionEnd: last.bFraction!,
        accepted: direction >= opts.minDirectionSimilarity,
      });
    }
  }

  const accepted = runs.filter((r) => r.accepted);
  if (accepted.length === 0) {
    const opposite = runs.some(
      (r) => r.direction <= -opts.minDirectionSimilarity && r.lengthMeters >= opts.stepMeters * 2,
    );
    return { ...EMPTY, runs, oppositeDirectionOnly: opposite };
  }

  const shared = Math.min(
    opts.routeALengthMeters,
    accepted.reduce((s, r) => s + r.lengthMeters, 0),
  );
  const direction =
    accepted.reduce((s, r) => s + r.direction * r.lengthMeters, 0) /
    accepted.reduce((s, r) => s + r.lengthMeters, 0);
  const firstRun = accepted[0]!;
  const lastRun = accepted[accepted.length - 1]!;
  const longest = accepted.reduce(
    (best, r) => (r.lengthMeters > best.lengthMeters ? r : best),
    firstRun,
  );
  const byIndex = new Map(samples.map((s) => [s.index, s]));
  const commonSegment: OverlapResult['commonSegment'] = [];
  for (let i = longest.startIndex; i <= longest.endIndex; i += 1) {
    const s = byIndex.get(i);
    if (s) commonSegment.push({ latitude: s.latitude, longitude: s.longitude });
  }
  const startA = byIndex.get(firstRun.startIndex)!.distanceAlongA;
  const endA = byIndex.get(lastRun.endIndex)!.distanceAlongA;

  return {
    sharedDistanceMeters: Math.round(shared),
    overlapRatioA: clamp(shared / opts.routeALengthMeters, 0, 1),
    overlapRatioB: clamp(shared / opts.routeBLengthMeters, 0, 1),
    directionSimilarity: clamp(direction, -1, 1),
    oppositeDirectionOnly: false,
    runs,
    firstSharedFractionA: clamp(startA / opts.routeALengthMeters, 0, 1),
    firstSharedFractionB: Math.min(...accepted.map((r) => r.bFractionStart)),
    lastSharedFractionA: clamp(endA / opts.routeALengthMeters, 0, 1),
    lastSharedFractionB: Math.max(...accepted.map((r) => r.bFractionEnd)),
    commonSegment,
  };
}

/**
 * Groups consecutive in-corridor samples into runs. A gap of up to `maxGapSamples`
 * out-of-corridor samples is bridged when the samples on both sides of the gap map
 * to nearby positions on B (so the gap is noise, not a genuine detour).
 */
function buildRuns(samples: readonly OverlapSample[], opts: OverlapOptions): OverlapSample[][] {
  const runs: OverlapSample[][] = [];
  let current: OverlapSample[] = [];
  let gap = 0;
  for (const s of samples) {
    if (s.withinCorridor && s.bFraction !== null) {
      const prev = current[current.length - 1];
      if (prev && gap > 0) {
        const bJump = Math.abs(s.bFraction - prev.bFraction!) * opts.routeBLengthMeters;
        const aJump = s.distanceAlongA - prev.distanceAlongA;
        if (bJump > aJump * 1.5 + 2 * opts.corridorWidthMeters) {
          runs.push(current);
          current = [];
        }
      }
      current.push(s);
      gap = 0;
    } else if (current.length > 0) {
      gap += 1;
      if (gap > opts.maxGapSamples) {
        runs.push(current);
        current = [];
        gap = 0;
      }
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** Split where B's matched position jumps further than A could have travelled. */
function splitOnJumps(run: readonly OverlapSample[], opts: OverlapOptions): OverlapSample[][] {
  const pieces: OverlapSample[][] = [];
  let piece: OverlapSample[] = [];
  for (const s of run) {
    const prev = piece[piece.length - 1];
    if (prev) {
      const aStep = s.distanceAlongA - prev.distanceAlongA;
      const bStep = Math.abs(s.bFraction! - prev.bFraction!) * opts.routeBLengthMeters;
      if (bStep > aStep * 1.5 + 2 * opts.corridorWidthMeters) {
        pieces.push(piece);
        piece = [];
      }
    }
    piece.push(s);
  }
  if (piece.length > 0) pieces.push(piece);
  return pieces;
}
