import { BarChart, HorizontalBars } from '@/components/charts';
import { ErrorPanel, StatCard } from '@/components/ui';
import { BackendError } from '@/lib/backend';
import { adminApi } from '@/lib/server-api';
import type { Overview } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  let data;
  try {
    data = await Promise.all([
      adminApi<Overview>('/admin/stats/overview'),
      adminApi<Array<{ day: string; total: number; cancelled: number }>>('/admin/stats/daily', { query: { days: 30 } }),
      adminApi<Array<{ code: string; name: string; journeys: number; travellers: number }>>('/admin/stats/vehicles'),
      adminApi<Array<{ code: string; name: string; journeys: number; upcomingOrActive: number }>>('/admin/stats/cities'),
    ]);
  } catch (err) {
    return <ErrorPanel message={err instanceof BackendError ? err.message : 'Could not load statistics.'} />;
  }
  const [o, daily, vehicles, cities] = data;
  return (
    <>
      <h1>Overview</h1>
      <div className="grid cols-4">
        <StatCard label="Users" value={o.users.total} hint={`${o.users.newLast7Days} new this week`} />
        <StatCard label="Active (30 d)" value={o.users.activeLast30Days} />
        <StatCard label="Total journeys" value={o.journeys.total} />
        <StatCard label="Active now" value={o.journeys.activeNow} />
        <StatCard label="Planned" value={o.journeys.byStatus.PLANNED ?? 0} />
        <StatCard label="Cancelled" value={o.journeys.byStatus.CANCELLED ?? 0} />
        <StatCard label="Completed" value={o.journeys.byStatus.COMPLETED ?? 0} />
        <StatCard label="Matched pairs" value={o.matches.pairs} hint={o.matches.averageScore !== null ? `avg score ${o.matches.averageScore}` : undefined} />
      </div>
      <p className="notice">Counts reflect journeys registered in EmblemWay, not total road traffic.</p>
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Journeys per day (IST, last 30 days + next 7)</h2>
          <BarChart title="Journeys per day" data={daily.map((d) => ({ label: d.day, value: d.total }))} />
        </section>
        <section className="card">
          <h2>Journeys by vehicle</h2>
          <HorizontalBars title="Journeys by vehicle" data={vehicles.filter((v) => v.journeys > 0).map((v) => ({ label: v.name, value: v.journeys }))} />
        </section>
        <section className="card">
          <h2>City-wise journeys</h2>
          <HorizontalBars title="Journeys by city" data={cities.map((c) => ({ label: c.name, value: c.journeys }))} />
        </section>
      </div>
    </>
  );
}
