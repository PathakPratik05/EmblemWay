import { ApiError } from '../api/client';

/** User-facing messages for backend error codes. Falls back to the server's message. */
const MESSAGES: Record<string, string> = {
  NETWORK_ERROR:
    'You appear to be offline. Check your connection and try again.',
  TIMEOUT: 'The connection is slow. Please try again.',
  OTP_INVALID: 'That code is incorrect.',
  OTP_EXPIRED: 'This code has expired. Request a new one.',
  OTP_LOCKED: 'Too many incorrect attempts. Request a new code.',
  OTP_ALREADY_USED: 'This code was already used. Request a new one.',
  OTP_RESEND_COOLDOWN: 'Please wait a moment before requesting another code.',
  OTP_SEND_LIMIT: 'Too many codes requested. Try again in an hour.',
  OTP_DELIVERY_FAILED: 'We could not send the code. Please try again.',
  INVALID_PHONE_NUMBER: 'Enter a valid 10-digit Indian mobile number.',
  ACCOUNT_SUSPENDED: 'This account has been suspended. Contact support.',
  SAME_SOURCE_DESTINATION: 'Source and destination must be different places.',
  DEPARTURE_IN_PAST: 'The departure time is in the past.',
  DEPARTURE_TOO_FAR: 'Journeys can be planned up to 90 days ahead.',
  OUTSIDE_SERVICE_AREA: 'EmblemWay currently works only within India.',
  ROUTE_NOT_FOUND: 'No route could be found between these places.',
  MAPS_PROVIDER_UNAVAILABLE:
    'Maps service is temporarily unavailable. Please retry.',
  MAPS_QUOTA_EXCEEDED: 'Maps service is busy. Please try again shortly.',
  VERSION_CONFLICT:
    'This journey was changed on another device. Reload and try again.',
  INVALID_STATUS_TRANSITION:
    'This action is no longer possible for this journey.',
  JOURNEY_NOT_EDITABLE:
    'Only upcoming journeys that have not started can be edited.',
  RATE_LIMITED: 'Too many requests. Please slow down.',
  POOL_FULL: 'No seats are left on this ride.',
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (
      err.code === 'OTP_INVALID' &&
      typeof err.details?.remainingAttempts === 'number'
    ) {
      const n = err.details.remainingAttempts;
      return `That code is incorrect. ${n} attempt${n === 1 ? '' : 's'} left.`;
    }
    return MESSAGES[err.code] ?? err.message;
  }
  return 'Something went wrong. Please try again.';
}

export function isOffline(err: unknown): boolean {
  return err instanceof ApiError && err.isNetworkError;
}
