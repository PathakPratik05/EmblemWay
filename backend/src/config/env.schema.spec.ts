import { validateEnv } from './env.schema';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://x@localhost/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  HASH_PEPPER: 'b'.repeat(40),
  OTP_PROVIDER: 'mock',
  MOCK_OTP_CODE: '123456',
  MAPS_PROVIDER: 'mock',
};

describe('environment validation', () => {
  it('accepts a valid development configuration with defaults', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.OTP_TTL_SECONDS).toBe(300);
    expect(env.THROTTLE_ENABLED).toBe(true);
  });

  it('refuses mock OTP and mock maps in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /mock OTP provider is not allowed[\s\S]*mock maps provider is not allowed/,
    );
  });

  it('refuses default secrets and disabled throttling in production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        OTP_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'AC1',
        TWILIO_AUTH_TOKEN: 't',
        TWILIO_FROM_NUMBER: '+1',
        MAPS_PROVIDER: 'google',
        GOOGLE_MAPS_SERVER_API_KEY: 'k',
        JWT_ACCESS_SECRET: 'change-me-' + 'x'.repeat(30),
        THROTTLE_ENABLED: 'false',
      }),
    ).toThrow(/Throttling cannot be disabled[\s\S]*Default JWT secret/);
  });

  it('accepts a complete production configuration', () => {
    const env = validateEnv({
      ...base,
      NODE_ENV: 'production',
      OTP_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 't',
      TWILIO_FROM_NUMBER: '+15550001111',
      MAPS_PROVIDER: 'google',
      GOOGLE_MAPS_SERVER_API_KEY: 'key',
      PUSH_PROVIDER: 'fcm',
      FIREBASE_SERVICE_ACCOUNT_BASE64: 'e30=',
    });
    expect(env.MAPS_PROVIDER).toBe('google');
  });

  it.each([
    [{ JWT_ACCESS_SECRET: 'short' }, /JWT_ACCESS_SECRET/],
    [{ MOCK_OTP_CODE: undefined }, /MOCK_OTP_CODE is required/],
    [{ MOCK_OTP_CODE: '1234' }, /length must equal OTP_LENGTH/],
    [{ MAPS_PROVIDER: 'google' }, /GOOGLE_MAPS_SERVER_API_KEY is required/],
    [{ OTP_PROVIDER: 'twilio' }, /Twilio credentials are required/],
    [{ PUSH_PROVIDER: 'fcm' }, /FIREBASE_SERVICE_ACCOUNT_BASE64 is required/],
    [{ DATABASE_URL: '' }, /DATABASE_URL/],
  ])('rejects %j', (override, message) => {
    expect(() => validateEnv({ ...base, ...override })).toThrow(message);
  });
});
