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
#   APPLE_SIGNING_IDENTITY     "Developer ID Application: Your Name (TEAMID)"
#   APPLE_API_KEY              App Store Connect API Key ID (the AuthKey_<ID>.p8 ID); APPLE_API_KEY_ID
#                              is accepted as an alias
#   APPLE_API_ISSUER           App Store Connect issuer ID (a UUID)
#   APPLE_API_KEY_PATH         absolute path to the AuthKey_<ID>.p8 file
#   TAURI_SIGNING_PRIVATE_KEY  path to (or content of) the updater's Ed25519 private key — signs the
#                              auto-update bundle; pubkey lives in tauri.conf.json (passwordless key)
#
# Usage:  ./scripts/build-mac-release.sh
# Output: src-tauri/target/release/bundle/{macos,dmg}/ — .dmg + .app.tar.gz + latest.json

set -euo pipefail

# Use rustup's toolchain, not a stray Homebrew rust: prepend ~/.cargo/bin so `cargo`/`rustc` resolve
# to the rustup proxy even when the shell's PATH lists Homebrew first. Homebrew's rust can lag the
# MSRV the Tauri deps require (see the rust-toolchain-tauri memory), failing the build at resolve time.
[[ -d "$HOME/.cargo/bin" ]] && export PATH="$HOME/.cargo/bin:$PATH"

# Tauri's notarization reads APPLE_API_KEY (the App Store Connect key ID). Accept APPLE_API_KEY_ID as
# an alias so either name in your profile works; export it so `tauri build` (a child) inherits it.
: "${APPLE_API_KEY:=${APPLE_API_KEY_ID:-}}"
export APPLE_API_KEY

# --- require credentials from the environment --------------------------------
missing=()
for var in APPLE_SIGNING_IDENTITY APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH TAURI_SIGNING_PRIVATE_KEY; do
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

# The updater compares the manifest version (from package.json, below) against the running app's
# version (from tauri.conf.json). The bump script keeps package.json / tauri.conf.json / Cargo.toml
# in lockstep; assert the two the updater relies on actually match, so a missed edit can't ship a
# manifest the installed app won't recognise as newer.
PKG_VERSION="$(node -p "require('./package.json').version")"
CONF_VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
if [[ "$PKG_VERSION" != "$CONF_VERSION" ]]; then
  echo "error: version mismatch — package.json=$PKG_VERSION, tauri.conf.json=$CONF_VERSION" >&2
  echo "       run scripts/bump-version.mjs to set them in lockstep." >&2
  exit 1
fi

# Tauri reads APPLE_SIGNING_IDENTITY + the APPLE_API_* vars to sign and notarize/staple the .app
# during the build, and TAURI_SIGNING_PRIVATE_KEY to sign the updater bundle. They're already
# exported in the environment, so no re-export is needed here — except the updater key's password:
# this project's key has none, so export an empty one, otherwise signing blocks on an interactive
# password prompt mid-build.
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

echo "==> Building, signing, and notarizing the app ..."
npm run tauri:build -- "$@"

# --- rename the DMG to a space-free artifact name ----------------------------
# productName stays "Gravity Notes" (the app's display name), but the DMG file
# should have no spaces, so Tauri's "Gravity Notes_<v>_<arch>.dmg" is renamed to
# "Gravity_Notes_<v>_<arch>.dmg". Done before notarizing so the ticket staples
# onto the final name (renaming a stapled DMG would be fine too — notarization
# travels with the file's content, not its name).
RAW_DMG="$(ls -t src-tauri/target/release/bundle/dmg/*.dmg | head -1)"
DMG="$(dirname "$RAW_DMG")/$(basename "$RAW_DMG" | tr ' ' '_')"
if [[ "$RAW_DMG" != "$DMG" ]]; then
  mv -f "$RAW_DMG" "$DMG"
fi

# --- notarize + staple the DMG ----------------------------------------------
# Tauri staples the .app but not the DMG container, so do that here too.
echo "==> Notarizing the DMG: $DMG"
xcrun notarytool submit "$DMG" \
  --key "$APPLE_API_KEY_PATH" \
  --key-id "$APPLE_API_KEY" \
  --issuer "$APPLE_API_ISSUER" \
  --wait

echo "==> Stapling the DMG ..."
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

# --- updater artifacts (Tauri in-app auto-update) ----------------------------
# `bundle.createUpdaterArtifacts` + TAURI_SIGNING_PRIVATE_KEY made the build emit a signed
# `<app>.app.tar.gz` (+ a `.sig`) next to the .app. Give the tarball the same space-free name as the
# DMG, then generate the `latest.json` manifest the updater fetches. The minisign signature is over
# the tarball BYTES, so renaming is safe — but the tarball must NOT be otherwise modified after the
# build (re-archiving would invalidate the signature the manifest carries).
VERSION="$(node -p "require('./package.json').version")"
MACOS_DIR="src-tauri/target/release/bundle/macos"
# Tauri emits the updater bundle under the productName, with no version in the name. Use that exact
# path (not a `ls *.app.tar.gz` glob, which could silently pick a stale renamed tarball from a prior
# build) and require BOTH it and its .sig before renaming — a build that didn't emit them fails loud,
# not with a half-renamed bundle dir.
RAW_TARBALL="$MACOS_DIR/Gravity Notes.app.tar.gz"
if [[ ! -f "$RAW_TARBALL" || ! -f "$RAW_TARBALL.sig" ]]; then
  echo "error: updater artifacts not found next to the .app:" >&2
  echo "       expected \"$RAW_TARBALL\" and its .sig." >&2
  echo "       Is bundle.createUpdaterArtifacts true and TAURI_SIGNING_PRIVATE_KEY set?" >&2
  exit 1
fi
TARBALL="$MACOS_DIR/Gravity_Notes_${VERSION}_aarch64.app.tar.gz"
if [[ "$RAW_TARBALL" != "$TARBALL" ]]; then
  mv -f "$RAW_TARBALL" "$TARBALL"
  mv -f "$RAW_TARBALL.sig" "$TARBALL.sig"
fi
UPDATER_URL="https://github.com/resure/gravity-notes/releases/download/v${VERSION}/Gravity_Notes_${VERSION}_aarch64.app.tar.gz"
LATEST_JSON="$MACOS_DIR/latest.json"
echo "==> Generating updater manifest: $LATEST_JSON"
node scripts/make-latest-json.mjs "$VERSION" "$TARBALL.sig" "$UPDATER_URL" "$LATEST_JSON"

echo "==> Done. Upload all three to the GitHub release:"
echo "    DMG (first install): $DMG"
echo "    Updater bundle:      $TARBALL"
echo "    Updater manifest:    $LATEST_JSON"
