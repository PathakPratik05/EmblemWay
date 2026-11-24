import Geolocation, {
  GeolocationError,
} from '@react-native-community/geolocation';
import { PermissionsAndroid, Platform } from 'react-native';
import type { LatLng } from '../api/types';

export type LocationPermission = 'granted' | 'denied' | 'blocked';
export type LocationFailure =
  | 'PERMISSION_DENIED'
  | 'PERMISSION_BLOCKED'
  | 'GPS_DISABLED'
  | 'UNAVAILABLE'
  | 'TIMEOUT';

export class LocationError extends Error {
  constructor(public readonly reason: LocationFailure) {
    super(reason);
    this.name = 'LocationError';
  }
}

export const LOCATION_MESSAGES: Record<LocationFailure, string> = {
  PERMISSION_DENIED:
    'Location permission was denied. You can still search for places by name.',
  PERMISSION_BLOCKED:
    'Location permission is turned off for EmblemWay. Enable it in Settings to use your current location.',
  GPS_DISABLED:
    'Location services are turned off. Turn on location (GPS) and try again.',
  UNAVAILABLE:
    'Your location is not available right now. Try again outdoors or search by name.',
  TIMEOUT: 'Getting your location took too long. Try again or search by name.',
};

/** Requests location only when the user explicitly asks to use it. */
export async function requestLocationPermission(): Promise<LocationPermission> {
  if (Platform.OS !== 'android') return 'granted';
  const fine = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  if (await PermissionsAndroid.check(fine)) return 'granted';
  const result = await PermissionsAndroid.request(fine, {
    title: 'Use your location',
    message:
      'EmblemWay uses your location only to fill in where your journey starts.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
    ? 'blocked'
    : 'denied';
}

export function mapGeolocationError(
  err: Pick<GeolocationError, 'code'>,
): LocationFailure {
  switch (err.code) {
    case 1:
      return 'PERMISSION_DENIED';
    case 2:
      return 'GPS_DISABLED'; // POSITION_UNAVAILABLE: provider disabled or no fix
    case 3:
      return 'TIMEOUT';
    default:
      return 'UNAVAILABLE';
  }
}

export async function getCurrentLocation(): Promise<LatLng> {
  const permission = await requestLocationPermission();
  if (permission === 'blocked') throw new LocationError('PERMISSION_BLOCKED');
  if (permission === 'denied') throw new LocationError('PERMISSION_DENIED');
  return new Promise<LatLng>((resolve, reject) => {
    Geolocation.getCurrentPosition(
      pos =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      err => reject(new LocationError(mapGeolocationError(err))),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}
