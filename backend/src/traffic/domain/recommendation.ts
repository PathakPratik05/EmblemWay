import type { TrafficSettings } from '../../settings/settings.schema';

export const DEPARTURE_SCENARIOS = [
  { scenario: 'NOW', offsetMinutes: 0 },
  { scenario: 'PLUS_15_MINUTES', offsetMinutes: 15 },
  { scenario: 'PLUS_30_MINUTES', offsetMinutes: 30 },
  { scenario: 'PLUS_45_MINUTES', offsetMinutes: 45 },
  { scenario: 'PLUS_60_MINUTES', offsetMinutes: 60 },
] as const;

export type DepartureScenario = (typeof DEPARTURE_SCENARIOS)[number]['scenario'];
export type EstimateStatus = 'OK' | 'UNSUPPORTED' | 'UNAVAILABLE';
export type Freshness = 'LIVE' | 'CACHED' | 'STALE';

export interface ScenarioEstimate {
  scenario: DepartureScenario;
  offsetMinutes: number;
  departureAt: string;
  status: EstimateStatus;
  durationSeconds: number | null;
  staticDurationSeconds: number | null;
  delaySeconds: number | null;
  arrivalAt: string | null;
  distanceMeters: number | null;
  fetchedAt: string | null;
  freshness: Freshness | null;
  reason: string | null;
}

export interface Recommendation {
  scenario: DepartureScenario | null;
  savingsSeconds: number;
  significant: boolean;
  message: string;
}

/**
 * Picks the best departure among AVAILABLE estimates. A later departure is only recommended
 * when it saves both ≥ significantImprovementMinutes and ≥ significantImprovementRatio of the
 * leave-now duration - otherwise we explicitly say waiting makes no real difference.
 * Stale estimates are never used to recommend a change.
 */
export function recommend(
  estimates: readonly ScenarioEstimate[],
  s: TrafficSettings,
): Recommendation {
  const usable = estimates.filter(
    (e) => e.status === 'OK' && e.durationSeconds !== null && e.freshness !== 'STALE',
  );
  if (usable.length === 0) {
    return {
      scenario: null,
      savingsSeconds: 0,
      significant: false,
      message:
        'Live traffic estimates are unavailable right now, so no departure recommendation can be made.',
    };
  }
  const best = usable.reduce((a, b) => (b.durationSeconds! < a.durationSeconds! ? b : a));
  const now = usable.find((e) => e.scenario === 'NOW');
  if (!now) {
    return {
      scenario: best.scenario,
      savingsSeconds: 0,
      significant: false,
      message: `Leave-now estimate unavailable. Among available options, leaving in ${best.offsetMinutes} min has the shortest predicted travel time.`,
    };
  }
  const savings = now.durationSeconds! - best.durationSeconds!;
  const threshold = Math.max(
    s.significantImprovementMinutes * 60,
    now.durationSeconds! * s.significantImprovementRatio,
  );
  if (best.scenario === 'NOW' || savings < threshold) {
    return {
      scenario: 'NOW',
      savingsSeconds: Math.max(0, savings),
      significant: false,
      message:
        savings > 0
          ? `Travel times are similar across the next hour (at most ~${Math.round(savings / 60)} min difference). Leave whenever suits you.`
          : 'Leaving now is predicted to be as fast as or faster than waiting.',
    };
  }
  return {
    scenario: best.scenario,
    savingsSeconds: savings,
    significant: true,
    message: `Leaving in ${best.offsetMinutes} min is predicted to save about ${Math.round(savings / 60)} min compared with leaving now.`,
  };
}

export const TRAFFIC_DISCLAIMER =
  'Future travel times are predictions based on typical and current traffic. They are not guaranteed and actual conditions may differ.';
