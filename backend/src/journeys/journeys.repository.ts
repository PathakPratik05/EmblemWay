import { Injectable } from '@nestjs/common';
import { LocationKind, Prisma, RoutingProfile } from '@prisma/client';
import { encodePolyline, LatLng } from '../common/utils/geo.util';
import { Tx } from '../prisma/prisma.service';

export interface LocationRecord {
  kind: LocationKind;
  name: string;
  address?: string | null;
  placeId?: string | null;
  latitude: number;
  longitude: number;
}

export interface RouteRecord {
  alternativeIndex: number;
  points: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  staticDurationSeconds: number | null;
}

/** Writes PostGIS columns, which Prisma's typed client cannot express. */
@Injectable()
export class JourneysRepository {
  async replaceLocations(tx: Tx, journeyId: string, locations: LocationRecord[]): Promise<void> {
    await tx.journeyLocation.deleteMany({ where: { journeyId } });
    if (locations.length === 0) return;
    const values = locations.map(
      (
        l,
      ) => Prisma.sql`(${journeyId}::uuid, ${l.kind}::"LocationKind", ${l.name}, ${l.address ?? null}, ${l.placeId ?? null},
        ${l.latitude}, ${l.longitude}, ST_SetSRID(ST_MakePoint(${l.longitude}, ${l.latitude}), 4326))`,
    );
    await tx.$executeRaw`
      INSERT INTO journey_locations (journey_id, kind, name, address, place_id, latitude, longitude, geom)
      VALUES ${Prisma.join(values)}`;
  }

  /**
   * Replaces all routes of a journey. The selected alternative becomes the route used for
   * matching; others are kept as non-selected alternatives. Geometry is built from an
   * encoded polyline (compact, avoids huge WKT strings for 1000 km routes).
   */
  async replaceRoutes(
    tx: Tx,
    journeyId: string,
    routes: RouteRecord[],
    selectedIndex: number,
    provider: string,
    profile: RoutingProfile,
  ): Promise<void> {
    await tx.journeyRoute.deleteMany({ where: { journeyId } });
    for (const r of routes) {
      const encoded = encodePolyline(r.points);
      await tx.$executeRaw`
        INSERT INTO journey_routes (journey_id, is_selected, alternative_index, provider, routing_profile, encoded_polyline, geom,
                                    distance_meters, duration_seconds, static_duration_seconds)
        VALUES (${journeyId}::uuid, ${r.alternativeIndex === selectedIndex}, ${r.alternativeIndex}, ${provider},
                ${profile}::"RoutingProfile", ${encoded}, ST_LineFromEncodedPolyline(${encoded}, 5),
                ${r.distanceMeters}, ${r.durationSeconds}, ${r.staticDurationSeconds})`;
    }
  }
}
