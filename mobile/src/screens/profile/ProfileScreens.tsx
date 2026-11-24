import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Image, Pressable, Switch, Text, View } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { z } from 'zod';
import { api } from '../../api';
import type { Me } from '../../api/types';
import { useAuthStore } from '../../auth/authStore';
import { QueryView, VehiclePicker } from '../../components/domain';
import {
  Button,
  Card,
  Chip,
  Icon,
  Notice,
  Screen,
  SectionHeader,
  TextField,
  styles,
} from '../../components/ui';
import {
  keys,
  useCities,
  useMe,
  useUserVehicles,
  useVehicleTypes,
} from '../../hooks/queries';
import type { AppScreenProps, TabScreenProps } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';
import { errorMessage } from '../../utils/errors';
import { profileSchema } from '../../validation/schemas';

type ProfileForm = z.infer<typeof profileSchema>;

function ProfileForm({
  me,
  submitLabel,
  onSaved,
  complete,
}: {
  me: Me;
  submitLabel: string;
  onSaved: (me: Me) => void;
  complete: boolean;
}) {
  const cities = useCities();
  const vehicles = useVehicleTypes();
  const [serverError, setServerError] = useState<string | null>(null);
  const { control, handleSubmit, formState, setValue, watch } =
    useForm<ProfileForm>({
      resolver: zodResolver(profileSchema),
      defaultValues: {
        firstName: me.firstName,
        lastName: me.lastName,
        email: me.email ?? '',
        preferredCityCode: me.preferredCity?.code ?? 'PUNE',
        defaultVehicleTypeCode: me.defaultVehicleType?.code ?? '',
      },
    });
  const onSubmit = handleSubmit(async v => {
    setServerError(null);
    try {
      const updated = await api.users.update({
        ...v,
        email: v.email ?? '',
        completeProfile: complete || undefined,
      });
      onSaved(updated);
    } catch (err) {
      setServerError(errorMessage(err));
    }
  });
  const city = watch('preferredCityCode');
  const vehicle = watch('defaultVehicleTypeCode');
  return (
    <>
      {(['firstName', 'lastName', 'email'] as const).map(name => (
        <Controller
          key={name}
          control={control}
          name={name}
          render={({ field }) => (
            <TextField
              label={
                {
                  firstName: 'First name',
                  lastName: 'Last name',
                  email: 'Email (optional)',
                }[name]
              }
              value={field.value ?? ''}
              onChangeText={field.onChange}
              error={formState.errors[name]?.message}
              autoCapitalize={name === 'email' ? 'none' : 'words'}
              testID={`profile-${name}`}
            />
          )}
        />
      ))}
      <Text style={styles.label}>Preferred city</Text>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        {(cities.data ?? []).map(c => (
          <Chip
            key={c.code}
            label={c.name}
            selected={city === c.code}
            onPress={() =>
              setValue('preferredCityCode', c.code, { shouldValidate: true })
            }
            testID={`city-${c.code}`}
          />
        ))}
      </View>
      {formState.errors.preferredCityCode ? (
        <Text style={styles.errorText}>
          {formState.errors.preferredCityCode.message}
        </Text>
      ) : null}
      <Text style={[styles.label, { marginTop: spacing.md }]}>
        Usual vehicle
      </Text>
      <VehiclePicker
        value={vehicle || null}
        onChange={c =>
          setValue('defaultVehicleTypeCode', c, { shouldValidate: true })
        }
        types={vehicles.data}
        loading={vehicles.isLoading}
        error={vehicles.isError ? errorMessage(vehicles.error) : undefined}
        onRetry={() => void vehicles.refetch()}
      />
      {formState.errors.defaultVehicleTypeCode ? (
        <Text style={styles.errorText}>
          {formState.errors.defaultVehicleTypeCode.message}
        </Text>
      ) : null}
      {serverError ? <Notice tone="danger" text={serverError} /> : null}
      <Button
        title={submitLabel}
        onPress={onSubmit}
        loading={formState.isSubmitting}
        style={{ marginTop: spacing.lg }}
        testID="profile-submit"
      />
    </>
  );
}

/** Screen 3: first-run profile setup. */
export function ProfileSetupScreen() {
  const me = useMe();
  const setUser = useAuthStore(s => s.setUser);
  return (
    <Screen testID="profile-setup-screen">
      <Text style={typography.title}>Set up your profile</Text>
      <Text style={[typography.caption, { marginBottom: spacing.lg }]}>
        This helps us show relevant routes and traffic. You can change it
        anytime.
      </Text>
      <QueryView query={me}>
        {data => (
          <ProfileForm
            me={data}
            complete
            submitLabel="Finish setup"
            onSaved={setUser}
          />
        )}
      </QueryView>
    </Screen>
  );
}

export function EditProfileScreen({
  navigation,
}: AppScreenProps<'EditProfile'>) {
  const me = useMe();
  const qc = useQueryClient();
  const setUser = useAuthStore(s => s.setUser);
  const avatar = useMutation({
    mutationFn: async () => {
      const res = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        maxWidth: 800,
        maxHeight: 800,
        quality: 0.8,
      });
      const asset = res.assets?.[0];
      if (res.didCancel || !asset?.uri) return null;
      if (res.errorCode)
        throw new Error(res.errorMessage ?? 'Could not open the gallery');
      return api.users.uploadAvatar({
        uri: asset.uri,
        type: asset.type ?? 'image/jpeg',
        name: asset.fileName ?? 'avatar.jpg',
      });
    },
    onSuccess: u => {
      if (u) {
        qc.setQueryData(keys.me, u);
        setUser(u);
      }
    },
  });
  return (
    <Screen testID="edit-profile-screen">
      <QueryView query={me}>
        {data => (
          <>
            <Pressable
              onPress={() => avatar.mutate()}
              style={{ alignItems: 'center', marginBottom: spacing.lg }}
              testID="avatar-button"
            >
              {data.profileImageUrl ? (
                <Image
                  source={{ uri: data.profileImageUrl }}
                  style={{ width: 88, height: 88, borderRadius: 44 }}
                />
              ) : (
                <View
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: 44,
                    backgroundColor: colors.primaryLight,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon
                    name="camera-plus-outline"
                    size={32}
                    color={colors.primary}
                  />
                </View>
              )}
              <Text style={[typography.caption, { marginTop: spacing.xs }]}>
                {avatar.isPending ? 'Uploading…' : 'Change photo'}
              </Text>
            </Pressable>
            {avatar.isError ? (
              <Notice tone="danger" text={errorMessage(avatar.error)} />
            ) : null}
            <ProfileForm
              me={data}
              complete={false}
              submitLabel="Save changes"
              onSaved={u => {
                qc.setQueryData(keys.me, u);
                setUser(u);
                navigation.goBack();
              }}
            />
          </>
        )}
      </QueryView>
    </Screen>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
  testID,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  return (
    <View
      style={[
        styles.row,
        { paddingVertical: spacing.md, justifyContent: 'space-between' },
      ]}
    >
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Text style={typography.body}>{label}</Text>
        {hint ? <Text style={typography.small}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        testID={testID}
        trackColor={{ true: colors.primary, false: colors.border }}
      />
    </View>
  );
}

function usePreferenceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.users.updatePreferences>[0]) =>
      api.users.updatePreferences(body),
    onSuccess: me => qc.setQueryData(keys.me, me),
  });
}

export function PrivacySettingsScreen() {
  const me = useMe();
  const m = usePreferenceMutation();
  return (
    <Screen testID="privacy-screen">
      <QueryView query={me}>
        {data => (
          <Card>
            <ToggleRow
              label="Include my journeys in matching"
              hint="Others see your first name, vehicle type and departure time - never your number or exact address."
              value={data.privacy.shareJourneysForMatching}
              onChange={v => m.mutate({ shareJourneysForMatching: v })}
              testID="toggle-share"
            />
            <ToggleRow
              label="Show my first name to matches"
              hint="Otherwise you appear as “EmblemWay traveller”."
              value={data.privacy.showFirstNameToMatches}
              onChange={v => m.mutate({ showFirstNameToMatches: v })}
              testID="toggle-name"
            />
            <ToggleRow
              label="Location consent"
              hint="Allow EmblemWay to use your current location when you ask for it."
              value={!!data.locationConsentAt}
              onChange={v => m.mutate({ locationConsent: v })}
              testID="toggle-location"
            />
            {m.isError ? (
              <Notice tone="danger" text={errorMessage(m.error)} />
            ) : null}
          </Card>
        )}
      </QueryView>
    </Screen>
  );
}

export function NotificationPreferencesScreen() {
  const me = useMe();
  const m = usePreferenceMutation();
  return (
    <Screen testID="notification-prefs-screen">
      <QueryView query={me}>
        {data => (
          <Card>
            <ToggleRow
              label="Journey reminders"
              value={data.notifications.journeyReminders}
              onChange={v => m.mutate({ notifyJourneyReminders: v })}
            />
            <ToggleRow
              label="New travellers on my route"
              value={data.notifications.matches}
              onChange={v => m.mutate({ notifyMatches: v })}
              testID="toggle-matches"
            />
            <ToggleRow
              label="Journey status updates"
              value={data.notifications.statusUpdates}
              onChange={v => m.mutate({ notifyStatusUpdates: v })}
            />
            <ToggleRow
              label="Traffic alerts"
              value={data.notifications.trafficAlerts}
              onChange={v => m.mutate({ notifyTrafficAlerts: v })}
            />
            {m.isError ? (
              <Notice tone="danger" text={errorMessage(m.error)} />
            ) : null}
          </Card>
        )}
      </QueryView>
    </Screen>
  );
}

export function VehiclesScreen() {
  const list = useUserVehicles();
  const types = useVehicleTypes();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api.users.addVehicle({ vehicleTypeCode: selected! }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.vehicles }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.users.removeVehicle(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.vehicles }),
  });
  return (
    <Screen testID="vehicles-screen">
      <QueryView query={list}>
        {vehicles => (
          <>
            {vehicles.length === 0 ? (
              <Text style={typography.caption}>No vehicles saved yet.</Text>
            ) : null}
            {vehicles.map(v => (
              <Card
                key={v.id}
                style={[styles.row, { justifyContent: 'space-between' }]}
              >
                <View style={styles.row}>
                  <Icon
                    name={v.vehicleType.icon}
                    size={22}
                    color={colors.primary}
                  />
                  <Text style={[typography.body, { marginLeft: spacing.sm }]}>
                    {v.nickname ?? v.vehicleType.name}{' '}
                    {v.isDefault ? '· default' : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={() => remove.mutate(v.id)}
                  accessibilityLabel={`Remove ${v.vehicleType.name}`}
                >
                  <Icon name="delete-outline" size={22} color={colors.danger} />
                </Pressable>
              </Card>
            ))}
          </>
        )}
      </QueryView>
      <SectionHeader title="Add a vehicle" />
      <VehiclePicker
        value={selected}
        onChange={setSelected}
        types={types.data}
        loading={types.isLoading}
      />
      {add.isError ? (
        <Notice tone="danger" text={errorMessage(add.error)} />
      ) : null}
      <Button
        title="Add vehicle"
        disabled={!selected}
        loading={add.isPending}
        onPress={() => add.mutate()}
      />
    </Screen>
  );
}

function SettingsItem({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={[styles.row, { paddingVertical: spacing.md }]}
      accessibilityRole="button"
    >
      <Icon name={icon} size={22} color={colors.primary} />
      <Text style={[typography.body, { flex: 1, marginLeft: spacing.md }]}>
        {label}
      </Text>
      <Icon name="chevron-right" size={22} color={colors.textMuted} />
    </Pressable>
  );
}

/** Screen 14: profile & settings hub. */
export function ProfileScreen({ navigation }: TabScreenProps<'Profile'>) {
  const me = useMe();
  const signOut = useAuthStore(s => s.signOut);
  const [deleting, setDeleting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const confirmDelete = () =>
    Alert.alert(
      'Delete account?',
      'This permanently deletes your profile, journeys and location history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await api.users.deleteAccount();
              await signOut({ remote: false });
            } catch (err) {
              setDeleting(false);
              Alert.alert('Could not delete account', errorMessage(err));
            }
          },
        },
      ],
    );

  const exportData = async () => {
    try {
      const data = await api.users.exportData();
      const journeys = Array.isArray(
        (data as { journeys?: unknown[] }).journeys,
      )
        ? (data as { journeys: unknown[] }).journeys.length
        : 0;
      setExportNote(
        `Your data export is ready (${journeys} journeys). Contact support to receive it by email.`,
      );
    } catch (err) {
      setExportNote(errorMessage(err));
    }
  };

  return (
    <Screen testID="profile-screen">
      <QueryView query={me}>
        {data => (
          <Card style={styles.row}>
            {data.profileImageUrl ? (
              <Image
                source={{ uri: data.profileImageUrl }}
                style={{ width: 56, height: 56, borderRadius: 28 }}
              />
            ) : (
              <Icon name="account-circle" size={56} color={colors.primary} />
            )}
            <View style={{ marginLeft: spacing.md }}>
              <Text style={typography.heading}>
                {data.firstName} {data.lastName}
              </Text>
              <Text style={typography.caption}>{data.mobileNumberMasked}</Text>
              <Text style={typography.small}>
                {data.preferredCity?.name ?? 'No city selected'}
              </Text>
            </View>
          </Card>
        )}
      </QueryView>
      <Card>
        <SettingsItem
          icon="account-edit-outline"
          label="Edit profile"
          onPress={() => navigation.navigate('EditProfile')}
          testID="nav-edit-profile"
        />
        <SettingsItem
          icon="car-outline"
          label="Vehicle preferences"
          onPress={() => navigation.navigate('Vehicles')}
        />
        <SettingsItem
          icon="routes"
          label="Saved routes"
          onPress={() => navigation.navigate('SavedRoutes')}
          testID="nav-saved-routes"
        />
        <SettingsItem
          icon="shield-account-outline"
          label="Privacy settings"
          onPress={() => navigation.navigate('PrivacySettings')}
          testID="nav-privacy"
        />
        <SettingsItem
          icon="bell-cog-outline"
          label="Notification preferences"
          onPress={() => navigation.navigate('NotificationPreferences')}
        />
        <SettingsItem
          icon="download-outline"
          label="Export my data"
          onPress={() => void exportData()}
        />
      </Card>
      {exportNote ? <Notice text={exportNote} /> : null}
      <Button
        title="Log out"
        variant="secondary"
        icon="logout"
        onPress={() => void signOut()}
        testID="logout-button"
      />
      <Button
        title="Delete account"
        variant="danger"
        icon="delete-forever-outline"
        loading={deleting}
        onPress={confirmDelete}
        style={{ marginTop: spacing.md }}
        testID="delete-account-button"
      />
    </Screen>
  );
}
