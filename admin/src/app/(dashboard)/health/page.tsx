import { ErrorPanel, StatCard } from '@/components/ui';
import { BackendError } from '@/lib/backend';
import { adminApi } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface Health {
  ok: boolean;
  version: string;
  uptimeSeconds: number;
  postgisVersion: string;
  checks: Record<string, { ok: boolean; latencyMs: number; error?: string }>;
  jobs: { mode?: string; counts?: Record<string, number>; workerRunning?: boolean; error?: string };
  maps: { provider: string; live: boolean; routesRequestsToday: number; placesRequestsToday: number };
  push: { configured: boolean };
  memory: { rssMb: number };
}

export default async function HealthPage() {
  let h: Health;
  try {
    h = await adminApi<Health>('/admin/health');
  } catch (err) {
    return <ErrorPanel message={err instanceof BackendError ? `API unhealthy: ${err.message}` : 'API health check failed.'} />;
  }
  return (
    <>
      <h1>API health</h1>
      <div className="grid cols-4">
        <StatCard label="Overall" value={h.ok ? 'Healthy' : 'Degraded'} />
        {Object.entries(h.checks).map(([name, c]) => (
          <StatCard key={name} label={name} value={c.ok ? `${c.latencyMs} ms` : 'DOWN'} hint={c.error} />
        ))}
        <StatCard label="Uptime" value={`${Math.round(h.uptimeSeconds / 60)} min`} hint={`v${h.version} · PostGIS ${h.postgisVersion}`} />
        <StatCard label="Memory" value={`${h.memory.rssMb} MB`} />
        <StatCard label="Maps provider" value={h.maps.provider} hint={h.maps.live ? 'live' : 'development (simulated)'} />
        <StatCard label="Push notifications" value={h.push.configured ? 'FCM configured' : 'Not configured'} />
        <StatCard label="Background jobs" value={h.jobs.mode ?? 'unknown'} hint={h.jobs.counts ? `failed ${h.jobs.counts.failed ?? 0} · waiting ${h.jobs.counts.waiting ?? 0}` : h.jobs.error} />
      </div>
    </>
  );
}
