# Environment Configuration

Templates: `backend/.env.example`, `backend/.env.test.example`, `admin/.env.example`. Copy to `.env` / `.env.test` /
`.env.local`. Real values belong in a secret manager (or GitHub Actions secrets) — `.env*` files are git-ignored and
excluded from Docker images. The backend **validates configuration at start-up** and exits with a list of problems.

## Backend
| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | development | `development`, `test`, `staging`, `production` |
| `PORT`, `API_PREFIX` | 3000, `api/v1` | |
| `LOG_LEVEL` | info | `silent` in tests |
| `CORS_ORIGINS` | – | comma-separated browser origins (the admin uses server-side calls, so usually empty in production) |
| `PUBLIC_BASE_URL` | http://localhost:3000 | used to build avatar URLs |
| `DATABASE_URL` | – | PostgreSQL with PostGIS; add `connection_limit=20` (pool size) |
| `REDIS_URL` | – | cache, quotas, BullMQ |
| `JWT_ACCESS_SECRET` | – | ≥ 32 chars (`openssl rand -base64 48`); default value refused in production |
| `JWT_ACCESS_TTL_SECONDS` | 900 | |
| `REFRESH_TOKEN_TTL_DAYS` | 30 | sliding session lifetime |
| `HASH_PEPPER` | – | ≥ 32 chars; HMAC pepper for OTP and refresh-token hashes. Rotating it invalidates outstanding OTPs and sessions. |
| `OTP_PROVIDER` | mock | `twilio` in production (`mock` refused) |
| `OTP_LENGTH`, `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS` | 6, 300, 5, 60 | |
| `OTP_MAX_SENDS_PER_HOUR`, `OTP_MAX_SENDS_PER_IP_PER_HOUR` | 5, 30 | |
| `MOCK_OTP_CODE` | 123456 | development/test only |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | – | required when `OTP_PROVIDER=twilio` (use a DLT-registered sender/template for India) |
| `MAPS_PROVIDER` | mock | `google` in production (`mock` refused) |
| `GOOGLE_MAPS_SERVER_API_KEY` | – | see GOOGLE_MAPS_SETUP.md |
| `GOOGLE_API_TIMEOUT_MS`, `GOOGLE_API_MAX_RETRIES` | 8000, 2 | |
| `GOOGLE_ROUTES_DAILY_QUOTA`, `GOOGLE_ROUTES_MAX_RPS` | 5000, 10 | cost guard |
| `TRAFFIC_CACHE_TTL_SECONDS` | 300 | |
| `PUSH_PROVIDER` | none | `fcm` to send push |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | – | base64 of the service-account JSON |
| `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` | – | first SUPER_ADMIN created by `npm run db:seed` (only if missing) |
| `UPLOAD_DIR`, `MAX_UPLOAD_BYTES` | ./uploads, 3 MB | mount a persistent volume in production |
| `JOBS_ENABLED` | true | `false` runs work inline (tests) |
| `LOCATION_RETENTION_DAYS` | 180 | |
| `THROTTLE_ENABLED` | true | may only be `false` in tests |
| `ENABLE_SWAGGER` | – | `true` to expose /api/docs in production |
| `RUN_MIGRATIONS`, `RUN_SEED` | false | Docker entrypoint flags |

## Admin dashboard
| Variable | Notes |
|---|---|
| `ADMIN_API_BASE_URL` | Server-side URL of the API (e.g. `http://backend:3000/api/v1` inside Docker) |
| `ADMIN_SECURE_COOKIES` | `true` behind HTTPS (always on when `NODE_ENV=production`) |

## Mobile (build time)
`EMBLEMWAY_API_URL`, `EMBLEMWAY_MAPS_API_KEY`, `EMBLEMWAY_UPLOAD_*`, `EMBLEMWAY_VERSION_CODE`, optional
`android/app/google-services.json` — see ANDROID_SETUP.md.

## Runtime-tunable settings (admin dashboard → Settings)
Stored in `app_settings`, validated by Zod, cached 30 s, audited.
- **matching**: `minSharedDistanceMeters` 2000, `minOverlapRatio` 0.3, `departureWindowMinutes` 30,
  `corridorWidthMeters` 60, `pickupProximityMeters` 5000, `requirePickupProximity` false,
  `destinationProximityMeters` 2000, `minDirectionSimilarity` 0.5, `sameRouteOverlapRatio` 0.85, sampling limits, `maxCandidates` 300.
- **hotspots**: `cellSizeMeters` 1000, `segmentCellSizeMeters` 500, `bucketMinutes` 60, `lookbackDays` 14.
- **traffic**: `significantImprovementMinutes` 3, `significantImprovementRatio` 0.05, `staleAfterMinutes` 15, `alertDelayRatio` 0.3.
- **journeys**: `pastDepartureGraceMinutes` 5, `maxScheduleDaysAhead` 90, `expiryGraceMinutes` 120, auto-complete factors, `reminderLeadMinutes` 30.
