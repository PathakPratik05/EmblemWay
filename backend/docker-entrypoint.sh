#!/bin/sh
set -e
# Apply pending database migrations when explicitly requested (e.g. a one-off release job
# or single-instance deployments). Multi-instance deployments should run migrations once,
# before rolling out new instances, rather than on every container start.
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "Applying database migrations..."
  npx prisma migrate deploy
fi
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "Seeding reference data..."
  node dist/seed/seed.js
fi
exec "$@"
