# EmblemWay – System Architecture

EmblemWay is a smart-mobility platform for Pune (expandable to any Indian city). Travellers register
journeys; the platform finds other travellers on the same or overlapping **roads** (not just the same
place names), predicts traffic for five departure times, and aggregates demand and traffic hotspots.

## Components

```
┌──────────────────────┐        HTTPS/JSON (JWT)        ┌───────────────────────────────────────────┐
│ Android app          │ ─────────────────────────────▶ │ EmblemWay API  (NestJS 11, Node 22)        │
│ React Native 0.81    │ ◀───────────────────────────── │  auth · users · vehicles · cities          │
│ • Google Maps SDK    │     FCM push notifications     │  journeys · matching · traffic · hotspots  │
│ • Keystore tokens    │                                │  ride-pool · notifications · admin · health│
└──────────────────────┘                                └──────┬──────────────┬─────────────┬───────┘
                                                               │ Prisma + SQL │ ioredis      │ HTTPS
┌──────────────────────┐  server-side calls only (BFF)  ┌──────▼──────┐ ┌─────▼──────┐ ┌────▼──────────────┐
│ Admin dashboard      │ ─────────────────────────────▶ │ PostgreSQL  │ │ Redis 7    │ │ Google Routes,    │
│ Next.js 15 (RSC)     │  httpOnly session cookies      │ 16+PostGIS  │ │ cache,     │ │ Places (New),     │
│ browser never sees   │                                │ 3.5         │ │ rate limit,│ │ Geocoding · Twilio│
│ a JWT                │                                └─────────────┘ │ BullMQ     │ │ SMS · Firebase FCM│
└──────────────────────┘                                                └────────────┘ └───────────────────┘
```

| Layer | Technology | Responsibility |
|---|---|---|
| Mobile | React Native 0.81 (New Architecture), TypeScript, React Navigation 7, TanStack Query 5, Zustand 5, React Hook Form + Zod, react-native-maps 1.26 | UI, input validation, secure token storage, map display. Holds only an Android-restricted Maps SDK key. |
| API | NestJS 11, Prisma 6, class-validator, Swagger | Source of truth for auth, journeys, matching, counts, traffic, hotspots. |
| Data | PostgreSQL 16 + PostGIS 3.5 | All persistence and every geographic computation (sampling, corridor tests, grid aggregation). |
| Cache / jobs | Redis 7, BullMQ 5 | Traffic cache, Google quota counters, rate limits, background jobs (matching, reminders, expiry, hotspots, retention). |
| Admin | Next.js 15 App Router, Server Components & Server Actions | Statistics, user/journey management, settings, audit, health. |

## Backend modules (`backend/src`)

| Module | Highlights |
|---|---|
| `config` | Zod-validated environment; refuses mock providers, default secrets or disabled throttling in staging/production. |
| `auth` | OTP provider abstraction (Twilio SMS; isolated mock for dev/tests), hashed OTPs, attempt locks, resend cooldown, hourly caps, replay protection; JWT access tokens + rotating refresh tokens with reuse detection; global JWT & role guards. |
| `users`, `vehicles`, `cities`, `saved` | Profile, privacy & notification preferences, avatar upload (content-sniffed), data export, account deletion; backend-driven vehicle categories; cities as data. |
| `maps` | Google Routes / Places / Geocoding providers behind interfaces, with timeouts, retries (exponential backoff + jitter), circuit breaker, Redis-backed daily quota and per-second rate limit. Deterministic mock providers for dev/tests. |
| `journeys` | Validation, UTC storage, idempotent creation, optimistic-locking edits with route recalculation, explicit state machine, history. |
| `matching` | Route-overlap engine (PostGIS sampling + pure TypeScript analysis), scoring, persistence of bidirectional match rows, deduplicated counts. |
| `hotspots` | Route segments (per-road-stretch traveller counts) and three hotspot models aggregated on a metric grid. |
| `traffic` | Five departure scenarios, caching, stale-labelled fallback, honest UNSUPPORTED/UNAVAILABLE results, recommendation. |
| `ride-pool` | Opt-in seat offers/requests with row-locked seat allocation. |
| `notifications` | In-app notifications + FCM push, per-type preferences, de-duplication. |
| `jobs` | BullMQ worker and schedulers; inline fallback when `JOBS_ENABLED=false`. |
| `admin`, `audit`, `health` | RBAC-protected admin API, audit log, liveness/readiness. |

## Key flows

**Journey creation**
1. App sends `POST /journeys` with an `Idempotency-Key` (reused on retries).
2. API validates coordinates, service area, distinct places, departure window, vehicle.
3. Routing provider is called *outside* any DB transaction; geometry is validated.
4. One transaction writes journey + locations (Point) + routes (LineString, SRID 4326) + road segments + audit.
5. A `match` job computes overlaps and mirrors results to the other travellers; notifications are sent.

**Matching read** – `GET /journeys/:id/matches` returns stored results (recomputed when missing or older
than 10 minutes), deduplicated per traveller, with vehicle and match-type counts and a disclaimer.

**Admin** – the browser posts credentials to the Next.js route handler, which logs in to the API and
stores tokens in httpOnly, SameSite=Strict cookies. Middleware refreshes tokens before expiry; pages fetch
data server-side.

## Design principles
- The backend is the single source of truth; the app never touches the database or server API keys.
- Geography is computed in PostGIS with index-driven candidate selection; only bounded candidate sets are measured.
- External providers are interfaces; production refuses mock providers.
- Every response is labelled with its data source (`provider`, `isLiveData`, `freshness`) — nothing is presented as more than it is.
- Counts always describe registered EmblemWay journeys, never total road traffic.
