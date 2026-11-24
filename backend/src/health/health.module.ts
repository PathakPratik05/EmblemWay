import { Controller, Get, HttpStatus, Injectable, Module, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators/auth.decorators';
import { JobsService } from '../jobs/jobs.service';
import { QuotaGuard } from '../maps/resilience/quota.guard';
import { RoutingService } from '../maps/routing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: (err as Error).message.slice(0, 120),
    };
  }
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jobs: JobsService,
    private readonly routing: RoutingService,
    private readonly quota: QuotaGuard,
    private readonly notifications: NotificationsService,
  ) {}

  async readiness() {
    const [database, redis] = await Promise.all([
      timed(() => this.prisma.ping()),
      timed(() => this.redis.ping()),
    ]);
    return { ok: database.ok && redis.ok, checks: { database, redis } };
  }

  async details() {
    const ready = await this.readiness();
    const postgis = await this.prisma.$queryRaw<
      Array<{ v: string }>
    >`SELECT postgis_lib_version() AS v`.catch(() => [{ v: 'unavailable' }]);
    return {
      ...ready,
      version: process.env.npm_package_version ?? '1.0.0',
      uptimeSeconds: Math.round(process.uptime()),
      postgisVersion: postgis[0]?.v,
      jobs: await this.jobs.health().catch((e: Error) => ({ error: e.message })),
      maps: {
        provider: this.routing.providerName,
        live: this.routing.isLive,
        routesRequestsToday: await this.quota.usage('routes'),
        placesRequestsToday: await this.quota.usage('places'),
      },
      push: { configured: this.notifications.pushConfigured },
      memory: { rssMb: Math.round(process.memoryUsage().rss / 1048576) },
    };
  }
}

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get('live')
  live() {
    return { ok: true };
  }

  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const result = await this.health.readiness();
    if (!result.ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}

@Module({ controllers: [HealthController], providers: [HealthService], exports: [HealthService] })
export class HealthModule {}
