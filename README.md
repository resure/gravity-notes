# Gravity Notes

A simple note-taking app built on the [Gravity UI](https://gravity-ui.com/) ecosystem,
using [`@gravity-ui/markdown-editor`](https://github.com/gravity-ui/markdown-editor) as the
WYSIWYG/Markdown editor. Runs as a **web app** and a **macOS desktop app** (Tauri). On first run you
choose where notes live: a **folder on your computer** (plain `.md` files), or **in-browser / in-app**
— and you can **export/import** `.md` files either way.

## Philosophy

The app does little, on purpose. There is one box — type, and you are reading the nearest note or
writing a new one, as in nvALT. The design takes after [Things](https://culturedcode.com/things/):
plain, quiet, out of the way. Every action has a key. The type is set to be read; the notes are plain
Markdown files, and they are yours.

## Features (v1)

- **Choose your storage** on first run: a folder of plain `.md` files (Chromium browsers, or natively
  in the desktop app), or in-browser/in-app storage that works everywhere
- **Export / import**: download all notes as a `.md` zip, or import `.md` files / a zip — so you own
  your data regardless of backend, and can migrate between them. Your **folder structure** is
  preserved both ways, including deliberately-empty folders (kept alive by a `.gnkeep` marker)
- Sidebar list of notes with create / rename / delete, **pinning**, and four **sort modes**
  (updated, created, title A→Z / Z→A)
- **Trash**: deleting a note moves it to a Trash (a hidden `.trash/` folder, so it leaves your notes
  but isn't erased) you can **restore** from — back to its original folder — or **empty**. Open it from
  the storage menu (the `⋯` orb)
- **Full-text search** across note titles _and_ bodies, ranked by relevance, with the matching
  passage shown as a snippet in the list (multi-word queries match all terms)
- Gravity Markdown editor (WYSIWYG + markup modes) with a read-only **preview** mode
- **`[[wiki links]]`** between notes: type `[[` for a note picker, or write them by hand. They render
  like links (no brackets) and ⌘-click follows them — creating the note if it doesn't exist yet;
  unresolved links are dimmed. Stored verbatim as `[[Title]]`, so they're Obsidian-compatible
- **Backlinks**: a "linked references" panel under each note lists every note that links to it, with
  the surrounding context
- **Recent-note history**: `⌘[` / `⌘]` step back / forward through the notes you've visited, browser-style
- Debounced **autosave**, with a status indicator and unsaved-changes guards
- **Conflict handling** when a note changes underneath you (reload / keep mine / save a copy / discard)
- Light / dark / system theme
- **Keyboard-first** navigation (nvALT / Notational Velocity style): type to search-or-create, arrow to
  preview, Enter to edit, Esc to step back. Press `⌘/` in the app for the full shortcut sheet.

### Keyboard shortcuts

| Keys                      | Action                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Type in the search box    | Full-text search of titles + bodies (ranked); `Enter` opens the top match, or creates a note titled with the query when nothing matches |
| `Tab` (in the search box) | Accept the inline autocomplete — fill the box with the top match's title (nvALT-style)                                                  |
| `↑` / `↓` (or `k` / `j`)  | Preview the previous / next note                                                                                                        |
| `⌘J` / `⌘K`               | Preview next / previous note (works while editing)                                                                                      |
| `⌘[` / `⌘]`               | Go back / forward through visited notes (browser-style history)                                                                         |
| `Enter`                   | Edit the selected note                                                                                                                  |
| `Esc`                     | Editor → list → search (then close / clear)                                                                                             |
| `⌘L`                      | Jump to the search box (`⌘L` in the desktop app; browsers reserve it)                                                                   |
| `⌘⇧Enter` / `⌘N`          | New note (`⌘N` in the desktop app; browsers reserve it)                                                                                 |
| `⌘\`                      | Toggle the sidebar                                                                                                                      |
| `⌘'`                      | Peek the collapsed sidebar / focus the list                                                                                             |
| `⌘⇧\`                     | Toggle the folder rail                                                                                                                  |
| `⌘⇧;`                     | Toggle WYSIWYG / Markup                                                                                                                 |
| `⌘⇧P`                     | Toggle read-only preview                                                                                                                |
| `⌘⇧K`                     | Insert link (in the editor)                                                                                                             |
| `[[`                      | Open the wiki-link note picker (in the editor)                                                                                          |
| `⌘-click` a link          | Open a URL in your browser, or follow a `[[wiki link]]` to its note (creating it if needed)                                             |
| `F2`                      | Rename the selected note, or the focused folder in the rail                                                                             |
| `⌘⇧M`                     | Move the selected note to a folder                                                                                                      |
| `⌘⇧⌫`                     | Move the selected note to the Trash (recoverable)                                                                                       |
| `⌘/`                      | Show the shortcut help                                                                                                                  |

**Right-click** a note or folder for its actions (pin, rename, move, duplicate, delete, …) — the same
menu the row's `⋯` button opens, at the cursor.

### Folders

A **folder rail** (toggle with `⌘⇧\`) lists your folders left of the notes list; it's off by default,
so the app stays a two-pane view until you want it. Selecting a folder scopes the notes list to it
(**All Notes** shows everything), while search stays global. **New note** (`⌘N`) lands in the selected
folder. Drag a note onto a folder to file it, or drag a folder onto another to nest it (onto **All
Notes** to move it back to the root). Double-click or `F2` renames a folder; with a folder focused, `n`
makes a subfolder and `⌫` removes an empty one.

## Requirements

Any modern browser works. **Folder storage** in the browser uses the
[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API), which is
Chromium-only (Chrome, Edge, …); on Firefox/Safari the first-run screen offers only **in-browser
storage** (IndexedDB). The **desktop app** (Tauri, macOS arm64) reads/writes the folder natively, so
folder storage works there regardless — with no per-session permission re-grant. Use **Export** to
get your notes out as plain `.md` files at any time.

Building the desktop app needs a Rust toolchain (**rustc ≥ 1.88**; [rustup](https://rustup.rs) is
recommended) and the Xcode Command Line Tools.

## Getting started

```bash
npm install
npm run dev          # start the dev server (http://localhost:5173)
npm run build        # type-check + production build
npm run build:single # single self-contained index.html (all JS/CSS inlined)
npm run preview      # preview the production build

npm run tauri:dev    # run the macOS desktop app against the dev server
npm run tauri:build  # build the .app / .dmg (arm64) → src-tauri/target/release/bundle
```

On first run, pick **Open a folder** or **Store in this browser** (**Store inside the app** in the
desktop build). The choice is remembered across reloads. In the browser, a folder re-prompts for
permission each session (a browser security requirement); the desktop app does not. Switch later — or
export/import — from the storage menu in the top bar.

## Architecture

```
FolderGate ──▶ NoteStore (filesystem | tauri-fs | indexeddb) ──▶ useNotes() ──▶ NoteList + EditorPane
(choose storage)  (.md on disk: web FSA / native Rust; or IndexedDB)  (state + autosave)   (UI)
```

All persistence sits behind the `NoteStore` interface (`src/storage/types.ts`), with three backends:
`FileSystemNoteStore` (`src/storage/fileSystemStore.ts`, plain `.md` files via the browser File System
Access API), `TauriNoteStore` (`src/storage/tauriStore.ts`, the same `.md` folder via native Rust `fs`
commands in the desktop app), and `IndexedDbNoteStore` (`src/storage/indexedDbStore.ts`, in-browser).
All share the same `<Title>.md` ids, canonical body shape, and `updatedAt`-based conflict semantics
(`src/storage/noteText.ts`), so everything above the seam is backend-agnostic. Per-folder/-store
metadata — sort mode, pins, created stamps, the open note — lives in `metadata.ts`. The chosen
backend (and any folder handle or path) is remembered in IndexedDB (`src/storage/handlePersistence.ts`).
The desktop shell is `src-tauri/` (Tauri 2); its only app code is the `notes_*` filesystem commands in
`src-tauri/src/lib.rs`.

Key modules:

- `src/storage/` — `types.ts` (the `NoteStore` seam), `fileSystemStore.ts` + `tauriStore.ts` +
  `indexedDbStore.ts` (the three backends), `noteText.ts` (shared id/body helpers), `metadata.ts`
  (sort/pins sidecar), `transfer.ts` (`.md` zip export/import), `handlePersistence.ts` (remembered
  backend + handle/path)
- `src/hooks/useNotesStorage.ts` — first-run storage choice + permission lifecycle; yields a ready
  `NoteStore`
- `src/hooks/useNotes.ts` — note list, selection, debounced autosave, and conflict detection
- `src/hooks/useNoteNavigation.ts`, `useNoteSearch.ts`, `useBacklinks.ts`, `useShortcuts.ts` —
  cursor/focus flow, full-text search-or-create and backlinks (both scoring a shared in-memory corpus
  loaded once by `useCorpus`; ranking + `[[wiki link]]` resolution are pure `src/search.ts` /
  `src/wikiLinks.ts`, fed by `NoteStore.getAll()`), and global keyboard shortcuts
- `src/components/` — `FolderGate`, `Workspace`, `TopBar`, `NoteList` (virtualized), `EditorPane`
  (+ `NoteTitle`, `NotePreview`), `BacklinksPanel`, `ConflictBanner`, `ShortcutsDialog`,
  `ThemeSwitcher`, `ErrorBoundary`
- `src/main.tsx` — app-shell styles; `src/App.tsx` — Gravity providers + theme

### Known limitations

- **Single-tab.** Metadata (sort/pins/active) is last-write-wins, and conflict detection uses a
  modification timestamp — coarse enough that rapid multi-tab editing of the same notes can miss or
  over-report changes. Use one tab per store for now.
- **In-browser storage is per-browser and per-origin.** It isn't synced across devices, and clearing
  the browser's site data erases it — use **Export** to keep a `.md` backup.
- **External changes** to the open note are detected when you return focus to the tab, not live while
  it stays focused.
- **A selected image shows a faint caret line** beside it in the editor — the browser's native
  object-selection caret, which resists CSS hiding. Cosmetic only; editing is unaffected. See
  `TODO.md`.

### Backlog

- Notion-like font, width and density setting for each note? And ability to set default for all notes

- Versioning / snapshots (with manual snapshopts?)
- Backend sync — add an `ApiStore` implementing `NoteStore`

- Proper signed desktop macOS app
- Mobile view
- Mobile app

- Preview style (typography) should look more similar to editor style
- Auto-empty the Trash and clean unused attachments (after 30 days?)
- Cmd+z for undoing deleting of notes and moves between folders?
