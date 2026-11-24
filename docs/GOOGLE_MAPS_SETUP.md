# Google Maps Platform Setup

EmblemWay uses **two separate keys**. Never put the server key in the app, and never commit either key.

| Key | Used by | APIs to enable | Restriction |
|---|---|---|---|
| **Android SDK key** | Mobile app (map display only) | Maps SDK for Android | *Android apps*: package `com.emblemway.app` + your SHA-1 fingerprints (debug and release/upload) |
| **Server key** | Backend | Routes API, Places API (New), Geocoding API | *IP addresses*: your API servers' egress IPs; *API restrictions*: only the three APIs |

The app never calls Places, Routes or Geocoding directly — the backend proxies them (`/places/*`, `/routes/preview`,
`/traffic/*`), so the server key stays on the server and usage is quota-controlled.

## 1. Create the project & keys
1. Google Cloud Console → create/select a project → **Billing** enabled (required by Maps Platform).
2. APIs & Services → Library → enable **Maps SDK for Android**, **Routes API**, **Places API (New)**, **Geocoding API**.
3. Credentials → Create credentials → API key (twice) and apply the restrictions above.
4. Set **quotas/budget alerts** (APIs & Services → Quotas; Billing → Budgets).

## 2. SHA-1 fingerprints for the Android key
```bash
# Debug keystore used by local builds
keytool -list -v -keystore mobile/android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android | grep SHA1
# Upload keystore (release)
keytool -list -v -keystore /path/to/upload.keystore -alias <alias> | grep SHA1
```
With Play App Signing, also add the **app signing key** SHA-1 from Play Console → Setup → App integrity.

## 3. Configure the Android key
Any one of (checked in this order):
```bash
./gradlew assembleRelease -PEMBLEMWAY_MAPS_API_KEY=AIza...           # Gradle property
export EMBLEMWAY_MAPS_API_KEY=AIza...                                # environment variable (CI secret)
echo "EMBLEMWAY_MAPS_API_KEY=AIza..." >> mobile/android/local.properties   # local file (git-ignored)
```
It is injected into `AndroidManifest.xml` (`com.google.android.geo.API_KEY`) via a manifest placeholder.
**Without a key the app runs, but map tiles render blank/black** (routes, distances and all other features still work).

## 4. Configure the server key
In `backend/.env` (or your secret manager):
```
MAPS_PROVIDER=google
GOOGLE_MAPS_SERVER_API_KEY=AIza...
GOOGLE_ROUTES_DAILY_QUOTA=5000
GOOGLE_ROUTES_MAX_RPS=10
```
`MAPS_PROVIDER=mock` (development only) uses a deterministic simulator and a small Pune gazetteer; it is refused in
staging/production.

## 5. Verify
```bash
curl -s -X POST localhost:3000/api/v1/routes/preview -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"source":{"latitude":18.5912,"longitude":73.7389},"destination":{"latitude":18.5515,"longitude":73.9348},"vehicleTypeCode":"CAR"}' | jq '.provider,.isLiveData,.routes[0].distanceMeters'
```
Expect `"google"`, `true` and a realistic distance. `GET /admin/health` shows the provider and today's request counts.

## Cost notes
- Routes API with traffic (`TRAFFIC_AWARE_OPTIMAL`) is billed at the advanced tier; five scenarios = five requests,
  cached for 5 minutes per route.
- Places Autocomplete uses session tokens (one per search screen) so a search + details is billed as a session.
