# CLAUDE.md

Guidance for working in this repository.

## What this is

**Gravity Notes** — a local-first Markdown note-taking app. Notes are plain `.md` files in a folder the
user picks on their own machine, read/written through the browser **File System Access API**. Built on
the [Gravity UI](https://gravity-ui.com/) ecosystem, with `@gravity-ui/markdown-editor` as the
WYSIWYG/Markdown editor.

**Browser requirement:** a Chromium-based browser (Chrome/Edge). The File System Access API is
unavailable in Firefox/Safari; those are a planned later phase (in-browser/IndexedDB backend).

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
FolderGate ──▶ FileSystemNoteStore ──▶ useNotes() ──▶ NoteList + EditorPane
(pick folder)   (.md files on disk)     (state + autosave)   (UI)
```

All persistence sits behind the **`NoteStore` interface** (`src/storage/types.ts`) — the key extension
seam. One note = one `.md` file; the file name is the note id, the name without `.md` is the title.

Key modules:

- `src/storage/types.ts` — the `NoteStore` interface (storage-agnostic; no FS-specific types leak in).
- `src/storage/fileSystemStore.ts` — `FileSystemNoteStore`, the File System Access API implementation.
  Holds the trickiest logic: title sanitizing, unique-filename resolution, copy-then-delete rename
  (the FS Access API has no atomic rename), list sorting.
- `src/storage/handlePersistence.ts` — stashes the directory handle in IndexedDB so the folder survives
  reloads; handles the per-session permission re-grant. Each `tx()` closes the connection on complete /
  error / abort.
- `src/storage/metadata.ts` — the `.gravity-notes.json` sidecar: tolerant `parseMetadata`, pure
  transforms (`withPinToggled`, `withActive`, `reconcile`, …), and `orderNotes` (pins first, then the
  active sort).
- `src/hooks/useNotesFolder.ts` — folder picking + permission lifecycle (state machine:
  `loading`/`unsupported`/`needs-folder`/`needs-permission`/`ready`). Bootstrap is `try/catch`-guarded
  and bails (via `interactedRef`) once the user picks/grants, so a slow IndexedDB read can't clobber it.
- `src/hooks/useNotes.ts` — note list, selection, **debounced autosave** (500 ms), and **conflict
  detection**. Editing is deliberately decoupled from React state: keystrokes flow into a ref + timer,
  not `setState`, so the markdown editor instance is never re-created mid-typing. Pending edits are
  flushed before every lifecycle transition (open/create/rename/remove/close/folder-change) and on
  `visibilitychange` / `beforeunload`; `open()` is guarded by a generation counter (wrong-note race) and
  short-circuits the already-open note (no remount). Exposes `flushPending()` for teardown.
- `src/hooks/useNoteNavigation.ts` / `useNoteSearch.ts` / `useShortcuts.ts` — list cursor + focus ladder
  (browse/commit/escape), search-or-create filtering, and the global keyboard shortcuts (driven by the
  `SHORTCUTS` descriptor in `src/shortcuts.ts`, which the help dialog also renders from). Punctuation
  chords match by `event.code` (e.g. `⌘⇧;` → `Semicolon`), since the shifted `event.key` differs.
- `src/components/` — `FolderGate` (pre-folder gate), `Workspace` (top bar + layout + nav wiring),
  `TopBar` (nvALT search box + folder/theme/help controls + save-status dot), `NoteList` (sidebar with
  create/rename/delete, pin, sort), `EditorPane` (wraps the Gravity markdown editor; re-created per
  editing session via a stable `useNotes.sessionId`, so a rename doesn't remount it) with `NoteTitle`
  and `NotePreview`, `ConflictBanner`, `ShortcutsDialog`, `ThemeSwitcher`, and `ErrorBoundary` (root
  render-crash net).
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
