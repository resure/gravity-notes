#!/usr/bin/env bash
#
# Build a signed + notarized PREVIEW build — a branch you want to put in someone's
# hands before it ships. Same signing and notarization as a release, so it opens on
# a stranger's Mac with no Gatekeeper warning, but deliberately NOT a release:
#
#   * it is its own app (src-tauri/tauri.preview.conf.json — "Gravity Notes Preview",
#     its own bundle id, the blue dev icon), so it installs ALONGSIDE the shipping
#     app and keeps its own workspace registry rather than adopting someone's real one;
#   * it emits no updater artifacts and its update endpoint points at a tag that will
#     never exist, so the build never replaces itself with a later release;
#   * nothing is tagged, versioned in lockstep, or published — the DMG is the product.
#     Hand it over directly (AirDrop, Dropbox); there is nothing to clean up afterwards.
#
# For a real release use ./scripts/build-mac-release.sh (via the /release runbook) instead.
#
# Credentials come from the environment, exactly as the release script documents —
# minus TAURI_SIGNING_PRIVATE_KEY, which only signs updater bundles:
#
#   APPLE_SIGNING_IDENTITY  "Developer ID Application: Your Name (TEAMID)"
#   APPLE_API_KEY           App Store Connect API Key ID (APPLE_API_KEY_ID is accepted too)
#   APPLE_API_ISSUER        App Store Connect issuer ID (a UUID)
#   APPLE_API_KEY_PATH      absolute path to the AuthKey_<ID>.p8 file
#
# Usage:  ./scripts/build-mac-preview.sh
# Output: src-tauri/target/release/bundle/dmg/Gravity_Notes_Preview_<version>_aarch64.dmg

set -euo pipefail

# rustup's toolchain, not a stray Homebrew rust — see the release script for why.
[[ -d "$HOME/.cargo/bin" ]] && export PATH="$HOME/.cargo/bin:$PATH"

: "${APPLE_API_KEY:=${APPLE_API_KEY_ID:-}}"
export APPLE_API_KEY

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

CONFIG="src-tauri/tauri.preview.conf.json"
VERSION="$(node -p "require('./$CONFIG').version")"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
COMMIT="$(git rev-parse --short HEAD)"
echo "==> Preview build $VERSION from $BRANCH@$COMMIT"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "    (working tree is dirty — the build includes uncommitted changes)"
fi

echo "==> Building, signing, and notarizing the app ..."
npx tauri build --config "$CONFIG" "$@"

# The preview's productName has spaces; the file friends download should not.
RAW_DMG="$(ls -t src-tauri/target/release/bundle/dmg/*.dmg | head -1)"
DMG="$(dirname "$RAW_DMG")/$(basename "$RAW_DMG" | tr ' ' '_')"
if [[ "$RAW_DMG" != "$DMG" ]]; then
  mv -f "$RAW_DMG" "$DMG"
fi

# Tauri staples the .app but not the DMG container, so do that here too — otherwise the
# first open on a machine that has never seen this build needs the network.
echo "==> Notarizing the DMG: $DMG"
xcrun notarytool submit "$DMG" \
  --key "$APPLE_API_KEY_PATH" \
  --key-id "$APPLE_API_KEY" \
  --issuer "$APPLE_API_ISSUER" \
  --wait

echo "==> Stapling the DMG ..."
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

echo "==> Done: $DMG"
echo "    Hand this file over directly; it is not published anywhere."
