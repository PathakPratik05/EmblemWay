import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { hashPassword } from '../../src/common/utils/crypto.util';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { SettingsService } from '../../src/settings/settings.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export interface ProviderOverride {
  token: unknown;
  useValue: unknown;
}

export async function createTestApp(
  overrides: ProviderOverride[] = [],
  customize?: (b: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<TestContext> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const o of overrides)
    builder = builder.overrideProvider(o.token as never).useValue(o.useValue);
  if (customize) builder = customize(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  // Listen once on an ephemeral port so concurrent supertest calls share one server.
  await app.listen(0, '127.0.0.1');
  const prisma = app.get(PrismaService);
  return {
    app,
    prisma,
    http: () => request(app.getHttpServer()),
    close: async () => {
      await app.close();
    },
  };
}

/** Wipes all user-generated data; keeps reference data (cities, vehicle types). */
export async function resetDatabase(ctx: TestContext): Promise<void> {
  await ctx.prisma.$executeRawUnsafe(`
    TRUNCATE TABLE audit_logs, notifications, device_tokens, ride_pool_members, ride_pool_requests, ride_pool_offers,
      journey_route_segments, route_segments, journey_matches, traffic_snapshots, hotspot_aggregations,
      journey_routes, journey_locations, journeys, saved_routes, saved_places, user_vehicles, user_sessions,
      otp_verifications, idempotency_records, app_settings, user_profiles, users RESTART IDENTITY CASCADE`);
  ctx.app.get(SettingsService).clearCache();
  await ctx.app.get(RedisService).client.flushdb();
}

let phoneCounter = 0;
/** Unique valid Indian mobile numbers within a test run. */
export function uniquePhone(): string {
  phoneCounter += 1;
  return `9${String((Date.now() % 10_000_000) * 100 + (phoneCounter % 100))
    .padStart(9, '0')
    .slice(-9)}`;
}

export const MOCK_OTP = '123456';

export interface TestUser {
  userId: string;
  accessToken: string;
  refreshToken: string;
  phone: string;
}

export async function registerUser(
  ctx: TestContext,
  firstName = 'Test',
  lastName = 'User',
  phone = uniquePhone(),
): Promise<TestUser> {
  const otp = await ctx
    .http()
    .post('/api/v1/auth/otp/request')
    .send({ countryCode: '+91', mobileNumber: phone })
    .expect(200);
  const res = await ctx
    .http()
    .post('/api/v1/auth/otp/verify')
    .send({
      requestId: otp.body.requestId,
      code: MOCK_OTP,
      firstName,
      lastName,
      platform: 'android',
    })
    .expect(200);
  return {
    userId: res.body.user.id,
    accessToken: res.body.tokens.accessToken,
    refreshToken: res.body.tokens.refreshToken,
    phone,
  };
}

export async function createAdmin(
  ctx: TestContext,
  role: 'ADMIN' | 'SUPER_ADMIN' = 'ADMIN',
): Promise<{ token: string; userId: string }> {
  const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2)}@emblemway.test`;
  const password = 'Sup3r-Secret-Pass!';
  const user = await ctx.prisma.user.create({
    data: {
      role,
      firstName: 'Ada',
      lastName: 'Admin',
      email,
      passwordHash: await hashPassword(password),
      profile: { create: {} },
    },
  });
  const res = await ctx
    .http()
    .post('/api/v1/auth/admin/login')
    .send({ email, password })
    .expect(200);
  return { token: res.body.tokens.accessToken, userId: user.id };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export function inMinutes(m: number): string {
  return new Date(Date.now() + m * 60_000).toISOString();
}

export const PLACES = {
  hinjewadi: { name: 'Hinjewadi Phase 1', latitude: 18.5912, longitude: 73.7389 },
  kharadi: { name: 'Kharadi', latitude: 18.5515, longitude: 73.9348 },
  shivajinagar: { name: 'Shivajinagar', latitude: 18.5308, longitude: 73.8475 },
  baner: { name: 'Baner', latitude: 18.559, longitude: 73.7868 },
  vimanNagar: { name: 'Viman Nagar', latitude: 18.5679, longitude: 73.9143 },
};

export function createJourney(
  ctx: TestContext,
  user: TestUser,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return ctx
    .http()
    .post('/api/v1/journeys')
    .set(auth(user.accessToken))
    .set(headers)
    .send({
      source: PLACES.hinjewadi,
      destination: PLACES.kharadi,
      departureAt: inMinutes(60),
      vehicleTypeCode: 'CAR',
      ...body,
    });
}
