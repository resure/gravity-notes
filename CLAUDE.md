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
npm run preview      # preview the production build

npm test             # run the Vitest suite once
npm run test:watch   # watch mode
npm run lint         # ESLint (Gravity flat config; also enforces Prettier on JS/TS)
npm run lint:fix     # ESLint with autofix
npm run format       # Prettier write (covers CSS/MD/JSON too)
npm run format:check # Prettier check (used in CI)
npm run typecheck    # tsc (noEmit)
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
  reloads; handles the per-session permission re-grant.
- `src/hooks/useNotesFolder.ts` — folder picking + permission lifecycle (state machine:
  `loading`/`unsupported`/`needs-folder`/`needs-permission`/`ready`).
- `src/hooks/useNotes.ts` — note list, selection, and **debounced autosave** (500 ms). Editing is
  deliberately decoupled from React state: keystrokes flow into a ref + timer, not `setState`, so the
  markdown editor instance is never re-created mid-typing. Pending edits are flushed on
  `visibilitychange` / `beforeunload`.
- `src/components/` — `FolderGate` (pre-folder gate), `Workspace` (header + layout), `NoteList`
  (sidebar with create/rename/delete), `EditorPane` (wraps the Gravity markdown editor; re-created per
  note id).
- `src/App.tsx` — Gravity providers (theme, mobile, toaster) + theme persistence.
- `src/main.tsx` — app-shell + Gravity/markdown-editor stylesheet imports.

## Conventions

- React 18 function components + hooks; TypeScript `strict` (plus `noUnusedLocals`/`noUnusedParameters`).
- UI is **Gravity UI** (`@gravity-ui/uikit`, `@gravity-ui/icons`) — prefer its components over hand-rolled ones.
- Code style follows the Gravity ecosystem (single quotes, sorted imports). Lint/format will be enforced
  via `@gravity-ui/eslint-config` + `@gravity-ui/prettier-config` (see the spec above).
- Errors surface to the user via the toaster (`onError` in `Workspace`); storage methods throw and
  callers translate to toasts.
- Keep new persistence behind `NoteStore` so alternative backends (Electron `fs`, HTTP API, IndexedDB)
  stay drop-in.

## Roadmap & active work

Improvements are built as sequenced sub-projects, each with its own spec + plan in
`docs/superpowers/`:

1. ✅ **Code health foundation** (PR #1) — Vitest + ESLint + Prettier + CI + storage tests.
2. ✅ **Robustness & data safety** (PR #2) — external-edit conflict detection, reliable save-on-close.
3. ✅ **Core UX & navigation — 3a** (PR #3) — title search/filter, keyboard shortcuts + help dialog,
   inline rename, list keyboard a11y; stood up jsdom + Testing Library component/hook testing.
   Spec: `docs/superpowers/specs/2026-06-20-core-ux-navigation-design.md`.
   - ✅ **Sort & pinning — 3b** — sort modes (updated/title/created) + pinned notes, persisted in a
     `.gravity-notes.json` folder dotfile via `NoteStore.readMetadata`/`writeMetadata`; ordering moved
     to a pure `orderNotes`. Folds in the 3a help-dialog/shortcut-descriptor polish.
     Spec: `docs/superpowers/specs/2026-06-20-sort-pinning-design.md`.
   - ✅ **Multi-tab editing** (superseded) — shipped then reverted; see below.
   - ✅ **Remove tabs + nvALT navigation** — reverted multi-tab to a single-pane
     Notational-Velocity model: one open note persisted as `metadata.active`, a
     `useNoteNavigation` hook for arrow-to-preview / Enter-to-edit / Esc-to-step-back.
     Spec: `docs/superpowers/specs/2026-06-20-remove-tabs-nvalt-navigation-design.md`.
   - ✅ **In-editor note title field** — editable title (= the file name) atop the open note;
     rename-on-leave/Enter, native title↔body cursor handoff (Enter/↓ down, ↑ on the first line up),
     and the body editor decoupled from the file-name id via a stable `useNotes.sessionId` so a rename
     never remounts it. `NameCollisionError` surfaces rename-onto-existing as a toast.
     Spec: `docs/superpowers/specs/2026-06-21-note-title-field-design.md`.
   - ✅ **Global ⌘J/⌘K navigation** — ⌘J/⌘K browse next/prev from anywhere (preview semantics, via a
     `browseRelative` helper); insert-link relocated to ⇧⌘K through the editor's `linkKey` option; new-
     note moved to ⌘Enter. All descriptor-driven through `SHORTCUTS`.
     Spec: `docs/superpowers/specs/2026-06-21-nav-shortcuts-cmd-jk-design.md`.
4. ⬜ **Richer editing** — wire up the installed-but-unused editor extensions (Mermaid, LaTeX, tabs, cuts,
   code highlighting).
5. ⬜ **Image attachments** — paste/drop images, stored alongside notes.

A tail dependency-trim pass removes any editor extensions left unused after (4)/(5).
