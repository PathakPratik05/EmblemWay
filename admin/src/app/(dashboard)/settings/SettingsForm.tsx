'use client';

import { useActionState } from 'react';
import { ActionState, updateSettings } from '@/app/actions';

/** Human labels for well-known keys; unknown keys fall back to a readable version of the key. */
const LABELS: Record<string, string> = {
  minSharedDistanceMeters: 'Minimum shared distance (m)',
  minOverlapRatio: 'Minimum overlap ratio (0–1)',
  departureWindowMinutes: 'Departure time window (min)',
  corridorWidthMeters: 'Same-road corridor half-width (m)',
  pickupProximityMeters: 'Pickup proximity (m)',
  requirePickupProximity: 'Require pickup proximity',
  destinationProximityMeters: 'Same-destination radius (m)',
  minDirectionSimilarity: 'Minimum direction similarity (0–1)',
  sameRouteOverlapRatio: 'Same-route overlap ratio (0–1)',
};

export function humanize(key: string): string {
  return LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

export function SettingsForm({ section, title, values }: { section: string; title: string; values: Record<string, number | boolean> }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateSettings, { ok: true, message: '' });
  const booleans = Object.entries(values)
    .filter(([, v]) => typeof v === 'boolean')
    .map(([k]) => k);
  return (
    <form className="card" action={action} aria-label={title}>
      <h2>{title}</h2>
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="$booleans" value={booleans.join(',')} />
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {Object.entries(values).map(([key, v]) =>
          typeof v === 'boolean' ? (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" name={key} defaultChecked={v} />
              {humanize(key)}
            </label>
          ) : (
            <label key={key}>
              {humanize(key)}
              <input name={key} type="number" step="any" defaultValue={v} required />
            </label>
          ),
        )}
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        {state.message ? (
          <span className={state.ok ? 'muted' : 'error'} role="status">
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
