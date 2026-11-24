import { ErrorPanel } from '@/components/ui';
import { BackendError } from '@/lib/backend';
import { adminApi } from '@/lib/server-api';
import type { SettingsMap } from '@/lib/types';
import { SettingsForm } from './SettingsForm';

export const dynamic = 'force-dynamic';

const SECTION_TITLES: Record<keyof SettingsMap, string> = {
  matching: 'Route matching thresholds',
  hotspots: 'Hotspot aggregation',
  traffic: 'Traffic recommendations',
  journeys: 'Journey lifecycle',
};

export default async function SettingsPage() {
  let settings: SettingsMap;
  try {
    settings = await adminApi<SettingsMap>('/admin/settings');
  } catch (err) {
    return <ErrorPanel message={err instanceof BackendError ? err.message : 'Could not load settings.'} />;
  }
  return (
    <>
      <h1>Settings</h1>
      <p className="notice">Changes take effect within 30 seconds and are recorded in the audit log. Values are validated by the API.</p>
      <div className="grid cols-2">
        {(Object.keys(SECTION_TITLES) as Array<keyof SettingsMap>).map((section) => (
          <SettingsForm key={section} section={section} title={SECTION_TITLES[section]} values={settings[section]} />
        ))}
      </div>
    </>
  );
}
