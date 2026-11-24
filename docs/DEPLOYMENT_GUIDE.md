# Deployment Guide

## Environments
| Environment | Purpose | Providers |
|---|---|---|
| Local | development | `OTP_PROVIDER=mock`, `MAPS_PROVIDER=mock` allowed |
| Test / CI | automated tests | mock providers, `emblemway_test` database, `JOBS_ENABLED=false` |
| Staging | release candidates (`v1.2.3-rc.N` tags) | real Twilio / Google / FCM test projects; mock providers refused |
| Production | `v1.2.3` tags + environment approval | real providers, HTTPS only |

## Infrastructure requirements
- PostgreSQL 16 with PostGIS ≥ 3.4 (managed: AWS RDS / Aurora PostgreSQL, Google Cloud SQL, Azure Flexible Server — all
  support PostGIS). Enable automated backups and point-in-time recovery; encrypt at rest.
- Redis 7 (managed ElastiCache / Memorystore) with `maxmemory-policy noeviction` (BullMQ requirement).
- Container runtime for two images (ECS/Fargate, Cloud Run, Kubernetes, …) behind HTTPS (TLS terminated at the load
  balancer). The API trusts one proxy hop (`trust proxy`) for client IPs used by rate limits.
- Persistent volume or object storage mount for `UPLOAD_DIR` (avatars).
- Secrets in a secret manager, injected as environment variables.

## Images
```bash
docker build -t emblemway-backend:1.0.0 backend
docker build -t emblemway-admin:1.0.0 admin
```
Both run as a non-root user, contain no secrets, and expose health checks (`/api/v1/health/live`, `/login`). The CI
`deploy.yml` workflow publishes `ghcr.io/<owner>/emblemway-backend|admin:<tag>` on version tags.

## Release procedure
1. Tag: `git tag v1.2.0-rc.1 && git push --tags` → images + AAB built, staging deploy job runs.
2. **Migrations once per release, before rolling out new API instances:**
   ```bash
   docker run --rm --env-file prod.env -e RUN_MIGRATIONS=true -e RUN_SEED=true emblemway-backend:1.2.0 true
   ```
   (`RUN_SEED` is idempotent: cities, vehicle categories, bootstrap admin if missing.) Migrations are forward-only and
   additive; take a database snapshot before applying.
3. Roll out the API (≥ 2 instances; readiness probe `/api/v1/health/ready`), then the admin dashboard
   (`ADMIN_API_BASE_URL` pointing at the API's internal URL, `ADMIN_SECURE_COOKIES=true`).
4. Background jobs run inside API instances (BullMQ, concurrency 4). Repeatable schedules are de-duplicated in Redis, so
   multiple instances are safe.
5. Smoke test: `/health/ready`, admin login, `POST /routes/preview` returns `provider: google`, a test OTP is received.
6. Promote with a `v1.2.0` tag (requires approval on the `production` GitHub environment).

## Local "production-like" stack
```bash
cp backend/.env.example backend/.env       # edit as needed
docker compose -f infrastructure/docker-compose.yml --profile app up -d --build
# API http://localhost:3000/api/v1 · Swagger http://localhost:3000/api/docs · Admin http://localhost:3001
```

## Android release
1. Configure secrets: `EMBLEMWAY_MAPS_API_KEY`, `EMBLEMWAY_UPLOAD_KEYSTORE_BASE64`, `EMBLEMWAY_UPLOAD_STORE_PASSWORD`,
   `EMBLEMWAY_UPLOAD_KEY_ALIAS`, `EMBLEMWAY_UPLOAD_KEY_PASSWORD`, and repository variable `EMBLEMWAY_API_URL`.
2. Add `google-services.json` for the production Firebase project (CI secret written to `mobile/android/app/`).
3. The tag workflow produces the signed `app-release.aab`; upload to Play Console (internal testing first). Enable Play App
   Signing and add its SHA-1 to the Android Maps key restriction.

## Monitoring
- Structured JSON logs (pino) with request IDs and user IDs (no tokens, OTPs or coordinates).
- Alerts: readiness failures, 5xx rate, traffic provider failure rate (`/admin/stats/traffic`), BullMQ failed jobs
  (`/admin/health`), Google daily usage vs quota, PostgreSQL slow queries (`log_min_duration_statement=500`).
- Error tracking: every 5xx is logged with stack and request ID in `backend/src/common/filters/all-exceptions.filter.ts`
  — the integration point for Sentry/OpenTelemetry.

## Rollback
Redeploy the previous image tag. Migrations are additive, so the previous version runs against the newer schema; restore
the pre-release snapshot only if a migration itself was faulty.
