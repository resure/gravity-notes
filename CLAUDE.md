# CLAUDE.md

Guidance for working in this repository.

## What this is

**Gravity Notes** — a local-first Markdown note-taking app, shipping as both a **web app** and a
**macOS desktop app** (Tauri 2). On first run the user chooses where notes live: a **folder** of
plain `.md` files or **in-browser** (IndexedDB). Built on the [Gravity UI](https://gravity-ui.com/)
ecosystem, with a vendored Notion-style **block editor** as the note body.

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
- `src/storage/transfer.ts` — `.md` export (a whole-vault zip via `fflate`, or `exportNote` for a
  single file — the note menu's "Export this note…", note bytes only) and import (`.md` / `.zip`), for any
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
- `src/markdown/` — **Block[] ⇄ Markdown**, the format seam for the block editor (below): pure,
  DOM-free, node-testable. `toMarkdown` favours what other tools understand (headings, lists, task
  lists, GFM tables, fenced code) and gives the three types with no Markdown spelling a portable
  encoding — toggle → `<details>` (the collapsed state rides on the `open` attribute), callout →
  an Obsidian `> [!note]`, image → `![](Attachments/…)`. `fromMarkdown` is a small LINE-ORIENTED
  parser, not CommonMark: it must recognise exactly what the writer emits (the round trip is the
  design intent — a load/save cycle must not rewrite a file) and degrade everything else to
  paragraphs. Degrading is only SAFE because the fixed point is **verified, not assumed**:
  `isRoundTripStable` (`roundTrip.ts`) checks `blocksToMarkdown(markdownToBlocks(text)) === text` and
  `EditorPane` consults it per session, forcing THAT note onto the raw-source surface when it fails
  (`forceSource` on `BlockEditorBody`). This is load-bearing, not
  belt-and-braces: the block engine re-serializes the WHOLE document on every keystroke, so anything
  the parser reads imperfectly is rewritten across the whole note on the first edit anywhere in it —
  frontmatter, an H4, a fence's language, a callout's kind, a table's alignment. Anything that widens
  the parser must keep that check as the backstop, and `markdown.test.ts` pins both halves (the
  regression corpus of notes this once corrupted, and the constructs the guard is expected to reject).
  Measured against the demo vault, 36/65 notes currently open in blocks; the biggest remaining
  causes are fence languages and table cell padding.
  `inline.ts` is a hand-rolled scanner for the span level; four rules matter — a `[[wiki link]]` is
  NEVER escaped (it reaches disk as the literal bytes Obsidian writes, which is what the backlink
  scan looks for) but DOES get a style-only wrapper (`WIKI_LINK_CLASS`, whose text is still the
  literal brackets, so the serializer has nothing to undo); a `<br>` is written as a plain newline,
  not a backslash hard break, so a soft-wrapped paragraph survives a save without the file sprouting
  punctuation; a lone `~` is not escaped (only `~~` opens strikethrough, and escaping every tilde
  rewrote `~4 min` to `\~4 min` on disk); and a `<url>` autolink carries `data-autolink` so it is
  written back in the SAME spelling instead of becoming `[url](url)`.
- `src/components/blockEditor/` — the **Notion-style block editor**: each block is its own
  `contentEditable` (no ProseMirror), with a slash menu, drag handles, block selection, tables, and
  its own undo history. It began life as a standalone app and is now **vendored — this is its home**,
  so it's edited freely rather than kept re-syncable: the standalone page chrome (its own title,
  icon picker, save indicator, undo buttons) has been deleted, since the pane above supplies all of
  it, and the surviving surface is body-only. Three things to know: `editor.css` is scoped under
  `.gn-block-editor` by `scripts/scope-css.mjs` (its class names — `.page`, `.content`, `.block` —
  would otherwise style the rest of the app); its palette is Notion's, hard-coded light, so the ink
  is a `--n-ink` channel triple that `.g-root_theme_dark` re-tints in one line; and the floating
  overlays (slash menu, block menu, selection toolbar) are `position: fixed` in VIEWPORT coordinates
  AND portaled to `<body>` via `OverlayPortal` — the host pane scrolls, clips its overflow, and
  carries a `transform`, which both re-anchors `fixed` to the pane and cuts the overlay off. The
  portal host re-applies the `.gn-block-editor` scope class (with `display: contents`) so the scoped
  rules still match once the overlay leaves the subtree. Block furniture is SPLIT across both
  margins — drag handle left, add button right — so the left gutter only has to fit one 18px button
  (`.editor-pane` widens the shared `--editor-gutter` to 36px, which the note TITLE reads
  too, so title and body keep one left edge). `[[wiki links]]` are authored here: `wikiDecorate.ts`
  wraps them for styling WITHOUT touching a character of text (so the caret offset is invariant and
  the editor can re-decorate mid-keystroke and simply put the caret back), the broken class is
  re-derived from `createWikiLinkResolver` whenever the note-id SIGNATURE changes (never per
  autosave), and `[[` opens `WikiSuggestMenu` — same portal/positioning machinery as the slash menu,
  with a trailing `Create "<query>"` row that inserts the literal `[[query]]` (insert-only).
  Every floating surface's fill is `--n-surface`, remapped in the dark block: the overlays portal to
  `<body>`, so a hard-coded white there painted white text on a white card.
  ESLint's jsx-a11y rules are relaxed for this directory only (a `contentEditable` div IS focusable
  and IS a textbox; the rules can't tell, and the editor drives focus itself).
- `src/components/BlockEditorBody.tsx` — the **adapter** between `EditorPane` and the block editor:
  it owns the ⌘⇧; blocks↔source flip (a plain textarea; `forceSource` pins it there for a note that
  fails the round-trip guard, and `toggleMode` is then a no-op) and the per-note scroll + caret
  restore. The editor is keyed on `sessionId`, so a note switch REMOUNTS it — the outgoing note's
  scroll and caret are therefore captured in RENDER, before the keyed child unmounts, which is the
  last moment `editorRef` still points at the old instance. Block ids are minted per parse, so the
  caret is saved as a block INDEX (`EditorCaret`), not an id. `focus()` is deliberately
  caret-PRESERVING (a no-op when focus is already in the body) — the pane calls it on
  every click-to-focus path, and a naive "focus the first block" pinned the caret to block 1 and
  made the surface unusable with a mouse.
- `src/hooks/useSettings.ts` — the **appearance model**: `Settings` (app-wide editor font / accent /
  text width + the note-icons toggle), `WorkspaceSettings` (per-workspace `'default'`-able
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
- `src/ui/` — the **design-system primitives**, on [`@base-ui/react`](https://base-ui.com) for
  behaviour and ~100% our own CSS for looks. `Button` (quiet / raised / filled — `filled` appears
  exactly ONCE in the app, on the folder gate, and `raised` marks the one action a pane exists for),
  `Icon`/`icons` (the hand-drawn set: one stroke each, drawn on a 16 box, with the stroke WEIGHT a
  function of the rendered size — a path merely scaled goes spindly at 12 and heavy at 26), `Menu`
  (+`MenuItem`/`MenuSub`/`MenuPanel`), `Dialog`+`AlertDialog`, `Popover`, `Select`, `Switch`,
  `ToggleGroup`, `Input`, `Tooltip`, `toast`, and `bits` (Kbd / Chip / Banner / Skeleton). Three
  things here are contracts, not styling:
  - **`.ui-pop` is a selector other code depends on.** Every floating surface carries it, and
    `Workspace`'s F2 guard tests `closest('.note-title-row, .ui-pop, .g-popup, [role="dialog"]')` to
    know focus is inside a floating layer. Base UI portals all of them to `<body>`, so the guard
    cannot walk the React tree instead. (`.g-popup` stays until the last uikit popup goes.)
  - **Dialogs must never be `keepMounted`.** `useShortcuts` goes quiet while
    `[role="dialog"]:not(.ui-toast), [role="alertdialog"]` matches, so a kept-mounted dialog would
    silence every global chord for the session. The `:not(.ui-toast)` is equally load-bearing: an
    interactive toast is a `role="dialog"` too, and one failure toast would otherwise kill the
    keyboard while it was on screen.
  - **Menus anchor, they don't only trigger.** `Menu` takes an `anchor` (an element OR a zero-size
    rect at the cursor) as well as a `trigger`, which is what lets the note list and folder rail keep
    ONE menu instance across thousands of rows and still open at the pointer on right-click. With a
    bare anchor there is no trigger to return focus to, so callers pass `finalFocus`.
- `src/listGroups.ts` — pure list grouping (no I/O, no React; sibling to `search.ts`/`tree.ts`):
  interleaves Pinned / Today / Yesterday / Earlier labels — or A, B, C under a title sort — into an
  already-ordered note list. Groups FOLLOW the active sort, and a live search gets none at all: its
  results are ranked, not sorted, so "Today" over them would be a lie about the order.
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
  match tucks it away), `TopBar` (the 44px title bar: two 26px pane toggles, the **Orb** (a flat 19px
  amber disc — the app MARK, not an accent, which is why it never recolours with state) holding
  everything app-wide [workspace list (click = switch in place, ⌘-click = new window on desktop) /
  Open Folder… (⌘-click = new window) / Workspaces… (⌃R) / export / import / attachments / trash /
  reload / toggle sidebar / theme / settings / shortcuts / updates / about], a **window-centred**
  404×27 search field (absolutely positioned, so a long title or a wide pane can never nudge it off
  centre), and at the right the **sync dot + word** — which REPLACED the toast that used to fire on
  every save — then the open note's own **⋯ menu**. The one structural rule is that "what is this
  app doing" and "what is this note doing" are never in the same list: the ⋯ carries the appearance
  strips (two ToggleGroups inline in the popup, out of the arrow-key ring), preview / markup, and the
  note's file actions, and ⌘⇧I opens it),
  `WorkspaceSwitcherDialog` (the ⌃R recents switcher; shares the keyboard model with MoveToDialog via
  `useListboxNav`: filter + ↑/↓ + ↵ open / ⌘↵ new window / ⌘⌫ remove; OTHER workspaces lead by recency
  with the current one parked last, and the top row is pre-highlighted, so ⌃R↵ ⌃R↵ ping-pongs between
  the two most recent workspaces; a pinned "Open Folder…" action row sits outside the filter; the
  in-browser row is offered on the web only — an existing in-app registry entry still lists so no data
  strands), `FolderRail` (the 236px
  nested-folder tree left of the list — select/scope, drag-and-drop, rename, pin; toggle ⌘⇧\. Rows
  are the same 14/500 type as the note list so the two panes read as one app, grouped by two mono
  labels (Library / Folders) and indented by a 12px step with a hairline guide; **Trash sits at the
  foot** — a destination, not a folder, and so deliberately outside the tree's roving-tabindex ring —
  above a 36px "New Folder" row. It stays a plain roving-tabindex tree and NOT a Base UI Menu:
  Menu/Select capture single letters for type-to-select, which would eat `n` and the vim `j`/`k`), `NoteList` (the 324px middle pane: a 38px **scope header** (folder name ·
  count · sort Select · the app's ONE raised button, "+ New") over **time-group labels** and **58px
  FIXED rows** — the height is a virtualizer contract, not a measurement, which is what keeps the
  arithmetic exact at three thousand rows. A row is a title with the time beside it plus one line of
  the note's own first words; the time gives way to a 24px ⋯ on hover. Pins are the first GROUP
  rather than a badge on a row, and the scope header is what replaced the per-row breadcrumb (only
  the leaf folder name still shows, and only outside a scoped folder). Create/rename/delete/move,
  pin, sort, **Open in New Window** (row ⋯/context menu, ⌘↵, ⌘-click — desktop only, gated by the
  optional `onOpenInNewWindow` prop); right-click and ⌘-click deliberately NEVER move the selection
  (the menu acts via its own payload, and a row `onMouseDown` blocks the focus grab); a
  **folder-scope chip** names the filter when a folder is selected while the rail is closed (click
  opens the rail, ✕ clears to All Notes without switching notes); **virtualized** via
  `@tanstack/react-virtual`, with a `rangeExtractor` that keeps the keyboard-focused row and the open
  ⋯ menu's anchor row mounted. Hover is suppressed on the row directly above or below the selection
  (two washes of the same family would read as one four-line block) — via a `data-no-hover` attribute
  on the row's POSITIONING WRAPPER, never a prop, so a selection change still re-renders exactly two
  memoized rows), `MoveToDialog` (the ⌘⇧M move-to-folder picker — the chord is
  list-scoped via `inTyping:false`, so in the editor ⌘⇧M stays a typing chord; shares
  `useListboxNav` with the workspace switcher),
  `EditorPane` (the note title above the block editor body; the pane does NOT remount on a switch —
  `BlockEditorBody` is keyed on `useNotes.sessionId` internally, so a rename doesn't rebuild
  anything and a real switch rebuilds only the body. It runs `isRoundTripStable` once per session
  and passes `forceSource` down; it is also the scroll container the body saves/restores per note.
  `.editor-pane` carries `transform: translateZ(0)` — its own compositing layer — because WKWebView
  otherwise occasionally leaves a stale paint of the caret line behind after a swap/resize (a ghost
  "doubled" line) — and widens `--editor-gutter` to 36px for the block editor's drag handles) with
  `NoteTitle` and
  `NotePreview` (read-only render via `@diplodoc/transform` — deliberately a WIDER grammar than the
  block editor's own parser, since the notes blocks can't hold are exactly the ones a preview must
  get right; linkify with fuzzy matching OFF (`.md` is a real TLD, so fuzzy would turn a `Notes.md`
  mention into a link); every link click routes through `openExternalUrl` instead of navigating the
  surface), `AttachmentsDialog` (manage attachments — list/usage/sort/
  delete + full-size view; virtualized list), `Lightbox` (shared full-size image overlay with
  pinch/scroll zoom + drag-pan; the block editor's `AttachmentImage` opens it on click, and also
  carries drag-resize — persisted as the YFM ` =600x` suffix, which `NotePreview`'s `imsize` plugin
  understands — plus alt/caption editing and explicit loading/broken states),
  `BacklinksPanel` (the "linked references" list
  under the open note), `ConflictBanner`, `ShortcutsDialog`, `SettingsDialog` (⌘, — the note-icons toggle +
  Appearance for the app and workspace layers), `UpdateDialog` (the software-update sheet;
  release notes rendered as Markdown via `@diplodoc/transform`), `AboutDialog` (the app's own About box
  with clickable links, opened from the native menu's `menu:about` event — the OS panel can't show
  clickable links), and `ErrorBoundary` (root render-crash net).
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
- `src/main.tsx` — app-shell stylesheet imports, in cascade order (the one file where `import/order`
  is off). The YFM content styles come straight from `@diplodoc/transform`; the small `--yfm-*`
  variable maps that used to arrive with `@gravity-ui/markdown-editor` are vendored in
  `src/yfm-tokens.css`.

## Conventions

- React 18 function components + hooks; TypeScript `strict` (plus `noUnusedLocals`/`noUnusedParameters`).
- UI is being rewritten onto **Base UI** (`@base-ui/react`) + our own CSS: reach for a primitive in
  `src/ui/` first, and add one there rather than styling a component in place. What is still Gravity
  UI (`@gravity-ui/uikit`, `@gravity-ui/icons`) is mid-migration and leaves in the dialogs pass.
- Code style follows the Gravity ecosystem (single quotes, sorted imports), enforced via
  `@gravity-ui/eslint-config` + `@gravity-ui/prettier-config`.
- Errors surface to the user via `toast()` from `src/ui/toast` (`onError` in `Workspace`) — and ONLY
  genuine failures and things with an action to take do: the save confirmation is gone, replaced by
  the title bar's sync dot. Storage methods throw and
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
