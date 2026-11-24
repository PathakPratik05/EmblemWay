import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Applies all migrations and reference-data seed to the TEST database before any suite
 * runs. Integration tests use a real PostgreSQL + PostGIS database - nothing is mocked.
 */
export default function globalSetup(): void {
  const root = resolve(__dirname, '../..');
  config({ path: resolve(root, '.env.test'), override: true });
  if (!process.env.DATABASE_URL?.includes('_test')) {
    throw new Error(
      `Refusing to run integration tests against a non-test database: ${process.env.DATABASE_URL}`,
    );
  }
  const env = { ...process.env, NODE_ENV: 'test' };
  execSync('npx prisma migrate deploy', { cwd: root, env, stdio: 'pipe' });
  execSync('npx ts-node --transpile-only prisma/seed.ts', { cwd: root, env, stdio: 'pipe' });
}
