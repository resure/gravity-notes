# Gravity Notes

A simple note-taking app built on the [Gravity UI](https://gravity-ui.com/) ecosystem,
using [`@gravity-ui/markdown-editor`](https://github.com/gravity-ui/markdown-editor) as the
WYSIWYG/Markdown editor. Notes are stored as plain `.md` files in a folder you choose on your
own computer.

## Features (v1)

- Sidebar list of notes with create / rename / delete
- Gravity Markdown editor (WYSIWYG + markup modes)
- Debounced **autosave** to disk
- Light / dark theme toggle
- Your notes are plain `.md` files in a folder you pick — no lock-in
- Keyboard-first navigation (nvALT / Notational Velocity style): arrow to preview, Enter to edit, Esc to step back

## Requirements

Notes are read and written through the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API),
so a **Chromium-based browser** (Chrome, Edge, …) is required. Firefox/Safari support arrives in a
later phase together with the in-browser storage backend.

## Getting started

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
npm run build    # type-check + production build
npm run preview  # preview the production build
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
file name. The directory handle is kept in IndexedDB (`src/storage/handlePersistence.ts`) so the
folder survives reloads.

Key modules:

- `src/storage/` — storage abstraction + File System Access API implementation
- `src/hooks/useNotesFolder.ts` — folder picking + permission lifecycle
- `src/hooks/useNotes.ts` — note list, selection, and debounced autosave
- `src/components/` — `FolderGate`, `Workspace`, `NoteList`, `EditorPane`
- `src/main.tsx` — app-shell styles; `src/App.tsx` — Gravity providers + theme

### Next up

- Safari (non-chromium) browser support. Probably should ask where to store notes on start, like excalidraw?

### Backlog

- Full-text search + ranking
- Tab-to-complete in the search box

- ESC key behaviour imrovement with closed sidebar
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
