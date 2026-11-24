import type { Config } from 'jest';

/** Unit tests: pure business logic, no database or network. */
const config: Config = {
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.service.ts',
    'src/**/*.engine.ts',
    'src/**/*.util.ts',
    'src/**/*.policy.ts',
    'src/**/*.machine.ts',
    'src/**/*.guard.ts',
    'src/**/domain/**/*.ts',
    'src/**/providers/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/testing/**',
  ],
  coverageDirectory: 'coverage/unit',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
};
export default config;
