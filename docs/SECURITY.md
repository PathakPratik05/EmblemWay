# Security & Privacy

## Authentication
- **Passwordless OTP** for travellers: 6-digit codes from a CSPRNG, stored only as `HMAC-SHA256(pepper, requestId:code)`,
  compared in constant time, 5-minute expiry, **5 attempts then locked** (atomic, safe under concurrent guessing), 60 s
  resend cooldown, max 5 sends/number/hour and 30/IP/hour, max 10 failed verifications/number/hour across codes, a newer
  code supersedes older ones, codes are single-use (atomic consume → **no replay**). Requesting a code never reveals
  whether an account exists.
- **Tokens**: 15-minute HS256 JWT access tokens (issuer/audience checked) + opaque 384-bit refresh tokens stored as HMAC
  hashes, **rotated on every refresh**; re-use of a rotated token revokes the whole session family. Every request checks
  the session row, so logout, suspension and deletion take effect immediately.
- **Admins** use email + password (scrypt, N=16384) with timing-equalised failure paths; failed logins are audited.
- **Android**: tokens stored in the Android Keystore-backed keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), never in
  AsyncStorage or logs; concurrent 401s trigger a single refresh; offline refresh failures don't sign the user out.
- **Admin dashboard**: Backend-for-Frontend — tokens live in `httpOnly`, `SameSite=Strict`, `Secure` cookies; browser
  JavaScript never sees them. Middleware refreshes before expiry; server actions are protected by Next.js origin checks.

## Authorization
Global JWT guard (opt-out via `@Public()`), global role guard with hierarchy `SUPER_ADMIN ⊃ ADMIN ⊃ USER`. All
`/admin/*` routes require `ADMIN`; maintenance tasks require `SUPER_ADMIN`; only a SUPER_ADMIN may change other admins.
Every user resource is scoped by `userId` in the query (other users' journeys return 404). Tested in
`platform.int-spec.ts` and `roles.guard.spec.ts`.

## Input & transport
- DTO validation with whitelist + forbid unknown fields; Zod on the mobile client; all SQL parameterised (Prisma tagged
  templates — no string concatenation of user input); 256 KB JSON limit; avatar uploads checked by **magic bytes**, size
  limited, stored under random UUID names.
- Helmet security headers (CSP, HSTS in production, no `X-Powered-By`); admin CSP `default-src 'self'`,
  `frame-ancestors 'none'`; React escaping for all rendered data.
- CORS allow-list; per-IP throttling (global + tighter on auth, journeys, traffic); request IDs on every response.
- Android: HTTPS only, cleartext permitted solely for `10.0.2.2`/`localhost` (emulator development & Detox).

## Secrets
Never committed (`.gitignore`, `.dockerignore`); validated at start-up; production refuses default secrets, mock providers
and disabled throttling. The Google **server** key stays on the backend; the app holds only an Android-restricted Maps
SDK key. Release signing material is injected by CI secrets.

## Privacy by design
- Other travellers see only first name (or "EmblemWay traveller"), vehicle type, departure time, distances and the shared
  stretch of *your own* route — never phone numbers, exact addresses or their full routes.
- Matching is opt-out (`shareJourneysForMatching`); opting out removes the user from all stored results immediately.
- Location is requested only on explicit user action; location consent is recorded.
- Logs redact `Authorization`, cookies, OTP codes, refresh tokens, passwords and lat/lng query parameters; audit metadata
  redacts keys matching otp/code/token/password/secret/latitude/longitude/phone.
- Counts and heatmaps are aggregates of registered journeys and are labelled as such.

## India – Digital Personal Data Protection Act, 2023 (DPDP) considerations
| Obligation | Implementation / action |
|---|---|
| Lawful purpose & notice | Purpose shown at registration and in the location prompt. **Action**: publish a privacy notice (in English and the languages of your users) before launch. |
| Consent & withdrawal | Location consent recorded and revocable; matching opt-out; notification preferences. |
| Data minimisation | Only names, mobile, optional email, journeys and preferences; no contacts, no background location, no exact addresses shown to others. |
| Accuracy & correction | Profile editing in app. |
| Right to access | `GET /users/me/export` (machine-readable). |
| Right to erasure | `DELETE /users/me` deletes journeys, locations, routes, matches, devices, notifications; anonymises the user row. |
| Storage limitation | Location data purged after `LOCATION_RETENTION_DAYS` (180); OTPs 1 day; snapshots 30 days. |
| Security safeguards | As above; encrypt disks/backups at rest; restrict DB network access. |
| Breach notification | **Action**: incident runbook to notify the Data Protection Board and affected users without delay. |
| Grievance redressal | **Action**: designate a grievance officer / contact in the app and privacy notice. |
| Children | **Action**: decide minimum age; verifiable parental consent is required for under-18 users under DPDP. |
| Cross-border transfer | Google/Twilio/Firebase process data outside India — **Action**: review against notified restrictions and disclose processors. |
| SMS rules | Use a TRAI DLT-registered sender ID and OTP template when sending SMS in India. |

This is an engineering summary, not legal advice; have counsel review before launch.
