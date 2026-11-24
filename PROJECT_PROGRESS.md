# EmblemWay – Project Progress

Status legend: ✅ implemented **and verified by automated tests** · 🟡 implemented, needs external credentials / real device to verify · ⏳ in progress · ⬜ not started

## Phase 1 – Workspace & infrastructure ✅
- Monorepo: `mobile/`, `backend/`, `admin/`, `infrastructure/`, `docs/`, `scripts/`.
- Docker Compose: PostgreSQL 16 + PostGIS 3.5 (multi-arch image), Redis 7.4; test database `emblemway_test` created by init script.
- Android SDK (platform 36, build-tools 36, NDK 27.1, CMake 3.22.1, emulator + API 35 arm64 image) installed locally.

## Phase 2 – Backend (NestJS 11 · Prisma 6 · PostGIS) ✅
| Area | Status | Verified by |
|---|---|---|
| Schema & migrations (17 required tables + cities, saved_routes, device_tokens, app_settings, idempotency, segment links; GiST, partial unique, CHECK constraints) | ✅ | `platform.int-spec` schema checks, constraint tests |
| OTP auth (hashing, expiry, attempt lock, resend cooldown, hourly caps, replay, concurrent guessing), JWT + rotating refresh tokens with reuse detection, logout / logout-all, suspension, deletion | ✅ | `auth.int-spec` (24 tests) |
| Twilio SMS OTP provider | 🟡 | unit-tested with fake HTTP; needs Twilio credentials for live SMS |
| Journeys: validation, UTC storage, idempotency, optimistic concurrency, route recalculation, state machine, history, expiry, auto-complete, retention | ✅ | `journeys.int-spec` (24), state-machine spec (exhaustive 36 transitions) |
| Google Routes / Places / Geocoding providers (timeouts, retries, circuit breaker, quota, rate limit) | 🟡 | unit-tested against recorded API shapes; **not called live** (no API key available) |
| Route matching engine (PostGIS sampling + overlap analysis + scoring) | ✅ | `overlap.engine.spec`, `match-scoring.spec`, `matching.int-spec` (23 real-geometry tests) |
| Traveller counts (dedup per user, per vehicle, per segment) | ✅ | `matching.int-spec` |
| Traffic prediction (5 scenarios, cache, stale labelling, unsupported, partial failures, recommendation) | ✅ logic / 🟡 live data | `traffic.service.spec`, `recommendation.spec`, `traffic-hotspots.int-spec` |
| Hotspots (journey demand, origin, destination, traffic; vehicle/time filters; history comparison) | ✅ | `traffic-hotspots.int-spec` incl. SQL↔TS grid parity |
| Ride pooling (offer, request, accept/reject, withdraw, no overbooking under concurrency) | ✅ | `ride-pool.int-spec` |
| Notifications (in-app, preferences, dedupe) | ✅ | `platform.int-spec` |
| FCM push delivery | 🟡 | unit-tested with mocked Firebase SDK; needs service-account credentials |
| Admin API with RBAC, audit logs, settings, health | ✅ | `platform.int-spec` |
| Test results | ✅ | **368 tests passing** (unit + integration); combined coverage **91.7 % lines / 90.3 % statements** |

## Phase 3 – Android app (React Native 0.81) ⏳
## Phase 4 – Admin dashboard (Next.js 15) ⬜
## Phase 5 – CI/CD, Docker images, documentation ⬜
