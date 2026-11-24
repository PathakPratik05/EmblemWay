# Traffic Prediction

Code: `backend/src/traffic/` · Provider: Google **Routes API** (`directions/v2:computeRoutes`).

## Scenarios
`NOW`, `PLUS_15_MINUTES`, `PLUS_30_MINUTES`, `PLUS_45_MINUTES`, `PLUS_60_MINUTES`. For each scenario the API:

1. computes the departure timestamp (`now + offset`; "now" is sent **without** `departureTime`, future scenarios add 30 s
   headroom so the timestamp is still in the future on arrival — the Routes API rejects past times);
2. requests a route with `routingPreference: TRAFFIC_AWARE_OPTIMAL`, `travelMode` from the vehicle category
   (`DRIVE` / `TWO_WHEELER`), and `extraComputations: TRAFFIC_ON_POLYLINE` for "now";
3. reads `duration` (traffic-aware) and `staticDuration` (no traffic) → **delay = duration − staticDuration**;
4. computes arrival = departure + duration;
5. stores a `traffic_snapshots` row (success or failure, with timestamp and provider);
6. caches the result in Redis for `TRAFFIC_CACHE_TTL_SECONDS` (default 300 s) keyed by route (~11 m rounding), profile,
   offset and 5-minute departure bucket.

All five requests run in parallel; each scenario fails independently (**partial results** are normal).

## Honesty rules
| Situation | Result |
|---|---|
| Fresh provider result | `status: OK`, `freshness: LIVE` |
| Served from cache | `freshness: CACHED` (never reported as live) |
| Provider down / quota / timeout and a snapshot < 6 h old exists | `status: OK`, `freshness: STALE`, reason "Live traffic is temporarily unavailable; showing the last known estimate." Stale estimates are **never** used to recommend a change. |
| Provider down and no snapshot | `status: UNAVAILABLE`, `durationSeconds: null`, human reason (quota, timeout, outage) |
| Vehicle without traffic-aware routing (Bicycle) | `status: UNSUPPORTED`, no numbers, no provider call |
| Approximated vehicles (Auto rickshaw, Bus, Truck, Other use car routing) | estimates returned with `approximationNote` |
| Development (`MAPS_PROVIDER=mock`) | `provider: "mock"`, `isLiveData: false`; the app shows "development traffic simulator" |

Every response includes: *"Future travel times are predictions based on typical and current traffic. They are not
guaranteed and actual conditions may differ."*

## Recommendation
Among usable (OK, non-stale) estimates, the fastest is compared with leaving now. A later departure is recommended only if
it saves **≥ max(3 min, 5 % of the leave-now duration)** (both configurable). Otherwise the message explicitly says that
travel times are similar and the user can leave when convenient. If "now" is unavailable, the fastest available option is
named but not marked significant.

## Resilience & cost control
- Per-attempt timeout (`GOOGLE_API_TIMEOUT_MS`, 8 s), retries with exponential backoff + full jitter for 5xx/timeouts only
  (`GOOGLE_API_MAX_RETRIES`, 2), never for 4xx.
- Circuit breaker: 5 consecutive failures open the circuit for 30 s (fail fast), then one trial request.
- Redis-backed daily quota (`GOOGLE_ROUTES_DAILY_QUOTA`) and per-second rate limit (`GOOGLE_ROUTES_MAX_RPS`) shared across
  instances; if Redis is down the guard fails open and logs an error.
- API endpoints are additionally rate-limited per IP (12 predictions/min).
- Traffic reminders: 30 min before departure the reminder job checks "now"; if the delay exceeds `alertDelayRatio`
  (default 30 % over free flow) a `TRAFFIC_ALERT` notification is sent.

## Traffic hotspots
Speed-reading intervals (`NORMAL` = 0, `SLOW` = 0.5, `TRAFFIC_JAM` = 1) from "now" requests are sampled every 200 m and
aggregated into 1 km cells as a congestion index (0–1). Coverage is limited to routes requested in EmblemWay; the
dashboard and app say so.
