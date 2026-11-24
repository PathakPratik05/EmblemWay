import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, shadow, spacing, typography } from '../theme';

export { Icon };

export function Screen({
  children,
  scroll = true,
  testID,
  padded = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  testID?: string;
  padded?: boolean;
}) {
  // The testID sits on the scrollable element so E2E tests can scroll the screen by id.
  const content = (
    <View
      style={[padded && styles.padded, { flexGrow: 1 }]}
      testID={scroll ? undefined : testID}
    >
      {children}
    </View>
  );
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          testID={testID}
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  testID,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  const palette = {
    primary: { bg: colors.primary, fg: colors.white, border: colors.primary },
    secondary: {
      bg: colors.surface,
      fg: colors.primary,
      border: colors.primary,
    },
    danger: { bg: colors.danger, fg: colors.white, border: colors.danger },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityLabel={title}
      testID={testID}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: inactive ? 0.55 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? (
            <Icon
              name={icon}
              size={18}
              color={palette.fg}
              style={{ marginRight: spacing.sm }}
            />
          ) : null}
          <Text style={[styles.buttonText, { color: palette.fg }]}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  testID,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        testID={testID}
        style={[styles.input, error ? { borderColor: colors.danger } : null]}
        {...props}
      />
      {error ? (
        <Text
          style={styles.errorText}
          testID={testID ? `${testID}-error` : undefined}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
  testID,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  testID?: string;
}) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [
          styles.card,
          style,
          pressed && { opacity: 0.9 },
        ]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={[
        styles.chip,
        selected && {
          backgroundColor: colors.primary,
          borderColor: colors.primary,
        },
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          size={16}
          color={selected ? colors.white : colors.primary}
          style={{ marginRight: 6 }}
        />
      ) : null}
      <Text
        style={{
          color: selected ? colors.white : colors.text,
          fontWeight: '600',
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return (
    <View style={styles.center} testID="loading-state">
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[typography.caption, { marginTop: spacing.md }]}>
        {message}
      </Text>
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.center} testID="error-state">
      <Icon name="alert-circle-outline" size={40} color={colors.danger} />
      <Text
        style={[
          typography.body,
          { textAlign: 'center', marginVertical: spacing.md },
        ]}
      >
        {message}
      </Text>
      {onRetry ? (
        <Button
          title="Try again"
          variant="secondary"
          icon="refresh"
          onPress={onRetry}
          testID="retry-button"
        />
      ) : null}
    </View>
  );
}

export function EmptyState({
  icon = 'map-search-outline',
  title,
  message,
  action,
}: {
  icon?: string;
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.center} testID="empty-state">
      <Icon name={icon} size={44} color={colors.textMuted} />
      <Text
        style={[
          typography.subheading,
          { marginTop: spacing.md, textAlign: 'center' },
        ]}
      >
        {title}
      </Text>
      {message ? (
        <Text
          style={[
            typography.caption,
            { marginTop: spacing.xs, textAlign: 'center' },
          ]}
        >
          {message}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.row,
        {
          justifyContent: 'space-between',
          marginTop: spacing.lg,
          marginBottom: spacing.sm,
        },
      ]}
    >
      <Text style={typography.heading}>{title}</Text>
      {action}
    </View>
  );
}

export function Notice({
  text,
  tone = 'info',
  testID,
}: {
  text: string;
  tone?: 'info' | 'warning' | 'danger';
  testID?: string;
}) {
  const c = {
    info: colors.info,
    warning: colors.orange,
    danger: colors.danger,
  }[tone];
  return (
    <View style={[styles.notice, { borderLeftColor: c }]} testID={testID}>
      <Icon
        name={tone === 'info' ? 'information-outline' : 'alert-outline'}
        size={18}
        color={c}
        style={{ marginRight: spacing.sm }}
      />
      <Text style={[typography.caption, { flex: 1, color: colors.text }]}>
        {text}
      </Text>
    </View>
  );
}

export function Badge({
  label,
  color = colors.primary,
}: {
  label: string;
  color?: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1A` }]}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function Stat({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }} testID={testID}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>
        {value}
      </Text>
      <Text style={typography.small}>{label}</Text>
    </View>
  );
}

/** The EmblemWay emblem: a shield with a route line through it. */
export function Logo({ size = 72 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="shield-outline" size={size * 0.62} color={colors.white} />
      <Icon
        name="map-marker-path"
        size={size * 0.3}
        color={colors.accent}
        style={{ position: 'absolute' }}
      />
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  padded: { padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    minHeight: 220,
  },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  label: { ...typography.caption, fontWeight: '600', marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  errorText: { color: colors.danger, fontSize: 13, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderLeftWidth: 4,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
});
