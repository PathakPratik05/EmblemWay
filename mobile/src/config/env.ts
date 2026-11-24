/**
 * Runtime configuration.
 *
 * EMBLEMWAY_API_URL is inlined at bundle time (see babel.config.js), e.g.
 *   EMBLEMWAY_API_URL=https://api.emblemway.in/api/v1 npm run build:android:release
 * In development the Android emulator reaches the host machine at 10.0.2.2.
 * The mobile app never holds server-side API credentials or database access.
 */
const DEV_DEFAULT = 'http://10.0.2.2:3000/api/v1';

export const API_BASE_URL: string = (
  process.env.EMBLEMWAY_API_URL || DEV_DEFAULT
).replace(/\/+$/, '');

export const APP_NAME = 'EmblemWay';
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
export const DEFAULT_COUNTRY_CODE = '+91';
/** Map camera fallback: Pune city centre. */
export const DEFAULT_REGION = {
  latitude: 18.5204,
  longitude: 73.8567,
  latitudeDelta: 0.25,
  longitudeDelta: 0.25,
};
export const REQUEST_TIMEOUT_MS = 15_000;
