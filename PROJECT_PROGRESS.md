# EmblemWay – Project Progress

Legend: ✅ implemented **and verified** · 🟡 implemented, needs external credentials or real-device verification

## Definition of done
| Item | Status | Evidence |
|---|---|---|
| Android project builds (debug APK, release APK, release AAB) | ✅ | Gradle builds succeed; AAB is debug-signed until an upload keystore is configured |
| User registration, OTP auth with mock provider | ✅ | `auth.int-spec` (24), Detox E2E |
| OTP via real SMS (Twilio) | 🟡 | provider unit-tested with fake HTTP; needs Twilio credentials |
| User data persists in PostgreSQL | ✅ | integration tests |
| Google Maps renders on Android | 🟡 | MapView integrated & runs; **tiles need an Android Maps key** (verified black map without key, no crash) |
| Location autocomplete / source, destination, pickup selection | ✅ (mock gazetteer) / 🟡 (Google Places live) | Detox E2E, screen tests |
| Journeys persist; route polylines generated & stored (PostGIS LineString 4326) | ✅ | `journeys.int-spec` |
| Spatial route matching, partial overlap, opposite-direction rejection, dedup, vehicle-wise counts | ✅ | 23 real-geometry integration tests + unit tests |
| Traffic estimates for 5 scenarios, honest unsupported/unavailable/stale handling | ✅ logic / 🟡 live Google traffic | unit + integration tests, Detox |
| Hotspot aggregation (demand, traffic, origin, destination) | ✅ | `traffic-hotspots.int-spec` |
| Upcoming journeys, history, cancellation | ✅ | integration + Detox |
| Notifications (in-app) / push (FCM) | ✅ / 🟡 | push needs Firebase project + `google-services.json` |
| Ride pooling (no overbooking under concurrency) | ✅ | `ride-pool.int-spec` |
| Admin dashboard (RBAC, stats, users, journeys, hotspots, settings, audit, health) | ✅ | 37 admin tests + live smoke test against API |
| Authorization & privacy controls | ✅ | platform/auth integration tests |
| Migrations execute | ✅ | test DB, dev DB, and inside Docker container |
| Backend unit / integration tests | ✅ | 264 + 104 passing; 91.7 % lines combined |
| Mobile unit tests | ✅ | 116 passing; 85.6 % lines |
| Android E2E (Detox, API 35 emulator, release build) | ✅ | 9/9 passing |
| Type checking / linting | ✅ | backend, mobile, admin clean |
| Docker images | ✅ | both build; full stack runs via compose (non-root) |
| Documentation | ✅ | README + 12 docs in `docs/` |
| Matching performance benchmark | ✅ | 2,000 journeys: p50 ~1.0 s, p95 ~1.4 s, GiST index used |

## Requires real-device / credential verification
Google map tiles, live Places/Routes/traffic, Twilio SMS, FCM push delivery, signed Play Store AAB, behaviour on physical
devices (GPS accuracy, OEM battery restrictions on notifications).
