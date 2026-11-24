import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../redis/redis.service';
import { MapsProviderError } from '../maps.types';

/**
 * Protects the Google Maps budget: a daily request quota and a per-second rate limit,
 * both shared across API instances through Redis. If Redis is unreachable we allow the
 * call (availability over strictness) but log loudly.
 */
@Injectable()
export class QuotaGuard {
  private readonly logger = new Logger(QuotaGuard.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  async acquire(api: 'routes' | 'places' | 'geocode', now = new Date()): Promise<void> {
    try {
      const day = now.toISOString().slice(0, 10);
      const used = await this.redis.incrWithTtl(`quota:${api}:${day}`, 2 * 86_400);
      const dailyLimit = this.config.get('GOOGLE_ROUTES_DAILY_QUOTA') * (api === 'routes' ? 1 : 2);
      if (used > dailyLimit) {
        throw new MapsProviderError(
          'QUOTA',
          `Daily ${api} quota of ${dailyLimit} requests exhausted`,
        );
      }
      const second = Math.floor(now.getTime() / 1000);
      const rps = await this.redis.incrWithTtl(`rate:${api}:${second}`, 2);
      if (rps > this.config.get('GOOGLE_ROUTES_MAX_RPS')) {
        throw new MapsProviderError(
          'QUOTA',
          `Rate limit of ${this.config.get('GOOGLE_ROUTES_MAX_RPS')} rps reached`,
        );
      }
    } catch (err) {
      if (err instanceof MapsProviderError) throw err;
      this.logger.error(`Quota check skipped, Redis unavailable: ${(err as Error).message}`);
    }
  }

  async usage(api: 'routes' | 'places' | 'geocode', now = new Date()): Promise<number> {
    try {
      const raw = await this.redis.client.get(`quota:${api}:${now.toISOString().slice(0, 10)}`);
      return Number(raw ?? 0);
    } catch {
      return -1;
    }
  }
}
