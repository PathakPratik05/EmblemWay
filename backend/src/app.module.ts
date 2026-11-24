import { Module, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { CitiesModule } from './cities/cities.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfigService } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { HotspotsModule } from './hotspots/hotspots.module';
import { JobsModule } from './jobs/jobs.module';
import { JourneysModule } from './journeys/journeys.module';
import { MapsModule } from './maps/maps.module';
import { MatchingModule } from './matching/matching.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RidePoolModule } from './ride-pool/ride-pool.module';
import { SavedModule } from './saved/saved.module';
import { SettingsModule } from './settings/settings.module';
import { TrafficModule } from './traffic/traffic.module';
import { UsersModule } from './users/users.module';
import { VehiclesModule } from './vehicles/vehicles.module';

/** Pretty logs only in local development and only if the dev dependency is installed. */
function prettyLogsAvailable(): boolean {
  if (process.env.NODE_ENV !== 'development') return false;
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      // Express 5 path syntax (avoids the legacy '*' wildcard conversion warning).
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: prettyLogsAvailable()
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
        genReqId: (req: IncomingMessage) => (req as IncomingMessage & { id?: string }).id ?? '',
        customProps: (req: IncomingMessage) => ({
          userId: (req as IncomingMessage & { user?: { userId: string } }).user?.userId,
        }),
        // Never log secrets, OTPs or precise locations.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-goog-api-key"]',
            'req.body.code',
            'req.body.refreshToken',
            'req.body.password',
            'req.query.lat',
            'req.query.lng',
          ],
          censor: '[redacted]',
        },
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url.split('?')[0],
          }),
        },
        autoLogging: {
          ignore: (req: IncomingMessage) => req.url?.startsWith('/api/v1/health') ?? false,
        },
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        skipIf: () => !config.get('THROTTLE_ENABLED'),
      }),
    }),
    PrismaModule,
    RedisModule,
    SettingsModule,
    AuditModule,
    CitiesModule,
    VehiclesModule,
    AuthModule,
    UsersModule,
    MapsModule,
    NotificationsModule,
    MatchingModule,
    HotspotsModule,
    TrafficModule,
    RidePoolModule,
    JobsModule,
    JourneysModule,
    SavedModule,
    HealthModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
