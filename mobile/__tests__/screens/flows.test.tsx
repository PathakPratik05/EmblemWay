import Geolocation from '@react-native-community/geolocation';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert, PermissionsAndroid } from 'react-native';
import { api } from '../../src/api';
import { ApiError } from '../../src/api/client';
import { useAuthStore } from '../../src/auth/authStore';
import { JourneyDetailScreen, MatchingJourneysScreen } from '../../src/screens/journeys/JourneyScreens';
import { SavedRoutesScreen } from '../../src/screens/misc/MiscScreens';
import { LocationSearchScreen, MapPlannerScreen, toIstHHmm, validatePlan } from '../../src/screens/plan/PlanScreens';
import {
  EditProfileScreen,
  NotificationPreferencesScreen,
  PrivacySettingsScreen,
  ProfileScreen,
  ProfileSetupScreen,
  VehiclesScreen,
} from '../../src/screens/profile/ProfileScreens';
import { registerForPush } from '../../src/services/push';
import { usePlannerStore } from '../../src/state/plannerStore';
import { getCurrentLocation, LocationError } from '../../src/utils/location';
import { journey, matches, me, renderScreen, vehicleTypes } from '../helpers';

jest.mock('../../src/api', () => ({
  setSessionExpiredHandler: jest.fn(),
  api: {
    auth: { logout: jest.fn().mockResolvedValue(undefined) },
    users: {
      me: jest.fn(),
      update: jest.fn(),
      updatePreferences: jest.fn(),
      vehicles: jest.fn(),
      addVehicle: jest.fn(),
      removeVehicle: jest.fn(),
      deleteAccount: jest.fn(),
      exportData: jest.fn(),
      uploadAvatar: jest.fn(),
    },
    meta: { vehicleTypes: jest.fn(), cities: jest.fn() },
    maps: { autocomplete: jest.fn(), placeDetails: jest.fn(), reverseGeocode: jest.fn(), previewRoute: jest.fn() },
    journeys: { create: jest.fn(), get: jest.fn(), list: jest.fn(), matches: jest.fn(), start: jest.fn(), cancel: jest.fn(), complete: jest.fn(), publish: jest.fn() },
    ridePool: { offer: jest.fn() },
    saved: { routes: jest.fn(), places: jest.fn(), createRoute: jest.fn(), deleteRoute: jest.fn() },
    notifications: { registerDevice: jest.fn() },
  },
}));

const m = api as unknown as Record<string, Record<string, jest.Mock>>;
const hinjewadi = { name: 'Hinjewadi', latitude: 18.5912, longitude: 73.7389 };
const kharadi = { name: 'Kharadi', latitude: 18.5515, longitude: 73.9348 };
const preview = {
  provider: 'google',
  isLiveData: true,
  routingProfile: 'DRIVE',
  approximationNote: null,
  routes: [
    { alternativeIndex: 0, encodedPolyline: '_p~iF~ps|U_ulLnnqC', distanceMeters: 21_100, durationSeconds: 2700, staticDurationSeconds: 2000, labels: [] },
    { alternativeIndex: 1, encodedPolyline: '_p~iF~ps|U_ulLnnqC', distanceMeters: 23_400, durationSeconds: 2900, staticDurationSeconds: 2100, labels: [] },
  ],
};
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 20, total: items.length, totalPages: 1, hasNextPage: false });

beforeEach(() => {
  jest.clearAllMocks();
  m.meta.vehicleTypes.mockResolvedValue(vehicleTypes);
  m.meta.cities.mockResolvedValue([{ id: 'c', code: 'PUNE', name: 'Pune', state: 'MH', center: { latitude: 18.5, longitude: 73.8 } }]);
  m.users.me.mockResolvedValue(me);
  m.saved.places.mockResolvedValue([{ id: 'p1', label: 'HOME', name: 'Home', address: null, latitude: 18.5, longitude: 73.8 }]);
  usePlannerStore.getState().reset();
  usePlannerStore.setState({ source: hinjewadi, destination: kharadi, vehicleTypeCode: 'CAR' });
});

describe('Map planner', () => {
  it('shows distance, duration and alternatives, then saves with an idempotency key', async () => {
    m.maps.previewRoute.mockResolvedValue(preview);
    m.journeys.create.mockResolvedValue(journey({ id: 'new-1' }));
    m.journeys.get.mockResolvedValue(journey({ id: 'new-1' }));
    renderScreen('MapPlanner', MapPlannerScreen, undefined, { JourneyDetail: JourneyDetailScreen });
    expect(await screen.findByText('21 km')).toBeTruthy();
    expect(screen.getByText('45 min')).toBeTruthy();
    fireEvent.press(screen.getByText('Alternative 1'));
    expect(await screen.findByText('23 km')).toBeTruthy();
    fireEvent.press(screen.getByTestId('save-journey'));
    await waitFor(() => expect(m.journeys.create).toHaveBeenCalledTimes(1));
    const [input, key] = m.journeys.create.mock.calls[0];
    expect(input).toMatchObject({ vehicleTypeCode: 'CAR', routeAlternativeIndex: 1, source: hinjewadi, destination: kharadi });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByTestId('journey-detail-screen')).toBeTruthy();
  });

  it('retries a failed save with the SAME idempotency key (no duplicate journeys)', async () => {
    m.maps.previewRoute.mockResolvedValue(preview);
    m.journeys.create.mockRejectedValueOnce(new ApiError(0, 'TIMEOUT', 'slow')).mockRejectedValueOnce(new ApiError(503, 'MAPS_PROVIDER_UNAVAILABLE', 'down'));
    renderScreen('MapPlanner', MapPlannerScreen);
    fireEvent.press(await screen.findByTestId('save-journey'));
    expect(await screen.findByText('The connection is slow. Please try again.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('save-journey'));
    expect(await screen.findByText('Maps service is temporarily unavailable. Please retry.')).toBeTruthy();
    const keys = m.journeys.create.mock.calls.map((c) => c[1]);
    expect(keys[0]).toBe(keys[1]);
  });

  it('shows routing errors with retry', async () => {
    m.maps.previewRoute.mockRejectedValue(new ApiError(422, 'ROUTE_NOT_FOUND', 'none'));
    renderScreen('MapPlanner', MapPlannerScreen);
    expect(await screen.findByText('No route could be found between these places.', {}, { timeout: 8000 })).toBeTruthy();
  });

  it('saves the plan as a frequent route with IST time', async () => {
    m.maps.previewRoute.mockResolvedValue(preview);
    m.saved.createRoute.mockResolvedValue({ id: 'r1' });
    renderScreen('MapPlanner', MapPlannerScreen);
    fireEvent.press(await screen.findByTestId('save-route'));
    expect(await screen.findByText('Route saved.')).toBeTruthy();
    expect(m.saved.createRoute.mock.calls[0][0]).toMatchObject({ name: 'Hinjewadi → Kharadi', usualDepartureTime: expect.stringMatching(/^\d{2}:\d{2}$/) });
  });

  it('asks for places first when the plan is incomplete', async () => {
    usePlannerStore.setState({ destination: null });
    renderScreen('MapPlanner', MapPlannerScreen);
    expect(await screen.findByText('Choose a start, destination and vehicle first')).toBeTruthy();
  });

  it('helpers: IST HH:mm and plan validation', () => {
    expect(toIstHHmm(new Date('2026-11-25T03:15:00Z'))).toBe('08:45');
    expect(validatePlan({ source: null, destination: kharadi, pickup: null, departureAt: new Date(Date.now() + 3600_000), vehicleTypeCode: 'CAR' })).toEqual({ source: 'Choose where you start' });
  });
});

describe('Location search', () => {
  it('autocompletes and selects a place', async () => {
    m.maps.autocomplete.mockResolvedValue({ provider: 'google', suggestions: [{ placeId: 'pl-1', primaryText: 'EON IT Park', secondaryText: 'Kharadi, Pune', fullText: '' }] });
    m.maps.placeDetails.mockResolvedValue({ placeId: 'pl-1', name: 'EON IT Park', address: 'Kharadi', location: { latitude: 18.55, longitude: 73.94 } });
    renderScreen('LocationSearch', LocationSearchScreen, { field: 'destination' });
    fireEvent.changeText(await screen.findByTestId('place-search-input'), 'EON');
    fireEvent.press(await screen.findByTestId('suggestion-pl-1', {}, { timeout: 3000 }));
    await waitFor(() => expect(usePlannerStore.getState().destination).toMatchObject({ name: 'EON IT Park', placeId: 'pl-1' }));
  });

  it('explains when location permission is permanently denied', async () => {
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
    renderScreen('LocationSearch', LocationSearchScreen, { field: 'source' });
    fireEvent.press(await screen.findByTestId('choose-current-location'));
    expect(await screen.findByText(/Enable it in Settings/)).toBeTruthy();
    expect(screen.getByText('Open settings')).toBeTruthy();
  });

  it('uses GPS when allowed and reverse geocodes the name', async () => {
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
    (Geolocation.getCurrentPosition as jest.Mock).mockImplementation((ok) => ok({ coords: { latitude: 18.53, longitude: 73.85 } }));
    m.maps.reverseGeocode.mockResolvedValue({ placeId: null, address: 'Shivajinagar, Pune', name: 'Shivajinagar' });
    renderScreen('LocationSearch', LocationSearchScreen, { field: 'pickup' });
    fireEvent.press(await screen.findByTestId('choose-current-location'));
    await waitFor(() => expect(usePlannerStore.getState().pickup).toMatchObject({ name: 'Shivajinagar', latitude: 18.53 }));
  });

  it('pickup can be reset to "same as start" and saved places are offered', async () => {
    usePlannerStore.setState({ pickup: kharadi });
    renderScreen('LocationSearch', LocationSearchScreen, { field: 'pickup' });
    expect(await screen.findByText('Home')).toBeTruthy();
    fireEvent.press(screen.getByTestId('pickup-same-as-start'));
    expect(usePlannerStore.getState().pickup).toBeNull();
  });

  it('pick on map confirms the centre point even if geocoding fails', async () => {
    m.maps.reverseGeocode.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'x'));
    renderScreen('LocationSearch', LocationSearchScreen, { field: 'destination' });
    fireEvent.press(await screen.findByTestId('choose-on-map'));
    fireEvent.press(await screen.findByTestId('confirm-map-point'));
    await waitFor(() => expect(usePlannerStore.getState().destination?.name).toMatch(/^Pinned location/));
  });
});

describe('location utility', () => {
  it('maps GPS-off to a clear error', async () => {
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
    (Geolocation.getCurrentPosition as jest.Mock).mockImplementation((_ok, fail) => fail({ code: 2 }));
    await expect(getCurrentLocation()).rejects.toEqual(new LocationError('GPS_DISABLED'));
  });
  it('reports a simple denial', async () => {
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    await expect(getCurrentLocation()).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
  });
});

describe('Journey detail actions', () => {
  it('starts, offers a seat and cancels (with confirmation)', async () => {
    m.journeys.get.mockResolvedValue(journey());
    m.journeys.start.mockResolvedValue(journey({ status: 'ACTIVE' }));
    m.ridePool.offer.mockResolvedValue({ id: 'o1' });
    renderScreen('JourneyDetail', JourneyDetailScreen, { journeyId: 'j1' });
    expect(await screen.findByText(/Hinjewadi Phase 1/)).toBeTruthy();
    expect(screen.getByText('21 km')).toBeTruthy();
    fireEvent.press(screen.getByText('Offer a seat to travellers on my route'));
    await waitFor(() => expect(m.ridePool.offer).toHaveBeenCalledWith('j1', 1));
    fireEvent.press(screen.getByTestId('start-journey'));
    expect(await screen.findByTestId('complete-journey')).toBeTruthy();

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    m.journeys.cancel.mockResolvedValue(journey({ status: 'CANCELLED', cancelReason: null }));
    fireEvent.press(screen.getByTestId('cancel-journey'));
    await waitFor(() => expect(m.journeys.cancel).toHaveBeenCalledWith('j1'));
    expect(await screen.findByText('Cancelled')).toBeTruthy();
    alertSpy.mockRestore();
  });

  it('shows transition errors and purged-location notice', async () => {
    m.journeys.get.mockResolvedValue(journey({ locationsPurged: true, source: null, destination: null, route: null }));
    m.journeys.start.mockRejectedValue(new ApiError(409, 'INVALID_STATUS_TRANSITION', 'no'));
    renderScreen('JourneyDetail', JourneyDetailScreen, { journeyId: 'j1' });
    expect(await screen.findByText(/data-retention policy/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('start-journey'));
    expect(await screen.findByText('This action is no longer possible for this journey.')).toBeTruthy();
  });
});

describe('Profile & settings', () => {
  it('profile setup saves city & vehicle and completes setup', async () => {
    useAuthStore.setState({ status: 'signedIn', needsProfileSetup: true, user: { ...me, profileComplete: false } });
    m.users.me.mockResolvedValue({ ...me, defaultVehicleType: null, profileComplete: false });
    m.users.update.mockResolvedValue({ ...me, profileComplete: true });
    renderScreen('Setup', ProfileSetupScreen);
    fireEvent.press(await screen.findByTestId('profile-submit'));
    expect(await screen.findByText('Choose a vehicle')).toBeTruthy();
    fireEvent.press(await screen.findByTestId('vehicle-CAR'));
    fireEvent.press(screen.getByTestId('profile-submit'));
    await waitFor(() => expect(m.users.update).toHaveBeenCalledWith(expect.objectContaining({ preferredCityCode: 'PUNE', defaultVehicleTypeCode: 'CAR', completeProfile: true })));
    await waitFor(() => expect(useAuthStore.getState().needsProfileSetup).toBe(false));
  });

  it('edit profile shows server errors', async () => {
    m.users.update.mockRejectedValue(new ApiError(409, 'CONFLICT', 'This email address is already in use'));
    renderScreen('EditProfile', EditProfileScreen);
    fireEvent.press(await screen.findByTestId('profile-submit'));
    expect(await screen.findByText('This email address is already in use')).toBeTruthy();
  });

  it('privacy and notification toggles call the API', async () => {
    m.users.updatePreferences.mockResolvedValue({ ...me, privacy: { ...me.privacy, shareJourneysForMatching: false } });
    renderScreen('Privacy', PrivacySettingsScreen);
    fireEvent(await screen.findByTestId('toggle-share'), 'valueChange', false);
    await waitFor(() => expect(m.users.updatePreferences).toHaveBeenCalledWith({ shareJourneysForMatching: false }));
  });

  it('notification preferences', async () => {
    m.users.updatePreferences.mockResolvedValue(me);
    renderScreen('Prefs', NotificationPreferencesScreen);
    fireEvent(await screen.findByTestId('toggle-matches'), 'valueChange', false);
    await waitFor(() => expect(m.users.updatePreferences).toHaveBeenCalledWith({ notifyMatches: false }));
  });

  it('vehicles: list, add and remove', async () => {
    m.users.vehicles.mockResolvedValue([{ id: 'v1', nickname: 'Nexon', makeModel: null, isDefault: true, vehicleType: vehicleTypes[0] }]);
    m.users.addVehicle.mockResolvedValue({});
    m.users.removeVehicle.mockResolvedValue(undefined);
    renderScreen('Vehicles', VehiclesScreen);
    expect(await screen.findByText(/Nexon/)).toBeTruthy();
    fireEvent.press(await screen.findByTestId('vehicle-MOTORCYCLE'));
    fireEvent.press(screen.getByText('Add vehicle'));
    await waitFor(() => expect(m.users.addVehicle).toHaveBeenCalledWith({ vehicleTypeCode: 'MOTORCYCLE' }));
    fireEvent.press(screen.getByLabelText('Remove Car'));
    await waitFor(() => expect(m.users.removeVehicle).toHaveBeenCalledWith('v1'));
  });

  it('account deletion requires confirmation and signs out', async () => {
    useAuthStore.setState({ status: 'signedIn', user: me });
    m.users.deleteAccount.mockResolvedValue(undefined);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => void buttons?.[1]?.onPress?.());
    renderScreen('Profile', ProfileScreen);
    fireEvent.press(await screen.findByTestId('delete-account-button'));
    await waitFor(() => expect(m.users.deleteAccount).toHaveBeenCalled());
    await waitFor(() => expect(useAuthStore.getState().status).toBe('signedOut'));
    alertSpy.mockRestore();
  });

  it('data export summary', async () => {
    m.users.exportData.mockResolvedValue({ journeys: [{}, {}] });
    renderScreen('Profile', ProfileScreen);
    fireEvent.press(await screen.findByText('Export my data'));
    expect(await screen.findByText(/2 journeys/)).toBeTruthy();
  });
});

describe('Saved routes & matching journeys', () => {
  it('lists saved routes, loads one into the planner and deletes', async () => {
    m.saved.routes.mockResolvedValue([
      { id: 'r1', name: 'Office', sourceName: 'Baner', sourceLatitude: 18.55, sourceLongitude: 73.78, destinationName: 'Kharadi', destinationLatitude: 18.55, destinationLongitude: 73.93, pickupName: null, pickupLatitude: null, pickupLongitude: null, usualDepartureTime: '08:45', vehicleType: { code: 'SCOOTER', name: 'Scooter', icon: 'moped' } },
    ]);
    m.saved.deleteRoute.mockResolvedValue(undefined);
    renderScreen('SavedRoutes', SavedRoutesScreen, undefined, { Tabs: () => null });
    expect(await screen.findByText('Office')).toBeTruthy();
    expect(screen.getByText(/usually 08:45/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Delete Office'));
    await waitFor(() => expect(m.saved.deleteRoute).toHaveBeenCalledWith('r1'));
    fireEvent.press(screen.getByText('Plan this route'));
    expect(usePlannerStore.getState()).toMatchObject({ vehicleTypeCode: 'SCOOTER', source: { name: 'Baner' } });
  });

  it('saved routes empty state', async () => {
    m.saved.routes.mockResolvedValue([]);
    renderScreen('SavedRoutes', SavedRoutesScreen);
    expect(await screen.findByText('No saved routes')).toBeTruthy();
  });

  it('aggregates other travellers across my upcoming journeys', async () => {
    m.journeys.list.mockResolvedValue(page([journey()]));
    m.journeys.matches.mockResolvedValue(matches);
    renderScreen('MatchingJourneys', MatchingJourneysScreen);
    expect(await screen.findByTestId('match-m1')).toBeTruthy();
  });
});

describe('push registration', () => {
  it('reports not_configured when the app has no Firebase project', async () => {
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    await act(async () => {
      await expect(registerForPush()).resolves.toBe('not_configured');
    });
    expect(m.notifications.registerDevice).not.toHaveBeenCalled();
  });
});
