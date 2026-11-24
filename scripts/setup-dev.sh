#!/usr/bin/env bash
# One-time local setup: infrastructure, dependencies, env files, migrations and seed data.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "▶ Starting PostgreSQL/PostGIS and Redis"
docker compose -f infrastructure/docker-compose.yml up -d postgres redis
for i in $(seq 1 60); do
  docker compose -f infrastructure/docker-compose.yml exec -T postgres pg_isready -U emblemway >/dev/null 2>&1 && break
  sleep 2
done

echo "▶ Backend"
cd "$ROOT/backend"
[ -f .env ] || cp .env.example .env
[ -f .env.test ] || cp .env.test.example .env.test
npm ci
npx prisma generate
npx prisma migrate deploy
npx dotenv -e .env.test -- npx prisma migrate deploy
npm run db:seed

echo "▶ Admin dashboard"
cd "$ROOT/admin"
[ -f .env.local ] || cp .env.example .env.local
npm ci

echo "▶ Mobile app"
cd "$ROOT/mobile"
npm ci
if [ -n "${ANDROID_HOME:-}" ] && [ ! -f android/local.properties ]; then
  echo "sdk.dir=$ANDROID_HOME" > android/local.properties
fi

cat <<'EOF'

✔ Setup complete.
  Backend:  cd backend && npm run start:dev        → http://localhost:3000/api/docs
  Admin:    cd admin && npm run dev                → http://localhost:3001  (admin@emblemway.local, see backend/.env)
  Android:  cd mobile && npm start  then  npm run android
EOF
