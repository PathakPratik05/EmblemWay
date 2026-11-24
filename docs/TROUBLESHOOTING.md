# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| API exits with `Invalid environment configuration` | Missing/invalid variable, or mock provider / default secret in staging-production | Read the listed fields; see ENVIRONMENT_CONFIGURATION.md |
| `function make_interval(mins => bigint) does not exist` (custom SQL) | Prisma binds JS numbers as `bigint` | Cast parameters: `${n}::int` |
| Port 5432 already in use | Local PostgreSQL running | Docker PostGIS is mapped to **5433** by default (`POSTGRES_HOST_PORT`) |
| PostGIS container slow on Apple Silicon | amd64 image emulated | Default `imresamu/postgis` image is multi-arch; on amd64 you may use `POSTGIS_IMAGE=postgis/postgis:16-3.5` |
| Integration tests refuse to start | `DATABASE_URL` in `.env.test` does not point at a `_test` database | Fix `.env.test` (safety check) |
| Integration tests hang | An interrupted run still holds locks on the test DB | `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='emblemway_test' AND pid <> pg_backend_pid();` |
| `429 RATE_LIMITED` / `OTP_SEND_LIMIT` in development | Throttling and per-IP OTP caps | Wait, or locally set `THROTTLE_ENABLED=false` and raise `OTP_MAX_SENDS_PER_IP_PER_HOUR` |
| OTP never arrives (production) | Twilio credentials / unregistered DLT sender | Check logs for `OTP delivery … failed`; register DLT sender & template |
| Map is blank/black in the app | Missing/incorrect Android Maps key or SHA-1 restriction | See GOOGLE_MAPS_SETUP.md; `adb logcat | grep -i "Google Maps"` shows "Authorization failure" |
| App says "You appear to be offline" on emulator | API not reachable at `10.0.2.2:3000` | Start the backend; physical devices need `EMBLEMWAY_API_URL` with your LAN IP |
| Traffic shows "development traffic simulator" | `MAPS_PROVIDER=mock` | Configure the Google server key |
| Traffic estimates `UNAVAILABLE` (quota) | `GOOGLE_ROUTES_DAILY_QUOTA` reached or Google 429 | Raise quota/budget; check `/admin/health` usage |
| Push notifications not received | No `google-services.json` or `PUSH_PROVIDER=none` | Notifications stay in-app (`pushStatus: SKIPPED`); configure FCM on both sides |
| Gradle wrapper download times out | JVM network/IPv6 issue | `export JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true` or pre-download the distribution |
| Release build warns "signed with the DEBUG key" | Upload keystore variables not set | Set `EMBLEMWAY_UPLOAD_*`; never publish debug-signed builds |
| Detox cannot find the emulator | AVD name differs | `EMBLEMWAY_AVD=<name> npm run e2e:test` |
| Admin redirects to login repeatedly | `Secure` cookies over plain HTTP | Use HTTPS, or `ADMIN_SECURE_COOKIES=false` with non-production `NODE_ENV` locally |
| Admin pages show "API is not reachable" | Wrong `ADMIN_API_BASE_URL` | Inside Docker use `http://backend:3000/api/v1` |
| Hotspot maps empty | Aggregation hasn't run yet | Runs hourly; or admin → Hotspots → "Re-aggregate now" (super admin) |
