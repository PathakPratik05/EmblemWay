import { HttpStatus } from '@nestjs/common';

/**
 * Stable, machine readable error codes returned to clients as `error.code`.
 * Mobile and admin clients switch on these - never on human-readable messages.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  FORBIDDEN: 'FORBIDDEN',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_DELETED: 'ACCOUNT_DELETED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_PHONE_NUMBER: 'INVALID_PHONE_NUMBER',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_LOCKED: 'OTP_LOCKED',
  OTP_ALREADY_USED: 'OTP_ALREADY_USED',
  OTP_RESEND_COOLDOWN: 'OTP_RESEND_COOLDOWN',
  OTP_SEND_LIMIT: 'OTP_SEND_LIMIT',
  OTP_DELIVERY_FAILED: 'OTP_DELIVERY_FAILED',
  REGISTRATION_DETAILS_REQUIRED: 'REGISTRATION_DETAILS_REQUIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_COORDINATES: 'INVALID_COORDINATES',
  OUTSIDE_SERVICE_AREA: 'OUTSIDE_SERVICE_AREA',
  SAME_SOURCE_DESTINATION: 'SAME_SOURCE_DESTINATION',
  DEPARTURE_IN_PAST: 'DEPARTURE_IN_PAST',
  DEPARTURE_TOO_FAR: 'DEPARTURE_TOO_FAR',
  INVALID_VEHICLE_TYPE: 'INVALID_VEHICLE_TYPE',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  JOURNEY_NOT_EDITABLE: 'JOURNEY_NOT_EDITABLE',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  IDEMPOTENCY_IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  ROUTE_GEOMETRY_INVALID: 'ROUTE_GEOMETRY_INVALID',
  MAPS_PROVIDER_UNAVAILABLE: 'MAPS_PROVIDER_UNAVAILABLE',
  MAPS_QUOTA_EXCEEDED: 'MAPS_QUOTA_EXCEEDED',
  MAPS_REQUEST_REJECTED: 'MAPS_REQUEST_REJECTED',
  POOL_NOT_ELIGIBLE: 'POOL_NOT_ELIGIBLE',
  POOL_FULL: 'POOL_FULL',
  POOL_REQUEST_INVALID: 'POOL_REQUEST_INVALID',
  UPLOAD_INVALID: 'UPLOAD_INVALID',
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(entity: string): AppError {
    return new AppError(ErrorCode.NOT_FOUND, `${entity} not found`, HttpStatus.NOT_FOUND);
  }

  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }

  static unauthenticated(
    message = 'Authentication required',
    code: ErrorCode = ErrorCode.UNAUTHENTICATED,
  ): AppError {
    return new AppError(code, message, HttpStatus.UNAUTHORIZED);
  }

  static conflict(
    message: string,
    code: ErrorCode = ErrorCode.CONFLICT,
    details?: Record<string, unknown>,
  ): AppError {
    return new AppError(code, message, HttpStatus.CONFLICT, details);
  }

  static tooMany(message: string, code: ErrorCode, retryAfterSeconds?: number): AppError {
    return new AppError(
      code,
      message,
      HttpStatus.TOO_MANY_REQUESTS,
      retryAfterSeconds !== undefined ? { retryAfterSeconds } : undefined,
    );
  }
}
