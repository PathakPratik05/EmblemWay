#!/usr/bin/env bash
# Runs every automated test suite (except Android E2E, which needs an emulator: see docs/TESTING_GUIDE.md).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "▶ Backend: lint, typecheck, unit + integration (real PostgreSQL/PostGIS) with coverage"
cd "$ROOT/backend"
npm run lint && npm run typecheck && npm run test:coverage

echo "▶ Mobile: lint, typecheck, Jest + React Native Testing Library"
cd "$ROOT/mobile"
npx eslint . --ext .ts,.tsx --max-warnings 0 && npx tsc --noEmit && npx jest --coverage

echo "▶ Admin: lint, typecheck, Jest"
cd "$ROOT/admin"
npm run lint && npm run typecheck && npx jest --coverage

echo "✔ All suites passed"
