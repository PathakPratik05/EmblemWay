# EmblemWay

**EmblemWay** is an Android app and platform for smarter journeys in Pune (built to expand to Mumbai, Bengaluru and
other Indian cities). Travellers register a journey (start, destination, pickup, departure, vehicle) and EmblemWay:

- finds other registered travellers on the **same or overlapping roads** — using real route geometry in PostGIS, rejecting
  opposite-direction traffic, with deduplicated, vehicle-wise counts;
- predicts travel time for leaving **now, +15, +30, +45, +60 minutes** with traffic-aware routing, and only recommends
  waiting when it genuinely helps;
- maps **journey-demand, traffic and origin/destination hotspots**;
- supports explicit, opt-in **ride pooling** with overbooking-safe seat allocation;
- gives operators an **admin dashboard** (statistics, users, journeys, popular corridors, hotspots, tunable matching
  thresholds, audit log, health).

| Folder | What |
|---|---|
| `mobile/` | React Native 0.81 Android app (`com.emblemway.app`) |
| `backend/` | NestJS 11 API · Prisma 6 · PostgreSQL 16 + PostGIS 3.5 · Redis · BullMQ |
| `admin/` | Next.js 15 admin dashboard (BFF, httpOnly sessions) |
| `infrastructure/` | Docker Compose, PostGIS init, Redis config |
| `docs/` | Architecture, schema, API, algorithms, setup, security, testing, deployment, troubleshooting |
| `scripts/` | `setup-dev.sh`, `test-all.sh`, `build-android.sh`, `generate-icons.py` |
| `.github/workflows/` | CI, Android E2E, release/deploy |

## Quick start (local)

Prerequisites: Docker, Node.js 22, JDK 17/21, Android SDK (see `docs/ANDROID_SETUP.md`).

```bash
scripts/setup-dev.sh                       # infra + deps + env files + migrations + seed

cd backend && npm run start:dev            # API      http://localhost:3000/api/v1   (Swagger: /api/docs)
cd admin   && npm run dev                  # Admin    http://localhost:3001  (ADMIN_BOOTSTRAP_EMAIL / PASSWORD from backend/.env)
cd mobile  && npm start                    # Metro
cd mobile  && npm run android              # installs EmblemWay on the running emulator
```

Development defaults use **isolated mock providers** (OTP code `123456`, simulated routes/traffic, a Pune gazetteer) so
everything works without credentials; responses are labelled as development data and production refuses these providers.

Whole stack in containers: `docker compose -f infrastructure/docker-compose.yml --profile app up -d --build`.

## Tests
```bash
scripts/test-all.sh                        # backend (unit + real-PostGIS integration), mobile, admin
cd mobile && npm run e2e:build && npm run e2e:test   # Detox on emulator EmblemWay_API_35 (backend running)
```

## Android builds
```bash
scripts/build-android.sh debug | apk | aab
```
Store-ready builds need `EMBLEMWAY_API_URL` (HTTPS), `EMBLEMWAY_MAPS_API_KEY` and the upload keystore variables.

## External credentials required for production
| Feature | Credential | Doc |
|---|---|---|
| Map tiles in the app | Android-restricted Google Maps SDK key | `docs/GOOGLE_MAPS_SETUP.md` |
| Places search, routes, traffic | Server Google key (Routes, Places (New), Geocoding) | `docs/GOOGLE_MAPS_SETUP.md` |
| SMS OTP | Twilio (DLT-registered sender for India) | `docs/ENVIRONMENT_CONFIGURATION.md` |
| Push notifications | Firebase project (`google-services.json` + service account) | `docs/ANDROID_SETUP.md` |
| Play Store release | Upload keystore | `docs/ANDROID_SETUP.md` |

See `PROJECT_PROGRESS.md` for verified status of every requirement.
