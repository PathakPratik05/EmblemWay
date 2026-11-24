#!/usr/bin/env bash
# Builds EmblemWay Android artifacts.
#   scripts/build-android.sh apk        → mobile/android/app/build/outputs/apk/release/app-release.apk
#   scripts/build-android.sh aab        → mobile/android/app/build/outputs/bundle/release/app-release.aab
#   scripts/build-android.sh debug      → mobile/android/app/build/outputs/apk/debug/app-debug.apk
#
# Required for store-ready builds (environment or ~/.gradle/gradle.properties, never committed):
#   EMBLEMWAY_API_URL            https://api.example.in/api/v1   (inlined into the JS bundle)
#   EMBLEMWAY_MAPS_API_KEY       Android-restricted Google Maps SDK key
#   EMBLEMWAY_UPLOAD_STORE_FILE / _STORE_PASSWORD / _KEY_ALIAS / _KEY_PASSWORD   upload keystore
# Without signing variables the release build is signed with the DEBUG key (not publishable).
set -euo pipefail
TARGET="${1:-apk}"
cd "$(dirname "$0")/../mobile/android"

case "$TARGET" in
  apk) ./gradlew assembleRelease ;;
  aab) ./gradlew bundleRelease ;;
  debug) ./gradlew assembleDebug ;;
  *) echo "usage: $0 [apk|aab|debug]" >&2; exit 1 ;;
esac

find app/build/outputs -name "*.apk" -o -name "*.aab" | grep -v androidTest
