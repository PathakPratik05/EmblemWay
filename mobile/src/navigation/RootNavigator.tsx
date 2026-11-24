import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '../auth/authStore';
import { OfflineBanner } from '../components/domain';
import { Icon } from '../components/ui';
import { useNotifications } from '../hooks/queries';
import {
  SplashScreen,
  OtpScreen,
  RegisterScreen,
  WelcomeScreen,
} from '../screens/auth/AuthScreens';
import {
  JourneyDetailScreen,
  JourneysScreen,
  MatchingJourneysScreen,
  RouteMatchingScreen,
  TrafficPredictionScreen,
} from '../screens/journeys/JourneyScreens';
import {
  HotspotsScreen,
  NotificationsScreen,
  SavedRoutesScreen,
} from '../screens/misc/MiscScreens';
import {
  HomeScreen,
  LocationSearchScreen,
  MapPlannerScreen,
} from '../screens/plan/PlanScreens';
import {
  EditProfileScreen,
  NotificationPreferencesScreen,
  PrivacySettingsScreen,
  ProfileScreen,
  ProfileSetupScreen,
  VehiclesScreen,
} from '../screens/profile/ProfileScreens';
import { registerForPush } from '../services/push';
import { colors } from '../theme';
import type { AppStackParams, AuthStackParams, TabParams } from './types';

const AuthStack = createNativeStackNavigator<AuthStackParams>();
const AppStack = createNativeStackNavigator<AppStackParams>();
const Tabs = createBottomTabNavigator<TabParams>();

const TAB_ICONS: Record<keyof TabParams, string> = {
  Home: 'home-variant-outline',
  Journeys: 'map-marker-path',
  Hotspots: 'fire',
  Alerts: 'bell-outline',
  Profile: 'account-circle-outline',
};

/** Created once per icon name at module level (not during render). */
const tabIconCache = new Map<
  string,
  (p: { color: string; size: number }) => React.ReactElement
>();
function tabIcon(name: string) {
  let render = tabIconCache.get(name);
  if (!render) {
    render = ({ color, size }) => (
      <Icon name={name} color={color} size={size} />
    );
    tabIconCache.set(name, render);
  }
  return render;
}

function MainTabs() {
  const notifications = useNotifications();
  const unread = notifications.data?.unreadCount ?? 0;
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        headerTitleStyle: { fontWeight: '700' },
        tabBarIcon: tabIcon(TAB_ICONS[route.name]),
        tabBarButtonTestID: `tab-${route.name}`,
      })}
    >
      <Tabs.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'EmblemWay', tabBarLabel: 'Home' }}
      />
      <Tabs.Screen
        name="Journeys"
        component={JourneysScreen}
        options={{ title: 'My journeys' }}
      />
      <Tabs.Screen
        name="Hotspots"
        component={HotspotsScreen}
        options={{ title: 'Hotspots' }}
      />
      <Tabs.Screen
        name="Alerts"
        component={NotificationsScreen}
        options={{
          title: 'Notifications',
          tabBarBadge: unread > 0 ? unread : undefined,
        }}
      />
      <Tabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Profile' }}
      />
    </Tabs.Navigator>
  );
}

function SignedInStack() {
  useEffect(() => {
    void registerForPush();
  }, []);
  return (
    <AppStack.Navigator screenOptions={{ headerTintColor: colors.primary }}>
      <AppStack.Screen
        name="Tabs"
        component={MainTabs}
        options={{ headerShown: false }}
      />
      <AppStack.Screen
        name="LocationSearch"
        component={LocationSearchScreen}
        options={{ title: 'Choose location', presentation: 'modal' }}
      />
      <AppStack.Screen
        name="MapPlanner"
        component={MapPlannerScreen}
        options={{ title: 'Plan journey' }}
      />
      <AppStack.Screen
        name="JourneyDetail"
        component={JourneyDetailScreen}
        options={{ title: 'Journey' }}
      />
      <AppStack.Screen
        name="RouteMatching"
        component={RouteMatchingScreen}
        options={{ title: 'Travellers on your route' }}
      />
      <AppStack.Screen
        name="TrafficPrediction"
        component={TrafficPredictionScreen}
        options={{ title: 'Traffic prediction' }}
      />
      <AppStack.Screen
        name="MatchingJourneys"
        component={MatchingJourneysScreen}
        options={{ title: 'Matching journeys' }}
      />
      <AppStack.Screen
        name="SavedRoutes"
        component={SavedRoutesScreen}
        options={{ title: 'Saved routes' }}
      />
      <AppStack.Screen
        name="EditProfile"
        component={EditProfileScreen}
        options={{ title: 'Edit profile' }}
      />
      <AppStack.Screen
        name="Vehicles"
        component={VehiclesScreen}
        options={{ title: 'Vehicle preferences' }}
      />
      <AppStack.Screen
        name="PrivacySettings"
        component={PrivacySettingsScreen}
        options={{ title: 'Privacy' }}
      />
      <AppStack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={{ title: 'Notification preferences' }}
      />
    </AppStack.Navigator>
  );
}

export function RootNavigator() {
  const status = useAuthStore(s => s.status);
  const needsProfileSetup = useAuthStore(s => s.needsProfileSetup);
  const bootstrap = useAuthStore(s => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Re-validate the session when the app returns from the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (
        s === 'active' &&
        useAuthStore.getState().status === 'signedIn' &&
        !useAuthStore.getState().user
      )
        void bootstrap();
    });
    return () => sub.remove();
  }, [bootstrap]);

  if (status === 'loading') return <SplashScreen />;

  return (
    <NavigationContainer>
      <OfflineBanner />
      {status === 'signedOut' ? (
        <AuthStack.Navigator
          screenOptions={{ headerTintColor: colors.primary }}
        >
          <AuthStack.Screen
            name="Welcome"
            component={WelcomeScreen}
            options={{ headerShown: false }}
          />
          <AuthStack.Screen
            name="Register"
            component={RegisterScreen}
            options={{ title: 'Create account' }}
          />
          <AuthStack.Screen
            name="Otp"
            component={OtpScreen}
            options={{ title: 'Verification' }}
          />
        </AuthStack.Navigator>
      ) : needsProfileSetup ? (
        <ProfileSetupScreen />
      ) : (
        <SignedInStack />
      )}
    </NavigationContainer>
  );
}
