# CLAUDE.md

Guidance for working in this repository.

## What this is

**Gravity Notes** — a local-first Markdown note-taking app. On first run the user chooses where notes
live: a **folder** of plain `.md` files (browser **File System Access API**) or **in-browser**
(IndexedDB). Built on the [Gravity UI](https://gravity-ui.com/) ecosystem, with
`@gravity-ui/markdown-editor` as the WYSIWYG/Markdown editor.

**Browser support:** any modern browser. Folder storage is Chromium-only (the File System Access API
is unavailable in Firefox/Safari), so those browsers are offered only the in-browser backend. Notes
move between backends via `.md` export/import (`src/storage/transfer.ts`).

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
```

## Architecture

```
FolderGate ──▶ NoteStore (filesystem | indexeddb) ──▶ useNotes() ──▶ NoteList + EditorPane
(choose storage)  (.md files on disk, or IndexedDB)     (state + autosave)   (UI)
```

All persistence sits behind the **`NoteStore` interface** (`src/storage/types.ts`) — the key extension
seam, with two backends. Note id = `<Title>.md` in both; the name without `.md` is the title. Anything
above the seam (`useNotes`, navigation, UI) is backend-agnostic.

Key modules:

- `src/storage/types.ts` — the `NoteStore` interface (storage-agnostic; no FS-specific types leak in).
- `src/storage/noteText.ts` — pure helpers shared by both backends: `titleFromFileName`,
  `sanitizeTitle`, `canonicalBody`, `previewFromContent`, `uniqueName`. Keeps id/body shape identical.
- `src/storage/fileSystemStore.ts` — `FileSystemNoteStore` (File System Access API). Trickiest logic:
  unique-filename resolution, copy-then-delete rename (no atomic rename), case-only rename via a temp
  name (case-insensitive filesystems), `writeFile` that aborts on failure.
- `src/storage/indexedDbStore.ts` — `IndexedDbNoteStore` (in-browser). Mirrors the FS store's
  semantics (`<Title>.md` ids, canonical body, `updatedAt`-based `ConflictError`, `NotFoundError` on a
  missing note) so `useNotes` is unaffected by which backend is active.
- `src/storage/transfer.ts` — `.md` export (zip via `fflate`) and import (`.md` / `.zip`), for any
  backend; the way to get plain files out of in-browser storage and migrate between backends.
- `src/storage/handlePersistence.ts` — remembers the chosen backend (and folder handle) in IndexedDB
  so reloads restore it; per-session permission re-grant. Each `tx()` closes the connection on
  complete / error / abort.
- `src/storage/metadata.ts` — the per-store metadata (`.gravity-notes.json` sidecar for the FS store):
  tolerant `parseMetadata`, pure transforms (`withPinToggled`, `withActive`, `reconcile`, …), and
  `orderNotes` (pins first, then the active sort).
- `src/hooks/useNotesStorage.ts` — first-run storage choice + permission lifecycle (state machine:
  `loading`/`choosing`/`needs-permission`/`ready`); yields a ready `NoteStore`. Bootstrap is
  `try/catch`-guarded and bails (via `interactedRef`) once the user chooses, so a slow IndexedDB read
  can't clobber it. Back-compat: a stored folder handle with no backend flag is treated as filesystem.
- `src/hooks/useNotes.ts` — note list, selection, **debounced autosave** (500 ms), and **conflict
  detection**. Editing is deliberately decoupled from React state: keystrokes flow into a ref + timer,
  not `setState`, so the markdown editor instance is never re-created mid-typing. Pending edits are
  flushed before every lifecycle transition (open/create/rename/remove/close/change-storage) and on
  `visibilitychange` / `beforeunload`; `open()` is guarded by a generation counter (wrong-note race) and
  short-circuits the already-open note (no remount). Exposes `flushPending()` (teardown) and
  `refresh()` (re-list after import). Takes a `NoteStore` — agnostic to which backend it is.
- `src/hooks/useNoteNavigation.ts` / `useNoteSearch.ts` / `useShortcuts.ts` — list cursor + focus ladder
  (browse/commit/escape), search-or-create filtering, and the global keyboard shortcuts (driven by the
  `SHORTCUTS` descriptor in `src/shortcuts.ts`, which the help dialog also renders from). Punctuation
  chords match by `event.code` (e.g. `⌘⇧;` → `Semicolon`), since the shifted `event.key` differs.
- `src/components/` — `FolderGate` (first-run storage choice + folder re-permission gate), `Workspace`
  (top bar + layout + nav wiring; takes the `NoteStore`, owns export/import), `TopBar` (nvALT search
  box + storage menu [export / import / change storage] + theme/help controls + save-status dot),
  `NoteList` (sidebar with create/rename/delete, pin, sort), `EditorPane` (wraps the Gravity markdown
  editor; re-created per editing session via a stable `useNotes.sessionId`, so a rename doesn't remount
  it) with `NoteTitle` and `NotePreview`, `ConflictBanner`, `ShortcutsDialog`, `ThemeSwitcher`, and
  `ErrorBoundary` (root render-crash net).
- `src/App.tsx` — Gravity providers (theme, mobile, toaster) + theme persistence; wraps the app in
  `ErrorBoundary`.
- `src/main.tsx` — app-shell + Gravity/markdown-editor stylesheet imports.

## Conventions

- React 18 function components + hooks; TypeScript `strict` (plus `noUnusedLocals`/`noUnusedParameters`).
- UI is **Gravity UI** (`@gravity-ui/uikit`, `@gravity-ui/icons`) — prefer its components over hand-rolled ones.
- Code style follows the Gravity ecosystem (single quotes, sorted imports), enforced via
  `@gravity-ui/eslint-config` + `@gravity-ui/prettier-config`.
- Errors surface to the user via the toaster (`onError` in `Workspace`); storage methods throw and
  callers translate to toasts.
- Keep new persistence behind `NoteStore` so alternative backends (Electron `fs`, HTTP API, IndexedDB)
  stay drop-in.

## Roadmap

Roadmap, TODOs, and backlog live in `README.md`.
