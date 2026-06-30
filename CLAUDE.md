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

Notes also move between backends via `.md` export/import (`src/storage/transfer.ts`). The Rust shell
lives in `src-tauri/` (only `src-tauri/src/lib.rs` carries app code: `notes_*` + `attachment_*` fs
commands, the folder ops, and `reveal_path`; it also registers the **updater** + **process** plugins,
sets a theme-aware native window background (anti-flash), and builds a **custom app menu** whose macOS
"About" item emits `menu:about` so the frontend can open its own `AboutDialog`).

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
spans notes, **nested folders**, and **media attachments** (plus an optional desktop-only `reveal`).
Anything above the seam (`useNotes`, navigation, UI) is backend-agnostic.

Key modules:

- `src/storage/types.ts` — the `NoteStore` interface (storage-agnostic; no FS-specific types leak in).
  Includes `getAll()` (every note with its body, one pass) that feeds the full-text search corpus. The
  seam also covers nested folders (`create(title, parentPath)`, `move`, `createFolder`/`removeFolder`/
  `moveFolder`/`listFolders`, and `listsRecursively` so metadata reconcile never prunes ids a backend
  can't yet enumerate), media attachments (`writeAttachment`/`writeAttachmentAt`/`readAttachment`/
  `listAttachments`/`removeAttachment`), and an optional desktop-only `reveal(relPath)`.
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
- `src/storage/handlePersistence.ts` — remembers the chosen backend in IndexedDB so reloads restore
  it: a `FileSystemDirectoryHandle` (web, per-session permission re-grant) or a plain folder-path
  string (`tauri-fs`, no re-grant — the OS governs access). Each `tx()` closes the connection on
  complete / error / abort.
- `src/storage/metadata.ts` — the per-store metadata (`.gravity-notes.json` sidecar for the FS store):
  tolerant `parseMetadata`, pure transforms (`withPinToggled`, `withActive`, `reconcile`, …), and
  `orderNotes` (pins first, then the active sort). The `pinned` set holds both note ids and folder
  paths — folders are pinnable too.
- `src/attachments.ts` — `AttachmentUrlCache` (one per store) lazily resolving `Attachments/…` refs to
  `blob:` object URLs at display time, provided through `AttachmentsContext`; revoked on store
  change/unmount. LRU **byte-budget eviction** (256 MB cap): callers `subscribe(ref, …)` to pin a
  visible image's URL (subscribed entries are never evicted) and get notified if it's re-seeded; `peek`
  is pure (no LRU touch), `resolve` touches. The stored Markdown always keeps the root-relative ref,
  never a blob URL.
- `src/hooks/useNotesStorage.ts` — first-run storage choice + permission lifecycle (state machine:
  `loading`/`choosing`/`needs-permission`/`ready`); yields a ready `NoteStore`. Detects the Tauri
  shell (`__TAURI_INTERNALS__`): there `pickFolder()` uses the native dialog and the `tauri-fs`
  bootstrap goes straight to `ready` (no `needs-permission`). `supportsFolders` (= native app OR
  browser FSA) drives whether the folder option is offered. Bootstrap is `try/catch`-guarded and bails
  (via `interactedRef`) once the user chooses, so a slow IndexedDB read can't clobber it. Back-compat:
  a stored folder handle with no backend flag is treated as filesystem.
- `src/hooks/useNotes.ts` — note list, selection, **debounced autosave** (500 ms), and **conflict
  detection**. Editing is deliberately decoupled from React state: keystrokes flow into a ref + timer,
  not `setState`, so the markdown editor instance is never re-created mid-typing. Pending edits are
  flushed before every lifecycle transition (open/create/rename/remove/close/change-storage) and on
  `visibilitychange` / `beforeunload`; `open()` is guarded by a generation counter (wrong-note race) and
  short-circuits the already-open note (no remount). Exposes `flushPending()` (teardown) and
  `refresh()` (re-list after import). Takes a `NoteStore` — agnostic to which backend it is.
- `src/hooks/useCorpus.ts` — the **shared body corpus**, loaded once (lazily, while a query is live or a
  note is open) and shared by full-text search AND backlinks, so `getAll()` runs once (one big IPC on
  desktop) and every body is held once. Derives `contentById` (raw, for snippets), `lowerById`
  (pre-lowercased), and `linksById` (`[[…]]` pre-extracted). Refreshes **incrementally** (re-reads only
  notes whose `updatedAt` changed) and keeps `linksById`'s identity stable across a non-link edit, so a
  plain autosave doesn't rebuild the backlink graph. Dropped on backend change.
- `src/hooks/useNoteNavigation.ts` / `useNoteSearch.ts` / `useBacklinks.ts` / `useShortcuts.ts` — list
  cursor + focus ladder (browse/commit/escape); search-or-create scoring against the shared corpus; the
  open note's backlinks (invert once via `useCorpus.linksById`, then snippet + sort lazily per open
  note); and the global keyboard shortcuts (driven by the `SHORTCUTS` descriptor in `src/shortcuts.ts`,
  which the help dialog also renders from). Punctuation chords match by `event.code` (e.g. `⌘⇧;` →
  `Semicolon`), since the shifted `event.key` differs. `useDebouncedValue` debounces the query (120 ms)
  only above a 500-note vault (wired in `Workspace`).
- `src/hooks/useAppUpdater.ts` — in-app auto-update (macOS desktop) over the Tauri updater/process
  plugins: a small state machine (check → available → downloading → installed / restart-required /
  error, with retry). `isTauri`-guarded, all Tauri APIs via dynamic `import()`, so it no-ops and stays
  out of the web bundle. `Workspace` runs a silent check on launch (production only) → toast; `TopBar`
  adds a manual "Check for Updates…" item; `UpdateDialog` renders the flow.
- `src/components/` — `FolderGate` (first-run storage choice + folder re-permission gate), `Workspace`
  (top bar + layout + nav wiring; takes the `NoteStore`, owns export/import), `TopBar` (nvALT search
  box + storage menu [export / import / manage attachments / change storage] + theme/help controls +
  save-status dot), `FolderRail` (collapsible nested-folder tree left of the list — select/scope,
  drag-and-drop, rename, pin; toggle ⌘⇧\), `NoteList` (sidebar with create/rename/delete/move, pin,
  sort; **virtualized** via `@tanstack/react-virtual`, with a `rangeExtractor` that keeps the
  keyboard-focused row mounted), `MoveToDialog` (the ⌘⇧M move-to-folder picker — the chord is
  list-scoped via `inTyping:false`, so in the editor ⌘⇧M stays the markdown heading shortcut),
  `EditorPane` (wraps the Gravity markdown editor; re-created per editing session via a stable
  `useNotes.sessionId`, so a rename doesn't remount it; saves/restores per-note **scroll + caret** on
  switch — the reused editor would otherwise carry the previous note's scrollTop; passes a custom
  `selectionContext` config that drops the block-type "Text" Select, which doesn't open inside the
  floating selection toolbar — see `SELECTION_MENU_CONFIG`) with `NoteTitle` and
  `NotePreview`, `AttachmentsDialog` (manage attachments — list/usage/sort/
  delete + full-size view; virtualized list), `Lightbox` (shared full-size image overlay with
  pinch/scroll zoom + drag-pan), the editor's custom image NodeView (`editor/attachmentImageView` +
  `attachmentImageExtension`: resize, caption, click-to-zoom, broken state), the `[[wiki link]]` editor
  pieces (`editor/wikiLinkExtension` — a mark with `escape: false` so it round-trips — plus the
  `WikiLinkSuggest` `[[` picker and `WikiLinkTooltip`), `BacklinksPanel` (the "linked references" list
  under the open note), `ConflictBanner`, `ShortcutsDialog`, `UpdateDialog` (the software-update sheet;
  release notes rendered as Markdown via `@diplodoc/transform`), `AboutDialog` (the app's own About box
  with clickable links, opened from the native menu's `menu:about` event — the OS panel can't show
  clickable links), `ThemeSwitcher`, and `ErrorBoundary` (root render-crash net).
- `src/App.tsx` — Gravity providers (theme, mobile, toaster) + theme persistence; wraps the app in
  `ErrorBoundary`. The theme key (`gravity-notes:theme`) is also read by an inline anti-flash
  script in `index.html` that paints the document background in the resolved theme before the bundle
  loads (so launch doesn't flash white before dark) — keep the two in sync.
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

## Roadmap

Roadmap, TODOs, and backlog live in `README.md`.
