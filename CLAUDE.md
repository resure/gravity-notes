# CLAUDE.md

Guidance for working in this repository.

## What this is

**Gravity Notes** — a local-first Markdown note-taking app, shipping as both a **web app** and a
**macOS desktop app** (Tauri 2). On first run the user chooses where notes live: a **folder** of
plain `.md` files or **in-browser** (IndexedDB). Built on the [Gravity UI](https://gravity-ui.com/)
ecosystem, with `@gravity-ui/markdown-editor` as the WYSIWYG/Markdown editor.

**Targets / folder backends.** The folder-of-`.md` backend is served two ways behind one `NoteStore`
seam:

- **Web (Chromium):** `FileSystemNoteStore` via the browser **File System Access API** — Chromium-only
  (unavailable in Firefox/Safari, which are offered only the in-browser backend).
- **Desktop (Tauri, macOS arm64):** `TauriNoteStore` via native Rust `fs` commands — the FSA API is
  absent in WKWebView. This makes folder storage work natively in the app, with no per-session
  permission re-grant.

Notes live in **nested folders** — real subdirectories on disk; a note's id is its POSIX rel-path
(`Work/Sub/Title.md`, basename = title) — and can carry **media attachments** (images written to a
root `Attachments/` folder, referenced root-relatively, resolved to `blob:` URLs only at display
time). Both work across all three backends.

Every opened folder/store is a **workspace**: an IndexedDB registry (`src/storage/workspaceRegistry.ts`)
remembers them all with recency, feeding the orb menu's "Open Recent" submenu, the **⌃R switcher
dialog**, and — desktop only — **one native window per workspace** (several at once; ⌘-click a recent
or ⌘↵ in the switcher — the modifier also works on "Open Folder…", picking a folder straight into a
new window). Desktop also has **per-note windows** (Apple-Notes-style): ⌘↵ / ⌘-click a list row or
its ⋯ menu opens that note in its own `note-N` window — both side panels closed, focus in the editor
body, native title = the note title, per-note focus-if-open — and **⌘0** (Window ▸ Main Window, a
native accelerator) surfaces the full workspace window for THAT window's workspace, un-hiding or
creating one as needed. Per-workspace UI layout (sidebar/rail/selected folder) lives under
workspace-namespaced localStorage keys — note windows neither read nor write those (their transient
layout must not clobber the full views', and reading would eat the legacy-key migration); the sidecar
metadata is per-folder anyway.

Notes also move between backends via `.md` export/import (`src/storage/transfer.ts`). The Rust shell
lives in `src-tauri/` (only `src-tauri/src/lib.rs` carries app code: `notes_*` + `attachment_*` fs
commands (the bulk walks skip iCloud **dataless** files' content — `SF_DATALESS` in `st_flags` —
because reading one blocks on download; they list by name/mtime with empty previews, and an explicit
single-note open still materializes), the folder ops, `reveal_path`, the **live folder watcher**
(`notes_watch`/`notes_unwatch` + the `Watchers` state: ONE debounced `notify`/FSEvents stream per
open folder, with per-window-label REFCOUNTED subscriptions — StrictMode makes `watch, watch,
unwatch` a legal wire order, so a set would break — emitting `notes:changed` `{dir, paths}` to each
subscriber via `emit_to`; `dir` is the RAW path the frontend passed (strict-equals
`TauriNoteStore.dir`) while `strip_prefix` runs against the canonicalized root — FSEvents resolves
`/var`→`/private/var` and symlinks; the `watch_rel_path` filter passes `.md` leaves (INCLUDING
dot-named ones — the note walks list `.hidden.md`, only dot DIRS are skipped), existing DIRS
(a Finder folder rename reports ONLY the dir paths), and vanished paths (unclassifiable → include),
dropping dot dirs/`node_modules`/root-`Attachments/`/write temps (the `WRITE_TMP_SUFFIX`/
`RENAME_TMP_SUFFIX` consts — the TS stores mint `.rename-tmp`, mirror-commented there); >64 paths,
a watcher error, or an event on the WATCH ROOT itself (FSEvents' queue-overflow rescan signal, all
that survives the debouncer) → EMPTY `paths` = "refresh everything"; never drop a `WatcherEntry`
under the mutex — Drop joins the debouncer thread, so `remove_window_subscriptions` returns the
emptied entries for the caller to drop unlocked; subscriptions are drained on `Destroyed`, on
`on_page_load` Started (a reload orphans the old JS context's disposers and fires no Destroyed —
without the reset every crash-reload would leak refcounts and pin dead watchers alive), and by
`reap_dead_window_subscriptions` after each `notes_watch` (the unlocked build gap can land a
subscription for an already-destroyed window that nothing else would ever drain)), and the
**window commands** — a
label→workspace map plus a label→note map powering
`window_workspace`/`set_window_workspace`/`focus_workspace_window`/`open_workspace_window` and
`window_note`/`set_window_note`/`window_note_renamed`/`window_note_removed`/`open_note_window`, plus
`focus_main_window` (the ⌘0 fallback App invokes when no Workspace is mounted to listen).
`window_note_renamed` re-keys note-window assignments when a rename/move changes a note's rel-path,
and `window_note_removed` drops them when a note is trashed/deleted (`useNotes.rename`/`move`/`trash`/
`remove` fire them, fire-and-forget, scoped to the caller's workspace), so per-note focus-if-open
doesn't go stale and spawn duplicate windows. All
three focus-if-open paths `unminimize()` before `show()`+`set_focus()` — set_focus alone leaves a
minimized window in the Dock. (`ws-N` and `note-N` windows are cloned from the main
window's config; note windows are 760×640, cascade centered on the opener's monitor, get their
workspace AND note assigned before the page loads, and are EXCLUDED from workspace-level
focus-if-open — `NOTE_WINDOW_PREFIX` is mirrored in `src/isTauri.ts`, keep in sync); it also registers
the **updater** + **process** plugins, sets the macOS window chrome (factored as
`apply_macos_chrome`, applied to every window: a theme-aware native background for anti-flash, plus an
empty unified-compact **NSToolbar** that makes the title bar tall with SYSTEM-positioned traffic
lights — macOS 26 re-runs title-bar layout on every pass and reverts hand-set button frames, so never
position the lights manually), and builds a **custom app menu**: the macOS "About" item emits
`menu:about` to the FOCUSED window so the frontend can open its own `AboutDialog`, and "Main Window"
(`CmdOrCtrl+0`) emits `menu:main-window` the same way — the focused window's frontend then
focuses-or-creates the workspace window for ITS OWN workspace (never dragging forward a main window
parked on another one). **Close flow:** the main window hides on ⌘W (Rust-side, macOS convention)
while `ws-N`/`note-N` windows really close — `useNotes`'s `onCloseRequested` handler flushes pending
edits then calls `preventDefault()` for `main` AND for any window whose flush could not land its
edit (an unresolved conflict re-queued it — destroying then would silently drop the edit, so the
window stays open with its conflict banner); the JS wrapper's `destroy()` needs the
`core:window:allow-destroy` capability (granted to `main`, `ws-*`, and `note-*`), so those must stay
in sync.

The desktop app ships **in-app auto-update** via the official Tauri 2 updater, delivered through GitHub
Releases (`src/hooks/useAppUpdater.ts`; cut a release with the `/release` runbook in `.claude/skills/release`).

## Commands

```bash
npm install
npm run dev          # Vite dev server (http://localhost:5173)
npm run build        # type-check (tsc, noEmit) + production build
npm run build:single # single self-contained index.html (inlined assets); also run in CI
npm run preview      # preview the production build

npm test             # run the Vitest suite once
npm run test:watch   # watch mode
npm run lint         # ESLint (Gravity flat config; also enforces Prettier on JS/TS)
npm run lint:fix     # ESLint with autofix
npm run format       # Prettier write (covers CSS/MD/JSON too)
npm run format:check # Prettier check (used in CI)
npm run typecheck    # tsc (noEmit) for src + tsconfig.node.json for vite.config.ts

# Desktop app (Tauri 2, macOS arm64). Needs Rust ≥ 1.88 (rustup recommended).
npm run tauri:dev    # run the desktop app (dev config: blue icon + "Gravity Notes Dev" name/title)
npm run tauri:build  # build the signed-less .app / .dmg (arm64) into src-tauri/target/release/bundle
# Signed + notarized release: the /release skill → scripts/build-mac-release.sh (emits DMG + updater
# .app.tar.gz + latest.json); needs rustup's cargo + the Apple/updater signing env vars.
```

**App icons.** Two SVG sources: `src-tauri/icon-source.svg` (prod — orange disc on a dark squircle)
and `src-tauri/icon-source-dev.svg` (dev — a blue "supernova" sun). Regenerate with
`npx tauri icon <1024.png> [-o src-tauri/icons-dev]`, then delete the `android/`, `ios/`, and
`64x64.png` it emits (macOS-only). **Gotcha:** rasterize the SVG to a _transparent_ 1024px PNG first —
`qlmanage -t` renders on a white background, so flood-fill it away before `tauri icon`
(`magick in.png -alpha set -bordercolor white -border 1 -fuzz 8% -fill none -draw "alpha 0,0 floodfill" -shave 1x1 out.png`),
or every generated asset gets a white box behind the squircle. `npm run tauri:dev` passes
`--config src-tauri/tauri.dev.conf.json` so the dev build gets the blue icon + a distinct name/identifier;
`tauri:build` and `/release` use the prod config untouched.

## Architecture

```
FolderGate ──▶ NoteStore (filesystem | tauri-fs | indexeddb) ──▶ useNotes() ──▶ NoteList + EditorPane
(choose storage)  (.md on disk: web FSA / native Rust; or IndexedDB)  (state + autosave)   (UI)
```

All persistence sits behind the **`NoteStore` interface** (`src/storage/types.ts`) — the key extension
seam, with three backends (two of them folder-of-`.md`). A note id is its POSIX rel-path (`<Title>.md`
at the root, `Work/Sub/<Title>.md` when nested); the basename without `.md` is the title. The seam
spans notes, **nested folders**, and **media attachments** (plus optional desktop-only `reveal` and
`watch`). Anything above the seam (`useNotes`, navigation, UI) is backend-agnostic.

Key modules:

- `src/storage/types.ts` — the `NoteStore` interface (storage-agnostic; no FS-specific types leak in).
  Includes `getAll()` (every note with its body, one pass) that feeds the full-text search corpus. The
  seam also covers nested folders (`create(title, parentPath)`, `move`, `createFolder`/`removeFolder`/
  `moveFolder`/`listFolders`, and `listsRecursively` so metadata reconcile never prunes ids a backend
  can't yet enumerate), media attachments (`writeAttachment`/`writeAttachmentAt`/`readAttachment`/
  `listAttachments`/`removeAttachment`), an optional desktop-only `reveal(relPath)`, and an optional
  desktop-only `watch(onChange)` (external-change push: rel-paths, EMPTY = "many/unknown"; resolves
  to a SYNC disposer; `TauriNoteStore.watch` listens window-scoped for `notes:changed` filtered by
  `payload.dir === this.dir`, subscribes the listener BEFORE invoking `notes_watch` so no event can
  slip the gap, and unlistens+rethrows if the invoke fails).
- `src/search.ts` — pure full-text ranking (no I/O, no React): `tokenizeQuery`, `scoreNoteText`
  (multi-term AND; title ≫ body, word-boundary/prefix/phrase boosts), `buildSnippet`, `searchNotes`.
  The corpus (id → body, plus a pre-lowercased `lowerById` so a big folder isn't re-lowercased on
  every keystroke) is loaded above it by `useCorpus` and passed in, so it stays trivially unit-testable.
- `src/wikiLinks.ts` — pure `[[wiki link]]` + backlink helpers (no I/O, no React; sibling to
  `search.ts`): `extractWikiLinks`, `resolveWikiLink` (match by title case-insensitively, or an explicit
  `Folder/Note` path; `|alias`/`#heading` ignored; same-folder ≫ shallowest ≫ lexicographic tiebreak),
  `suggestWikiTargets` (the `[[`-autocomplete ranking). Backlinks invert in **two stages** so a corpus
  change stays cheap: `buildBacklinkInversion` (resolve + group, NO snippets, once per graph change)
  then `materializeBacklinks` (slice context snippets + sort for ONE bucket, lazily — only the open
  note's). `buildBacklinks`/`buildBacklinkIndex` are the eager forms kept for direct/test callers. Notes
  keep the literal `[[Title]]` on disk (Obsidian-compatible round-trip).
- `src/tree.ts` — pure tree shaping (no I/O, no React): `buildFolderTree` / `notesInFolder` /
  `buildMoveTargets` turn notes + folders + metadata into the `FolderRow[]` the folder rail renders
  (and the move-to picker), encoding the per-level order [pinned folders, folders, pinned notes, notes]
  and synthesizing missing ancestor folders. `notesInFolder` lists a folder's _direct_ children (the
  visible note ids for the middle pane are derived in `Workspace`).
- `src/storage/noteText.ts` — pure helpers shared by both backends: `titleFromFileName`,
  `sanitizeTitle`, `canonicalBody`, `previewFromContent`, `uniqueName`. Keeps id/body shape identical.
- `src/storage/fileSystemStore.ts` — `FileSystemNoteStore` (File System Access API). Trickiest logic:
  unique-filename resolution, copy-then-delete rename (no atomic rename), case-only rename via a temp
  name (case-insensitive filesystems), `writeFile` that aborts on failure.
- `src/storage/indexedDbStore.ts` — `IndexedDbNoteStore` (in-browser). Mirrors the FS store's
  semantics (`<Title>.md` ids, canonical body, `updatedAt`-based `ConflictError`, `NotFoundError` on a
  missing note) so `useNotes` is unaffected by which backend is active.
- `src/storage/tauriStore.ts` — `TauriNoteStore` (desktop). Same semantics as the FS store, but over
  `invoke()` to the Rust `notes_*` commands (`src-tauri/src/lib.rs`). Reuses the `noteText`/`metadata`
  helpers verbatim; gets real atomic `fs::rename` (no copy-then-delete) but still keeps the case-only
  rename two-step (macOS's case-insensitive FS makes a direct case-only rename a no-op). `save()`
  reproduces the FS contract exactly: `ConflictError` on mtime mismatch, a `NotFoundError` `DOMException`
  when the file is gone (so `useNotes` maps it to a "deleted" conflict).
- `src/storage/transfer.ts` — `.md` export (zip via `fflate`) and import (`.md` / `.zip`), for any
  backend; the way to get plain files out of in-browser storage and migrate between backends.
  Preserves folder structure (incl. deliberately-empty folders, via a `.gnkeep` marker) and bundles
  `Attachments/` bytes both ways.
- `src/storage/workspaceRegistry.ts` — the workspace registry (IndexedDB `gravity-notes` v2): every
  opened workspace as a `WorkspaceEntry` (`indexeddb` | `tauri:<path>` | `fsa:<uuid>`; a
  `FileSystemDirectoryHandle` structured-clones inside the entry, `tauri-fs` keeps a path string) plus
  a last-active pointer for launch restore. Lazily migrates the v1 single-choice keys into a
  deterministic entry (`fsa:legacy`) so a StrictMode/two-window double-run is idempotent. ⚠️ This must
  stay the ONLY module opening that database — a second module opening v1 would throw `VersionError`
  after the upgrade. Each `tx()` closes the connection on complete / error / abort (short-lived
  connections are also why cross-window v1→v2 upgrades can't block).
- `src/storage/metadata.ts` — the per-store metadata (`.gravity-notes.json` sidecar for the FS store):
  tolerant `parseMetadata`, pure transforms (`withPinToggled`, `withActive`, `reconcile`, …), and
  `orderNotes` (pins first, then the active sort). The `pinned` set holds both note ids and folder
  paths — folders are pinnable too. Per-note `icons` and `appearances` (the ⋯ popover's font/width
  overrides) also live here, keyed by note id — a note id is its rel-path, so keeping them in the
  sidecar is what lets `withRenamed`/`withReprefixed` re-key them on rename/move (and lets them
  travel with the folder + survive trash → restore via the `TrashEntry`). Per-note appearance is
  deliberately NOT in localStorage; `Workspace` one-shot migrates any legacy
  `gravity-notes:<wsId>:note:<id>:appearance` keys into the sidecar on first ready load.
- `src/attachments.ts` — `AttachmentUrlCache` (one per store) lazily resolving `Attachments/…` refs to
  `blob:` object URLs at display time, provided through `AttachmentsContext`; revoked on store
  change/unmount. LRU **byte-budget eviction** (256 MB cap): callers `subscribe(ref, …)` to pin a
  visible image's URL (subscribed entries are never evicted) and get notified if it's re-seeded; `peek`
  is pure (no LRU touch), `resolve` touches. The stored Markdown always keeps the root-relative ref,
  never a blob URL.
- `src/hooks/useNotesStorage.ts` — the workspace lifecycle (state machine:
  `loading`/`choosing`/`needs-permission`/`ready`); yields a ready `NoteStore` plus the recents list.
  Bootstrap order: the shell's per-window assignment (`readWindowAssignment`: `window_workspace` +
  `window_note`, both set before a `ws-N`/`note-N` window's page loads; a shell-assigned `ws-`/`note-`
  window SKIPS the folder probe — the opener verified it moments ago — so new windows paint fast;
  NOT the main window, whose assignment is registered on every in-place open and can be hours stale
  after a webview reload) → the
  last-active pointer → `choosing`. A note window's assignment surfaces as `windowNote`
  ({workspaceId, noteId}), which App forwards to `Workspace` as `initialNoteId` only while the window
  still shows that workspace — and is cleared for good on the first explicit `openWorkspace` switch,
  so returning to the original workspace later restores its own last-active note, not the stale
  assignment. `openWorkspace(id)` switches in place (probe-guarded; desktop first asks
  `focus_workspace_window` so a workspace already shown elsewhere is focused, not duplicated; a failed
  switch leaves the current workspace mounted); `openInNewWindow(id)` invokes `open_workspace_window`
  (refreshing the registry and failing LOUDLY if the workspace is no longer in it — it's also the ⌘0
  path); `openNoteInNewWindow(noteId, title)` invokes `open_note_window` for the ACTIVE workspace;
  `pickFolderForNewWindow()` probes the picked folder (timed, BEFORE touching the registry — the new
  window skips its own probe on the premise the opener verified it, and a dead/huge pick must not
  become the launch pointer) then opens it as its own window — persisting the registry
  entry FIRST, since that's what the new window's bootstrap reads. Activation touches the registry,
  registers the window's workspace, and sets the native title (skipped in note windows — their title
  tracks the open note, owned by `Workspace`). Detects the Tauri shell (`__TAURI_INTERNALS__`):
  there `pickFolder()` uses the native dialog and `tauri-fs` opens go straight to `ready` (no
  `needs-permission`; an FSA _switch_ tries `requestPermission` inline — it runs off a gesture —
  before falling back to the grant gate). `supportsFolders` (= native app OR browser FSA) drives
  whether the folder option is offered. Every async action claims an `opSeq` ticket and bails once
  superseded (including the detached post-activation writes — recency, `set_window_workspace`, native
  title — so a rapid A→B switch can't restore A next launch or register A for a window showing B), so a
  slow bootstrap read can't clobber a user choice and rapid switches can't interleave. `reset()`
  returns to the gate but DOES `clearLastActive()` (so "choose different storage" sticks across a
  relaunch) while keeping the registry.
- `src/hooks/useNotes.ts` — note list, selection, **debounced autosave** (500 ms), and **conflict
  detection**. Editing is deliberately decoupled from React state: keystrokes flow into a ref + timer,
  not `setState`, so the markdown editor instance is never re-created mid-typing. Pending edits are
  flushed before every lifecycle transition (open/create/rename/remove/close/change-storage) and on
  `visibilitychange` / `beforeunload`; `open()` is guarded by a generation counter (wrong-note race) and
  short-circuits the already-open note (no remount). An optional `initialNoteId` (a note window's
  assignment) overrides the restore: that note loads instead of the sidecar's last-`active` pointer,
  and the pointer belongs to the main window's next-launch restore — the load never writes it, and
  every later metadata write from that hook (pin, appearance, wiki-link navigation, close) substitutes
  the LIVE on-disk `active` at the write boundary (`writeMetadataNow` re-reads the sidecar; in-memory
  `active` keeps tracking the window's own note for the conflict checks). Re-lists on window focus
  (2 s throttle, `ready`-gated) — main + note windows
  routinely show the same folder now, so a returning window picks up notes created/edited elsewhere.
  On desktop it also subscribes to `store.watch` (`ready`-gated): external changes push a
  300 ms-debounced, in-flight-coalesced pipeline that runs `checkOpenNoteConflict` THEN `refresh()`
  (that order matters — `reconcile` nulls a vanished `active`, so refresh-first would swallow the
  deleted-conflict banner; the focus re-list runs the same check-then-refresh order for the same
  reason; the corpus follows the list signature for free). `checkOpenNoteConflict` RE-VALIDATES
  after its `store.stat` await (same id, no conflict/pending/save, baseline unchanged) — a note
  switch mid-stat would otherwise raise a phantom conflict for the WRONG note, whose banner
  actions key off `conflict.id` and would cross-contaminate the two notes — and mirrors a raised
  conflict into `conflictRef` synchronously (the effect mirror lags a render; flush's raise sites
  do too), because `refresh()` reads the ref to KEEP a vanished `active` alive while its
  deleted-conflict banner is up (nulling it would silently drop every keystroke typed under the
  banner — `edit()` records nothing without an id). `refresh()` also merges newest-wins per row,
  so a save landing mid-walk isn't clobbered back to a stale preview (`addNote` replaces-not-
  appends for the same reason). The hook's own writes echo back through the watcher via
  `recentLocalWritesRef` (3 s window; every mutation stamps its rel-path — store-returned, post-
  sanitize — AND the `dirname()` ancestor chain, since fs ops churn ancestor dirs; an EMPTY
  `paths` event is NEVER suppressible, `[].every()` is vacuously true): echo-only batches skip
  the 300 ms cadence but are NEVER dropped — they defer ONE trailing verify run
  (`WATCH_SUPPRESSED_VERIFY_MS`, past the stamp window, superseded by any sooner real run), so a
  stamp false-positive (an external dir-only event under an ancestor stamp, an external rewrite
  of a just-saved note) delays a refresh instead of losing it; correctness additionally never
  rests on suppression because a save advances `baselineRef` before its echo lands.
  `saveInFlightRef` gates the conflict check (mid-save, `pendingRef` is already null and
  `baselineRef` stale → phantom conflict). Events while `hidden` latch and replay on
  `visibilitychange` (visible ≠ focused, so the focus re-list wouldn't cover it; `run()` re-checks
  visibility at fire time). A failed `watch()` subscription degrades to focus-refresh with a
  `console.warn`. Exposes `flushPending()` (teardown), `refresh()` (plain re-list), `reload()`
  (check-then-refresh — the orb menu's "Reload notes" and post-import path; a bare `refresh()`
  there would swallow the deleted-conflict), and `withBulkWrites()` (holds the watcher/focus
  pipelines off during import — bulk writes bypass the echo stamps). Takes a `NoteStore` —
  agnostic to which backend it is.
- `src/hooks/useCorpus.ts` — the **shared body corpus**, loaded once (lazily, while a query is live or a
  note is open) and shared by full-text search AND backlinks, so `getAll()` runs once (one big IPC on
  desktop) and every body is held once. Derives `contentById` (raw, for snippets), `lowerById`
  (pre-lowercased), and `linksById` (`[[…]]` pre-extracted). Refreshes **incrementally** (re-reads only
  notes whose `updatedAt` changed — plus any cached with an EMPTY body whose list preview turned
  non-empty: an iCloud-dataless file materializes without an mtime bump, so the preview flip is the
  only signal its content became readable; the signature includes that bit) and keeps `linksById`'s
  identity stable across a non-link edit, so a
  plain autosave doesn't rebuild the backlink graph. Dropped on backend change.
- `src/hooks/useNoteNavigation.ts` / `useNoteSearch.ts` / `useBacklinks.ts` / `useShortcuts.ts` — list
  cursor + focus ladder (browse/commit/escape); search-or-create scoring against the shared corpus; the
  open note's backlinks (invert once via `useCorpus.linksById`, then snippet + sort lazily per open
  note); and the global keyboard shortcuts (driven by the `SHORTCUTS` descriptor in `src/shortcuts.ts`,
  which the help dialog also renders from). Punctuation chords match by `event.code` (e.g. `⌘⇧;` →
  `Semicolon`), since the shifted `event.key` differs. `useShortcuts` skips ALL global chords while a
  `[role="dialog"]` modal is open (the dialog owns the keyboard — so ⌘N can't create a note behind the
  ⌃R switcher). `useDebouncedValue` debounces the query (120 ms) only above a 500-note vault (wired in
  `Workspace`).
- `src/hooks/useListboxNav.ts` — the shared filter-over-listbox keyboard model for the ⌃R workspace
  switcher AND the ⌘⇧M move-to picker: a DOCUMENT-level keydown listener while open (↑/↓ skip-disabled,
  ↵ commit, ⌘⌫ remove, Esc close), a range/disabled clamp on list change, and scroll-into-view. It's
  document-level (not input-scoped `onKeyDown`) + paired with `initialFocus={inputRef}` because
  Gravity's `Dialog` focus-manager can park focus on the dialog container, where an input handler goes
  silent. Callers own filtering + rendering + pre-highlight seeding; `highlightMatch` (shared) marks
  the filter match.
- `src/hooks/useSettings.ts` — the **appearance model**: `Settings` (app-wide editor font / accent /
  text width + the toolbar/icons toggles), `WorkspaceSettings` (per-workspace `'default'`-able
  overrides), `NoteAppearance` (per-note font + width, read from the metadata sidecar — accent is
  deliberately NOT per-note), and pure `effectiveAppearance` (note wins → workspace → app). The app
  and workspace layers persist through a shared `usePersistedSettings` that MERGES into the freshest
  stored object at write time and adopts other windows' writes via `storage` events — the desktop
  runs one window per workspace over one localStorage, so a naive whole-object persist was a
  multi-window lost update. `Workspace` stamps the resolved values on `<html>` as
  `data-editor-font` / `data-accent` / `data-text-width`; `index.css` consumes them (per-font
  `--gn-editor-*` metrics; serif = self-hosted PT Serif, woff2-only rules in `src/fonts/pt-serif.css`).
  Also owns the one-shot legacy-localStorage → sidecar migration helpers (keys are cleared only after
  the adoption verifiably lands on disk; trashed notes' overrides attach to their `TrashEntry`).
- `src/hooks/useAppUpdater.ts` — in-app auto-update (macOS desktop) over the Tauri updater/process
  plugins: a small state machine (check → available → downloading → installed / restart-required /
  error, with retry). `isTauri`-guarded, all Tauri APIs via dynamic `import()`, so it no-ops and stays
  out of the web bundle. `Workspace` runs a silent check on launch (production only) → toast; `TopBar`
  adds a manual "Check for Updates…" item; `UpdateDialog` renders the flow.
- `src/components/` — `FolderGate` (first-run storage choice + folder re-permission gate + a recents
  list so a failed probe is never a dead end; **desktop is folder-first** — in-browser storage is
  offered on the web only; the transient `loading` state renders NO gate UI — just a 300 ms-delayed
  spinner — so fresh windows don't flash the welcome card), `Workspace` (top bar + layout + nav
  wiring; takes the
  `NoteStore` and a `workspaceId` — App remounts it `key`ed per workspace, so switches start clean;
  owns export/import and the flush-then-confirm guard before any workspace switch; per-workspace UI
  layout persists under `gravity-notes:<wsId>:*` localStorage keys, adopting the legacy un-namespaced
  value once — note windows skip both the read and the write, start with panels closed + editor
  focused (search box when the assigned note failed to load, so the window is never
  keyboard-orphaned), and sync their native title + `set_window_note` assignment to the open note
  ONLY once `notes.ready` — the mount run would otherwise push `set_window_note(null)` mid-load and
  wipe the shell's pre-seeded assignment (a second ⌘↵ during the load would duplicate the window);
  also owns the
  floating **Preview badge** (read-only preview is otherwise invisible; hover swaps it to "Exit
  preview", click or ⌘⇧P leaves) and the **search auto-peek** — typing a query while the sidebar is
  collapsed peeks the list WITHOUT stealing focus from the box, and clearing the query or committing a
  match tucks it away), `TopBar` (nvALT search box + orb menu [export / import / manage attachments /
  trash / **Open Recent submenu** (click = switch in place, ⌘-click = new window on desktop;
  "Workspaces…" opens the ⌃R switcher) / **Open Folder…** (⌘-click = new window)] + theme/help
  controls + save-status dot),
  `WorkspaceSwitcherDialog` (the ⌃R recents switcher; shares the keyboard model with MoveToDialog via
  `useListboxNav`: filter + ↑/↓ + ↵ open / ⌘↵ new window / ⌘⌫ remove; OTHER workspaces lead by recency
  with the current one parked last, and the top row is pre-highlighted, so ⌃R↵ ⌃R↵ ping-pongs between
  the two most recent workspaces; a pinned "Open Folder…" action row sits outside the filter; the
  in-browser row is offered on the web only — an existing in-app registry entry still lists so no data
  strands), `FolderRail` (collapsible
  nested-folder tree left of the list — select/scope,
  drag-and-drop, rename, pin; toggle ⌘⇧\), `NoteList` (sidebar with create/rename/delete/move, pin,
  sort, **Open in New Window** (row ⋯/context menu, ⌘↵, ⌘-click — desktop only, gated by the optional
  `onOpenInNewWindow` prop); right-click and ⌘-click deliberately NEVER move the selection (the menu
  acts via its own payload, and a row `onMouseDown` blocks the focus grab); a **folder-scope chip**
  names the filter when a folder is selected while the rail is closed (click opens the rail, ✕ clears
  to All Notes without switching notes); **virtualized** via `@tanstack/react-virtual`, with a
  `rangeExtractor` that keeps the
  keyboard-focused row and any open row popover's anchor row (⋯ menu / icon picker) mounted; rows
  render only an `IconPickerButton` glyph and share ONE `IconPickerPopup` — like the one shared row
  menu — so a closed picker costs nothing per row and scrolling can't unmount an open one), `MoveToDialog` (the ⌘⇧M move-to-folder picker — the chord is
  list-scoped via `inTyping:false`, so in the editor ⌘⇧M stays the markdown heading shortcut; shares
  `useListboxNav` with the workspace switcher),
  `EditorPane` (wraps the Gravity markdown editor; re-created per editing session via a stable
  `useNotes.sessionId`, so a rename doesn't remount it; saves/restores per-note **scroll + caret** on
  switch — the reused editor would otherwise carry the previous note's scrollTop; a note switch also
  hard-resets BOTH undo histories — ProseMirror via a fresh `EditorState`, and markup-mode CodeMirror
  via `editor/markupHistory.ts` (a pristine CM state snapshotted at mount becomes the template for
  fresh per-note states — `replace()` is a history-recorded dispatch and `addToHistory:false` only
  REMAPS old events, so without the template reset ⌘Z in markup mode walked into the previous note's
  content); **linkify**: `md: {linkify: true}` with fuzzy matching OFF via `configureMd`
  (`fuzzyLink/fuzzyEmail: false` — `.md` is a real TLD, so fuzzy would rewrite a `Notes.md` mention
  on disk; bare URLs normalize once to `<url>` on save) plus `editor/linkifyTypedUrls.ts`, an
  InputRule that linkifies a just-typed URL on trailing whitespace with the `raw-link` attr (typed
  links round-trip as the BARE url); the wiki tooltip/suggest popups are gated by `swappingRef`
  (exposed as `isSwapping` to the extension) which starts TRUE at mount and brackets every content
  swap — mid-swap anchors get detached by the swap's own redraw (a popup pinned to a detached element
  renders stuck at the viewport's top-left), and a restored caret inside a `[[link]]` must not pop UI
  unasked (the caret at a link's LEFT edge doesn't count as inside it, matching `inclusive: false`);
  `.editor-pane` carries `transform: translateZ(0)` — its own compositing layer — because WKWebView
  otherwise occasionally leaves a stale paint of the caret line behind after a swap/resize (a ghost
  "doubled" line); the floating
  **selection toolbar is a vendored fixed copy** (`editor/selectionContextFix.ts` — the stock plugin
  never re-arms its flags after the plugin-view recreation every note switch triggers, going
  permanently dead; the bundle's own is disabled via `selectionContext: {config: []}` and the fixed
  one registered at High priority so Escape still reaches it — drop the file when upstream fixes it,
  and keep `@gravity-ui/markdown-editor` pinned exact meanwhile). Its `SELECTION_MENU_CONFIG` swaps
  the block-type "Text"/H1–H6 Select for a local `SelectionHeadingSelect` — the bundle's
  `ToolbarSelect` wires `onOpenChange` to the editor `focus()`, which re-closes the dropdown the
  instant it opens inside the floating toolbar; the local version omits that wiring so the menu
  opens) with `NoteTitle` and
  `NotePreview` (read-only render via `@diplodoc/transform`, mirroring the editor's linkify +
  fuzzy-off config; every link click routes through `openExternalUrl` instead of navigating the
  surface), `AttachmentsDialog` (manage attachments — list/usage/sort/
  delete + full-size view; virtualized list), `Lightbox` (shared full-size image overlay with
  pinch/scroll zoom + drag-pan), the editor's custom image NodeView (`editor/attachmentImageView` +
  `attachmentImageExtension`: resize, caption, click-to-zoom, broken state), the `[[wiki link]]` editor
  pieces (`editor/wikiLinkExtension` — a mark with `escape: false` so it round-trips — plus the
  `WikiLinkSuggest` `[[` picker and `WikiLinkTooltip`), `BacklinksPanel` (the "linked references" list
  under the open note), `ConflictBanner`, `ShortcutsDialog`, `SettingsDialog` (⌘, — General toggles +
  Appearance for the app and workspace layers), `NoteAppearancePopover` (the per-note font/width
  popover off the TopBar's ⋯ button or ⌘⇧I; survives rename/move — its close effect keys on
  `sessionId`, not note id; shared segmented pickers + option arrays live in `appearanceControls.tsx`,
  derived from the canonical value arrays in `useSettings`), `UpdateDialog` (the software-update sheet;
  release notes rendered as Markdown via `@diplodoc/transform`), `AboutDialog` (the app's own About box
  with clickable links, opened from the native menu's `menu:about` event — the OS panel can't show
  clickable links), `ThemeSwitcher`, and `ErrorBoundary` (root render-crash net).
- `src/App.tsx` — Gravity providers (theme, mobile, toaster) + theme persistence; wraps the app in
  `ErrorBoundary`. The theme key (`gravity-notes:theme`) is also read by an inline anti-flash
  script in `index.html` that paints the document background in the resolved theme before the bundle
  loads (so launch doesn't flash white before dark) — keep the two in sync. Also owns the **⌘0
  (`menu:main-window`) listener** — deliberately HERE, not in `Workspace`: App mounts exactly once
  per window and never remounts, whereas `Workspace` is keyed by workspace and remounts on every
  ⌃R switch, so registering the listener there leaked a duplicate per switch (a window then fired
  ⌘0 for several workspaces at once). It reads the live workspace/state via a ref and calls
  `openInNewWindow(activeWorkspaceId)` (fallback `focus_main_window` when no workspace is mounted —
  bootstrapping, or parked on the gate).
- `src/main.tsx` — app-shell + Gravity/markdown-editor stylesheet imports.

## Conventions

- React 18 function components + hooks; TypeScript `strict` (plus `noUnusedLocals`/`noUnusedParameters`).
- UI is **Gravity UI** (`@gravity-ui/uikit`, `@gravity-ui/icons`) — prefer its components over hand-rolled ones.
- Code style follows the Gravity ecosystem (single quotes, sorted imports), enforced via
  `@gravity-ui/eslint-config` + `@gravity-ui/prettier-config`.
- Errors surface to the user via the toaster (`onError` in `Workspace`); storage methods throw and
  callers translate to toasts.
- Keep new persistence behind `NoteStore` so alternative backends (the Tauri `fs` store, HTTP API,
  IndexedDB) stay drop-in. Anything that runs only in the desktop shell must feature-detect Tauri (the
  canonical `isTauri` lives in `src/isTauri.ts`) and keep the browser build working (e.g. `pickFolder`
  branches; `@tauri-apps/plugin-dialog`/`-updater`/`-process` are loaded via dynamic `import()` so they
  never enter the web bundle).

## Docs

Human-facing docs live in `docs/`: `architecture.md` (how it's built, the on-disk format, and the
**known limitations** — the canonical list) and `shortcuts.md` (the full shortcut sheet). The
README stays slim — features, two-path Getting started (download / from source), doc pointers,
backlog. Keep these in sync with code changes: a new/changed shortcut updates `docs/shortcuts.md`
alongside the `SHORTCUTS` descriptor in `src/shortcuts.ts` (the in-app `⌘/` dialog renders from the
descriptor, the doc is by hand); a new limitation, storage-format change, or architectural shift
updates `docs/architecture.md`; a new user-facing feature gets a README feature bullet.

## Roadmap

Roadmap, TODOs, and backlog live in `README.md`.
