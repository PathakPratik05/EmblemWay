import type { Config } from 'jest';
import unit from './jest.config';
import integration from './jest.integration.config';

/**
 * Combined coverage: unit tests (pure logic) + integration tests (real PostgreSQL/PostGIS).
 * Business logic in services that talk to the database is exercised only by the latter.
 */
const config: Config = {
  projects: [
    {
      ...unit,
      displayName: 'unit',
      collectCoverageFrom: undefined,
      coverageDirectory: undefined,
      coverageReporters: undefined,
    },
    { ...integration, displayName: 'integration' },
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/**/*.dto.ts',
    '!src/**/dto/**',
    '!src/**/*.types.ts',
  ],
  coverageDirectory: 'coverage/combined',
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
  coverageThreshold: { global: { lines: 80, statements: 80 } },
};
export default config;
