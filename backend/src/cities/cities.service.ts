import { Injectable } from '@nestjs/common';
import { City } from '@prisma/client';
import { haversineMeters, LatLng } from '../common/utils/geo.util';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_MS = 60_000;

/**
 * Cities are data, not code: adding Mumbai or Bengaluru is an INSERT (or toggling
 * is_active), never a change to the matching algorithm.
 */
@Injectable()
export class CitiesService {
  private cache: { at: number; items: City[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async listActive(): Promise<City[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.items;
    const items = await this.prisma.city.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    this.cache = { at: Date.now(), items };
    return items;
  }

  /** The active city whose service radius contains the point (closest centre wins). */
  async resolve(point: LatLng): Promise<City | null> {
    const cities = await this.listActive();
    let best: { city: City; d: number } | null = null;
    for (const city of cities) {
      const d = haversineMeters(point, {
        latitude: city.centerLatitude,
        longitude: city.centerLongitude,
      });
      if (d <= city.radiusMeters && (!best || d < best.d)) best = { city, d };
    }
    return best?.city ?? null;
  }

  async findByCode(code: string): Promise<City | null> {
    return this.prisma.city.findUnique({ where: { code: code.toUpperCase() } });
  }

  invalidate(): void {
    this.cache = null;
  }
}
