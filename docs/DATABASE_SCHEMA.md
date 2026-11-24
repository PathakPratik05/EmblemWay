# Database Schema (PostgreSQL 16 + PostGIS 3.5)

Source of truth: `backend/prisma/schema.prisma` and `backend/prisma/migrations/*`.
Conventions: UUID primary keys generated in the database (`gen_random_uuid()`), snake_case, every timestamp is
`timestamptz` stored in **UTC** (the app displays Asia/Kolkata). Geometry uses **SRID 4326**; distances use the
`geography` type (spheroidal metres).

## Tables

| Table | Purpose | Notable constraints / indexes |
|---|---|---|
| `users` | Account (role `USER`/`ADMIN`/`SUPER_ADMIN`, status, names, E.164 phone, admin password hash) | partial unique phone among non-deleted users; partial unique lower(email); CHECK E.164 format; CHECK deleted ⇒ anonymised |
| `user_profiles` | Preferred city, default vehicle, privacy & notification preferences, location consent, avatar path | 1:1 with users |
| `user_sessions` | Refresh-token sessions (hash only), rotation chain (`replaced_by_id`), family, device, expiry, revocation | unique token hash; idx user, family, expiry |
| `otp_verifications` | OTP challenges: HMAC hash (never the code), attempts, expiry, resend time, consumed / locked / superseded | CHECK attempts ≤ max; idx (phone, created), (ip, created) |
| `device_tokens` | FCM tokens per device | unique token |
| `cities` | Pune (active), Mumbai, Bengaluru (inactive) – centre, radius, timezone | CHECK coordinates |
| `vehicle_types` | 11 configurable categories, routing profile, traffic support, approximation note, pooling eligibility | unique code |
| `user_vehicles` | A user's saved vehicles | partial unique default vehicle per user |
| `journeys` | Status, purpose, departure (UTC), timezone, version (optimistic lock), idempotency key, lifecycle timestamps | unique (user, idempotency_key); CHECK cancelled ⇒ cancelled_at, completed ⇒ completed_at; idx (status, departure), (user, status, departure), (city, departure) |
| `journey_locations` | SOURCE / DESTINATION / PICKUP with name, address, place id, lat/lng and `geometry(Point,4326)` | unique (journey, kind); GiST on geom and geom::geography; CHECK valid geometry |
| `journey_routes` | Selected route + alternatives: encoded polyline, `geometry(LineString,4326)`, distance, duration, static duration | partial unique selected route per journey; GiST on geom; partial GiST on geom::geography; CHECK ≥ 2 points, SRID 4326, length > 0 |
| `journey_matches` | Bidirectional match results: type, shared distance, both overlap ratios, direction, time differences, pickup/destination distance, score, confidence, common segment | unique pair; CHECK not self; CHECK ratio/score ranges |
| `route_segments` | Metric grid cells (500 m) used as "stretches of road" | unique cell_key; GiST on polygon |
| `journey_route_segments` | Ordered cells each journey passes through | PK (journey, segment) |
| `traffic_snapshots` | Every provider estimate (or failure): scenario offset, durations, distance, speed intervals (JSON), provider, error | idx (route_key, fetched_at) |
| `hotspot_aggregations` | Per model (`JOURNEY_DEMAND`, `TRAFFIC`, `ORIGIN`, `DESTINATION`), cell, time bucket and vehicle: journey count, distinct users, congestion index | unique (model, cell, bucket, interval, vehicle); CHECK ranges |
| `ride_pool_offers` | Seats offered on a journey | CHECK 0 ≤ available ≤ total |
| `ride_pool_requests` | Seat requests | partial unique open request per (offer, user) |
| `ride_pool_members` | Accepted members | unique request |
| `notifications` | In-app notifications + push status | unique (user, dedupe_key) |
| `saved_places`, `saved_routes` | Frequently used places / routes | CHECK coordinates, HH:mm |
| `app_settings` | Admin-tunable thresholds (JSON per section) | PK key |
| `idempotency_records` | Idempotency keys with request hash and result | unique (user, scope, key) |
| `audit_logs` | Security & admin actions (sensitive metadata redacted) | idx (action, created), (actor, created) |

SQL function `emblemway_grid_cell(lat, lng, size_m)` (migration `20261124010000`) maps a point to the same metric grid
cell as `gridCellFor()` in TypeScript; parity is verified by an integration test.

## Migrations

```bash
cd backend
npx prisma migrate deploy          # apply (dev / CI / production)
npx prisma migrate dev --name x    # create a new migration during development
npm run db:seed                    # reference data: cities, vehicle types, bootstrap admin (idempotent)
```

Migrations: `…000000_init` (schema + hand-written partial indexes, GiST indexes, CHECK constraints),
`…010000_grid_cell_function`, `…020000_db_uuid_defaults`.

## Transactions & concurrency
- Multi-row writes (journey creation/update, matching persistence, ride-pool seat allocation, account deletion) run in
  transactions with automatic retry on deadlock / serialization failure (`PrismaService.withTransaction`).
- State changes are conditional UPDATEs (e.g. `WHERE status IN (...)`, `WHERE version = $v`), so concurrent requests
  cannot both win. Seat allocation locks the offer row (`SELECT … FOR UPDATE`).

## Data retention (applied daily at 03:00 IST)

| Data | Retention |
|---|---|
| Exact locations & route geometry of completed / cancelled / expired journeys | `LOCATION_RETENTION_DAYS` (default 180); the journey row remains for history with `locations_purged_at` |
| OTP records | 1 day |
| Traffic snapshots | 30 days |
| Expired / revoked sessions | 7 / 30 days |
| Idempotency records | 24 h |
| Hotspot aggregates | kept (no personal data) |

Account deletion removes all journeys, locations, routes, matches, saved data, devices and notifications immediately;
the user row is anonymised (no name, phone or email) so audit references remain valid.
