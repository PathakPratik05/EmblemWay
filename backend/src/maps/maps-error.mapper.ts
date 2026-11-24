import { HttpStatus } from '@nestjs/common';
import { AppError, ErrorCode } from '../common/errors/app-error';
import { MapsProviderError } from './maps.types';

/** Translate provider failures into client-facing errors without leaking provider internals. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof MapsProviderError) {
    switch (err.kind) {
      case 'QUOTA':
        return new AppError(
          ErrorCode.MAPS_QUOTA_EXCEEDED,
          'Maps service is busy. Please try again shortly.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      case 'NOT_FOUND':
        return new AppError(
          ErrorCode.ROUTE_NOT_FOUND,
          err.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      case 'REJECTED':
        return new AppError(
          ErrorCode.MAPS_REQUEST_REJECTED,
          'The maps service rejected this request.',
          HttpStatus.BAD_GATEWAY,
        );
      case 'UNSUPPORTED':
        return new AppError(
          ErrorCode.MAPS_REQUEST_REJECTED,
          err.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      case 'TIMEOUT':
      case 'UNAVAILABLE':
        return new AppError(
          ErrorCode.MAPS_PROVIDER_UNAVAILABLE,
          'Maps service is temporarily unavailable. Please retry.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
    }
  }
  return new AppError(
    ErrorCode.INTERNAL_ERROR,
    'Unexpected maps error',
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
