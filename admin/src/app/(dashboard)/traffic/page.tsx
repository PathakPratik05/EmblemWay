import { ErrorPanel, StatCard } from '@/components/ui';
import { BackendError } from '@/lib/backend';
import { adminApi } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface TrafficStats {
  windowHours: number;
  requestsByStatus: Record<string, number>;
  failuresByCode: Record<string, number>;
  averageDelayRatioNow: number | null;
  samples: number;
}

export default async function TrafficPage() {
  let t: TrafficStats;
  let health: { maps: { provider: string; live: boolean; routesRequestsToday: number; placesRequestsToday: number } };
  try {
    [t, health] = await Promise.all([adminApi<TrafficStats>('/admin/stats/traffic'), adminApi<typeof health>('/admin/health')]);
  } catch (err) {
    return <ErrorPanel message={err instanceof BackendError ? err.message : 'Could not load traffic statistics.'} />;
  }
  const ok = t.requestsByStatus.OK ?? 0;
  const failed = t.requestsByStatus.UNAVAILABLE ?? 0;
  return (
    <>
      <h1>Traffic analytics</h1>
      {!health.maps.live ? <p className="notice">The API is using the development maps provider: traffic numbers are simulated, not live.</p> : null}
      <div className="grid cols-4">
        <StatCard label="Estimates (24 h)" value={ok} />
        <StatCard label="Provider failures (24 h)" value={failed} hint={ok + failed > 0 ? `${Math.round((failed / (ok + failed)) * 100)}% failure rate` : undefined} />
        <StatCard label="Avg delay now" value={t.averageDelayRatioNow === null ? '—' : `+${Math.round(t.averageDelayRatioNow * 100)}%`} hint="vs free-flow travel time" />
        <StatCard label="Routes API calls today" value={health.maps.routesRequestsToday} hint={`provider: ${health.maps.provider}`} />
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Failures by cause (24 h)</h2>
        {Object.keys(t.failuresByCode).length === 0 ? (
          <p className="muted">No provider failures.</p>
        ) : (
          <table>
            <tbody>
              {Object.entries(t.failuresByCode).map(([code, n]) => (
                <tr key={code}>
                  <td>{code}</td>
                  <td>{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
