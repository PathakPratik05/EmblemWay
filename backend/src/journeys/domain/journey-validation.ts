import { HttpStatus } from '@nestjs/common';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import {
  haversineMeters,
  INDIA_BBOX,
  isValidLatLng,
  isWithinBox,
  LatLng,
} from '../../common/utils/geo.util';
import { isValidTimeZone } from '../../common/utils/time.util';
import type { JourneySettings } from '../../settings/settings.schema';

/** Points closer than this are considered "the same place". */
export const SAME_PLACE_THRESHOLD_M = 100;

export interface JourneyGeoInput {
  source: LatLng;
  destination: LatLng;
  pickup?: LatLng | null;
}

export function validateJourneyGeo(input: JourneyGeoInput): void {
  const pts: Array<[string, LatLng | null | undefined]> = [
    ['source', input.source],
    ['destination', input.destination],
    ['pickup', input.pickup],
  ];
  for (const [label, p] of pts) {
    if (p === undefined || p === null) {
      if (label === 'pickup') continue;
      throw new AppError(
        ErrorCode.INVALID_COORDINATES,
        `${label} is required`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!isValidLatLng(p))
      throw new AppError(
        ErrorCode.INVALID_COORDINATES,
        `${label} has invalid coordinates`,
        HttpStatus.BAD_REQUEST,
      );
    if (!isWithinBox(p, INDIA_BBOX)) {
      throw new AppError(
        ErrorCode.OUTSIDE_SERVICE_AREA,
        `${label} is outside the EmblemWay service area (India)`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
  if (haversineMeters(input.source, input.destination) < SAME_PLACE_THRESHOLD_M) {
    throw new AppError(
      ErrorCode.SAME_SOURCE_DESTINATION,
      'Source and destination must be different places',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (input.pickup && haversineMeters(input.pickup, input.destination) < SAME_PLACE_THRESHOLD_M) {
    throw new AppError(
      ErrorCode.SAME_SOURCE_DESTINATION,
      'Pickup point cannot be the destination',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export function validateDeparture(departureAt: Date, s: JourneySettings, now = new Date()): void {
  if (Number.isNaN(departureAt.getTime())) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      'departureAt is not a valid date-time',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (departureAt.getTime() < now.getTime() - s.pastDepartureGraceMinutes * 60_000) {
    throw new AppError(
      ErrorCode.DEPARTURE_IN_PAST,
      'Departure time is in the past',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (departureAt.getTime() > now.getTime() + s.maxScheduleDaysAhead * 86_400_000) {
    throw new AppError(
      ErrorCode.DEPARTURE_TOO_FAR,
      `Journeys can be scheduled at most ${s.maxScheduleDaysAhead} days ahead`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** ISO-8601 with an explicit offset or Z, so a client's local clock never gets misread as UTC. */
export const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export function parseDepartureIso(value: string): Date {
  if (!ISO_WITH_OFFSET.test(value)) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      'departureAt must be ISO-8601 with a timezone offset, e.g. 2026-11-25T09:30:00+05:30',
      HttpStatus.BAD_REQUEST,
    );
  }
  return new Date(value);
}

export function validateTimezone(tz: string): void {
  if (!isValidTimeZone(tz))
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      `Unknown timezone ${tz}`,
      HttpStatus.BAD_REQUEST,
    );
}
