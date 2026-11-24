import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import { api } from '../../src/api';
import { ApiError } from '../../src/api/client';
import { useAuthStore } from '../../src/auth/authStore';
import { tokenStore } from '../../src/auth/tokenStorage';
import { ErrorState, LoadingState } from '../../src/components/ui';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { RootNavigator } from '../../src/navigation/RootNavigator';
import {
  JourneysScreen,
  RouteMatchingScreen,
  TrafficPredictionScreen,
} from '../../src/screens/journeys/JourneyScreens';
import {
  HotspotsScreen,
  NotificationsScreen,
} from '../../src/screens/misc/MiscScreens';
import { HomeScreen } from '../../src/screens/plan/PlanScreens';
import { ProfileScreen } from '../../src/screens/profile/ProfileScreens';
import { usePlannerStore } from '../../src/state/plannerStore';
import {
  journey,
  matches,
  me,
  renderScreen,
  renderWithProviders,
  traffic,
  vehicleTypes,
} from '../helpers';

jest.mock('../../src/api', () => ({
  setSessionExpiredHandler: jest.fn(),
  api: {
    auth: {
      requestOtp: jest.fn(),
      verifyOtp: jest.fn(),
      logout: jest.fn().mockResolvedValue(undefined),
    },
    users: { me: jest.fn(), deleteAccount: jest.fn(), exportData: jest.fn() },
    meta: { vehicleTypes: jest.fn(), cities: jest.fn() },
    maps: { reverseGeocode: jest.fn() },
    journeys: {
      list: jest.fn(),
      get: jest.fn(),
      matches: jest.fn(),
      segments: jest.fn(),
    },
    traffic: { forJourney: jest.fn() },
    hotspots: { get: jest.fn() },
    notifications: {
      list: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
      registerDevice: jest.fn(),
    },
    saved: { routes: jest.fn(), places: jest.fn() },
  },
}));

const m = api as unknown as Record<string, Record<string, jest.Mock>>;
const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
  totalPages: 1,
  hasNextPage: false,
});

beforeEach(() => {
  jest.clearAllMocks();
  m.meta.vehicleTypes.mockResolvedValue(vehicleTypes);
  m.meta.cities.mockResolvedValue([
    {
      id: 'c',
      code: 'PUNE',
      name: 'Pune',
      state: 'MH',
      center: { latitude: 18.52, longitude: 73.85 },
    },
  ]);
  m.users.me.mockResolvedValue(me);
  m.journeys.list.mockResolvedValue(page([]));
  m.saved.routes.mockResolvedValue([]);
  m.saved.places.mockResolvedValue([]);
  m.notifications.list.mockResolvedValue({ ...page([]), unreadCount: 0 });
  usePlannerStore.getState().reset();
  usePlannerStore.setState({ vehicleTypeCode: null });
  useAuthStore.setState({ user: null });
});

describe('navigation by auth state', () => {
  it('shows the login screen when signed out', async () => {
    await tokenStore.clear();
    renderWithProviders(<RootNavigator />);
    expect(await screen.findByTestId('welcome-screen')).toBeTruthy();
  });

  it('shows profile setup for a new account', async () => {
    await tokenStore.set({
      accessToken: 'a',
      refreshToken: 'r',
      accessTokenExpiresAt: '',
      refreshTokenExpiresAt: '',
      tokenType: 'Bearer',
    });
    m.users.me.mockResolvedValue({ ...me, profileComplete: false });
    renderWithProviders(<RootNavigator />);
    expect(await screen.findByTestId('profile-setup-screen')).toBeTruthy();
  });

  it('shows the home dashboard with tabs when signed in', async () => {
    await tokenStore.set({
      accessToken: 'a',
      refreshToken: 'r',
      accessTokenExpiresAt: '',
      refreshTokenExpiresAt: '',
      tokenType: 'Bearer',
    });
    renderWithProviders(<RootNavigator />);
    expect(await screen.findByTestId('home-screen')).toBeTruthy();
    expect(screen.getByText(/Priya/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('tab-Journeys'));
    expect(await screen.findByTestId('journeys-screen')).toBeTruthy();
  });
});

describe('Home dashboard', () => {
  it('lists vehicle categories from the backend and validates the plan', async () => {
    renderScreen('Home', HomeScreen);
    expect(await screen.findByTestId('vehicle-MOTORCYCLE')).toBeTruthy();
    expect(screen.getByTestId('vehicle-BICYCLE')).toBeTruthy();
    fireEvent.press(screen.getByTestId('search-journeys'));
    expect(await screen.findByText('Choose where you start')).toBeTruthy();
    expect(screen.getByText('Choose your destination')).toBeTruthy();
    expect(screen.getByText('Choose a vehicle')).toBeTruthy();
  });

  it('shows an error state with retry when vehicle types fail to load', async () => {
    m.meta.vehicleTypes.mockRejectedValue(
      new ApiError(0, 'NETWORK_ERROR', 'offline'),
    );
    renderScreen('Home', HomeScreen);
    expect(await screen.findByText(/offline/)).toBeTruthy();
    m.meta.vehicleTypes.mockResolvedValue(vehicleTypes);
    fireEvent.press(screen.getAllByTestId('retry-button')[0]!);
    expect(await screen.findByTestId('vehicle-CAR')).toBeTruthy();
  });

  it('shows upcoming journeys and a traffic summary for the next one', async () => {
    m.journeys.list.mockResolvedValue(page([journey()]));
    m.traffic.forJourney.mockResolvedValue(traffic);
    renderScreen('Home', HomeScreen);
    expect(await screen.findByTestId('journey-j1')).toBeTruthy();
    expect(await screen.findByText(/Leave now: 50 min/)).toBeTruthy();
    expect(screen.getByText(/save about 10 min/)).toBeTruthy();
  });

  it('selecting a vehicle chip updates the plan', async () => {
    renderScreen('Home', HomeScreen);
    fireEvent.press(await screen.findByTestId('vehicle-MOTORCYCLE'));
    expect(usePlannerStore.getState().vehicleTypeCode).toBe('MOTORCYCLE');
  });
});

describe('Route matching screen', () => {
  it('shows deduplicated counts, vehicle breakdown, disclaimer and matches', async () => {
    m.journeys.get.mockResolvedValue(journey());
    m.journeys.matches.mockResolvedValue(matches);
    m.journeys.segments.mockResolvedValue({
      cellSizeMeters: 500,
      timeWindowMinutes: 120,
      segments: [
        {
          segmentId: 's',
          sequence: 0,
          center: { latitude: 18.5, longitude: 73.8 },
          travellers: 2,
          journeys: 3,
          byVehicleType: {},
        },
      ],
      disclaimer: '',
    });
    renderScreen('RouteMatching', RouteMatchingScreen, { journeyId: 'j1' });
    expect(await screen.findByTestId('match-m1')).toBeTruthy();
    expect(screen.getByText('Arjun')).toBeTruthy();
    expect(screen.getByText('Motorcycle: 2')).toBeTruthy();
    expect(screen.getByTestId('match-disclaimer')).toBeTruthy();
    expect(screen.getByText(/Busiest stretch of your route: 2/)).toBeTruthy();
    fireEvent.press(await screen.findByTestId('match-filter-CAR'));
    await waitFor(() =>
      expect(m.journeys.matches).toHaveBeenLastCalledWith('j1', {
        vehicleTypes: ['CAR'],
        minOverlap: undefined,
      }),
    );
  });

  it('shows an empty state when nobody shares the route', async () => {
    m.journeys.get.mockResolvedValue(journey());
    m.journeys.matches.mockResolvedValue({
      ...matches,
      items: [],
      summary: {
        ...matches.summary,
        distinctTravellers: 0,
        totalMatchingJourneys: 0,
      },
    });
    m.journeys.segments.mockResolvedValue({
      cellSizeMeters: 500,
      timeWindowMinutes: 120,
      segments: [],
      disclaimer: '',
    });
    renderScreen('RouteMatching', RouteMatchingScreen, { journeyId: 'j1' });
    expect(await screen.findByText('No matching travellers yet')).toBeTruthy();
  });
});

describe('Traffic prediction screen', () => {
  it('shows all five scenarios, stale/unavailable labels, recommendation and disclaimer', async () => {
    m.traffic.forJourney.mockResolvedValue(traffic);
    renderScreen('TrafficPrediction', TrafficPredictionScreen, {
      journeyId: 'j1',
    });
    for (const s of [
      'NOW',
      'PLUS_15_MINUTES',
      'PLUS_30_MINUTES',
      'PLUS_45_MINUTES',
      'PLUS_60_MINUTES',
    ]) {
      expect(await screen.findByTestId(`traffic-${s}`)).toBeTruthy();
    }
    expect(screen.getByText('Last known estimate - not live')).toBeTruthy();
    expect(
      screen.getByText(
        /Unavailable: Traffic service is temporarily unavailable/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/save about 10 min/)).toBeTruthy();
    expect(screen.getByTestId('traffic-disclaimer')).toBeTruthy();
  });

  it('labels development data as not live', async () => {
    m.traffic.forJourney.mockResolvedValue({ ...traffic, isLiveData: false });
    renderScreen('TrafficPrediction', TrafficPredictionScreen, {
      journeyId: 'j1',
    });
    expect(
      await screen.findByText(/development traffic simulator/),
    ).toBeTruthy();
  });
});

describe('Journeys & history', () => {
  it('shows empty upcoming state, then history with filters', async () => {
    renderScreen('Journeys', JourneysScreen);
    expect(await screen.findByText('No upcoming journeys')).toBeTruthy();
    m.journeys.list.mockResolvedValue(
      page([journey({ id: 'h1', status: 'CANCELLED', cancelReason: 'x' })]),
    );
    fireEvent.press(screen.getByTestId('tab-history'));
    expect(await screen.findByTestId('journey-h1')).toBeTruthy();
    expect(screen.getAllByText('Cancelled')).toHaveLength(2); // filter chip + status badge
    fireEvent.press(screen.getByTestId('history-filter-Completed'));
    await waitFor(() =>
      expect(m.journeys.list).toHaveBeenLastCalledWith(
        'history',
        1,
        'COMPLETED',
      ),
    );
  });

  it('shows an error state when loading fails', async () => {
    m.journeys.list.mockRejectedValue(
      new ApiError(500, 'SERVER_ERROR', 'down'),
    );
    renderScreen('Journeys', JourneysScreen);
    expect(
      await screen.findByTestId('error-state', {}, { timeout: 10000 }),
    ).toBeTruthy();
  });
});

describe('Hotspots & notifications', () => {
  it('renders hotspot legend, disclaimer and switches models', async () => {
    m.hotspots.get.mockResolvedValue({
      model: 'JOURNEY_DEMAND',
      cellSizeMeters: 1000,
      from: '',
      to: '',
      lastAggregatedAt: null,
      legend: [
        { level: 'LOW', color: '#2E9E5B', label: 'Low' },
        { level: 'VERY_HIGH', color: '#D93B3B', label: 'Very high' },
      ],
      disclaimer: 'Journey demand, not the number of vehicles on the road.',
      cells: [
        {
          cellKey: 'c1',
          center: { latitude: 18.5, longitude: 73.8 },
          journeys: 12,
          peakTravellers: 5,
          congestionIndex: null,
          intensity: 12,
          level: 'VERY_HIGH',
          changeRatio: 0.2,
        },
      ],
    });
    renderScreen('Hotspots', HotspotsScreen);
    expect(await screen.findByTestId('hotspot-legend')).toBeTruthy();
    expect(screen.getByText(/not the number of vehicles/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('hotspot-model-TRAFFIC'));
    await waitFor(() =>
      expect(m.hotspots.get).toHaveBeenLastCalledWith(
        expect.objectContaining({ model: 'TRAFFIC', vehicleType: undefined }),
      ),
    );
  });

  it('lists notifications and marks them read', async () => {
    m.notifications.list.mockResolvedValue({
      ...page([
        {
          id: 'n1',
          type: 'MATCH_FOUND',
          title: 'New traveller on your route',
          body: 'Someone…',
          data: {},
          readAt: null,
          createdAt: new Date().toISOString(),
        },
      ]),
      unreadCount: 1,
    });
    m.notifications.markRead.mockResolvedValue(undefined);
    renderScreen('Alerts', NotificationsScreen);
    fireEvent.press(await screen.findByTestId('notification-n1'));
    await waitFor(() =>
      expect(m.notifications.markRead).toHaveBeenCalledWith('n1'),
    );
  });
});

describe('Profile', () => {
  it('logs out', async () => {
    useAuthStore.setState({ status: 'signedIn', user: me });
    renderScreen('Profile', ProfileScreen);
    expect(await screen.findByText('Priya Kulkarni')).toBeTruthy();
    expect(screen.getByText('+91 ••••••3210')).toBeTruthy();
    fireEvent.press(screen.getByTestId('logout-button'));
    await waitFor(() =>
      expect(useAuthStore.getState().status).toBe('signedOut'),
    );
  });
});

describe('shared UI states', () => {
  it('loading and error with retry', () => {
    const retry = jest.fn();
    render(
      <>
        <LoadingState message="Wait" />
        <ErrorState message="Failed" onRetry={retry} />
      </>,
    );
    expect(screen.getByText('Wait')).toBeTruthy();
    fireEvent.press(screen.getByTestId('retry-button'));
    expect(retry).toHaveBeenCalled();
  });

  it('error boundary catches render crashes', () => {
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const Boom = () => {
      throw new Error('boom');
    };
    render(
      <ErrorBoundary>
        <Boom />
        <Text>never</Text>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary')).toBeTruthy();
    spy.mockRestore();
  });
});
