import { ErrorPanel } from '@/components/ui';
import { BackendError } from '@/lib/backend';
import { adminApi } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface PopularRoute {
  sourceName: string;
  destinationName: string;
  journeys: number;
  travellers: number;
  averageDistanceKm: number | null;
}

export default async function RoutesPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const days = Math.min(365, Math.max(1, Number((await searchParams).days) || 30));
  let routes: PopularRoute[];
  try {
    routes = await adminApi<PopularRoute[]>('/admin/stats/popular-routes', { query: { days, limit: 25 } });
  } catch (err) {
    return <ErrorPanel message={err instanceof BackendError ? err.message : 'Could not load routes.'} />;
  }
  return (
    <>
      <h1>Popular commuting corridors</h1>
      <form className="filters" method="get">
        <label>
          Period (days)
          <input name="days" type="number" min={1} max={365} defaultValue={days} />
        </label>
        <button className="btn" type="submit">
          Update
        </button>
      </form>
      <p className="notice">Corridors group journeys whose start and end fall in the same ~1 km cells. Counts are registered journeys, not vehicles.</p>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>From</th>
            <th>To</th>
            <th>Journeys</th>
            <th>Travellers</th>
            <th>Avg distance</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r, i) => (
            <tr key={`${r.sourceName}-${r.destinationName}-${i}`}>
              <td>{i + 1}</td>
              <td>{r.sourceName}</td>
              <td>{r.destinationName}</td>
              <td>{r.journeys}</td>
              <td>{r.travellers}</td>
              <td>{r.averageDistanceKm === null ? '—' : `${r.averageDistanceKm} km`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {routes.length === 0 ? <p className="muted">No journeys in this period.</p> : null}
    </>
  );
}
