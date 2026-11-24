import { PermissionsAndroid, Platform } from 'react-native';
import { api } from '../api';

/**
 * Registers this device for Firebase Cloud Messaging. Push is optional: if the app was built
 * without google-services.json (no Firebase project configured) this resolves to
 * 'not_configured' and notifications remain available in-app.
 */
export async function registerForPush(): Promise<
  'registered' | 'denied' | 'not_configured' | 'failed'
> {
  try {
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      const r = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (r !== PermissionsAndroid.RESULTS.GRANTED) return 'denied';
    }
    // Required lazily so a missing Firebase configuration can never crash app start-up.
     
    const { getApp } =
      require('@react-native-firebase/app') as typeof import('@react-native-firebase/app');
    const { getMessaging, getToken, onTokenRefresh } =
      require('@react-native-firebase/messaging') as typeof import('@react-native-firebase/messaging');
     
    let messaging;
    try {
      messaging = getMessaging(getApp());
    } catch {
      return 'not_configured';
    }
    const token = await getToken(messaging);
    await api.notifications.registerDevice(token);
    onTokenRefresh(messaging, t => {
      void api.notifications.registerDevice(t).catch(() => undefined);
    });
    return 'registered';
  } catch {
    return 'failed';
  }
}
