# Android Setup (EmblemWay app)

App id **`com.emblemway.app`**, display name **EmblemWay**, React Native **0.81.6** (New Architecture, Hermes),
min SDK 24 (Android 7.0), target/compile SDK 36.

## Prerequisites
- Node.js ≥ 20.19 (22 LTS recommended), JDK 17 or 21.
- Android SDK: Platform 36, Build-Tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1, Platform-Tools, Emulator.
  ```bash
  sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1" \
             "emulator" "system-images;android-35;google_apis;arm64-v8a"   # x86_64 on Intel/Linux
  export ANDROID_HOME=$HOME/Library/Android/sdk      # macOS default; ~/Android/Sdk on Linux
  echo "sdk.dir=$ANDROID_HOME" > mobile/android/local.properties
  ```

## Run in development
```bash
cd mobile && npm ci
npm start                    # Metro bundler
npm run android              # builds & installs the debug app on a running emulator/device
```
The debug build talks to `http://10.0.2.2:3000/api/v1` (the host machine from the emulator). For a physical device on
the same network: `EMBLEMWAY_API_URL=http://<your-LAN-IP>:3000/api/v1 npm start -- --reset-cache`
(cleartext is allowed only for `10.0.2.2`/`localhost`; use HTTPS for anything else).

## Configuration (never committed)
| Setting | How |
|---|---|
| API URL | `EMBLEMWAY_API_URL` env var at bundle time (inlined by Babel). Production must be HTTPS. |
| Google Maps SDK key | `EMBLEMWAY_MAPS_API_KEY` (Gradle property / env / `local.properties`) – see GOOGLE_MAPS_SETUP.md |
| Firebase (push) | Put `google-services.json` in `mobile/android/app/` (git-ignored). Without it the app builds and runs; push registration reports `not_configured` and notifications stay in-app. |
| Release signing | `EMBLEMWAY_UPLOAD_STORE_FILE`, `EMBLEMWAY_UPLOAD_STORE_PASSWORD`, `EMBLEMWAY_UPLOAD_KEY_ALIAS`, `EMBLEMWAY_UPLOAD_KEY_PASSWORD` |
| Version code | `-PEMBLEMWAY_VERSION_CODE=42` |

Create an upload keystore once and keep it in a password manager / secret store:
```bash
keytool -genkeypair -v -storetype PKCS12 -keystore emblemway-upload.keystore -alias emblemway-upload -keyalg RSA -keysize 2048 -validity 10000
```

## Build artifacts
```bash
scripts/build-android.sh debug   # app-debug.apk
scripts/build-android.sh apk     # app-release.apk  (signed with upload key if configured, else DEBUG key – not publishable)
scripts/build-android.sh aab     # app-release.aab  (Play Store upload)
```
Outputs: `mobile/android/app/build/outputs/{apk,bundle}/release/`. Example production build:
```bash
EMBLEMWAY_API_URL=https://api.emblemway.in/api/v1 EMBLEMWAY_MAPS_API_KEY=... \
EMBLEMWAY_UPLOAD_STORE_FILE=/secure/emblemway-upload.keystore EMBLEMWAY_UPLOAD_STORE_PASSWORD=... \
EMBLEMWAY_UPLOAD_KEY_ALIAS=emblemway-upload EMBLEMWAY_UPLOAD_KEY_PASSWORD=... scripts/build-android.sh aab
```

## Permissions
`INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_FINE/COARSE_LOCATION` (requested only when the user taps "use my current
location"; denial and "don't ask again" are handled with an "Open settings" path), `POST_NOTIFICATIONS` (Android 13+).

## End-to-end tests (Detox)
```bash
avdmanager create avd -n EmblemWay_API_35 -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_6
cd mobile
npm run e2e:build            # release APK + instrumentation APK
npm run e2e:test             # needs the backend running locally with OTP_PROVIDER=mock (code 123456)
```
Set `EMBLEMWAY_AVD` to use another emulator and `DETOX_HEADLESS=1` to run without a window.
