import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type {
  Journey,
  JourneyStatus,
  MatchItem,
  Place,
  VehicleType,
} from '../api/types';
import { useIsOnline } from '../hooks/queries';
import { colors, spacing, typography } from '../theme';
import { errorMessage } from '../utils/errors';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatPercent,
  MATCH_TYPE_LABELS,
  STATUS_LABELS,
} from '../utils/format';
import {
  Badge,
  Card,
  Chip,
  Icon,
  ErrorState,
  LoadingState,
  styles,
} from './ui';

const STATUS_COLORS: Record<JourneyStatus, string> = {
  DRAFT: colors.textMuted,
  PLANNED: colors.primary,
  ACTIVE: colors.success,
  COMPLETED: colors.success,
  CANCELLED: colors.danger,
  EXPIRED: colors.orange,
};

export function StatusBadge({ status }: { status: JourneyStatus }) {
  return <Badge label={STATUS_LABELS[status]} color={STATUS_COLORS[status]} />;
}

export function OfflineBanner() {
  const online = useIsOnline();
  if (online !== false) return null;
  return (
    <View
      style={{
        backgroundColor: colors.danger,
        padding: spacing.sm,
        flexDirection: 'row',
        justifyContent: 'center',
      }}
      testID="offline-banner"
    >
      <Icon name="wifi-off" size={16} color={colors.white} />
      <Text
        style={{
          color: colors.white,
          marginLeft: spacing.sm,
          fontWeight: '600',
        }}
      >
        You are offline
      </Text>
    </View>
  );
}

export function LocationRow({
  icon,
  label,
  place,
  placeholder,
  onPress,
  testID,
  color = colors.primary,
}: {
  icon: string;
  label: string;
  place: Place | null;
  placeholder: string;
  onPress: () => void;
  testID?: string;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${place?.name ?? placeholder}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.md,
      }}
    >
      <Icon name={icon} size={22} color={color} />
      <View style={{ marginLeft: spacing.md, flex: 1 }}>
        <Text style={typography.small}>{label}</Text>
        <Text
          style={[typography.body, !place && { color: colors.textMuted }]}
          numberOfLines={1}
        >
          {place?.name ?? placeholder}
        </Text>
      </View>
      <Icon name="chevron-right" size={22} color={colors.textMuted} />
    </Pressable>
  );
}

/** Vehicle categories rendered from the backend list. */
export function VehiclePicker({
  value,
  onChange,
  types,
  loading,
  error,
  onRetry,
}: {
  value: string | null;
  onChange: (code: string) => void;
  types?: VehicleType[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  if (loading)
    return <Text style={typography.caption}>Loading vehicle types…</Text>;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingVertical: spacing.xs }}
    >
      {(types ?? []).map(t => (
        <Chip
          key={t.code}
          label={t.name}
          icon={t.icon}
          selected={value === t.code}
          onPress={() => onChange(t.code)}
          testID={`vehicle-${t.code}`}
        />
      ))}
    </ScrollView>
  );
}

export function DateTimeField({
  value,
  onChange,
  testID,
}: {
  value: Date;
  onChange: (d: Date) => void;
  testID?: string;
}) {
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const handle = (e: DateTimePickerEvent, d?: Date) => {
    const current = mode;
    setMode(null);
    if (e.type !== 'set' || !d) return;
    const next = new Date(value);
    if (current === 'date')
      next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    else next.setHours(d.getHours(), d.getMinutes(), 0, 0);
    onChange(next);
    if (current === 'date') setMode('time');
  };
  return (
    <View>
      <Pressable
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: spacing.md,
        }}
        onPress={() => setMode('date')}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel="Departure time"
      >
        <Icon name="clock-outline" size={22} color={colors.primary} />
        <View style={{ marginLeft: spacing.md, flex: 1 }}>
          <Text style={typography.small}>Departure (IST)</Text>
          <Text style={typography.body}>{formatDateTime(value)}</Text>
        </View>
        <Icon name="pencil-outline" size={20} color={colors.textMuted} />
      </Pressable>
      {mode ? (
        <DateTimePicker
          value={value}
          mode={mode}
          minimumDate={mode === 'date' ? new Date() : undefined}
          onChange={handle}
        />
      ) : null}
    </View>
  );
}

export function JourneyCard({
  journey,
  onPress,
}: {
  journey: Journey;
  onPress: () => void;
}) {
  return (
    <Card onPress={onPress} testID={`journey-${journey.id}`}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={typography.subheading}>
          {formatDateTime(journey.departureAt, journey.timezone)}
        </Text>
        <StatusBadge status={journey.status} />
      </View>
      <View style={{ marginTop: spacing.sm }}>
        <Text style={typography.body} numberOfLines={1}>
          {journey.source?.name ?? 'Location removed'} →{' '}
          {journey.destination?.name ?? 'Location removed'}
        </Text>
        <View style={[styles.row, { marginTop: spacing.xs }]}>
          <Icon
            name={journey.vehicleType.icon}
            size={16}
            color={colors.textMuted}
          />
          <Text style={[typography.caption, { marginLeft: 6 }]}>
            {journey.vehicleType.name}
            {journey.route
              ? ` · ${formatDistance(
                  journey.route.distanceMeters,
                )} · ${formatDuration(journey.route.durationSeconds)}`
              : ''}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const CONFIDENCE_COLORS = {
  HIGH: colors.success,
  MEDIUM: colors.orange,
  LOW: colors.textMuted,
} as const;

export function MatchCard({
  match,
  onPress,
}: {
  match: MatchItem;
  onPress?: () => void;
}) {
  return (
    <Card onPress={onPress} testID={`match-${match.matchedJourneyId}`}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <View style={styles.row}>
          <Icon
            name={match.vehicleType.icon}
            size={22}
            color={colors.primary}
          />
          <Text style={[typography.subheading, { marginLeft: spacing.sm }]}>
            {match.traveller.displayName}
          </Text>
        </View>
        <Badge
          label={`${Math.round(
            match.score,
          )} · ${match.confidence.toLowerCase()}`}
          color={CONFIDENCE_COLORS[match.confidence]}
        />
      </View>
      <Text style={[typography.caption, { marginTop: spacing.xs }]}>
        {MATCH_TYPE_LABELS[match.matchType]} · {match.vehicleType.name} · leaves{' '}
        {formatDateTime(match.departureAt)}
      </Text>
      <View
        style={[
          styles.row,
          { marginTop: spacing.sm, justifyContent: 'space-between' },
        ]}
      >
        <Text style={typography.small}>
          Shared {formatDistance(match.sharedDistanceMeters)}
        </Text>
        <Text style={typography.small}>
          Your route {formatPercent(match.overlapRatioSelf)}
        </Text>
        <Text style={typography.small}>
          {match.convergenceTimeDiffMinutes === 0
            ? 'Same time'
            : `${Math.abs(match.convergenceTimeDiffMinutes)} min ${
                match.convergenceTimeDiffMinutes > 0 ? 'earlier' : 'later'
              }`}
        </Text>
      </View>
      {match.ridePool ? (
        <Text
          style={[
            typography.small,
            { color: colors.success, marginTop: spacing.xs },
          ]}
        >
          Offering {match.ridePool.availableSeats} seat(s) to share
        </Text>
      ) : null}
    </Card>
  );
}

/** Render loading / error / content consistently for any query. */
export function QueryView<T>({
  query,
  loadingMessage,
  children,
}: {
  query: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data?: T;
    refetch: () => unknown;
  };
  loadingMessage?: string;
  children: (data: T) => React.ReactElement;
}) {
  if (query.isLoading) return <LoadingState message={loadingMessage} />;
  if (query.isError || query.data === undefined)
    return (
      <ErrorState
        message={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  return children(query.data);
}
