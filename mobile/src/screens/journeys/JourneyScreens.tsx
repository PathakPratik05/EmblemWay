import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, RefreshControl, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { api } from '../../api';
import type { Journey, MatchItem, TrafficEstimate } from '../../api/types';
import {
  JourneyCard,
  MatchCard,
  QueryView,
  StatusBadge,
} from '../../components/domain';
import {
  Badge,
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
  Stat,
  styles,
} from '../../components/ui';
import {
  keys,
  useJourney,
  useJourneyList,
  useMatches,
  useSegments,
  useTraffic,
  useVehicleTypes,
} from '../../hooks/queries';
import type { AppScreenProps, TabScreenProps } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';
import { errorMessage } from '../../utils/errors';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatTime,
  relativeTime,
} from '../../utils/format';
import { decodePolyline, regionForPoints } from '../../utils/geo';

const HISTORY_FILTERS = [
  { key: undefined, label: 'All' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'EXPIRED', label: 'Expired' },
] as const;

/** Screens 9 & 11: the user's own upcoming journeys and journey history. */
export function JourneysScreen({
  navigation,
  route,
}: TabScreenProps<'Journeys'>) {
  const [tab, setTab] = useState<'upcoming' | 'history'>(
    route.params?.tab ?? 'upcoming',
  );
  const [status, setStatus] = useState<string | undefined>(undefined);
  const list = useJourneyList(tab, tab === 'history' ? status : undefined);
  const items = list.data?.pages.flatMap(p => p.items) ?? [];

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background }}
      testID="journeys-screen"
    >
      <View style={[styles.row, { padding: spacing.lg, paddingBottom: 0 }]}>
        <Chip
          label="Upcoming"
          selected={tab === 'upcoming'}
          onPress={() => setTab('upcoming')}
          testID="tab-upcoming"
        />
        <Chip
          label="History"
          selected={tab === 'history'}
          onPress={() => setTab('history')}
          testID="tab-history"
        />
        <Chip
          label="Others on my routes"
          icon="account-group-outline"
          onPress={() => navigation.navigate('MatchingJourneys')}
          testID="tab-matching"
        />
      </View>
      {tab === 'history' ? (
        <View style={[styles.row, { paddingHorizontal: spacing.lg }]}>
          {HISTORY_FILTERS.map(f => (
            <Chip
              key={f.label}
              label={f.label}
              selected={status === f.key}
              onPress={() => setStatus(f.key)}
              testID={`history-filter-${f.label}`}
            />
          ))}
        </View>
      ) : null}
      {list.isLoading ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState
          message={errorMessage(list.error)}
          onRetry={() => void list.refetch()}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={j => j.id}
          contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={list.isRefetching}
              onRefresh={() => void list.refetch()}
            />
          }
          onEndReached={() =>
            list.hasNextPage &&
            !list.isFetchingNextPage &&
            void list.fetchNextPage()
          }
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <LoadingState message="Loading more…" />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={tab === 'upcoming' ? 'calendar-blank-outline' : 'history'}
              title={
                tab === 'upcoming' ? 'No upcoming journeys' : 'No past journeys'
              }
              message={
                tab === 'upcoming'
                  ? 'Plan a journey from the Home tab.'
                  : 'Completed, cancelled and expired journeys appear here.'
              }
              action={
                tab === 'upcoming' ? (
                  <Button
                    title="Plan a journey"
                    onPress={() => navigation.navigate('Home')}
                  />
                ) : undefined
              }
            />
          }
          renderItem={({ item }) => (
            <JourneyCard
              journey={item}
              onPress={() =>
                navigation.navigate('JourneyDetail', { journeyId: item.id })
              }
            />
          )}
        />
      )}
    </View>
  );
}

function RouteMap({
  journey,
  highlight,
}: {
  journey: Journey;
  highlight?: string | null;
}) {
  const points = useMemo(
    () => decodePolyline(journey.route?.encodedPolyline),
    [journey.route?.encodedPolyline],
  );
  const shared = useMemo(() => decodePolyline(highlight), [highlight]);
  const pins = [journey.source, journey.pickup, journey.destination].filter(
    (x): x is NonNullable<typeof x> => !!x,
  );
  const region = regionForPoints([...points, ...pins]);
  if (!region) return null;
  return (
    <MapView
      provider={PROVIDER_GOOGLE}
      style={{ height: 220, borderRadius: 12 }}
      initialRegion={region}
      scrollEnabled={false}
      zoomEnabled={false}
      toolbarEnabled={false}
      testID="route-map"
    >
      {points.length > 1 ? (
        <Polyline
          coordinates={points}
          strokeColor={colors.routeSelf}
          strokeWidth={5}
        />
      ) : null}
      {shared.length > 1 ? (
        <Polyline
          coordinates={shared}
          strokeColor={colors.routeShared}
          strokeWidth={7}
        />
      ) : null}
      {journey.source ? (
        <Marker coordinate={journey.source} pinColor="green" title="Start" />
      ) : null}
      {journey.pickup &&
      (journey.pickup.latitude !== journey.source?.latitude ||
        journey.pickup.longitude !== journey.source?.longitude) ? (
        <Marker coordinate={journey.pickup} pinColor="azure" title="Pickup" />
      ) : null}
      {journey.destination ? (
        <Marker
          coordinate={journey.destination}
          pinColor="red"
          title="Destination"
        />
      ) : null}
    </MapView>
  );
}

export function JourneyDetailScreen({
  route,
  navigation,
}: AppScreenProps<'JourneyDetail'>) {
  const { journeyId } = route.params;
  const q = useJourney(journeyId);
  const qc = useQueryClient();
  const refresh = (j: Journey) => {
    qc.setQueryData(keys.journey(journeyId), j);
    void qc.invalidateQueries({ queryKey: ['journeys'] });
  };
  const action = useMutation({
    mutationFn: async (a: 'start' | 'complete' | 'cancel' | 'publish') =>
      api.journeys[a](journeyId),
    onSuccess: refresh,
  });
  const offer = useMutation({
    mutationFn: (seats: number) => api.ridePool.offer(journeyId, seats),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: keys.journey(journeyId) }),
  });

  const confirmCancel = () =>
    Alert.alert(
      'Cancel journey?',
      'Other travellers will no longer see this journey.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel journey',
          style: 'destructive',
          onPress: () => action.mutate('cancel'),
        },
      ],
    );

  return (
    <Screen testID="journey-detail-screen">
      <QueryView query={q}>
        {j => {
          const live = j.status === 'PLANNED' || j.status === 'ACTIVE';
          return (
            <>
              <View
                style={[
                  styles.row,
                  { justifyContent: 'space-between', marginBottom: spacing.md },
                ]}
              >
                <Text style={typography.heading}>
                  {formatDateTime(j.departureAt, j.timezone)}
                </Text>
                <StatusBadge status={j.status} />
              </View>
              {j.locationsPurged ? (
                <Notice text="Exact locations for this old journey were deleted under our data-retention policy." />
              ) : (
                <RouteMap journey={j} />
              )}
              <Card style={{ marginTop: spacing.md }}>
                <Text style={typography.body}>
                  <Text style={{ fontWeight: '700' }}>From </Text>
                  {j.source?.name ?? '—'}
                </Text>
                {j.pickup && j.pickup.name !== j.source?.name ? (
                  <Text style={typography.body}>
                    <Text style={{ fontWeight: '700' }}>Pickup </Text>
                    {j.pickup.name}
                  </Text>
                ) : null}
                <Text style={typography.body}>
                  <Text style={{ fontWeight: '700' }}>To </Text>
                  {j.destination?.name ?? '—'}
                </Text>
                <View style={[styles.row, { marginTop: spacing.md }]}>
                  <Stat
                    label="Distance"
                    value={formatDistance(j.route?.distanceMeters)}
                  />
                  <Stat
                    label="Duration"
                    value={formatDuration(j.route?.durationSeconds)}
                  />
                  <Stat
                    label="Arrive ~"
                    value={
                      j.estimatedArrivalAt
                        ? formatTime(j.estimatedArrivalAt, j.timezone)
                        : '—'
                    }
                  />
                </View>
                <View style={[styles.row, { marginTop: spacing.md }]}>
                  <Icon
                    name={j.vehicleType.icon}
                    size={18}
                    color={colors.textMuted}
                  />
                  <Text style={[typography.caption, { marginLeft: 6 }]}>
                    {j.vehicleType.name}
                  </Text>
                </View>
                {j.route && !j.route.isLiveData ? (
                  <Text style={[typography.small, { color: colors.orange }]}>
                    Route from development data provider
                  </Text>
                ) : null}
                {j.cancelReason ? (
                  <Text style={typography.caption}>
                    Cancelled: {j.cancelReason}
                  </Text>
                ) : null}
              </Card>

              {live ? (
                <>
                  <Button
                    title="Travellers on this route"
                    icon="account-group-outline"
                    onPress={() =>
                      navigation.navigate('RouteMatching', { journeyId })
                    }
                    testID="open-matches"
                  />
                  <Button
                    title="Traffic & best time to leave"
                    icon="traffic-light-outline"
                    variant="secondary"
                    onPress={() =>
                      navigation.navigate('TrafficPrediction', { journeyId })
                    }
                    style={{ marginTop: spacing.sm }}
                    testID="open-traffic"
                  />
                </>
              ) : null}
              {action.isError ? (
                <Notice
                  tone="danger"
                  text={errorMessage(action.error)}
                  testID="journey-action-error"
                />
              ) : null}
              <View style={{ marginTop: spacing.lg }}>
                {j.status === 'DRAFT' ? (
                  <Button
                    title="Publish journey"
                    onPress={() => action.mutate('publish')}
                    loading={action.isPending}
                  />
                ) : null}
                {j.status === 'PLANNED' ? (
                  <Button
                    title="Start journey"
                    variant="secondary"
                    icon="play"
                    onPress={() => action.mutate('start')}
                    loading={action.isPending}
                    testID="start-journey"
                  />
                ) : null}
                {j.status === 'ACTIVE' ? (
                  <Button
                    title="Mark as completed"
                    icon="flag-checkered"
                    onPress={() => action.mutate('complete')}
                    loading={action.isPending}
                    testID="complete-journey"
                  />
                ) : null}
                {j.status === 'PLANNED' && !j.ridePoolOffer ? (
                  <Button
                    title="Offer a seat to travellers on my route"
                    variant="ghost"
                    icon="seat-passenger"
                    onPress={() => offer.mutate(1)}
                    loading={offer.isPending}
                  />
                ) : null}
                {j.ridePoolOffer ? (
                  <Notice
                    text={`You are offering ${j.ridePoolOffer.availableSeats} of ${j.ridePoolOffer.totalSeats} seat(s). Requests appear in Alerts.`}
                  />
                ) : null}
                {offer.isError ? (
                  <Notice tone="danger" text={errorMessage(offer.error)} />
                ) : null}
                {j.status === 'DRAFT' ||
                j.status === 'PLANNED' ||
                j.status === 'ACTIVE' ? (
                  <Button
                    title="Cancel journey"
                    variant="ghost"
                    onPress={confirmCancel}
                    style={{ marginTop: spacing.sm }}
                    testID="cancel-journey"
                  />
                ) : null}
              </View>
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}

const OVERLAP_FILTERS = [
  { v: undefined, label: 'Any overlap' },
  { v: 0.5, label: '50%+' },
  { v: 0.8, label: '80%+' },
] as const;

/** Screen 6: route matching - counts, vehicle breakdown, common route map, matches list. */
export function RouteMatchingScreen({
  route,
}: AppScreenProps<'RouteMatching'>) {
  const { journeyId } = route.params;
  const journey = useJourney(journeyId);
  const vehicleTypes = useVehicleTypes();
  const [vehicle, setVehicle] = useState<string | undefined>(undefined);
  const [minOverlap, setMinOverlap] = useState<number | undefined>(undefined);
  const [selected, setSelected] = useState<MatchItem | null>(null);
  const matches = useMatches(journeyId, {
    vehicleTypes: vehicle ? [vehicle] : undefined,
    minOverlap,
  });
  const segments = useSegments(journeyId);
  const busiest = segments.data
    ? Math.max(0, ...segments.data.segments.map(s => s.travellers))
    : 0;

  return (
    <Screen testID="route-matching-screen">
      {journey.data ? (
        <RouteMap
          journey={journey.data}
          highlight={selected?.commonSegmentPolyline}
        />
      ) : null}
      <View style={[styles.row, { flexWrap: 'wrap', marginTop: spacing.md }]}>
        <Chip
          label="All vehicles"
          selected={!vehicle}
          onPress={() => setVehicle(undefined)}
        />
        {(vehicleTypes.data ?? []).map(v => (
          <Chip
            key={v.code}
            label={v.name}
            icon={v.icon}
            selected={vehicle === v.code}
            onPress={() => setVehicle(v.code)}
            testID={`match-filter-${v.code}`}
          />
        ))}
      </View>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        {OVERLAP_FILTERS.map(f => (
          <Chip
            key={f.label}
            label={f.label}
            selected={minOverlap === f.v}
            onPress={() => setMinOverlap(f.v)}
          />
        ))}
      </View>
      <QueryView
        query={matches}
        loadingMessage="Finding travellers on your route…"
      >
        {m => (
          <>
            <Card>
              <View style={styles.row}>
                <Stat
                  label="Travellers"
                  value={String(m.summary.distinctTravellers)}
                  testID="stat-travellers"
                />
                <Stat
                  label="Journeys"
                  value={String(m.summary.totalMatchingJourneys)}
                  testID="stat-journeys"
                />
                <Stat
                  label="Same route"
                  value={String(m.summary.sameRouteTravellers)}
                  testID="stat-same-route"
                />
                <Stat
                  label="Partial"
                  value={String(m.summary.partialOverlapTravellers)}
                />
              </View>
              {m.summary.byVehicleType.length ? (
                <View
                  style={[
                    styles.row,
                    { flexWrap: 'wrap', marginTop: spacing.md },
                  ]}
                >
                  {m.summary.byVehicleType.map(v => (
                    <Badge key={v.code} label={`${v.name}: ${v.travellers}`} />
                  ))}
                </View>
              ) : null}
              {segments.data ? (
                <Text style={[typography.small, { marginTop: spacing.sm }]}>
                  Busiest stretch of your route: {busiest} other traveller(s)
                </Text>
              ) : null}
            </Card>
            <Notice text={m.summary.disclaimer} testID="match-disclaimer" />
            <Notice text="Sharing a road does not mean travelling together. Ride sharing only happens if a traveller offers seats and accepts your request." />
            {m.items.length === 0 ? (
              <EmptyState
                icon="account-search-outline"
                title="No matching travellers yet"
                message="We'll notify you when someone plans a journey along your route."
              />
            ) : (
              m.items.map(item => (
                <MatchCard
                  key={item.matchedJourneyId}
                  match={item}
                  onPress={() => setSelected(item === selected ? null : item)}
                />
              ))
            )}
            {m.summary.computedAt ? (
              <Text style={[typography.small, { textAlign: 'center' }]}>
                Updated {relativeTime(m.summary.computedAt)}
              </Text>
            ) : null}
          </>
        )}
      </QueryView>
    </Screen>
  );
}

const SCENARIO_LABEL: Record<TrafficEstimate['scenario'], string> = {
  NOW: 'Leave now',
  PLUS_15_MINUTES: 'In 15 min',
  PLUS_30_MINUTES: 'In 30 min',
  PLUS_45_MINUTES: 'In 45 min',
  PLUS_60_MINUTES: 'In 60 min',
};

/** Screen 7: traffic prediction for five departure scenarios. */
export function TrafficPredictionScreen({
  route,
}: AppScreenProps<'TrafficPrediction'>) {
  const t = useTraffic(route.params.journeyId);
  return (
    <Screen testID="traffic-screen">
      <QueryView query={t} loadingMessage="Getting traffic-aware estimates…">
        {d => {
          const best = d.recommendation.scenario;
          return (
            <>
              <Card
                style={{
                  backgroundColor: d.recommendation.significant
                    ? colors.primaryLight
                    : colors.surface,
                }}
                testID="traffic-recommendation"
              >
                <Text style={typography.subheading}>
                  {d.recommendation.significant
                    ? 'Recommended'
                    : 'Recommendation'}
                </Text>
                <Text style={[typography.body, { marginTop: spacing.xs }]}>
                  {d.recommendation.message}
                </Text>
              </Card>
              {d.estimates.map(e => (
                <Card
                  key={e.scenario}
                  testID={`traffic-${e.scenario}`}
                  style={
                    e.scenario === best && d.recommendation.significant
                      ? { borderWidth: 2, borderColor: colors.primary }
                      : undefined
                  }
                >
                  <View
                    style={[styles.row, { justifyContent: 'space-between' }]}
                  >
                    <Text style={typography.subheading}>
                      {SCENARIO_LABEL[e.scenario]}
                    </Text>
                    <Text style={typography.caption}>
                      {formatTime(e.departureAt)}
                    </Text>
                  </View>
                  {e.status === 'OK' ? (
                    <>
                      <View style={[styles.row, { marginTop: spacing.sm }]}>
                        <Stat
                          label="Travel time"
                          value={formatDuration(e.durationSeconds)}
                        />
                        <Stat
                          label="Traffic delay"
                          value={
                            e.delaySeconds === null
                              ? '—'
                              : formatDuration(e.delaySeconds)
                          }
                        />
                        <Stat
                          label="Arrive"
                          value={e.arrivalAt ? formatTime(e.arrivalAt) : '—'}
                        />
                      </View>
                      {e.freshness === 'STALE' ? (
                        <Badge
                          label="Last known estimate - not live"
                          color={colors.orange}
                        />
                      ) : null}
                      {e.freshness === 'CACHED' ? (
                        <Text style={typography.small}>
                          Updated{' '}
                          {e.fetchedAt ? relativeTime(e.fetchedAt) : 'recently'}
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <Text
                      style={[typography.caption, { marginTop: spacing.sm }]}
                    >
                      {e.status === 'UNSUPPORTED'
                        ? 'Not supported: '
                        : 'Unavailable: '}
                      {e.reason}
                    </Text>
                  )}
                </Card>
              ))}
              {d.approximationNote ? (
                <Notice text={d.approximationNote} />
              ) : null}
              {!d.isLiveData ? (
                <Notice
                  tone="warning"
                  text="These numbers come from a development traffic simulator, not live traffic data."
                />
              ) : null}
              <Notice text={d.disclaimer} testID="traffic-disclaimer" />
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}

/** Screen 10: other users' compatible journeys across my upcoming journeys. */
export function MatchingJourneysScreen({
  navigation,
}: AppScreenProps<'MatchingJourneys'>) {
  const upcoming = useJourneyList('upcoming');
  const journeys = (upcoming.data?.pages.flatMap(p => p.items) ?? []).slice(
    0,
    10,
  );
  const results = useQueries({
    queries: journeys.map(j => ({
      queryKey: keys.matches(j.id, {}),
      queryFn: () => api.journeys.matches(j.id, {}),
    })),
  });
  if (upcoming.isLoading) return <LoadingState />;
  if (upcoming.isError)
    return (
      <ErrorState
        message={errorMessage(upcoming.error)}
        onRetry={() => void upcoming.refetch()}
      />
    );
  if (journeys.length === 0)
    return (
      <EmptyState
        title="No upcoming journeys"
        message="Plan a journey to discover travellers on your route."
      />
    );
  return (
    <Screen testID="matching-journeys-screen">
      {journeys.map((j, i) => {
        const r = results[i];
        return (
          <View key={j.id}>
            <SectionHeader
              title={`${j.source?.name ?? ''} → ${
                j.destination?.name ?? ''
              }`.slice(0, 48)}
              action={
                <Button
                  title="Details"
                  variant="ghost"
                  onPress={() =>
                    navigation.navigate('RouteMatching', { journeyId: j.id })
                  }
                />
              }
            />
            <Text style={typography.caption}>
              {formatDateTime(j.departureAt, j.timezone)}
            </Text>
            {r?.isLoading ? (
              <LoadingState />
            ) : r?.isError ? (
              <ErrorState
                message={errorMessage(r.error)}
                onRetry={() => void r.refetch()}
              />
            ) : r?.data?.items.length ? (
              r.data.items
                .slice(0, 3)
                .map(m => <MatchCard key={m.matchedJourneyId} match={m} />)
            ) : (
              <Text style={typography.caption}>
                No travellers on this route yet.
              </Text>
            )}
          </View>
        );
      })}
    </Screen>
  );
}
