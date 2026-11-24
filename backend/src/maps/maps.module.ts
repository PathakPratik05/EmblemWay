import { Global, Logger, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { MapsController } from './maps.controller';
import { PLACES_PROVIDER, PlacesProvider, ROUTING_PROVIDER, RoutingProvider } from './maps.types';
import { GoogleHttpClient } from './providers/google-http.client';
import { GooglePlacesProvider } from './providers/google-places.provider';
import { GoogleRoutesProvider } from './providers/google-routes.provider';
import { MockPlacesProvider, MockRoutingProvider } from './providers/mock-maps.providers';
import { QuotaGuard } from './resilience/quota.guard';
import { RoutingService } from './routing.service';

export const ROUTES_HTTP = Symbol('ROUTES_HTTP');

@Global()
@Module({
  controllers: [MapsController],
  providers: [
    QuotaGuard,
    RoutingService,
    {
      provide: ROUTES_HTTP,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new GoogleHttpClient({
          timeoutMs: config.get('GOOGLE_API_TIMEOUT_MS'),
          maxRetries: config.get('GOOGLE_API_MAX_RETRIES'),
        }),
    },
    {
      provide: ROUTING_PROVIDER,
      inject: [AppConfigService, QuotaGuard, ROUTES_HTTP],
      useFactory: (
        config: AppConfigService,
        quota: QuotaGuard,
        http: GoogleHttpClient,
      ): RoutingProvider => {
        if (config.get('MAPS_PROVIDER') === 'google') {
          return new GoogleRoutesProvider(http, config.get('GOOGLE_MAPS_SERVER_API_KEY')!, quota);
        }
        if (config.isProductionLike)
          throw new Error('Mock maps provider is not allowed in production');
        new Logger('MapsModule').warn(
          'MAPS_PROVIDER=mock - routes and traffic are SIMULATED (development only)',
        );
        return new MockRoutingProvider();
      },
    },
    {
      provide: PLACES_PROVIDER,
      inject: [AppConfigService, QuotaGuard],
      useFactory: (config: AppConfigService, quota: QuotaGuard): PlacesProvider => {
        if (config.get('MAPS_PROVIDER') === 'google') {
          const http = new GoogleHttpClient({
            timeoutMs: config.get('GOOGLE_API_TIMEOUT_MS'),
            maxRetries: config.get('GOOGLE_API_MAX_RETRIES'),
          });
          return new GooglePlacesProvider(http, config.get('GOOGLE_MAPS_SERVER_API_KEY')!, quota);
        }
        return new MockPlacesProvider();
      },
    },
  ],
  exports: [RoutingService, ROUTING_PROVIDER, PLACES_PROVIDER, QuotaGuard, ROUTES_HTTP],
})
export class MapsModule {}
