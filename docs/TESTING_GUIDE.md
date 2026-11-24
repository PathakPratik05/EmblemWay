# Testing Guide

| Suite | Location | Command | Needs |
|---|---|---|---|
| Backend unit | `backend/src/**/*.spec.ts` | `npm test` | nothing |
| Backend integration | `backend/test/integration/*.int-spec.ts` | `npm run test:integration` | PostgreSQL/PostGIS + Redis (docker compose); uses `emblemway_test` |
| Backend combined coverage | both | `npm run test:coverage` (fails below 80 % lines/statements) | as above |
| Matching benchmark | `backend/scripts/benchmark-matching.ts` | `npx dotenv -e .env.test -- npm run benchmark:matching` | test DB (wiped) |
| Mobile unit + screens | `mobile/__tests__/**` | `npm test` / `npm run test:cov` | nothing |
| Android E2E | `mobile/e2e/*.e2e.ts` | `npm run e2e:build && npm run e2e:test` | emulator `EmblemWay_API_35`, backend running with mock OTP |
| Admin | `admin/__tests__/**` | `npm test` | nothing |
| Everything except E2E | – | `scripts/test-all.sh` | docker infra |

## Principles
- **Integration tests never mock the database.** They boot the real Nest application (same bootstrap as production) on
  an ephemeral port and use real PostgreSQL/PostGIS and Redis; `global-setup` applies migrations and seed data and refuses
  to run unless the URL points at a `_test` database. Each test truncates user data.
- Only true externals are replaced, through their interfaces: OTP delivery (isolated mock provider with code `123456`),
  Google Maps (deterministic mock routing / gazetteer, or a switchable failing provider for outage tests), FCM (mocked SDK
  in unit tests, `PUSH_PROVIDER=none` in integration).
- Geometry edge cases are tested with **hand-constructed road shapes** inserted directly into PostGIS
  (`test/utils/geometry-fixtures.ts`), so expectations are exact and independent of any provider.
- Assertions check results (distances, ratios, counts, stored rows, HTTP codes, error codes), not just execution.

## Results at delivery (all passing)
| Suite | Tests | Coverage |
|---|---|---|
| Backend unit | 264 | – |
| Backend integration (real PostGIS) | 104 | – |
| Backend combined | 368 | **91.7 % lines, 90.3 % statements** |
| Mobile (Jest + RNTL) | 116 | **85.6 % lines** |
| Admin (Jest + RTL) | 37 | **83.4 % lines** |
| Android E2E (Detox, emulator API 35, release build) | 9 | register → OTP → profile → plan via search → map planner → save → matches → traffic (5 scenarios) → cancel → history → logout → login; invalid number; wrong OTP |

Critical paths with exhaustive coverage: all 36 journey state transitions; OTP expiry / lock / replay / cooldown /
send-limit / concurrent guessing; refresh rotation & reuse; matching edge cases listed in ROUTE_MATCHING_ALGORITHM.md.

## Running integration tests locally
```bash
docker compose -f infrastructure/docker-compose.yml up -d postgres redis
cd backend && cp -n .env.test.example .env.test
npm run test:integration
```
