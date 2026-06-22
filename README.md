# Gravity Notes

A simple note-taking app built on the [Gravity UI](https://gravity-ui.com/) ecosystem,
using [`@gravity-ui/markdown-editor`](https://github.com/gravity-ui/markdown-editor) as the
WYSIWYG/Markdown editor. On first run you choose where notes live: a **folder on your computer**
(plain `.md` files), or **in this browser** — and you can **export/import** `.md` files either way.

## Features (v1)

- **Choose your storage** on first run: a folder of plain `.md` files (Chromium browsers), or
  in-browser storage that works in any modern browser
- **Export / import**: download all notes as a `.md` zip, or import `.md` files / a zip — so you own
  your data regardless of backend, and can migrate between them
- Sidebar list of notes with create / rename / delete, **pinning**, and four **sort modes**
  (updated, created, title A→Z / Z→A)
- Gravity Markdown editor (WYSIWYG + markup modes) with a read-only **preview** mode
- Debounced **autosave**, with a status indicator and unsaved-changes guards
- **Conflict handling** when a note changes underneath you (reload / keep mine / save a copy / discard)
- Light / dark / system theme
- **Keyboard-first** navigation (nvALT / Notational Velocity style): type to search-or-create, arrow to
  preview, Enter to edit, Esc to step back. Press `⌘/` in the app for the full shortcut sheet.

### Keyboard shortcuts

| Keys                     | Action                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Type in the search box   | Find notes; `Enter` opens the top match, or creates a note titled with the query when nothing matches |
| `↑` / `↓` (or `k` / `j`) | Preview the previous / next note                                                                      |
| `⌘J` / `⌘K`              | Preview next / previous note (works while editing)                                                    |
| `Enter`                  | Edit the selected note                                                                                |
| `Esc`                    | Editor → list → search (then close / clear)                                                           |
| `⌘Enter`                 | New note                                                                                              |
| `⌘\`                     | Toggle the sidebar                                                                                    |
| `⌘'`                     | Peek the collapsed sidebar / focus the list                                                           |
| `⌘⇧;`                    | Toggle WYSIWYG / Markup                                                                               |
| `⌘⇧P`                    | Toggle read-only preview                                                                              |
| `⌘⇧K`                    | Insert link (in the editor)                                                                           |
| `F2`                     | Rename the selected note                                                                              |
| `⌘/`                     | Show the shortcut help                                                                                |

## Requirements

Any modern browser works. **Folder storage** uses the
[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API), which is
Chromium-only (Chrome, Edge, …); on Firefox/Safari the first-run screen offers only **in-browser
storage** (IndexedDB). Use **Export** to get your notes out as plain `.md` files at any time.

## Getting started

```bash
npm install
npm run dev          # start the dev server (http://localhost:5173)
npm run build        # type-check + production build
npm run build:single # single self-contained index.html (all JS/CSS inlined)
npm run preview      # preview the production build
```

On first run, pick **Open a folder** (Chromium) or **Store in this browser**. The choice is
remembered across reloads; a folder also re-prompts for permission each session (a browser security
requirement). Switch later — or export/import — from the storage menu in the top bar.

## Architecture

```
FolderGate ──▶ NoteStore (filesystem | indexeddb) ──▶ useNotes() ──▶ NoteList + EditorPane
(choose storage)  (.md files on disk, or IndexedDB)     (state + autosave)   (UI)
```

All persistence sits behind the `NoteStore` interface (`src/storage/types.ts`), with two backends:
`FileSystemNoteStore` (`src/storage/fileSystemStore.ts`, plain `.md` files in a chosen folder) and
`IndexedDbNoteStore` (`src/storage/indexedDbStore.ts`, in-browser). Both share the same
`<Title>.md` ids, canonical body shape, and `updatedAt`-based conflict semantics
(`src/storage/noteText.ts`), so everything above the seam is backend-agnostic. Per-folder/-store
metadata — sort mode, pins, created stamps, the open note — lives in `metadata.ts`. The chosen
backend (and any folder handle) is remembered in IndexedDB (`src/storage/handlePersistence.ts`).

Key modules:

- `src/storage/` — `types.ts` (the `NoteStore` seam), `fileSystemStore.ts` + `indexedDbStore.ts`
  (the two backends), `noteText.ts` (shared id/body helpers), `metadata.ts` (sort/pins sidecar),
  `transfer.ts` (`.md` zip export/import), `handlePersistence.ts` (remembered backend + handle)
- `src/hooks/useNotesStorage.ts` — first-run storage choice + permission lifecycle; yields a ready
  `NoteStore`
- `src/hooks/useNotes.ts` — note list, selection, debounced autosave, and conflict detection
- `src/hooks/useNoteNavigation.ts`, `useNoteSearch.ts`, `useShortcuts.ts` — cursor/focus flow,
  search-or-create, and global keyboard shortcuts
- `src/components/` — `FolderGate`, `Workspace`, `TopBar`, `NoteList`, `EditorPane` (+ `NoteTitle`,
  `NotePreview`), `ConflictBanner`, `ShortcutsDialog`, `ThemeSwitcher`, `ErrorBoundary`
- `src/main.tsx` — app-shell styles; `src/App.tsx` — Gravity providers + theme

### Known limitations

- **Single-tab.** Metadata (sort/pins/active) is last-write-wins, and conflict detection uses a
  modification timestamp — coarse enough that rapid multi-tab editing of the same notes can miss or
  over-report changes. Use one tab per store for now.
- **In-browser storage is per-browser and per-origin.** It isn't synced across devices, and clearing
  the browser's site data erases it — use **Export** to keep a `.md` backup.
- **External changes** to the open note are detected when you return focus to the tab, not live while
  it stays focused.

### Backlog

- Full-text search + ranking (search currently matches titles only)
- Tab-to-complete in the search box

- Fullscreen mode?

- PWA improvements
- Mobile view

- Wiki-style links between notes, backlinks
- Recent-note history (cmd+[] - back/forward through visited notes)

- Trash bin for deleted notes
- Media attachments, with separate view for files management (and preview)

- Versioning / snapshots (with manual snapshopts?)
- Backend sync — add an `ApiStore` implementing `NoteStore`

- Tags?
- Daily notes
