import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type {
  CompositeScreenProps,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type { LocationField } from '../state/plannerStore';

export type AuthStackParams = {
  Welcome: undefined;
  Register: undefined;
  Otp: {
    requestId: string;
    mobileNumber: string;
    codeLength: number;
    resendAvailableAt: string;
    registration?: { firstName: string; lastName: string; email?: string };
  };
};

export type TabParams = {
  Home: undefined;
  Journeys: { tab?: 'upcoming' | 'history' } | undefined;
  Hotspots: undefined;
  Alerts: undefined;
  Profile: undefined;
};

export type AppStackParams = {
  Tabs: NavigatorScreenParams<TabParams>;
  LocationSearch: { field: LocationField };
  MapPlanner: undefined;
  JourneyDetail: { journeyId: string };
  RouteMatching: { journeyId: string };
  TrafficPrediction: { journeyId: string };
  MatchingJourneys: undefined;
  SavedRoutes: undefined;
  EditProfile: undefined;
  Vehicles: undefined;
  PrivacySettings: undefined;
  NotificationPreferences: undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParams> =
  NativeStackScreenProps<AuthStackParams, T>;
export type AppScreenProps<T extends keyof AppStackParams> =
  NativeStackScreenProps<AppStackParams, T>;
export type TabScreenProps<T extends keyof TabParams> = CompositeScreenProps<
  BottomTabScreenProps<TabParams, T>,
  NativeStackScreenProps<AppStackParams>
>;
