import { useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import MapView, { Polygon, PROVIDER_GOOGLE } from 'react-native-maps';
import { api } from '../../api';
import type {
  AppNotification,
  HotspotModel,
  HotspotResponse,
  LatLng,
} from '../../api/types';
import { QueryView } from '../../components/domain';
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
  styles,
} from '../../components/ui';
import { DEFAULT_REGION } from '../../config/env';
import {
  keys,
  useHotspots,
  useNotifications,
  useSavedRoutes,
  useVehicleTypes,
} from '../../hooks/queries';
import type { AppScreenProps, TabScreenProps } from '../../navigation/types';
import { usePlannerStore } from '../../state/plannerStore';
import { colors, levelColors, spacing, typography } from '../../theme';
import { errorMessage } from '../../utils/errors';
import { relativeTime } from '../../utils/format';

/** Square grid cell around its centre (cells are ~square in metres, see backend gridCellFor). */
export function cellSquare(center: LatLng, sizeMeters: number): LatLng[] {
  const dLat = sizeMeters / 111_320 / 2;
  const dLng =
    sizeMeters / (111_320 * Math.cos((center.latitude * Math.PI) / 180)) / 2;
  return [
    { latitude: center.latitude - dLat, longitude: center.longitude - dLng },
    { latitude: center.latitude - dLat, longitude: center.longitude + dLng },
    { latitude: center.latitude + dLat, longitude: center.longitude + dLng },
    { latitude: center.latitude + dLat, longitude: center.longitude - dLng },
  ];
}

const MODELS: Array<{ model: HotspotModel; label: string; icon: string }> = [
  {
    model: 'JOURNEY_DEMAND',
    label: 'Journey demand',
    icon: 'account-group-outline',
  },
  { model: 'TRAFFIC', label: 'Traffic', icon: 'traffic-light-outline' },
  { model: 'ORIGIN', label: 'Start points', icon: 'ray-start' },
  { model: 'DESTINATION', label: 'Destinations', icon: 'ray-end' },
];

const TIME_FILTERS = [
  { label: 'All day', hourFrom: undefined, hourTo: undefined },
  { label: 'Morning peak', hourFrom: 7, hourTo: 11 },
  { label: 'Midday', hourFrom: 11, hourTo: 16 },
  { label: 'Evening peak', hourFrom: 16, hourTo: 21 },
] as const;

function Legend({ legend }: { legend: HotspotResponse['legend'] }) {
  return (
    <View
      style={[styles.row, { flexWrap: 'wrap', marginTop: spacing.sm }]}
      testID="hotspot-legend"
    >
      {legend.map(l => (
        <View
          key={l.level}
          style={[styles.row, { marginRight: spacing.md, marginBottom: 4 }]}
        >
          <View
            style={{
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: l.color,
              marginRight: 4,
            }}
          />
          <Text style={typography.small}>{l.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Screen 8: hotspot explorer (three distinct models, vehicle and time filters). */
export function HotspotsScreen() {
  const [model, setModel] = useState<HotspotModel>('JOURNEY_DEMAND');
  const [vehicle, setVehicle] = useState<string | undefined>(undefined);
  const [time, setTime] = useState<(typeof TIME_FILTERS)[number]>(
    TIME_FILTERS[0],
  );
  const vehicleTypes = useVehicleTypes();
  const q = useHotspots({
    model,
    city: 'PUNE',
    vehicleType: model === 'TRAFFIC' ? undefined : vehicle,
    hourFrom: time.hourFrom,
    hourTo: time.hourTo,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const cell = q.data?.cells.find(c => c.cellKey === selected);

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background }}
      testID="hotspots-screen"
    >
      <MapView
        provider={PROVIDER_GOOGLE}
        style={{ height: 300 }}
        initialRegion={DEFAULT_REGION}
        toolbarEnabled={false}
      >
        {(q.data?.cells ?? []).map(c => (
          <Polygon
            key={c.cellKey}
            coordinates={cellSquare(c.center, q.data?.cellSizeMeters ?? 1000)}
            fillColor={`${levelColors[c.level]}88`}
            strokeColor={levelColors[c.level]}
            strokeWidth={1}
            tappable
            onPress={() => setSelected(c.cellKey)}
          />
        ))}
      </MapView>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {MODELS.map(m => (
            <Chip
              key={m.model}
              label={m.label}
              icon={m.icon}
              selected={model === m.model}
              onPress={() => setModel(m.model)}
              testID={`hotspot-model-${m.model}`}
            />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {TIME_FILTERS.map(t => (
            <Chip
              key={t.label}
              label={t.label}
              selected={time.label === t.label}
              onPress={() => setTime(t)}
            />
          ))}
        </ScrollView>
        {model !== 'TRAFFIC' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
              />
            ))}
          </ScrollView>
        ) : null}
        {q.isLoading ? (
          <LoadingState message="Loading hotspots…" />
        ) : q.isError ? (
          <ErrorState
            message={errorMessage(q.error)}
            onRetry={() => void q.refetch()}
          />
        ) : q.data ? (
          <>
            <Legend legend={q.data.legend} />
            <Notice text={q.data.disclaimer} testID="hotspot-disclaimer" />
            {q.data.cells.length === 0 ? (
              <EmptyState
                icon="map-marker-off-outline"
                title="No hotspot data for this filter yet"
              />
            ) : null}
            {cell ? (
              <Card testID="hotspot-detail">
                <Text style={typography.subheading}>Area details</Text>
                {model === 'TRAFFIC' ? (
                  <Text style={typography.body}>
                    Congestion index{' '}
                    {Math.round((cell.congestionIndex ?? 0) * 100)} / 100
                  </Text>
                ) : (
                  <Text style={typography.body}>
                    {cell.journeys} registered journeys · up to{' '}
                    {cell.peakTravellers} travellers per hour
                  </Text>
                )}
                {cell.changeRatio !== null ? (
                  <Text style={typography.caption}>
                    {cell.changeRatio >= 0 ? '▲' : '▼'}{' '}
                    {Math.abs(Math.round(cell.changeRatio * 100))}% vs previous
                    period
                  </Text>
                ) : null}
              </Card>
            ) : (
              <Text style={typography.caption}>
                Tap a coloured area for details.
              </Text>
            )}
            {q.data.lastAggregatedAt ? (
              <Text style={typography.small}>
                Updated {relativeTime(q.data.lastAggregatedAt)}
              </Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const NOTIFICATION_ICONS: Record<AppNotification['type'], string> = {
  JOURNEY_REMINDER: 'alarm',
  MATCH_FOUND: 'account-group-outline',
  JOURNEY_STATUS: 'information-outline',
  TRAFFIC_ALERT: 'traffic-light-outline',
  RIDE_POOL: 'seat-passenger',
  SYSTEM: 'bell-outline',
};

/** Screen 13: notifications. */
export function NotificationsScreen({ navigation }: TabScreenProps<'Alerts'>) {
  const q = useNotifications();
  const qc = useQueryClient();
  const read = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: keys.notifications }),
  });
  const readAll = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: keys.notifications }),
  });
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data)
    return (
      <ErrorState
        message={errorMessage(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  return (
    <FlatList
      testID="notifications-screen"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
      data={q.data.items}
      keyExtractor={n => n.id}
      refreshControl={
        <RefreshControl
          refreshing={q.isRefetching}
          onRefresh={() => void q.refetch()}
        />
      }
      ListHeaderComponent={
        q.data.unreadCount > 0 ? (
          <Button
            title={`Mark all ${q.data.unreadCount} as read`}
            variant="ghost"
            onPress={() => readAll.mutate()}
          />
        ) : null
      }
      ListEmptyComponent={
        <EmptyState
          icon="bell-outline"
          title="No notifications yet"
          message="Journey reminders, new matches and traffic alerts appear here."
        />
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => {
            if (!item.readAt) read.mutate(item.id);
            const journeyId = item.data?.journeyId;
            if (journeyId) navigation.navigate('JourneyDetail', { journeyId });
          }}
          testID={`notification-${item.id}`}
        >
          <Card
            style={[
              styles.row,
              !item.readAt && {
                borderLeftWidth: 4,
                borderLeftColor: colors.primary,
              },
            ]}
          >
            <Icon
              name={NOTIFICATION_ICONS[item.type]}
              size={24}
              color={colors.primary}
            />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text
                style={[
                  typography.subheading,
                  item.readAt && { fontWeight: '400' },
                ]}
              >
                {item.title}
              </Text>
              <Text style={typography.caption}>{item.body}</Text>
              <Text style={typography.small}>
                {relativeTime(item.createdAt)}
              </Text>
            </View>
          </Card>
        </Pressable>
      )}
    />
  );
}

/** Screen 12: saved routes. */
export function SavedRoutesScreen({
  navigation,
}: AppScreenProps<'SavedRoutes'>) {
  const q = useSavedRoutes();
  const qc = useQueryClient();
  const loadRoute = usePlannerStore(s => s.loadRoute);
  const remove = useMutation({
    mutationFn: (id: string) => api.saved.deleteRoute(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.savedRoutes }),
  });
  return (
    <Screen testID="saved-routes-screen">
      <QueryView query={q}>
        {routes =>
          routes.length === 0 ? (
            <EmptyState
              icon="routes"
              title="No saved routes"
              message="Save a frequent route from the map planner to reuse it in one tap."
            />
          ) : (
            <>
              {routes.map(r => (
                <Card key={r.id}>
                  <View
                    style={[styles.row, { justifyContent: 'space-between' }]}
                  >
                    <Text style={typography.subheading}>{r.name}</Text>
                    <Pressable
                      onPress={() => remove.mutate(r.id)}
                      accessibilityLabel={`Delete ${r.name}`}
                    >
                      <Icon
                        name="delete-outline"
                        size={22}
                        color={colors.danger}
                      />
                    </Pressable>
                  </View>
                  <Text style={typography.caption}>
                    {r.sourceName} → {r.destinationName}
                  </Text>
                  <Text style={typography.small}>
                    {r.vehicleType?.name ?? 'Any vehicle'}
                    {r.usualDepartureTime
                      ? ` · usually ${r.usualDepartureTime}`
                      : ''}
                  </Text>
                  <Button
                    title="Plan this route"
                    variant="secondary"
                    style={{ marginTop: spacing.sm }}
                    onPress={() => {
                      loadRoute({
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
                          r.pickupLatitude !== null &&
                          r.pickupLongitude !== null
                            ? {
                                name: r.pickupName ?? 'Pickup',
                                latitude: r.pickupLatitude,
                                longitude: r.pickupLongitude,
                              }
                            : null,
                        vehicleTypeCode: r.vehicleType?.code,
                      });
                      navigation.navigate('Tabs', { screen: 'Home' });
                    }}
                  />
                </Card>
              ))}
              {remove.isError ? (
                <Notice tone="danger" text={errorMessage(remove.error)} />
              ) : null}
            </>
          )
        }
      </QueryView>
    </Screen>
  );
}
