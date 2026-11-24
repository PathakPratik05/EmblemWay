import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  Region,
} from 'react-native-maps';
import { api } from '../../api';
import { ApiError } from '../../api/client';
import type { LatLng, Place } from '../../api/types';
import { useAuthStore } from '../../auth/authStore';
import {
  DateTimeField,
  JourneyCard,
  LocationRow,
  VehiclePicker,
} from '../../components/domain';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  Notice,
  Screen,
  SectionHeader,
  styles,
} from '../../components/ui';
import { DEFAULT_REGION } from '../../config/env';
import {
  keys,
  useJourneyList,
  useSavedPlaces,
  useSavedRoutes,
  useTraffic,
  useVehicleTypes,
} from '../../hooks/queries';
import type { AppScreenProps, TabScreenProps } from '../../navigation/types';
import { LocationField, usePlannerStore } from '../../state/plannerStore';
import { colors, spacing, typography } from '../../theme';
import { errorMessage } from '../../utils/errors';
import { formatDistance, formatDuration } from '../../utils/format';
import { decodePolyline, regionForPoints } from '../../utils/geo';
import { uuidv4 } from '../../utils/ids';
import {
  getCurrentLocation,
  LOCATION_MESSAGES,
  LocationError,
} from '../../utils/location';
import { journeySchema } from '../../validation/schemas';

/** "08:45" in IST (24-hour), as stored for saved routes. */
export function toIstHHmm(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

function greeting(d = new Date()): string {
  const h = Number(
    new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      hour12: false,
    }).format(d),
  );
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Validates the planner and returns field errors (client-side; the server re-validates). */
export function validatePlan(s: {
  source: Place | null;
  destination: Place | null;
  pickup: Place | null;
  departureAt: Date;
  vehicleTypeCode: string | null;
}) {
  const parsed = journeySchema.safeParse({
    ...s,
    vehicleTypeCode: s.vehicleTypeCode ?? '',
  });
  if (parsed.success) return {};
  const out: Record<string, string> = {};
  for (const i of parsed.error.issues) {
    const k = String(i.path[0] ?? 'form');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

function TrafficSummary({
  journeyId,
  onOpen,
}: {
  journeyId: string;
  onOpen: () => void;
}) {
  const t = useTraffic(journeyId);
  if (t.isLoading)
    return <Text style={typography.caption}>Checking traffic…</Text>;
  if (t.isError || !t.data)
    return (
      <Text style={typography.caption}>
        Traffic estimate unavailable right now.
      </Text>
    );
  const now = t.data.estimates.find(e => e.scenario === 'NOW');
  return (
    <Pressable onPress={onOpen} testID="home-traffic-summary">
      <Text style={typography.body}>
        {now?.status === 'OK'
          ? `Leave now: ${formatDuration(now.durationSeconds)}${
              now.delaySeconds
                ? ` (+${formatDuration(now.delaySeconds)} traffic)`
                : ''
            }`
          : 'Leave-now estimate unavailable'}
      </Text>
      <Text style={[typography.caption, { marginTop: 2 }]}>
        {t.data.recommendation.message}
      </Text>
      {!t.data.isLiveData ? (
        <Text style={[typography.small, { color: colors.orange }]}>
          Development data - not live traffic
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Screen 4: Home dashboard with the journey planner. */
export function HomeScreen({ navigation }: TabScreenProps<'Home'>) {
  const user = useAuthStore(s => s.user);
  const p = usePlannerStore();
  const vehicles = useVehicleTypes();
  const upcoming = useJourneyList('upcoming');
  const savedRoutes = useSavedRoutes();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  useEffect(() => {
    if (!p.vehicleTypeCode && user?.defaultVehicleType)
      p.setVehicle(user.defaultVehicleType.code);
  }, [user, p]);

  const fillFromMyLocation = async () => {
    setLocError(null);
    setLocating(true);
    try {
      const here = await getCurrentLocation();
      let name = 'Current location';
      try {
        name = (await api.maps.reverseGeocode(here)).name;
      } catch {
        /* keep generic label when geocoding is unavailable */
      }
      p.setPlace('source', { ...here, name });
    } catch (err) {
      setLocError(
        err instanceof LocationError
          ? LOCATION_MESSAGES[err.reason]
          : errorMessage(err),
      );
    } finally {
      setLocating(false);
    }
  };

  const search = () => {
    const e = validatePlan(p);
    setErrors(e);
    if (Object.keys(e).length === 0) navigation.navigate('MapPlanner');
  };

  const items = upcoming.data?.pages.flatMap(pg => pg.items) ?? [];
  const next = items[0];
  const pick = (field: LocationField) =>
    navigation.navigate('LocationSearch', { field });

  return (
    <Screen testID="home-screen">
      <Text style={typography.title}>
        {greeting()}
        {user ? `, ${user.firstName}` : ''}
      </Text>
      <Text style={[typography.caption, { marginBottom: spacing.md }]}>
        Where are you heading?
      </Text>

      <Card>
        <LocationRow
          icon="circle-slice-8"
          color={colors.success}
          label="From"
          place={p.source}
          placeholder="Choose starting point"
          onPress={() => pick('source')}
          testID="home-source"
        />
        {errors.source ? (
          <Text style={styles.errorText}>{errors.source}</Text>
        ) : null}
        <Pressable
          onPress={() => void fillFromMyLocation()}
          style={[styles.row, { marginBottom: spacing.xs }]}
          testID="use-current-location"
        >
          {locating ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Icon name="crosshairs-gps" size={16} color={colors.primary} />
          )}
          <Text
            style={{ color: colors.primary, marginLeft: 6, fontWeight: '600' }}
          >
            Use my current location
          </Text>
        </Pressable>
        {locError ? (
          <Notice tone="warning" text={locError} testID="location-error" />
        ) : null}
        {locError && locError === LOCATION_MESSAGES.PERMISSION_BLOCKED ? (
          <Button
            title="Open settings"
            variant="ghost"
            onPress={() => void Linking.openSettings()}
          />
        ) : null}
        <View style={[styles.row]}>
          <View style={{ flex: 1 }}>
            <LocationRow
              icon="map-marker"
              color={colors.danger}
              label="To"
              place={p.destination}
              placeholder="Choose destination"
              onPress={() => pick('destination')}
              testID="home-destination"
            />
          </View>
          <Pressable
            onPress={p.swap}
            accessibilityLabel="Swap start and destination"
            style={{ padding: spacing.sm }}
            testID="swap-button"
          >
            <Icon name="swap-vertical" size={24} color={colors.primary} />
          </Pressable>
        </View>
        {errors.destination ? (
          <Text style={styles.errorText}>{errors.destination}</Text>
        ) : null}
        <LocationRow
          icon="account-arrow-up-outline"
          color={colors.info}
          label="Pickup point (optional)"
          place={p.pickup}
          placeholder="Same as starting point"
          onPress={() => pick('pickup')}
          testID="home-pickup"
        />
        {errors.pickup ? (
          <Text style={styles.errorText}>{errors.pickup}</Text>
        ) : null}
        <DateTimeField
          value={p.departureAt}
          onChange={p.setDeparture}
          testID="home-departure"
        />
        {errors.departureAt ? (
          <Text style={styles.errorText}>{errors.departureAt}</Text>
        ) : null}
        <Text style={[styles.label, { marginTop: spacing.sm }]}>Vehicle</Text>
        <VehiclePicker
          value={p.vehicleTypeCode}
          onChange={p.setVehicle}
          types={vehicles.data}
          loading={vehicles.isLoading}
          error={vehicles.isError ? errorMessage(vehicles.error) : undefined}
          onRetry={() => void vehicles.refetch()}
        />
        {errors.vehicleTypeCode ? (
          <Text style={styles.errorText}>{errors.vehicleTypeCode}</Text>
        ) : null}
        <Button
          title="Search journeys"
          icon="magnify"
          onPress={search}
          style={{ marginTop: spacing.md }}
          testID="search-journeys"
        />
      </Card>

      {savedRoutes.data && savedRoutes.data.length > 0 ? (
        <>
          <SectionHeader title="Saved routes" />
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            {savedRoutes.data.slice(0, 6).map(r => (
              <Chip
                key={r.id}
                label={r.name}
                icon="routes"
                onPress={() =>
                  p.loadRoute({
                    source: {
                      name: r.sourceName,
                      latitude: r.sourceLatitude,
                      longitude: r.sourceLongitude,
                    },
                    destination: {
                      name: r.destinationName,
                      latitude: r.destinationLatitude,
                      longitude: r.destinationLongitude,
                    },
                    pickup:
                      r.pickupLatitude !== null && r.pickupLongitude !== null
                        ? {
                            name: r.pickupName ?? 'Pickup',
                            latitude: r.pickupLatitude,
                            longitude: r.pickupLongitude,
                          }
                        : null,
                    vehicleTypeCode: r.vehicleType?.code,
                  })
                }
              />
            ))}
          </View>
        </>
      ) : null}

      <SectionHeader title="Traffic" />
      <Card>
        {next ? (
          <TrafficSummary
            journeyId={next.id}
            onOpen={() =>
              navigation.navigate('TrafficPrediction', { journeyId: next.id })
            }
          />
        ) : (
          <Text style={typography.caption}>
            Plan a journey to see traffic estimates for it.
          </Text>
        )}
      </Card>

      <SectionHeader
        title="Upcoming journeys"
        action={
          items.length ? (
            <Button
              title="See all"
              variant="ghost"
              onPress={() =>
                navigation.navigate('Journeys', { tab: 'upcoming' })
              }
            />
          ) : undefined
        }
      />
      {upcoming.isLoading ? (
        <LoadingState />
      ) : upcoming.isError ? (
        <ErrorState
          message={errorMessage(upcoming.error)}
          onRetry={() => void upcoming.refetch()}
        />
      ) : items.length === 0 ? (
        <Text style={typography.caption}>No upcoming journeys yet.</Text>
      ) : (
        items
          .slice(0, 3)
          .map(j => (
            <JourneyCard
              key={j.id}
              journey={j}
              onPress={() =>
                navigation.navigate('JourneyDetail', { journeyId: j.id })
              }
            />
          ))
      )}
    </Screen>
  );
}

/** Location search: autocomplete, current location, pick on map, saved places. */
export function LocationSearchScreen({
  route,
  navigation,
}: AppScreenProps<'LocationSearch'>) {
  const { field } = route.params;
  const setPlace = usePlannerStore(s => s.setPlace);
  const source = usePlannerStore(s => s.source);
  const sessionToken = useMemo(() => uuidv4(), []);
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const [mode, setMode] = useState<'search' | 'map'>('search');
  const [center, setCenter] = useState<LatLng>(source ?? DEFAULT_REGION);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const saved = useSavedPlaces();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const results = useQuery({
    queryKey: ['autocomplete', debounced, sessionToken],
    queryFn: () =>
      api.maps.autocomplete(debounced, sessionToken, source ?? undefined),
    enabled: debounced.length >= 2,
  });

  const choose = (place: Place | null) => {
    setPlace(field, place);
    navigation.goBack();
  };

  const selectSuggestion = async (placeId: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const d = await api.maps.placeDetails(placeId, sessionToken);
      choose({
        name: d.name,
        address: d.address,
        placeId: d.placeId,
        ...d.location,
      });
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const pickCurrentLocation = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const here = await getCurrentLocation();
      let name = 'Current location';
      try {
        name = (await api.maps.reverseGeocode(here)).name;
      } catch {
        /* offline / provider down: keep generic label */
      }
      choose({ ...here, name });
    } catch (err) {
      setProblem(
        err instanceof LocationError
          ? LOCATION_MESSAGES[err.reason]
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmMapPoint = async () => {
    setBusy(true);
    setProblem(null);
    let name = `Pinned location (${center.latitude.toFixed(
      5,
    )}, ${center.longitude.toFixed(5)})`;
    let address: string | undefined;
    try {
      const r = await api.maps.reverseGeocode(center);
      name = r.name;
      address = r.address || undefined;
    } catch {
      /* the coordinates are still valid without a readable name */
    }
    setBusy(false);
    choose({
      name,
      address,
      latitude: center.latitude,
      longitude: center.longitude,
    });
  };

  const title = {
    source: 'Starting point',
    destination: 'Destination',
    pickup: 'Pickup point',
  }[field];

  if (mode === 'map') {
    return (
      <View style={{ flex: 1 }} testID="pick-on-map">
        <MapView
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          initialRegion={{
            ...DEFAULT_REGION,
            ...center,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
          onRegionChangeComplete={(r: Region) =>
            setCenter({ latitude: r.latitude, longitude: r.longitude })
          }
          showsUserLocation={false}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            marginLeft: -18,
            marginTop: -36,
          }}
        >
          <Icon name="map-marker" size={36} color={colors.danger} />
        </View>
        <View style={{ padding: spacing.lg, backgroundColor: colors.surface }}>
          {problem ? <Notice tone="danger" text={problem} /> : null}
          <Button
            title={`Set as ${title.toLowerCase()}`}
            onPress={() => void confirmMapPoint()}
            loading={busy}
            testID="confirm-map-point"
          />
          <Button
            title="Back to search"
            variant="ghost"
            onPress={() => setMode('search')}
          />
        </View>
      </View>
    );
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background }}
      testID="location-search-screen"
    >
      <View style={{ padding: spacing.lg }}>
        <TextInput
          autoFocus
          value={input}
          onChangeText={setInput}
          placeholder={`Search ${title.toLowerCase()} by name`}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          accessibilityLabel="Search places"
          testID="place-search-input"
        />
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: spacing.md }]}>
          {field !== 'destination' ? (
            <Chip
              icon="crosshairs-gps"
              label="Current location"
              onPress={() => void pickCurrentLocation()}
              testID="choose-current-location"
            />
          ) : null}
          <Chip
            icon="map-search-outline"
            label="Choose on map"
            onPress={() => setMode('map')}
            testID="choose-on-map"
          />
          {field === 'pickup' ? (
            <Chip
              icon="undo"
              label="Same as start"
              onPress={() => choose(null)}
              testID="pickup-same-as-start"
            />
          ) : null}
          {(saved.data ?? []).map(s => (
            <Chip
              key={s.id}
              icon={
                s.label === 'HOME'
                  ? 'home-outline'
                  : s.label === 'WORK'
                  ? 'briefcase-outline'
                  : 'star-outline'
              }
              label={s.name}
              onPress={() =>
                choose({
                  name: s.name,
                  address: s.address,
                  latitude: s.latitude,
                  longitude: s.longitude,
                })
              }
            />
          ))}
        </View>
        {busy ? <ActivityIndicator color={colors.primary} /> : null}
        {problem ? (
          <Notice
            tone="warning"
            text={problem}
            testID="location-search-error"
          />
        ) : null}
        {problem === LOCATION_MESSAGES.PERMISSION_BLOCKED ? (
          <Button
            title="Open settings"
            variant="ghost"
            onPress={() => void Linking.openSettings()}
          />
        ) : null}
      </View>
      {results.isError ? (
        <ErrorState
          message={errorMessage(results.error)}
          onRetry={() => void results.refetch()}
        />
      ) : (
        <FlatList
          data={results.data?.suggestions ?? []}
          keyExtractor={s => s.placeId}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            debounced.length >= 2 && !results.isFetching ? (
              <EmptyState
                title="No places found"
                message="Try a different spelling or choose on the map."
              />
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => void selectSuggestion(item.placeId)}
              style={{
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                borderBottomWidth: 1,
                borderColor: colors.border,
              }}
              testID={`suggestion-${item.placeId}`}
            >
              <Text style={typography.body}>{item.primaryText}</Text>
              <Text style={typography.small} numberOfLines={1}>
                {item.secondaryText}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

/** Screen 5: interactive map planner with route preview and draggable markers. */
export function MapPlannerScreen({ navigation }: AppScreenProps<'MapPlanner'>) {
  const p = usePlannerStore();
  const qc = useQueryClient();
  const mapRef = useRef<MapView>(null);
  const [selectedAlt, setSelectedAlt] = useState(0);
  const [saveRouteNote, setSaveRouteNote] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: [
      'route-preview',
      p.source,
      p.destination,
      p.pickup,
      p.vehicleTypeCode,
    ],
    queryFn: () =>
      api.maps.previewRoute({
        source: p.source!,
        destination: p.destination!,
        pickup: p.pickup,
        vehicleTypeCode: p.vehicleTypeCode!,
      }),
    enabled: !!(p.source && p.destination && p.vehicleTypeCode),
    retry: 1,
  });
  const routes = preview.data?.routes ?? [];
  const selected =
    routes[Math.min(selectedAlt, Math.max(0, routes.length - 1))];
  const points = useMemo(
    () => decodePolyline(selected?.encodedPolyline),
    [selected],
  );

  useEffect(() => {
    // Recalculation when places change: reset to the primary route and refit the camera.
    setSelectedAlt(0);
  }, [p.source, p.destination, p.pickup, p.vehicleTypeCode]);

  useEffect(() => {
    const all = [
      ...points,
      ...[p.source, p.destination, p.pickup].filter((x): x is Place => !!x),
    ];
    const region = regionForPoints(all);
    if (region) mapRef.current?.animateToRegion(region, 400);
  }, [points, p.source, p.destination, p.pickup]);

  const create = useMutation({
    mutationFn: () => {
      // Reuse the same key for retries of this exact plan, so a flaky network can't create duplicates.
      const key = p.idempotencyKey ?? uuidv4();
      if (!p.idempotencyKey) p.setIdempotencyKey(key);
      return api.journeys.create(
        {
          source: p.source!,
          destination: p.destination!,
          pickup: p.pickup,
          departureAt: p.departureAt.toISOString(),
          vehicleTypeCode: p.vehicleTypeCode!,
          routeAlternativeIndex: selected?.alternativeIndex ?? 0,
        },
        key,
      );
    },
    onSuccess: journey => {
      void qc.invalidateQueries({ queryKey: ['journeys'] });
      p.reset();
      navigation.replace('JourneyDetail', { journeyId: journey.id });
    },
  });

  const saveRoute = useMutation({
    mutationFn: () =>
      api.saved.createRoute({
        name: `${p.source!.name.split(',')[0]} → ${
          p.destination!.name.split(',')[0]
        }`.slice(0, 80),
        source: p.source!,
        destination: p.destination!,
        pickup: p.pickup,
        vehicleTypeCode: p.vehicleTypeCode ?? undefined,
        usualDepartureTime: toIstHHmm(p.departureAt),
      }),
    onSuccess: () => {
      setSaveRouteNote('Route saved.');
      void qc.invalidateQueries({ queryKey: keys.savedRoutes });
    },
    onError: e => setSaveRouteNote(errorMessage(e)),
  });

  const onDragEnd = async (field: LocationField, c: LatLng) => {
    let name = `Pinned location (${c.latitude.toFixed(
      5,
    )}, ${c.longitude.toFixed(5)})`;
    try {
      name = (await api.maps.reverseGeocode(c)).name;
    } catch {
      /* keep coordinate label */
    }
    p.setPlace(field, { ...c, name });
  };

  if (!p.source || !p.destination || !p.vehicleTypeCode) {
    return (
      <EmptyState
        title="Choose a start, destination and vehicle first"
        action={<Button title="Back" onPress={() => navigation.goBack()} />}
      />
    );
  }

  const createError = create.error instanceof ApiError ? create.error : null;

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background }}
      testID="map-planner-screen"
    >
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={
          regionForPoints([p.source, p.destination]) ?? DEFAULT_REGION
        }
        toolbarEnabled={false}
      >
        {routes.map((r, i) =>
          i === selectedAlt ? null : (
            <Polyline
              key={r.alternativeIndex}
              coordinates={decodePolyline(r.encodedPolyline)}
              strokeColor="#8FA3BF"
              strokeWidth={4}
              tappable
              onPress={() => setSelectedAlt(i)}
            />
          ),
        )}
        {points.length > 1 ? (
          <Polyline
            coordinates={points}
            strokeColor={colors.routeSelf}
            strokeWidth={6}
          />
        ) : null}
        <Marker
          coordinate={p.source}
          title="Start"
          pinColor="green"
          draggable
          onDragEnd={e => void onDragEnd('source', e.nativeEvent.coordinate)}
        />
        {p.pickup ? (
          <Marker
            coordinate={p.pickup}
            title="Pickup"
            pinColor="azure"
            draggable
            onDragEnd={e => void onDragEnd('pickup', e.nativeEvent.coordinate)}
          />
        ) : null}
        <Marker
          coordinate={p.destination}
          title="Destination"
          pinColor="red"
          draggable
          onDragEnd={e =>
            void onDragEnd('destination', e.nativeEvent.coordinate)
          }
        />
      </MapView>
      <View
        style={{
          backgroundColor: colors.surface,
          padding: spacing.lg,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
        }}
      >
        {preview.isLoading || preview.isFetching ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[typography.caption, { marginLeft: spacing.sm }]}>
              Calculating route…
            </Text>
          </View>
        ) : preview.isError ? (
          <ErrorState
            message={errorMessage(preview.error)}
            onRetry={() => void preview.refetch()}
          />
        ) : selected ? (
          <>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={typography.heading} testID="route-distance">
                {formatDistance(selected.distanceMeters)}
              </Text>
              <Text style={typography.heading} testID="route-duration">
                {formatDuration(selected.durationSeconds)}
              </Text>
            </View>
            {routes.length > 1 ? (
              <View style={[styles.row, { marginTop: spacing.sm }]}>
                {routes.map((r, i) => (
                  <Chip
                    key={r.alternativeIndex}
                    label={i === 0 ? 'Fastest' : `Alternative ${i}`}
                    selected={i === selectedAlt}
                    onPress={() => setSelectedAlt(i)}
                  />
                ))}
              </View>
            ) : null}
            {preview.data?.approximationNote ? (
              <Notice text={preview.data.approximationNote} />
            ) : null}
            {preview.data && !preview.data.isLiveData ? (
              <Notice
                tone="warning"
                text="Development routing data (not Google Maps)."
              />
            ) : null}
            <Text style={[typography.small, { marginTop: spacing.xs }]}>
              Drag a pin to adjust a location. The route is recalculated
              automatically.
            </Text>
          </>
        ) : null}
        {create.isError ? (
          <Notice
            tone="danger"
            text={errorMessage(create.error)}
            testID="create-journey-error"
          />
        ) : null}
        {createError?.code === 'IDEMPOTENCY_IN_PROGRESS' ? (
          <Text style={typography.small}>
            Your journey is still being saved - please wait a moment and retry.
          </Text>
        ) : null}
        <Button
          title="Save journey"
          icon="content-save-outline"
          onPress={() => create.mutate()}
          loading={create.isPending}
          disabled={!selected}
          style={{ marginTop: spacing.md }}
          testID="save-journey"
        />
        <Button
          title="Save as frequent route"
          variant="ghost"
          onPress={() => saveRoute.mutate()}
          loading={saveRoute.isPending}
          testID="save-route"
        />
        {saveRouteNote ? (
          <Text style={[typography.small, { textAlign: 'center' }]}>
            {saveRouteNote}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
