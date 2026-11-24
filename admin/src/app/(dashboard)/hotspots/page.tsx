import { HotspotCell, HotspotGrid, Legend } from '@/components/charts';
import { ErrorPanel, formatDateTime } from '@/components/ui';
import { BackendError } from '@/lib/backend';
import { adminApi } from '@/lib/server-api';
import { MaintenanceButton } from './MaintenanceButton';

export const dynamic = 'force-dynamic';

const MODELS = { JOURNEY_DEMAND: 'Journey demand', TRAFFIC: 'Traffic', ORIGIN: 'Journey starts', DESTINATION: 'Journey ends' } as const;

interface HotspotResponse {
  model: keyof typeof MODELS;
  disclaimer: string;
  lastAggregatedAt: string | null;
  cells: Array<HotspotCell & { peakTravellers: number; changeRatio: number | null }>;
}

export default async function HotspotsPage({ searchParams }: { searchParams: Promise<{ model?: string; vehicleType?: string; city?: string }> }) {
  const sp = await searchParams;
  const model = (Object.keys(MODELS) as Array<keyof typeof MODELS>).includes(sp.model as keyof typeof MODELS) ? (sp.model as keyof typeof MODELS) : 'JOURNEY_DEMAND';
  let data: HotspotResponse;
  try {
    data = await adminApi<HotspotResponse>('/admin/hotspots', { query: { model, vehicleType: sp.vehicleType, city: sp.city || 'PUNE' } });
  } catch (err) {
    return <ErrorPanel message={err instanceof BackendError ? err.message : 'Could not load hotspots.'} />;
  }
  const top = [...data.cells].sort((a, b) => (model === 'TRAFFIC' ? (b.congestionIndex ?? 0) - (a.congestionIndex ?? 0) : b.journeys - a.journeys)).slice(0, 15);
  return (
    <>
      <h1>Hotspot analytics</h1>
      <form className="filters" method="get">
        <label>
          Model
          <select name="model" defaultValue={model}>
            {Object.entries(MODELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Vehicle code
          <input name="vehicleType" placeholder="ALL" defaultValue={sp.vehicleType ?? ''} />
        </label>
        <label>
          City
          <select name="city" defaultValue={sp.city ?? 'PUNE'}>
            <option value="PUNE">Pune</option>
            <option value="MUMBAI">Mumbai</option>
            <option value="BENGALURU">Bengaluru</option>
          </select>
        </label>
        <button className="btn" type="submit">
          Show
        </button>
      </form>
      <p className="notice">{data.disclaimer}</p>
      <div className="grid cols-2">
        <section className="card">
          <h2>{MODELS[model]} map (last 7 days)</h2>
          <Legend />
          <HotspotGrid cells={data.cells} title={`${MODELS[model]} hotspots`} />
          <p className="muted">Last aggregated: {data.lastAggregatedAt ? formatDateTime(data.lastAggregatedAt) : 'never'}</p>
          <MaintenanceButton task="aggregate-hotspots" label="Re-aggregate now (super admin)" />
        </section>
        <section className="card">
          <h2>Top areas</h2>
          <table>
            <thead>
              <tr>
                <th>Area (cell centre)</th>
                <th>{model === 'TRAFFIC' ? 'Congestion' : 'Journeys'}</th>
                <th>Level</th>
                <th>vs previous</th>
              </tr>
            </thead>
            <tbody>
              {top.map((c) => (
                <tr key={c.cellKey}>
                  <td>
                    {c.center.latitude.toFixed(4)}, {c.center.longitude.toFixed(4)}
                  </td>
                  <td>{model === 'TRAFFIC' ? `${Math.round((c.congestionIndex ?? 0) * 100)}/100` : c.journeys}</td>
                  <td>{c.level.replace('_', ' ').toLowerCase()}</td>
                  <td>{c.changeRatio === null ? '—' : `${c.changeRatio >= 0 ? '+' : ''}${Math.round(c.changeRatio * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
