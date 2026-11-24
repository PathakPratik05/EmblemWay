import { render, screen } from '@testing-library/react';
import OverviewPage from '@/app/(dashboard)/page';
import UsersPage from '@/app/(dashboard)/users/page';
import JourneysPage from '@/app/(dashboard)/journeys/page';
import RoutesPage from '@/app/(dashboard)/routes/page';
import HotspotsPage from '@/app/(dashboard)/hotspots/page';
import TrafficPage from '@/app/(dashboard)/traffic/page';
import SettingsPage from '@/app/(dashboard)/settings/page';
import AuditPage from '@/app/(dashboard)/audit/page';
import HealthPage from '@/app/(dashboard)/health/page';
import LoginPage from '@/app/login/page';
import { BackendError } from '@/lib/backend';
import { adminApi } from '@/lib/server-api';

jest.mock('@/lib/server-api', () => ({ adminApi: jest.fn() }));
jest.mock('@/app/actions', () => ({ setUserStatus: jest.fn(), cancelJourney: jest.fn(), updateSettings: jest.fn(), runMaintenance: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }) }));

const api = adminApi as jest.Mock;
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 25, total: items.length, totalPages: 1, hasNextPage: false });
const sp = <T,>(v: T) => Promise.resolve(v);

/** Server Components are async functions returning JSX: await, then render. */
async function renderPage(el: Promise<React.ReactElement>) {
  render(await el);
}

const health = {
  ok: true,
  version: '1.0.0',
  uptimeSeconds: 600,
  postgisVersion: '3.5.3',
  checks: { database: { ok: true, latencyMs: 2 }, redis: { ok: false, latencyMs: 3000, error: 'timeout' } },
  jobs: { mode: 'queue', counts: { failed: 1, waiting: 0 } },
  maps: { provider: 'google', live: true, routesRequestsToday: 42, placesRequestsToday: 7 },
  push: { configured: false },
  memory: { rssMb: 180 },
};

beforeEach(() => api.mockReset());

it('overview shows statistics and the counts disclaimer', async () => {
  api.mockImplementation(async (path: string) => {
    if (path === '/admin/stats/overview') return { users: { total: 120, activeLast30Days: 80, newLast7Days: 9 }, journeys: { total: 400, byStatus: { PLANNED: 50, CANCELLED: 12, COMPLETED: 300 }, activeNow: 4 }, matches: { pairs: 77, averageScore: 63.2 }, generatedAt: '' };
    if (path === '/admin/stats/daily') return [{ day: '2026-11-24', total: 30, cancelled: 2 }];
    if (path === '/admin/stats/vehicles') return [{ code: 'CAR', name: 'Car', journeys: 200, travellers: 90 }, { code: 'BUS', name: 'Bus', journeys: 0, travellers: 0 }];
    return [{ code: 'PUNE', name: 'Pune', journeys: 400, upcomingOrActive: 54 }];
  });
  await renderPage(OverviewPage());
  expect(screen.getByTestId('stat-Users')).toHaveTextContent('120');
  expect(screen.getByTestId('stat-Matched pairs')).toHaveTextContent('avg score 63.2');
  expect(screen.getByText(/not total road traffic/)).toBeInTheDocument();
  expect(screen.getByText('Pune')).toBeInTheDocument();
  expect(screen.queryByText('Bus')).not.toBeInTheDocument(); // zero-journey vehicles hidden
});

it('overview shows an error panel when the API fails', async () => {
  api.mockRejectedValue(new BackendError(503, 'BACKEND_UNREACHABLE', 'The EmblemWay API is not reachable.'));
  await renderPage(OverviewPage());
  expect(screen.getByRole('alert')).toHaveTextContent('not reachable');
});

it('users page lists masked numbers and offers suspend / reactivate', async () => {
  api.mockResolvedValue(
    page([
      { id: '00000000-0000-4000-8000-000000000001', firstName: 'Priya', lastName: 'K', mobileNumberMasked: '+91 ••••••3210', email: null, status: 'ACTIVE', journeys: 3, lastLoginAt: null, createdAt: '2026-11-01T00:00:00Z' },
      { id: '00000000-0000-4000-8000-000000000002', firstName: 'Ravi', lastName: 'S', mobileNumberMasked: '+91 ••••••1111', email: 'r@x.in', status: 'SUSPENDED', journeys: 0, lastLoginAt: null, createdAt: '2026-11-01T00:00:00Z' },
    ]),
  );
  await renderPage(UsersPage({ searchParams: sp({ search: 'pri' }) }));
  expect(api).toHaveBeenCalledWith('/admin/users', { query: { search: 'pri', status: undefined, page: 1, pageSize: 25 } });
  expect(screen.getByText('+91 ••••••3210')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/\+91\d{10}/);
});

it('journeys page filters and only offers cancel for live journeys', async () => {
  api.mockImplementation(async (path: string) =>
    path === '/admin/journeys'
      ? page([
          { id: 'a', status: 'PLANNED', departureAt: '2026-11-25T04:00:00Z', vehicleType: { code: 'CAR', name: 'Car' }, city: { code: 'PUNE', name: 'Pune' }, user: { id: 'u', firstName: 'A', lastName: 'B' }, source: 'Baner', destination: 'Kharadi', distanceMeters: 15000, durationSeconds: 1800, provider: 'google', matches: 2 },
          { id: 'b', status: 'COMPLETED', departureAt: '2026-11-20T04:00:00Z', vehicleType: { code: 'BUS', name: 'Bus' }, city: null, user: { id: 'u', firstName: 'A', lastName: 'B' }, source: null, destination: null, distanceMeters: null, durationSeconds: null, provider: 'mock', matches: 0 },
        ])
      : [{ code: 'CAR', name: 'Car' }],
  );
  await renderPage(JourneysPage({ searchParams: sp({ status: 'PLANNED', vehicleType: 'CAR' }) }));
  expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
  expect(screen.getByText('Outside launch cities')).toBeInTheDocument();
  expect(screen.getByText('dev data')).toBeInTheDocument();
  expect(screen.getByText('15.0 km')).toBeInTheDocument();
});

it('popular routes page', async () => {
  api.mockResolvedValue([{ sourceName: 'Hinjewadi', destinationName: 'Kharadi', journeys: 14, travellers: 9, averageDistanceKm: 21.2 }]);
  await renderPage(RoutesPage({ searchParams: sp({ days: '7' }) }));
  expect(api).toHaveBeenCalledWith('/admin/stats/popular-routes', { query: { days: 7, limit: 25 } });
  expect(screen.getByText('21.2 km')).toBeInTheDocument();
});

it('hotspots page shows disclaimer, legend and top areas', async () => {
  api.mockResolvedValue({
    model: 'TRAFFIC',
    disclaimer: 'Derived from traffic speed data.',
    lastAggregatedAt: '2026-11-24T10:00:00Z',
    cells: [{ cellKey: 'c', center: { latitude: 18.52, longitude: 73.85 }, journeys: 0, congestionIndex: 0.8, level: 'VERY_HIGH', peakTravellers: 0, changeRatio: 0.25 }],
  });
  await renderPage(HotspotsPage({ searchParams: sp({ model: 'TRAFFIC' }) }));
  expect(screen.getByText('Derived from traffic speed data.')).toBeInTheDocument();
  expect(screen.getByText('80/100')).toBeInTheDocument();
  expect(screen.getByText('+25%')).toBeInTheDocument();
  expect(screen.getByLabelText('Legend')).toBeInTheDocument();
});

it('traffic page warns when data is simulated', async () => {
  api.mockImplementation(async (path: string) =>
    path === '/admin/stats/traffic'
      ? { windowHours: 24, requestsByStatus: { OK: 90, UNAVAILABLE: 10 }, failuresByCode: { QUOTA: 10 }, averageDelayRatioNow: 0.35, samples: 90 }
      : { ...health, maps: { ...health.maps, live: false, provider: 'mock' } },
  );
  await renderPage(TrafficPage());
  expect(screen.getByText(/simulated, not live/)).toBeInTheDocument();
  expect(screen.getByText('10% failure rate')).toBeInTheDocument();
  expect(screen.getByText('+35%')).toBeInTheDocument();
  expect(screen.getByText('QUOTA')).toBeInTheDocument();
});

it('settings page renders one form per section with current values', async () => {
  api.mockResolvedValue({
    matching: { minSharedDistanceMeters: 2000, minOverlapRatio: 0.3, requirePickupProximity: false },
    hotspots: { cellSizeMeters: 1000 },
    traffic: { staleAfterMinutes: 15 },
    journeys: { expiryGraceMinutes: 120 },
  });
  await renderPage(SettingsPage());
  expect(screen.getByRole('form', { name: 'Route matching thresholds' })).toBeInTheDocument();
  expect(screen.getByLabelText('Minimum shared distance (m)')).toHaveValue(2000);
  expect(screen.getByLabelText('Require pickup proximity')).not.toBeChecked();
  expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(4);
});

it('audit and health pages', async () => {
  api.mockResolvedValueOnce(page([{ id: '1', action: 'admin.settings_updated', entityType: 'settings', entityId: 'matching', ipAddress: null, requestId: null, metadata: { minOverlapRatio: 0.4 }, createdAt: '2026-11-24T10:00:00Z', actor: { firstName: 'Ada', lastName: 'A', role: 'SUPER_ADMIN' } }]));
  await renderPage(AuditPage({ searchParams: sp({}) }));
  expect(screen.getByText('admin.settings_updated')).toBeInTheDocument();
  expect(screen.getByText(/Ada A \(super_admin\)/)).toBeInTheDocument();

  api.mockResolvedValueOnce(health);
  await renderPage(HealthPage());
  expect(screen.getByTestId('stat-redis')).toHaveTextContent('DOWN');
  expect(screen.getByTestId('stat-Push notifications')).toHaveTextContent('Not configured');
});

it('login page shows the session-ended notice', async () => {
  await renderPage(LoginPage({ searchParams: sp({ reason: 'session' }) }));
  expect(screen.getByText(/session ended/)).toBeInTheDocument();
});
