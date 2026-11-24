import type { MatchConfidence, MatchType } from '@prisma/client';
import type { MatchingSettings } from '../../settings/settings.schema';
import { clamp, OverlapResult } from './overlap.engine';

/**
 * MATCH SCORING MODEL (documented in docs/ROUTE_MATCHING_ALGORITHM.md)
 *
 *   score = 100 × ( 0.40 · overlap      — mean of both routes' overlap ratios
 *                 + 0.25 · timing       — 1 − |convergence time difference| / window
 *                 + 0.15 · direction    — direction similarity rescaled from [min,1] to [0,1]
 *                 + 0.10 · pickup       — 1 − pickupDistance / pickupProximity
 *                 + 0.10 · destination  — 1 − destinationDistance / destinationProximity )
 *
 *   confidence: HIGH ≥ 70, MEDIUM ≥ 45, otherwise LOW.
 */
export const SCORE_WEIGHTS = {
  overlap: 0.4,
  timing: 0.25,
  direction: 0.15,
  pickup: 0.1,
  destination: 0.1,
} as const;

export interface PairContext {
  overlap: OverlapResult;
  /** Seconds; positive when A departs after B. */
  departureDiffSeconds: number;
  /** Difference between the times A and B reach the start of the shared stretch. */
  convergenceTimeDiffSeconds: number;
  sourceDistanceMeters: number;
  pickupDistanceMeters: number;
  destinationDistanceMeters: number;
}

export type RejectionReason =
  | 'NO_OVERLAP'
  | 'OPPOSITE_DIRECTION'
  | 'SHARED_DISTANCE_TOO_SHORT'
  | 'OVERLAP_RATIO_TOO_LOW'
  | 'DIRECTION_INCOMPATIBLE'
  | 'TIME_INCOMPATIBLE'
  | 'PICKUP_TOO_FAR';

export type Evaluation =
  | {
      eligible: true;
      matchType: MatchType;
      score: number;
      confidence: MatchConfidence;
      components: Record<keyof typeof SCORE_WEIGHTS, number>;
    }
  | { eligible: false; reason: RejectionReason };

export function evaluateMatch(ctx: PairContext, s: MatchingSettings): Evaluation {
  const o = ctx.overlap;
  if (o.sharedDistanceMeters <= 0)
    return {
      eligible: false,
      reason: o.oppositeDirectionOnly ? 'OPPOSITE_DIRECTION' : 'NO_OVERLAP',
    };
  if (o.directionSimilarity < s.minDirectionSimilarity)
    return { eligible: false, reason: 'DIRECTION_INCOMPATIBLE' };
  if (o.sharedDistanceMeters < s.minSharedDistanceMeters)
    return { eligible: false, reason: 'SHARED_DISTANCE_TOO_SHORT' };
  if (Math.max(o.overlapRatioA, o.overlapRatioB) < s.minOverlapRatio)
    return { eligible: false, reason: 'OVERLAP_RATIO_TOO_LOW' };
  const windowSec = s.departureWindowMinutes * 60;
  if (Math.abs(ctx.convergenceTimeDiffSeconds) > windowSec)
    return { eligible: false, reason: 'TIME_INCOMPATIBLE' };
  if (s.requirePickupProximity && ctx.pickupDistanceMeters > s.pickupProximityMeters)
    return { eligible: false, reason: 'PICKUP_TOO_FAR' };

  const components = {
    overlap: (o.overlapRatioA + o.overlapRatioB) / 2,
    timing: 1 - Math.abs(ctx.convergenceTimeDiffSeconds) / windowSec,
    direction:
      s.minDirectionSimilarity >= 1
        ? 1
        : clamp(
            (o.directionSimilarity - s.minDirectionSimilarity) / (1 - s.minDirectionSimilarity),
            0,
            1,
          ),
    pickup: clamp(1 - ctx.pickupDistanceMeters / s.pickupProximityMeters, 0, 1),
    destination: clamp(1 - ctx.destinationDistanceMeters / s.destinationProximityMeters, 0, 1),
  };
  const raw =
    components.overlap * SCORE_WEIGHTS.overlap +
    components.timing * SCORE_WEIGHTS.timing +
    components.direction * SCORE_WEIGHTS.direction +
    components.pickup * SCORE_WEIGHTS.pickup +
    components.destination * SCORE_WEIGHTS.destination;
  const score = Math.round(clamp(raw, 0, 1) * 1000) / 10;
  return {
    eligible: true,
    matchType: classify(ctx, s),
    score,
    confidence: confidenceFor(score),
    components,
  };
}

export function classify(ctx: PairContext, s: MatchingSettings): MatchType {
  const o = ctx.overlap;
  if (o.overlapRatioA >= s.sameRouteOverlapRatio && o.overlapRatioB >= s.sameRouteOverlapRatio)
    return 'SAME_ROUTE';
  if (ctx.destinationDistanceMeters <= s.destinationProximityMeters) return 'SAME_DESTINATION';
  const startsTogether =
    ctx.sourceDistanceMeters <= s.destinationProximityMeters &&
    (o.firstSharedFractionA ?? 1) <= 0.1 &&
    (o.firstSharedFractionB ?? 1) <= 0.1;
  if (startsTogether) return 'SHARED_START';
  return 'PARTIAL_OVERLAP';
}

export function confidenceFor(score: number): MatchConfidence {
  if (score >= 70) return 'HIGH';
  if (score >= 45) return 'MEDIUM';
  return 'LOW';
}

/**
 * Time at which a traveller reaches the convergence point, assuming uniform progress
 * along the route (route duration × fraction). Returns epoch milliseconds.
 */
export function convergenceTime(
  departure: Date,
  durationSeconds: number,
  fraction: number | null,
): number {
  return departure.getTime() + durationSeconds * 1000 * (fraction ?? 0);
}

/** Step that keeps the sample count bounded for very long routes. */
export function samplingStep(
  routeLengthMeters: number,
  s: Pick<MatchingSettings, 'minSampleSpacingMeters' | 'maxSamplesPerRoute'>,
): number {
  return Math.max(s.minSampleSpacingMeters, routeLengthMeters / s.maxSamplesPerRoute);
}
