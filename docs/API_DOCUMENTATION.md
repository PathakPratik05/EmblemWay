# API Documentation

Base URL: `https://<host>/api/v1` (local: `http://localhost:3000/api/v1`).
Interactive OpenAPI (Swagger UI): **`/api/docs`**, JSON: **`/api/docs-json`** (disabled in production unless
`ENABLE_SWAGGER=true`).

## Conventions
- Auth: `Authorization: Bearer <accessToken>` (JWT, 15 min). Refresh with `POST /auth/refresh` (refresh token rotates on
  every use; re-using an old one revokes the session).
- Times: ISO-8601. Requests **must** include an offset (`2026-11-25T09:30:00+05:30`); responses are UTC (`…Z`).
- Errors: `{ "error": { "code": "MACHINE_CODE", "message": "…", "details": {…}, "requestId": "…" } }`.
  Clients branch on `code`. Every response carries `X-Request-Id`.
- Pagination: `?page=1&pageSize=20` (max 100) → `{ items, page, pageSize, total, totalPages, hasNextPage }`.
- Idempotency: `POST /journeys` accepts `Idempotency-Key` (8–64 URL-safe chars). Replays return the original journey with
  `200` and `Idempotent-Replayed: true`; reuse with a different body → `409 IDEMPOTENCY_KEY_REUSED`.
- Rate limits: global 120 req/min/IP plus tighter limits on OTP, login, journey creation and traffic → `429 RATE_LIMITED`
  with `Retry-After`.

## Endpoints

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/otp/request` | `{countryCode:"+91", mobileNumber}` → `{requestId, expiresAt, resendAvailableAt, codeLength}` |
| POST | `/auth/otp/verify` | `{requestId, code, firstName?, lastName?, email?}` → `{tokens, user, isNewUser, profileComplete}`; `422 REGISTRATION_DETAILS_REQUIRED` for unknown numbers without names (code stays valid) |
| POST | `/auth/refresh` | `{refreshToken}` → new token pair |
| POST | `/auth/logout` · `/auth/logout-all` | revoke this device / all devices |
| POST | `/auth/admin/login` | `{email, password}` (admin dashboard) |

### Profile & settings
`GET/PATCH /users/me` · `PATCH /users/me/preferences` · `POST/DELETE /users/me/avatar` (multipart `file`, JPEG/PNG/WebP ≤ 3 MB) ·
`GET /users/me/export` · `GET /users/me/sessions` · `DELETE /users/me/sessions/:id` · `DELETE /users/me` (permanent) ·
`GET/POST/PATCH/DELETE /users/me/vehicles[/:id]` · `GET/POST/DELETE /users/me/saved-places[/:id]` ·
`GET/POST/PATCH/DELETE /users/me/saved-routes[/:id]`

### Reference data (public)
`GET /vehicle-types` · `GET /cities`

### Maps proxy (server holds the Google key)
| Method | Path |
|---|---|
| GET | `/places/autocomplete?input=&sessionToken=&lat=&lng=` |
| GET | `/places/:placeId?sessionToken=` |
| GET | `/places/reverse-geocode?lat=&lng=` |
| POST | `/routes/preview` `{source, destination, pickup?, vehicleTypeCode}` → alternatives with polyline, distance, duration |

### Journeys
| Method | Path | Notes |
|---|---|---|
| POST | `/journeys` | create (`saveAsDraft`, `routeAlternativeIndex` optional) |
| GET | `/journeys?scope=upcoming\|history\|drafts&status=` | own journeys only |
| GET | `/journeys/:id` | detail incl. route polyline |
| PATCH | `/journeys/:id` | `{version, …changes}` – optimistic lock (`409 VERSION_CONFLICT`); route recalculated when places / vehicle change |
| POST | `/journeys/:id/publish` · `/start` · `/complete` · `/cancel` | state machine (`409 INVALID_STATUS_TRANSITION`) |
| GET | `/journeys/:id/matches?vehicleTypes=CAR,BUS&minOverlap=0.5&matchTypes=` | deduplicated travellers + counts + disclaimer |
| GET | `/journeys/:id/segments` | travellers per stretch of the route |

### Traffic
`GET /traffic/journeys/:id/predictions` · `POST /traffic/predictions {source, destination, pickup?, vehicleTypeCode}` →
5 estimates (`NOW`, `PLUS_15/30/45/60_MINUTES`) each with `status` (`OK`/`UNSUPPORTED`/`UNAVAILABLE`), duration, static
duration, delay, arrival, `freshness` (`LIVE`/`CACHED`/`STALE`), plus `recommendation` and `disclaimer`.

### Hotspots
`GET /hotspots?model=JOURNEY_DEMAND|TRAFFIC|ORIGIN|DESTINATION&city=PUNE&vehicleType=&from=&to=&hourFrom=&hourTo=` ·
`GET /hotspots/hourly?…`

### Ride pooling
`POST /journeys/:id/ride-pool/offer {totalSeats}` · `GET /ride-pool/offers/mine` · `GET /ride-pool/requests/mine` ·
`GET/DELETE /ride-pool/offers/:offerId` · `POST /ride-pool/offers/:offerId/requests {journeyId, seats}` ·
`POST /ride-pool/requests/:id/accept|reject|withdraw`

### Notifications
`GET /notifications` · `POST /notifications/:id/read` · `POST /notifications/read-all` · `POST/DELETE /notifications/devices {token}`

### Admin (role ADMIN; maintenance requires SUPER_ADMIN)
`GET /admin/stats/overview|daily|vehicles|cities|popular-routes|traffic` · `GET /admin/hotspots[/hourly]` ·
`GET /admin/users` · `PATCH /admin/users/:id/status` · `GET /admin/journeys` · `POST /admin/journeys/:id/cancel` ·
`GET /admin/settings` · `PATCH /admin/settings/:section` · `GET /admin/audit-logs` · `GET /admin/health` ·
`POST /admin/maintenance/expire-journeys|auto-complete|aggregate-hotspots|retention`

### Health
`GET /health/live` · `GET /health/ready` (503 when PostgreSQL or Redis is down)

## Common error codes
`VALIDATION_FAILED`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_REFRESH_TOKEN`, `REFRESH_TOKEN_REUSED`, `FORBIDDEN`,
`ACCOUNT_SUSPENDED`, `ACCOUNT_DELETED`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INVALID_PHONE_NUMBER`, `OTP_INVALID`,
`OTP_EXPIRED`, `OTP_LOCKED`, `OTP_ALREADY_USED`, `OTP_RESEND_COOLDOWN`, `OTP_SEND_LIMIT`, `OTP_DELIVERY_FAILED`,
`INVALID_COORDINATES`, `OUTSIDE_SERVICE_AREA`, `SAME_SOURCE_DESTINATION`, `DEPARTURE_IN_PAST`, `DEPARTURE_TOO_FAR`,
`INVALID_VEHICLE_TYPE`, `INVALID_STATUS_TRANSITION`, `JOURNEY_NOT_EDITABLE`, `VERSION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`,
`IDEMPOTENCY_IN_PROGRESS`, `ROUTE_NOT_FOUND`, `ROUTE_GEOMETRY_INVALID`, `MAPS_PROVIDER_UNAVAILABLE`, `MAPS_QUOTA_EXCEEDED`,
`MAPS_REQUEST_REJECTED`, `POOL_NOT_ELIGIBLE`, `POOL_FULL`, `POOL_REQUEST_INVALID`, `UPLOAD_INVALID`,
`DATABASE_UNAVAILABLE`, `INTERNAL_ERROR`.
