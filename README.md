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

### TODO

UX tasks:

- i want to havesome kind of "preview" mode for notes OR clicking ESC first time removes cursor from editing area, clicking second time closes current opened the note. when cursor not in editing mode, pressing cursor arrows (up/down) should navigate us between notes
- hotkeys for working with tabs?

Design things:

- let's make padding ABOVE editing area little smaller (but don't touch paddding on the left side)
- saving indicator is too annoying
- theme switcher should have distinct "system theme" option
- let's pick different accent color instead of default yellow-orange
- default line-height in editor is too big
- i want lists to have short dashes instead of bullets - like in apple notes
- sublime/vscode-like logic for tabs - just clicking on some note in the sidebar opens "ephereal" tab with italic tab name. Double click on note or any edits inside it makes that ephereal tab normal. When tab is ephereal clicking on another note in the sidebar just replaces ethereal tab with another one, instead of opening a new one (so there probably can only be one ethereal tab).
- don't like current tabs layout with empty space above them, what ideas do you have on more compact layout? maybe collapse first and second panels into one. Also i want tabs to be little bigger in height.

Bugs:

- F2 hotkey doesn't work
- cmd+k conflicts with inserting link in markdown editor
- on trying to rename to existing note name - do nothing, don't try to generate number at the end of the note

Backlog:

- add plus button at the tabs pane, after it we should either open existing file or create a new one
- Folders support
- **Electron app**
- **PWA** — manifest + service worker; an IndexedDB store as the default for non-Chromium browsers.
- **Backend sync** — add an `ApiStore` implementing `NoteStore`.
