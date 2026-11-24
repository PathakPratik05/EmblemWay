/** Dependency-free SVG charts (server-renderable, no client JS). */

export interface BarDatum {
  label: string;
  value: number;
}

export function BarChart({ data, height = 180, color = '#1b4d89', title }: { data: BarDatum[]; height?: number; color?: string; title: string }) {
  if (data.length === 0) return <p className="muted">No data yet.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const barW = 100 / data.length;
  return (
    <svg viewBox={`0 0 100 ${height / 3}`} width="100%" height={height} role="img" aria-label={title} preserveAspectRatio="none">
      <title>{title}</title>
      {data.map((d, i) => {
        const h = (d.value / max) * (height / 3 - 6);
        return (
          <rect key={d.label} x={i * barW + barW * 0.15} y={height / 3 - h} width={barW * 0.7} height={h} fill={color} rx={0.6}>
            <title>{`${d.label}: ${d.value}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function HorizontalBars({ data, title }: { data: BarDatum[]; title: string }) {
  if (data.length === 0) return <p className="muted">No data yet.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div role="list" aria-label={title} className="grid" style={{ gap: 8 }}>
      {data.map((d) => (
        <div role="listitem" key={d.label} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 48px', gap: 8, alignItems: 'center' }}>
          <span>{d.label}</span>
          <span style={{ background: '#e8f0fa', borderRadius: 6, height: 14 }}>
            <span style={{ display: 'block', width: `${(d.value / max) * 100}%`, background: '#1b4d89', height: 14, borderRadius: 6 }} />
          </span>
          <strong style={{ textAlign: 'right' }}>{d.value}</strong>
        </div>
      ))}
    </div>
  );
}

export const LEVEL_COLORS = { LOW: '#2E9E5B', MODERATE: '#F2C230', HIGH: '#F08A24', VERY_HIGH: '#D93B3B' } as const;
export type HotspotLevel = keyof typeof LEVEL_COLORS;

export interface HotspotCell {
  cellKey: string;
  center: { latitude: number; longitude: number };
  journeys: number;
  congestionIndex: number | null;
  level: HotspotLevel;
}

/** Plots grid cells by lat/lng as coloured squares - a map-free heatmap for the dashboard. */
export function HotspotGrid({ cells, title }: { cells: HotspotCell[]; title: string }) {
  if (cells.length === 0) return <p className="muted">No hotspot data for this filter. Run aggregation or widen the time range.</p>;
  const lats = cells.map((c) => c.center.latitude);
  const lngs = cells.map((c) => c.center.longitude);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const pad = 0.01;
  const w = Math.max(0.02, maxLng - minLng + pad * 2);
  const h = Math.max(0.02, maxLat - minLat + pad * 2);
  const size = Math.min(w, h) / 40;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxHeight: 460, background: '#f0f3f7', borderRadius: 8 }} role="img" aria-label={title}>
      <title>{title}</title>
      {cells.map((c) => (
        <rect
          key={c.cellKey}
          data-level={c.level}
          x={c.center.longitude - minLng + pad - size / 2}
          y={maxLat - c.center.latitude + pad - size / 2}
          width={size}
          height={size}
          fill={LEVEL_COLORS[c.level]}
          opacity={0.85}
        >
          <title>{c.congestionIndex !== null ? `Congestion ${(c.congestionIndex * 100).toFixed(0)}/100` : `${c.journeys} journeys`}</title>
        </rect>
      ))}
    </svg>
  );
}

export function Legend() {
  return (
    <div style={{ display: 'flex', gap: 16, margin: '8px 0' }} aria-label="Legend">
      {(Object.entries(LEVEL_COLORS) as Array<[HotspotLevel, string]>).map(([level, color]) => (
        <span key={level} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: color, display: 'inline-block' }} />
          {{ LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High', VERY_HIGH: 'Very high' }[level]}
        </span>
      ))}
    </div>
  );
}
