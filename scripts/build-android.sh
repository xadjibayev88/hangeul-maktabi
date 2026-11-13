#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/output}"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0.0}"

if [[ -x "$ANDROID_DIR/gradlew" ]]; then
  GRADLE=("$ANDROID_DIR/gradlew")
elif command -v gradle >/dev/null 2>&1; then
  GRADLE=("$(command -v gradle)")
else
  echo "Gradle not found. Install Gradle 8.9+ or provide android/gradlew before building." >&2
  exit 127
fi

release_ready=true
for variable in RELEASE_KEYSTORE_FILE RELEASE_STORE_PASSWORD RELEASE_KEY_ALIAS RELEASE_KEY_PASSWORD; do
  if [[ -z "${!variable:-}" ]]; then
    release_ready=false
  fi
done

if [[ "$release_ready" == true ]]; then
  if [[ ! -f "$RELEASE_KEYSTORE_FILE" ]]; then
    echo "RELEASE_KEYSTORE_FILE is set but does not point to a readable keystore." >&2
    exit 2
  fi
  VARIANT="Release"
  ARTIFACT_NAME="GoTopic-release.apk"
  echo "Building signed release APK (credentials are supplied through the environment)."
else
  VARIANT="Debug"
  ARTIFACT_NAME="GoTopic-debug.apk"
  echo "Release signing is not fully configured; building debug APK: $ARTIFACT_NAME"
fi

mkdir -p "$OUTPUT_DIR"
(
  cd "$ANDROID_DIR"
  "${GRADLE[@]}" --no-daemon ":app:assemble${VARIANT}" \
    "-PverCode=$VERSION_CODE" \
    "-PversionName=$VERSION_NAME"
)

SOURCE_APK="$ANDROID_DIR/app/build/outputs/apk/${VARIANT,,}/app-${VARIANT,,}.apk"
if [[ ! -f "$SOURCE_APK" ]]; then
  echo "Expected APK was not produced: $SOURCE_APK" >&2
  exit 3
fi
cp "$SOURCE_APK" "$OUTPUT_DIR/$ARTIFACT_NAME"
echo "APK: $OUTPUT_DIR/$ARTIFACT_NAME"
