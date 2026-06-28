#!/usr/bin/env bash
#
# Build a signed + notarized "Gravity Notes" .app/.dmg for distribution outside
# the Mac App Store. Tauri signs with the Developer ID cert (hardened runtime),
# uploads to Apple for notarization, and staples the app; this script then also
# notarizes + staples the DMG container so every artifact passes Gatekeeper
# offline, with no warning.
#
# Credentials come from the environment (set these outside the repo, e.g. in
# your shell profile) — nothing secret lives in this file:
#
#   APPLE_SIGNING_IDENTITY  "Developer ID Application: Your Name (TEAMID)"
#   APPLE_API_KEY           App Store Connect API Key ID (the AuthKey_<ID>.p8 ID)
#   APPLE_API_ISSUER        App Store Connect issuer ID (a UUID)
#   APPLE_API_KEY_PATH      absolute path to the AuthKey_<ID>.p8 file
#
# Usage:  ./scripts/build-mac-release.sh
# Output: src-tauri/target/release/bundle/{macos,dmg}/

set -euo pipefail

# --- require credentials from the environment --------------------------------
missing=()
for var in APPLE_SIGNING_IDENTITY APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH; do
  if [[ -z "${!var:-}" ]]; then missing+=("$var"); fi
done
if (( ${#missing[@]} )); then
  echo "error: missing required env var(s): ${missing[*]}" >&2
  echo "       set them in your shell profile (kept outside the repo)." >&2
  exit 1
fi
if [[ ! -r "$APPLE_API_KEY_PATH" ]]; then
  echo "error: API key not readable at: $APPLE_API_KEY_PATH" >&2
  exit 1
fi

# Tauri reads APPLE_SIGNING_IDENTITY + the APPLE_API_* vars to sign and
# notarize/staple the .app during the build. They are already exported in the
# environment, so no re-export is needed here.

echo "==> Building, signing, and notarizing the app ..."
npm run tauri:build -- "$@"

# --- notarize + staple the DMG ----------------------------------------------
# Tauri staples the .app but not the DMG container, so do that here too.
DMG="$(ls -t src-tauri/target/release/bundle/dmg/*.dmg | head -1)"
echo "==> Notarizing the DMG: $DMG"
xcrun notarytool submit "$DMG" \
  --key "$APPLE_API_KEY_PATH" \
  --key-id "$APPLE_API_KEY" \
  --issuer "$APPLE_API_ISSUER" \
  --wait

echo "==> Stapling the DMG ..."
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

echo "==> Done. Ship: $DMG"
