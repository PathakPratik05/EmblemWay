import type { Config } from 'jest';

/**
 * Integration tests: run against a REAL PostgreSQL/PostGIS + Redis instance
 * (see .env.test). The database is never mocked here.
 */
const config: Config = {
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'test/integration/.*\\.int-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  setupFiles: ['<rootDir>/test/setup/load-env.ts'],
  testTimeout: 60000,
  maxWorkers: 1,
};
export default config;
