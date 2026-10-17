# shellcheck shell=bash
#
# Shared DMG plumbing for build-mac-release.sh and build-mac-preview.sh (sourced, not run).
#
# create-dmg (Tauri's bundle_dmg.sh) lays out a scratch volume through a live Finder window.
# Anything that touches that volume meanwhile (an app launched from the window, say) keeps it
# busy; create-dmg gives up after three detach attempts and Tauri reports only "failed to run
# bundle_dmg.sh", leaving /Volumes/dmg.XXXXXX mounted and its rw.*.dmg behind.

BUNDLE_DIR="src-tauri/target/release/bundle"
DMG_STEP_FAILED=75

detach_stale_dmg_mounts() {
  local dev
  for dev in $(hdiutil info | awk '
    /^image-path/ { img = $0 }
    /^\/dev\/disk[0-9]+[ \t]/ && img ~ /\/bundle\/(macos|dmg)\/rw\.[0-9]+\./ { print $1; img = "" }
  '); do
    echo "    detaching stale scratch image $dev"
    hdiutil detach -force "$dev" >/dev/null || true
  done
  rm -f "$BUNDLE_DIR"/{macos,dmg}/rw.*.dmg
}

tauri_build() {
  local log status=0
  log="$(mktemp -t gn-tauri-build)"
  detach_stale_dmg_mounts
  "$@" 2>&1 | tee "$log" || status=$?
  if (( status )) && grep -q 'bundle_dmg\.sh' "$log"; then
    status=$DMG_STEP_FAILED
  fi
  rm -f "$log"
  return "$status"
}

build_dmg_directly() {
  local app="$1.app" dmg="$2" attempt status
  local out="$PWD/$BUNDLE_DIR/dmg/$dmg"
  for attempt in 1 2 3; do
    local extra=()
    if (( attempt == 3 )); then
      echo "    warning: last attempt skips the Finder window layout, so nothing can grab the volume"
      extra=(--skip-jenkins)
    fi
    detach_stale_dmg_mounts
    rm -f "$out"
    status=0
    # Same layout as Tauri's defaults (tauri.conf.json sets no bundle.macOS.dmg).
    (cd "$BUNDLE_DIR/macos" && bash ../dmg/bundle_dmg.sh ${extra[@]+"${extra[@]}"} \
      --volname "$1" \
      --icon "$app" 180 170 \
      --app-drop-link 480 170 \
      --window-size 660 400 \
      --hide-extension "$app" \
      --volicon ../dmg/icon.icns \
      "$out" "$app") || status=$?
    if (( status == 0 )); then
      codesign --force --timestamp -s "$APPLE_SIGNING_IDENTITY" "$out"
      return 0
    fi
    echo "    bundle_dmg.sh failed (exit $status), attempt $attempt of 3" >&2
  done
  detach_stale_dmg_mounts
  return 1
}
