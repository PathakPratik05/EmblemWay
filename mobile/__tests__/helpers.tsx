import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { render } from '@testing-library/react-native';
import React from 'react';
import type {
  Journey,
  Me,
  MatchesResponse,
  TrafficPrediction,
  VehicleType,
} from '../src/api/types';

export function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return {
    qc,
    ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>),
  };
}

/** Renders a screen inside a real native-stack navigator so `navigation` and `route` props are genuine. */
export function renderScreen(
  name: string,
  Component: React.ComponentType<any>,
  params?: object,
  extra: Record<string, React.ComponentType<any>> = {},
) {
  const Stack = createNativeStackNavigator();
  return renderWithProviders(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name={name}
          component={Component}
          initialParams={params}
        />
        {Object.entries(extra).map(([n, C]) => (
          <Stack.Screen key={n} name={n} component={C} />
        ))}
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

export const vehicleTypes: VehicleType[] = [
  {
    id: '1',
    code: 'CAR',
    name: 'Car',
    icon: 'car',
    routingProfile: 'DRIVE',
    trafficSupported: true,
    approximationNote: null,
    poolingEligible: true,
    defaultSeats: 4,
  },
  {
    id: '2',
    code: 'MOTORCYCLE',
    name: 'Motorcycle',
    icon: 'motorbike',
    routingProfile: 'TWO_WHEELER',
    trafficSupported: true,
    approximationNote: null,
    poolingEligible: true,
    defaultSeats: 1,
  },
  {
    id: '3',
    code: 'BICYCLE',
    name: 'Bicycle',
    icon: 'bicycle',
    routingProfile: 'BICYCLE',
    trafficSupported: false,
    approximationNote: 'n/a',
    poolingEligible: false,
    defaultSeats: 1,
  },
];

export const me: Me = {
  id: 'u1',
  firstName: 'Priya',
  lastName: 'Kulkarni',
  email: null,
  mobileNumberMasked: '+91 ••••••3210',
  role: 'USER',
  profileImageUrl: null,
  preferredCity: { code: 'PUNE', name: 'Pune' },
  defaultVehicleType: { code: 'CAR', name: 'Car' },
  profileComplete: true,
  privacy: { shareJourneysForMatching: true, showFirstNameToMatches: true },
  notifications: {
    journeyReminders: true,
    matches: true,
    statusUpdates: true,
    trafficAlerts: true,
  },
  locationConsentAt: null,
};

export function journey(overrides: Partial<Journey> = {}): Journey {
  return {
    id: 'j1',
    status: 'PLANNED',
    purpose: 'COMMUTE',
    departureAt: '2026-11-25T04:00:00.000Z',
    estimatedArrivalAt: '2026-11-25T04:50:00.000Z',
    timezone: 'Asia/Kolkata',
    version: 1,
    notes: null,
    vehicleType: {
      code: 'CAR',
      name: 'Car',
      icon: 'car',
      routingProfile: 'DRIVE',
    },
    source: {
      name: 'Hinjewadi Phase 1',
      latitude: 18.5912,
      longitude: 73.7389,
    },
    destination: { name: 'Kharadi', latitude: 18.5515, longitude: 73.9348 },
    pickup: {
      name: 'Hinjewadi Phase 1',
      latitude: 18.5912,
      longitude: 73.7389,
    },
    route: {
      encodedPolyline: '_p~iF~ps|U_ulLnnqC',
      distanceMeters: 21_100,
      durationSeconds: 3000,
      staticDurationSeconds: 1900,
      provider: 'google',
      isLiveData: true,
      computedAt: '',
      alternatives: 0,
    },
    ridePoolOffer: null,
    matchesComputedAt: null,
    cancelledAt: null,
    cancelReason: null,
    completedAt: null,
    locationsPurged: false,
    createdAt: '',
    ...overrides,
  };
}

export const matches: MatchesResponse = {
  items: [
    {
      matchedJourneyId: 'm1',
      traveller: { displayName: 'Arjun' },
      vehicleType: {
        code: 'MOTORCYCLE',
        name: 'Motorcycle',
        icon: 'motorbike',
      },
      matchType: 'SAME_ROUTE',
      sharedDistanceMeters: 20_500,
      overlapRatioSelf: 0.97,
      overlapRatioOther: 0.99,
      directionSimilarity: 1,
      departureAt: '2026-11-25T04:05:00.000Z',
      departureDiffMinutes: -5,
      convergenceTimeDiffMinutes: -5,
      pickupDistanceMeters: 300,
      destinationDistanceMeters: 150,
      score: 92.4,
      confidence: 'HIGH',
      commonSegmentPolyline: '_p~iF~ps|U',
      ridePool: null,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
  hasNextPage: false,
  summary: {
    totalMatchingJourneys: 3,
    distinctTravellers: 2,
    sameRouteTravellers: 1,
    partialOverlapTravellers: 1,
    byMatchType: {
      SAME_ROUTE: 1,
      SAME_DESTINATION: 0,
      SHARED_START: 0,
      PARTIAL_OVERLAP: 1,
    },
    byVehicleType: [
      { code: 'MOTORCYCLE', name: 'Motorcycle', travellers: 2, journeys: 3 },
    ],
    computedAt: null,
    disclaimer:
      'Counts include only journeys registered in EmblemWay. They are not a measure of all vehicles on the road.',
  },
};

export const traffic: TrafficPrediction = {
  provider: 'google',
  isLiveData: true,
  routingProfile: 'DRIVE',
  vehicleType: { code: 'CAR', name: 'Car' },
  approximationNote: null,
  generatedAt: '2026-11-25T03:00:00.000Z',
  estimates: (
    [
      'NOW',
      'PLUS_15_MINUTES',
      'PLUS_30_MINUTES',
      'PLUS_45_MINUTES',
      'PLUS_60_MINUTES',
    ] as const
  ).map((scenario, i) => ({
    scenario,
    offsetMinutes: i * 15,
    departureAt: new Date(
      Date.parse('2026-11-25T03:00:00.000Z') + i * 15 * 60_000,
    ).toISOString(),
    status: i === 4 ? ('UNAVAILABLE' as const) : ('OK' as const),
    durationSeconds: i === 4 ? null : 3000 - i * 300,
    staticDurationSeconds: 1800,
    delaySeconds: i === 4 ? null : 1200 - i * 300,
    arrivalAt: i === 4 ? null : '2026-11-25T03:50:00.000Z',
    distanceMeters: 21_000,
    fetchedAt: '2026-11-25T03:00:00.000Z',
    freshness:
      i === 4 ? null : i === 3 ? ('STALE' as const) : ('LIVE' as const),
    reason: i === 4 ? 'Traffic service is temporarily unavailable.' : null,
  })),
  recommendation: {
    scenario: 'PLUS_30_MINUTES',
    savingsSeconds: 600,
    significant: true,
    message:
      'Leaving in 30 min is predicted to save about 10 min compared with leaving now.',
  },
  disclaimer: 'Future travel times are predictions, not guaranteed.',
};
