import { cancelJourney } from '@/app/actions';
import { ErrorPanel, formatDateTime, km, Pager, StatusBadge } from '@/components/ui';
import { BackendError } from '@/lib/backend';
import { adminApi } from '@/lib/server-api';
import type { AdminJourney, Paginated } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUSES = ['DRAFT', 'PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED'];

export default async function JourneysPage({ searchParams }: { searchParams: Promise<{ status?: string; vehicleType?: string; city?: string; page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  let data: Paginated<AdminJourney>;
  let vehicles: Array<{ code: string; name: string }>;
  try {
    [data, vehicles] = await Promise.all([
      adminApi<Paginated<AdminJourney>>('/admin/journeys', { query: { status: sp.status, vehicleType: sp.vehicleType, city: sp.city, page, pageSize: 25 } }),
      adminApi<Array<{ code: string; name: string }>>('/admin/stats/vehicles'),
    ]);
  } catch (err) {
    return <ErrorPanel message={err instanceof BackendError ? err.message : 'Could not load journeys.'} />;
  }
  const params = (p: number) => {
    const q = new URLSearchParams({ page: String(p) });
    if (sp.status) q.set('status', sp.status);
    if (sp.vehicleType) q.set('vehicleType', sp.vehicleType);
    if (sp.city) q.set('city', sp.city);
    return `/journeys?${q}`;
  };
  return (
    <>
      <h1>Journeys</h1>
      <form className="filters" method="get">
        <label>
          Status
          <select name="status" defaultValue={sp.status ?? ''}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          Vehicle
          <select name="vehicleType" defaultValue={sp.vehicleType ?? ''}>
            <option value="">All</option>
            {vehicles.map((v) => (
              <option key={v.code} value={v.code}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          City
          <select name="city" defaultValue={sp.city ?? ''}>
            <option value="">All</option>
            <option value="PUNE">Pune</option>
            <option value="MUMBAI">Mumbai</option>
            <option value="BENGALURU">Bengaluru</option>
          </select>
        </label>
        <button className="btn" type="submit">
          Filter
        </button>
      </form>
      <p className="muted">{data.total} journeys</p>
      <table>
        <thead>
          <tr>
            <th>Departure (IST)</th>
            <th>Route</th>
            <th>Traveller</th>
            <th>Vehicle</th>
            <th>Distance</th>
            <th>Matches</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.items.map((j) => (
            <tr key={j.id}>
              <td>{formatDateTime(j.departureAt)}</td>
              <td>
                {j.source ?? '—'} → {j.destination ?? '—'}
                <div className="muted">{j.city?.name ?? 'Outside launch cities'}</div>
              </td>
              <td>
                {j.user.firstName} {j.user.lastName}
              </td>
              <td>{j.vehicleType.name}</td>
              <td>
                {km(j.distanceMeters)}
                {j.provider === 'mock' ? <div className="muted">dev data</div> : null}
              </td>
              <td>{j.matches}</td>
              <td>
                <StatusBadge status={j.status} />
              </td>
              <td>
                {['DRAFT', 'PLANNED', 'ACTIVE'].includes(j.status) ? (
                  <form action={cancelJourney}>
                    <input type="hidden" name="journeyId" value={j.id} />
                    <button className="btn danger" type="submit">
                      Cancel
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={data.page} totalPages={data.totalPages} hrefFor={params} />
    </>
  );
}
