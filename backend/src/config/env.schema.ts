import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const secret = (name: string) =>
  z
    .string()
    .min(32, `${name} must be at least 32 characters (generate with: openssl rand -base64 48)`);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    API_PREFIX: z.string().default('api/v1'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z.string().default(''),
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),

    JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(180).default(30),
    HASH_PEPPER: secret('HASH_PEPPER'),

    OTP_PROVIDER: z.enum(['mock', 'twilio']).default('mock'),
    OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
    OTP_MAX_SENDS_PER_HOUR: z.coerce.number().int().min(1).max(20).default(5),
    OTP_MAX_SENDS_PER_IP_PER_HOUR: z.coerce.number().int().min(1).max(100_000).default(30),
    /** Global per-IP request throttling. Only ever disable for automated tests. */
    THROTTLE_ENABLED: bool.default(true),
    MOCK_OTP_CODE: z
      .string()
      .regex(/^\d{4,8}$/)
      .optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),

    MAPS_PROVIDER: z.enum(['mock', 'google']).default('mock'),
    GOOGLE_MAPS_SERVER_API_KEY: z.string().optional(),
    GOOGLE_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
    GOOGLE_API_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    GOOGLE_ROUTES_DAILY_QUOTA: z.coerce.number().int().min(1).default(5000),
    GOOGLE_ROUTES_MAX_RPS: z.coerce.number().int().min(1).default(10),
    TRAFFIC_CACHE_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

    PUSH_PROVIDER: z.enum(['none', 'fcm']).default('none'),
    FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().optional(),

    ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
    ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).optional(),

    UPLOAD_DIR: z.string().default('./uploads'),
    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(3 * 1024 * 1024),

    JOBS_ENABLED: bool.default(true),
    LOCATION_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(180),
  })
  .superRefine((env, ctx) => {
    const prodLike = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
    if (prodLike && env.OTP_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_PROVIDER'],
        message: 'The mock OTP provider is not allowed in staging/production',
      });
    }
    if (prodLike && env.MAPS_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAPS_PROVIDER'],
        message: 'The mock maps provider is not allowed in staging/production',
      });
    }
    if (env.OTP_PROVIDER === 'mock' && !env.MOCK_OTP_CODE) {
      ctx.addIssue({
        code: 'custom',
        path: ['MOCK_OTP_CODE'],
        message: 'MOCK_OTP_CODE is required when OTP_PROVIDER=mock',
      });
    }
    if (env.MOCK_OTP_CODE && env.MOCK_OTP_CODE.length !== env.OTP_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        path: ['MOCK_OTP_CODE'],
        message: 'MOCK_OTP_CODE length must equal OTP_LENGTH',
      });
    }
    if (
      env.OTP_PROVIDER === 'twilio' &&
      !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['TWILIO_ACCOUNT_SID'],
        message: 'Twilio credentials are required when OTP_PROVIDER=twilio',
      });
    }
    if (env.MAPS_PROVIDER === 'google' && !env.GOOGLE_MAPS_SERVER_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_MAPS_SERVER_API_KEY'],
        message: 'GOOGLE_MAPS_SERVER_API_KEY is required when MAPS_PROVIDER=google',
      });
    }
    if (env.PUSH_PROVIDER === 'fcm' && !env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
      ctx.addIssue({
        code: 'custom',
        path: ['FIREBASE_SERVICE_ACCOUNT_BASE64'],
        message: 'FIREBASE_SERVICE_ACCOUNT_BASE64 is required when PUSH_PROVIDER=fcm',
      });
    }
    if (prodLike && !env.THROTTLE_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['THROTTLE_ENABLED'],
        message: 'Throttling cannot be disabled in staging/production',
      });
    }
    if (prodLike && env.JWT_ACCESS_SECRET.startsWith('change-me')) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'Default JWT secret must be replaced',
      });
    }
    if (prodLike && env.HASH_PEPPER.startsWith('change-me')) {
      ctx.addIssue({
        code: 'custom',
        path: ['HASH_PEPPER'],
        message: 'Default hash pepper must be replaced',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
