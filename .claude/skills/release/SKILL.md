---
name: release
description: Cut a new signed + notarized macOS release of Gravity Notes. Bumps the version (minor by default), writes CHANGELOG.md, builds/signs/notarizes the .app and .dmg, tags, and publishes a GitHub release with the DMG + auto-update artifacts (.app.tar.gz + latest.json) attached. Use when the user runs /release or asks to "cut a release", "ship a version", or "publish a release".
---

# Release runbook (signed + notarized macOS build)

This skill ships a distributable build of **Gravity Notes**: bump → changelog →
build/sign/notarize → tag → GitHub release with the DMG attached. Follow the steps
**in order**. The order is deliberate: nothing public (commit, tag, release) is created
until the artifact exists and passes Gatekeeper, so a failed/aborted build leaves only
throwaway uncommitted edits.

## Argument — the bump

`$ARGUMENTS` selects the bump, **default `minor`**:

- _(empty)_ or `minor` → `X.(Y+1).0`
- `major` → `(X+1).0.0`
- `patch` → `X.Y.(Z+1)`
- an explicit `X.Y.Z` → that exact version

## Step 0 — Preflight (STOP if any check fails; report what's missing)

1. **Clean main, in sync.** `git rev-parse --abbrev-ref HEAD` is `main`; `git status
--porcelain` is empty; `git fetch` then confirm not behind `origin/main`. If the tree
   is dirty or you're not on main, stop and tell the user.
2. **Toolchain.** macOS arm64 with Xcode Command Line Tools, and **rustup's** cargo installed
   (`~/.cargo/bin/cargo --version` ≥ 1.88 — the Homebrew rust 1.87 is too old; see the
   `rust-toolchain-tauri` memory). The build script prepends `~/.cargo/bin` to PATH itself, so a
   Homebrew cargo sitting first on PATH no longer breaks the build.
3. **Signing credentials** in the environment (the build script reads these; never print their
   values): the Apple set — `APPLE_SIGNING_IDENTITY`, `APPLE_API_KEY` (or `APPLE_API_KEY_ID`, which
   the build script aliases to it), `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH` (the `.p8` file is
   readable) — **and** the updater key
   `TAURI_SIGNING_PRIVATE_KEY` (path to / content of the passwordless
   `~/Documents/Apple Connect Keys/gravity-notes-updater.key`;
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` may be empty). Check each is set — without the updater key
   the build can't sign the auto-update bundle and fails.
4. **GitHub CLI.** `gh auth status` is logged in.
5. **Green tree.** Run `npm run typecheck`, `npm test`, and `npm run lint`. Do not
   release a red tree.

## Step 1 — Bump the version

```bash
NEW=$(node scripts/bump-version.mjs "${ARGUMENTS:-minor}")   # prints the new X.Y.Z
npx prettier --write package.json src-tauri/tauri.conf.json   # keep JSON Prettier-clean
echo "Releasing v$NEW"
```

This updates `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` in
lockstep (leave them **uncommitted** for now). Capture `$NEW` — every later step uses it.

## Step 2 — Prepare the changelog

1. Find the previous release base: `PREV=$(git describe --tags --match 'v*' --abbrev=0
2>/dev/null)`. If empty, this is the **first** release — summarize the whole history
   (`git log --no-merges --pretty='%s'`), and seed CHANGELOG.md with a header.
2. Otherwise list what's new: `git log "$PREV"..HEAD --no-merges --pretty='%s (%h)'`.
3. **Write the release notes yourself** — don't paste raw commit subjects. Group them
   into [Keep a Changelog](https://keepachangelog.com/) sections (`### Added`,
   `### Changed`, `### Fixed`, `### Removed`), in user-facing language. Drop noise
   (formatting-only, internal refactors, "update todo").
4. Prepend a new section to `CHANGELOG.md` (above older entries, below the title header):

   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD

   ### Added

   - …
   ```

   Use `date +%F` for the date. If CHANGELOG.md is empty, start it with a
   `# Changelog` title + the "format follows Keep a Changelog / SemVer" blurb, then the
   section.

5. **Show the user the proposed `## [X.Y.Z]` section and the bump, and get an explicit
   go-ahead** before building/publishing — this text becomes the public release notes.

## Step 3 — Build, sign, notarize (the slow step)

```bash
./scripts/build-mac-release.sh
```

Tauri builds + signs the `.app` (hardened runtime, Developer ID) and notarizes+staples
it; the script then notarizes + staples the **DMG** too. Because `createUpdaterArtifacts` is on,
the build also emits a **signed `…app.tar.gz` + `latest.json`** (the auto-update bundle + its
manifest) in `bundle/macos/` — the script renames the tarball to the space-free form and writes
`latest.json` from its `.sig`. Notarization waits on Apple, so this takes minutes. If it fails,
**STOP** and report — discard the uncommitted version edits with
`git checkout -- package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml` if abandoning.
Then verify **both** Gatekeeper artifacts pass offline:

```bash
APP="src-tauri/target/release/bundle/macos/Gravity Notes.app"
DMG="src-tauri/target/release/bundle/dmg/Gravity_Notes_${NEW}_aarch64.dmg"
TARBALL="src-tauri/target/release/bundle/macos/Gravity_Notes_${NEW}_aarch64.app.tar.gz"
LATEST="src-tauri/target/release/bundle/macos/latest.json"
xcrun stapler validate "$APP"
xcrun stapler validate "$DMG"
spctl -a -vvv "$APP"                 # → "accepted", source=Notarized Developer ID
```

(`build-mac-release.sh` renames the DMG to the space-free `Gravity_Notes_…` form, so
the file has no spaces; the `.app` path still does, so keep both quoted. `aarch64` =
the arm64 build.)

## Step 4 — Commit the release

Stage only the release files (the bump touched these; the build refreshed `Cargo.lock`):

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock CHANGELOG.md
git commit -m "release: v$NEW" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Step 5 — Tag and push

```bash
git tag -a "v$NEW" -m "Gravity Notes v$NEW"
git push origin main
git push origin "v$NEW"
```

## Step 6 — Publish the GitHub release with the DMG

Write the changelog section you wrote in Step 2 to a notes file and attach the DMG (it
contains the `.app`):

```bash
gh release create "v$NEW" \
  --title "Gravity Notes v$NEW" \
  --notes-file <(printf '%s\n' "$NOTES") \
  "$DMG" "$TARBALL" "$LATEST"
```

`$NOTES` is the body of the `## [X.Y.Z]` section (without the `## [X.Y.Z]` header line).
Attach **all three** assets: the `$DMG` (first install), the `$TARBALL` (the bundle the updater
swaps in), and `$LATEST` (`latest.json`, the manifest the updater fetches from the release's
`latest/download/` URL). The updater only sees **published, non-draft, non-prerelease** releases —
if you `--draft` first to eyeball it, the auto-update path stays dark until you publish.

## Step 7 — Report

Print the release URL (`gh release view "v$NEW" --json url -q .url`), the version, and
confirm **all three** assets uploaded — the DMG, the `.app.tar.gz`, and `latest.json`
(`gh release view "v$NEW" --json assets -q '.assets[].name'`). A missing `latest.json` or tarball
silently breaks auto-update for everyone on the previous version.

## Notes & failure handling

- **Why this order:** the build/notarize step is the only one that can fail slowly or
  need Apple. Doing it _before_ commit/tag/release means an abort leaves nothing but
  uncommitted file edits — no orphan tag or half-published release to clean up.
- **Idempotency:** if a run dies after the tag/push, don't re-bump — re-run from the
  failed step using the same `$NEW` (e.g. delete a bad tag with
  `git push --delete origin "v$NEW"` before re-tagging; `gh release delete` to redo a
  release).
- **Three assets per release:** the DMG (first install — the `.app` lives inside it), the
  `.app.tar.gz` (the auto-update bundle), and `latest.json` (the update manifest). The updater uses
  only the tarball + manifest; the DMG is for fresh installs.
- **First updater release is a baseline.** Anyone on a version without the updater (≤ 0.2.0) must
  download the next release manually; auto-update only works from one updater-carrying release to
  the next. The `latest.json` version is read from `package.json`, so it always matches the bump.
- **Never echo** the Apple credential values; only check that the env vars are set.
