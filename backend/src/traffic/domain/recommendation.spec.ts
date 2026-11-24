import { defaultSettings } from '../../settings/settings.schema';
import { DEPARTURE_SCENARIOS, recommend, ScenarioEstimate } from './recommendation';

const s = defaultSettings('traffic');

function est(
  durations: Array<number | null>,
  overrides: Partial<ScenarioEstimate>[] = [],
): ScenarioEstimate[] {
  return DEPARTURE_SCENARIOS.map(({ scenario, offsetMinutes }, i) => ({
    scenario,
    offsetMinutes,
    departureAt: new Date().toISOString(),
    status: durations[i] === null ? 'UNAVAILABLE' : 'OK',
    durationSeconds: durations[i] ?? null,
    staticDurationSeconds: 1500,
    delaySeconds: null,
    arrivalAt: null,
    distanceMeters: 10_000,
    fetchedAt: new Date().toISOString(),
    freshness: durations[i] === null ? null : 'LIVE',
    reason: null,
    ...(overrides[i] ?? {}),
  }));
}

describe('departure recommendation', () => {
  it('defines exactly five scenarios: now, +15, +30, +45, +60', () => {
    expect(DEPARTURE_SCENARIOS.map((d) => d.offsetMinutes)).toEqual([0, 15, 30, 45, 60]);
  });

  it('recommends a later departure only when the saving is significant', () => {
    const r = recommend(est([3600, 3300, 2700, 2900, 3000]), s);
    expect(r).toMatchObject({
      scenario: 'PLUS_30_MINUTES',
      significant: true,
      savingsSeconds: 900,
    });
    expect(r.message).toMatch(/save about 15 min/);
  });

  it('does not claim an improvement for near-identical estimates', () => {
    const r = recommend(est([2400, 2340, 2380, 2400, 2420]), s); // best saves 60 s
    expect(r).toMatchObject({ scenario: 'NOW', significant: false, savingsSeconds: 60 });
    expect(r.message).toMatch(/similar/);
  });

  it('requires the saving to beat the ratio threshold on long trips too', () => {
    // 4 min saving on a 2 h trip = 3.3 % < 5 % -> not significant.
    expect(recommend(est([7200, 6960, 7100, 7200, 7300]), s).significant).toBe(false);
  });

  it('says leaving now is best when it is fastest', () => {
    const r = recommend(est([1800, 2000, 2200, 2400, 2600]), s);
    expect(r).toMatchObject({ scenario: 'NOW', significant: false, savingsSeconds: 0 });
    expect(r.message).toMatch(/as fast as or faster/);
  });

  it('handles partial estimates (leave-now unavailable)', () => {
    const r = recommend(est([null, 2000, 1900, null, 2100]), s);
    expect(r.scenario).toBe('PLUS_30_MINUTES');
    expect(r.significant).toBe(false);
    expect(r.message).toMatch(/unavailable/);
  });

  it('returns no recommendation when nothing is available', () => {
    expect(recommend(est([null, null, null, null, null]), s)).toMatchObject({
      scenario: null,
      significant: false,
    });
  });

  it('never uses STALE estimates to recommend a change', () => {
    const stale = { freshness: 'STALE' as const };
    const r = recommend(est([3600, 1800, 3600, 3600, 3600], [{}, stale]), s);
    expect(r.scenario).toBe('NOW');
    expect(r.significant).toBe(false);
  });

  it('ignores UNSUPPORTED scenarios', () => {
    const unsupported = { status: 'UNSUPPORTED' as const, durationSeconds: null };
    expect(recommend(est([1, 1, 1, 1, 1], Array(5).fill(unsupported)), s).scenario).toBeNull();
  });
});
