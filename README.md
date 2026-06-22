# Gravity Notes

A simple note-taking app built on the [Gravity UI](https://gravity-ui.com/) ecosystem,
using [`@gravity-ui/markdown-editor`](https://github.com/gravity-ui/markdown-editor) as the
WYSIWYG/Markdown editor. Notes are stored as plain `.md` files in a folder you choose on your
own computer.

## Features (v1)

- Sidebar list of notes with create / rename / delete, **pinning**, and four **sort modes**
  (updated, created, title A→Z / Z→A)
- Gravity Markdown editor (WYSIWYG + markup modes) with a read-only **preview** mode
- Debounced **autosave** to disk, with a status indicator and unsaved-changes guards
- **Conflict handling** when a note changes on disk underneath you (reload / keep mine / save a copy /
  discard)
- Light / dark / system theme
- Your notes are plain `.md` files in a folder you pick — no lock-in
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

Notes are read and written through the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API),
so a **Chromium-based browser** (Chrome, Edge, …) is required. Firefox/Safari support arrives in a
later phase together with the in-browser storage backend.

## Getting started

```bash
npm install
npm run dev          # start the dev server (http://localhost:5173)
npm run build        # type-check + production build
npm run build:single # single self-contained index.html (all JS/CSS inlined)
npm run preview      # preview the production build
```

On first run, click **Open notes folder** and pick a directory. The folder is remembered across
reloads (you'll be re-prompted for permission, a browser security requirement).

## Architecture

```
FolderGate ──▶ FileSystemNoteStore ──▶ useNotes() ──▶ NoteList + EditorPane
(pick folder)   (.md files on disk)     (state + autosave)   (UI)
```

All persistence sits behind the `NoteStore` interface (`src/storage/types.ts`). v1 ships the
`FileSystemNoteStore` (`src/storage/fileSystemStore.ts`); a note is one `.md` file, its title is the
file name. Per-folder metadata — sort mode, pins, created stamps, and the open note — lives in a
`.gravity-notes.json` sidecar (`src/storage/metadata.ts`); it's not a `.md` file, so it never shows up
as a note. The directory handle is kept in IndexedDB (`src/storage/handlePersistence.ts`) so the
folder survives reloads.

Key modules:

- `src/storage/` — storage abstraction (`types.ts`), the File System Access implementation
  (`fileSystemStore.ts`), the metadata sidecar (`metadata.ts`), and the IndexedDB handle store
  (`handlePersistence.ts`)
- `src/hooks/useNotesFolder.ts` — folder picking + permission lifecycle
- `src/hooks/useNotes.ts` — note list, selection, debounced autosave, and conflict detection
- `src/hooks/useNoteNavigation.ts`, `useNoteSearch.ts`, `useShortcuts.ts` — cursor/focus flow,
  search-or-create, and global keyboard shortcuts
- `src/components/` — `FolderGate`, `Workspace`, `TopBar`, `NoteList`, `EditorPane` (+ `NoteTitle`,
  `NotePreview`), `ConflictBanner`, `ShortcutsDialog`, `ThemeSwitcher`, `ErrorBoundary`
- `src/main.tsx` — app-shell styles; `src/App.tsx` — Gravity providers + theme

### Known limitations

- **Single-tab.** The `.gravity-notes.json` sidecar is last-write-wins, and on-disk conflict detection
  uses file modification time — coarse enough that rapid multi-tab editing of the same folder can miss
  or over-report changes. Use one tab per folder for now.
- **External changes** to the open note are detected when you return focus to the tab, not live while
  it stays focused.

### Next up

- Safari (non-chromium) browser support. Probably should ask where to store notes on start, like excalidraw?

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
