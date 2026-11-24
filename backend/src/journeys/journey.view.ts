import {
  Journey,
  JourneyLocation,
  JourneyRoute,
  Prisma,
  RidePoolOffer,
  VehicleType,
} from '@prisma/client';

export const JOURNEY_DETAIL_INCLUDE = {
  vehicleType: true,
  locations: true,
  routes: {
    select: {
      id: true,
      isSelected: true,
      alternativeIndex: true,
      provider: true,
      routingProfile: true,
      encodedPolyline: true,
      distanceMeters: true,
      durationSeconds: true,
      staticDurationSeconds: true,
      computedAt: true,
      journeyId: true,
    },
  },
  ridePoolOffer: true,
} satisfies Prisma.JourneyInclude;

export type JourneyWithRelations = Journey & {
  vehicleType: VehicleType;
  locations: Omit<JourneyLocation, 'geom'>[];
  routes: Omit<JourneyRoute, 'geom'>[];
  ridePoolOffer: RidePoolOffer | null;
};

function locView(l: Omit<JourneyLocation, 'geom'> | undefined) {
  return l
    ? {
        name: l.name,
        address: l.address,
        placeId: l.placeId,
        latitude: l.latitude,
        longitude: l.longitude,
      }
    : null;
}

export function toJourneyView(
  j: JourneyWithRelations,
  isLiveProvider: boolean,
  opts: { includePolyline?: boolean } = {},
) {
  const route = j.routes.find((r) => r.isSelected);
  const find = (kind: string) => j.locations.find((l) => l.kind === kind);
  return {
    id: j.id,
    status: j.status,
    purpose: j.purpose,
    departureAt: j.departureAt.toISOString(),
    estimatedArrivalAt: j.estimatedArrivalAt?.toISOString() ?? null,
    timezone: j.timezone,
    version: j.version,
    notes: j.notes,
    vehicleType: {
      code: j.vehicleType.code,
      name: j.vehicleType.name,
      icon: j.vehicleType.icon,
      routingProfile: j.vehicleType.routingProfile,
    },
    userVehicleId: j.userVehicleId,
    source: locView(find('SOURCE')),
    destination: locView(find('DESTINATION')),
    pickup: locView(find('PICKUP')),
    route: route
      ? {
          encodedPolyline: opts.includePolyline === false ? undefined : route.encodedPolyline,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          staticDurationSeconds: route.staticDurationSeconds,
          provider: route.provider,
          isLiveData: route.provider !== 'mock' && isLiveProvider,
          computedAt: route.computedAt.toISOString(),
          alternatives: j.routes.length - 1,
        }
      : null,
    ridePoolOffer: j.ridePoolOffer
      ? {
          id: j.ridePoolOffer.id,
          status: j.ridePoolOffer.status,
          totalSeats: j.ridePoolOffer.totalSeats,
          availableSeats: j.ridePoolOffer.availableSeats,
        }
      : null,
    matchesComputedAt: j.matchesComputedAt?.toISOString() ?? null,
    startedAt: j.startedAt?.toISOString() ?? null,
    completedAt: j.completedAt?.toISOString() ?? null,
    cancelledAt: j.cancelledAt?.toISOString() ?? null,
    cancelReason: j.cancelReason,
    expiredAt: j.expiredAt?.toISOString() ?? null,
    locationsPurged: !!j.locationsPurgedAt,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}
