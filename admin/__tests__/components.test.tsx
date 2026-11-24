import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BarChart, HorizontalBars, HotspotGrid, Legend, LEVEL_COLORS } from '@/components/charts';
import { formatDateTime, km, Pager, StatCard, StatusBadge } from '@/components/ui';
import { LoginForm } from '@/app/login/LoginForm';
import { humanize } from '@/app/(dashboard)/settings/SettingsForm';

const replace = jest.fn();
const refresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));
jest.mock('@/app/actions', () => ({ updateSettings: jest.fn(), runMaintenance: jest.fn() }));

describe('charts', () => {
  it('bar chart renders one bar per datum with accessible titles', () => {
    const { container } = render(<BarChart title="Journeys per day" data={[{ label: 'Mon', value: 3 }, { label: 'Tue', value: 6 }]} />);
    expect(container.querySelectorAll('rect')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Journeys per day' })).toBeInTheDocument();
    expect(screen.getByText('Tue: 6')).toBeInTheDocument();
  });

  it('empty charts show a message', () => {
    render(<BarChart title="x" data={[]} />);
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
  });

  it('horizontal bars list values', () => {
    render(<HorizontalBars title="By vehicle" data={[{ label: 'Car', value: 12 }]} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('Car12');
  });

  it('hotspot grid colours cells by level using the agreed legend', () => {
    const { container } = render(
      <HotspotGrid
        title="Demand"
        cells={[
          { cellKey: 'a', center: { latitude: 18.5, longitude: 73.8 }, journeys: 2, congestionIndex: null, level: 'LOW' },
          { cellKey: 'b', center: { latitude: 18.6, longitude: 73.9 }, journeys: 40, congestionIndex: null, level: 'VERY_HIGH' },
        ]}
      />,
    );
    const rects = container.querySelectorAll('rect');
    expect(rects[0]).toHaveAttribute('fill', LEVEL_COLORS.LOW);
    expect(rects[1]).toHaveAttribute('fill', '#D93B3B');
    render(<Legend />);
    expect(screen.getByText('Very high')).toBeInTheDocument();
  });

  it('legend colours are green, yellow, orange, red', () => {
    expect(Object.values(LEVEL_COLORS)).toEqual(['#2E9E5B', '#F2C230', '#F08A24', '#D93B3B']);
  });
});

describe('ui', () => {
  it('stat card, badge and pager', () => {
    render(
      <>
        <StatCard label="Users" value={42} hint="5 new" />
        <StatusBadge status="CANCELLED" />
        <Pager page={2} totalPages={3} hrefFor={(p) => `/users?page=${p}`} />
      </>,
    );
    expect(screen.getByTestId('stat-Users')).toHaveTextContent('42');
    expect(screen.getByText('cancelled')).toHaveClass('danger');
    expect(screen.getByText('Previous')).toHaveAttribute('href', '/users?page=1');
    expect(screen.getByText('Next')).toHaveAttribute('href', '/users?page=3');
  });

  it('formats IST and distances', () => {
    expect(formatDateTime('2026-11-25T04:00:00Z')).toMatch(/9:30/);
    expect(km(21_100)).toBe('21.1 km');
    expect(km(null)).toBe('—');
  });

  it('humanizes settings keys', () => {
    expect(humanize('minOverlapRatio')).toBe('Minimum overlap ratio (0–1)');
    expect(humanize('expiryGraceMinutes')).toBe('Expiry Grace Minutes');
  });
});

// jsdom has no fetch Response; the form only uses ok/json().
const fakeResponse = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

describe('login form', () => {
  beforeEach(() => {
    replace.mockReset();
    global.fetch = jest.fn();
  });

  it('signs in and navigates to the dashboard', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(fakeResponse(200, { ok: true }));
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@emblemway.in' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Sup3r-secret' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Admin sign in' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
  });

  it('shows the server error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(fakeResponse(401, { error: 'Invalid email or password.' }));
    render(<LoginForm notice="Your session ended." />);
    expect(screen.getByText('Your session ended.')).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('form', { name: 'Admin sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(replace).not.toHaveBeenCalled();
  });

  it('handles network errors', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('offline'));
    render(<LoginForm />);
    fireEvent.submit(screen.getByRole('form', { name: 'Admin sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
  });
});
