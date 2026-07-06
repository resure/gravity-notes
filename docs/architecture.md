# Architecture

How Gravity Notes is put together, what it writes to your disk, and where the edges are.

## Overview

```
FolderGate ──▶ NoteStore (filesystem | tauri-fs | indexeddb) ──▶ useNotes() ──▶ NoteList + EditorPane
(choose storage)  (.md on disk: web FSA / native Rust; or IndexedDB)  (state + autosave)   (UI)
```

The app ships two ways from one codebase: a **web app** and a **macOS desktop app** (Tauri 2).
Everything interesting sits behind one seam.

## The storage seam

All persistence goes through the `NoteStore` interface
([`src/storage/types.ts`](../src/storage/types.ts)), with three backends:

- **`FileSystemNoteStore`** ([`src/storage/fileSystemStore.ts`](../src/storage/fileSystemStore.ts)) —
  plain `.md` files via the browser File System Access API (Chromium only).
- **`TauriNoteStore`** ([`src/storage/tauriStore.ts`](../src/storage/tauriStore.ts)) — the same
  `.md` folder through native Rust `fs` commands in the desktop app (the FSA API doesn't exist in
  WKWebView). No per-session permission re-grant.
- **`IndexedDbNoteStore`** ([`src/storage/indexedDbStore.ts`](../src/storage/indexedDbStore.ts)) —
  in-browser/in-app storage that works everywhere.

All three share the same note ids, canonical body shape, and `updatedAt`-based conflict semantics
([`src/storage/noteText.ts`](../src/storage/noteText.ts)), so everything above the seam — state,
search, navigation, UI — is backend-agnostic. Notes move between backends via `.md` zip
export/import ([`src/storage/transfer.ts`](../src/storage/transfer.ts)), which preserves folder
structure and attachment bytes both ways.

## What's on disk

A notes folder is meant to be shared with other tools — Obsidian, scripts, `grep`, iCloud. The
format, in full:

- **A note is a file.** Its id is its POSIX relative path (`Inbox.md`, `Work/Sub/Title.md`); the
  file name without `.md` is the title. Folders are real directories.
- **`.gravity-notes.json`** — one metadata sidecar at the root: sort mode, pins (notes and
  folders), created stamps, note icons, per-note appearance overrides, the open note, and the
  trash registry. Losing it loses pins and icons, never notes.
- **`.trash/`** — deleting a note moves it here (a hidden folder, excluded from listings), so
  Trash survives across app restarts and is restorable from the storage menu. Emptying the Trash
  is the only permanent delete.
- **`Attachments/`** — pasted/dropped images land here as files; notes reference them
  root-relatively (`![…](Attachments/pie.png)`). The stored Markdown never contains `blob:` URLs.
- **`.gnkeep`** — a marker file that keeps a deliberately-empty folder alive (Git-style).
- **`[[Wiki links]]`** are stored verbatim — `[[Title]]` on disk, Obsidian-compatible round-trip.
- **Bare URLs** you type are linkified in the editor and normalized to `<url>` on save; a stray
  `Notes.md` never turns into a link (fuzzy linkify is off — `.md` is a real TLD).
- **Blank lines** inside a note persist as `&nbsp;` lines (the editor's `preserveEmptyRows`), so
  intentional vertical space survives the Markdown round-trip.

## Workspaces & windows

Every opened folder/store is a **workspace**, remembered (with recency) in an IndexedDB registry
([`src/storage/workspaceRegistry.ts`](../src/storage/workspaceRegistry.ts)) that feeds the orb
menu's Open Recent, the `⌃R` switcher, and launch restore. On the desktop each workspace can have
its own native window, plus Apple-Notes-style **per-note windows** (`⌘↵` on a list row) — small,
panels tucked away, focus-if-open, with `⌘0` bringing back the workspace's main window. The window
↔ workspace/note assignments live in the Rust shell, so new windows boot straight into the right
folder.

## Live file-watching (desktop)

The desktop shell runs one debounced FSEvents watcher per open folder
(`notify` in [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs)), shared by every window showing
it. External changes — another app, another window, a sync agent — push a `notes:changed` event;
the frontend re-checks the open note for conflicts and refreshes the list, which the search index
and backlinks follow automatically. The app's own saves are recognized and skipped, so typing
never triggers refresh churn. Noise (`.DS_Store`, the sidecar, `Attachments/`, temp files) is
filtered at the source. On the web there's no watching API, so external edits surface when the tab
regains focus — or via **Reload notes** in the storage menu.

## Search, backlinks & performance

Full-text ranking ([`src/search.ts`](../src/search.ts)) and wiki-link/backlink resolution
([`src/wikiLinks.ts`](../src/wikiLinks.ts)) are pure functions with no I/O — they score a shared
in-memory corpus loaded once by [`src/hooks/useCorpus.ts`](../src/hooks/useCorpus.ts) (one bulk
read, lazily, only while searching or a note is open). The corpus refreshes **incrementally** —
only notes whose mtime changed are re-read — and the backlink graph is rebuilt only when a note's
links actually change, so a plain autosave costs nothing. The note list is virtualized
(`@tanstack/react-virtual`). There is deliberately **no inverted search index**: for
personal-vault sizes, scanning a pre-lowercased corpus is fast enough that an index would cost
more in build/invalidations than it saves.

Editing is decoupled from React state ([`src/hooks/useNotes.ts`](../src/hooks/useNotes.ts)):
keystrokes flow into a ref + a 500 ms autosave timer, so the editor instance is never re-created
mid-typing. Conflicts (a note changing underneath you) are detected by mtime and resolved through
a banner: reload / keep mine / save a copy / discard.

## The desktop shell

[`src-tauri/`](../src-tauri) is a thin Tauri 2 shell: the `notes_*`/`attachment_*` filesystem
commands (deliberately dumb primitives — the note semantics live in TypeScript, mirroring the web
backend), the folder watcher, window management, native menu, and in-app **auto-update** via
GitHub Releases (signature-verified). Bulk listings skip iCloud **dataless** files' content so a
not-yet-downloaded vault doesn't block on the network; such notes list by name and fill in once
macOS materializes them.

## Known limitations

- **Two windows on one store can clobber each other's _metadata_.** The sidecar (sort, pins,
  icons, per-note appearance) is last-write-wins everywhere: desktop windows coordinate their
  workspace assignments and note _bodies_ (the live watcher + conflict banner) through the shell,
  but not the sidecar — and browser tabs coordinate nothing, seeing external changes only on
  refocus. Body conflicts are detected by modification timestamp, coarse enough that rapid
  multi-window editing of the same note can miss or over-report changes.
- **In-browser storage is per-browser and per-origin.** It isn't synced across devices, and
  clearing the browser's site data erases it — use **Export** to keep a `.md` backup.
- **External changes are live only in the desktop app** (the folder watcher). In the browser
  they're detected when you return focus to the tab — or via **Reload notes** in the storage menu.
- **A selected image shows a faint caret line** beside it in the editor — the browser's native
  object-selection caret, which resists CSS hiding. Cosmetic only.
- **Auto-update starts from the release that introduced it.** A build without the updater
  (≤ 0.2.0) has to be updated by hand once; from there the macOS app updates itself in place.
  Apple silicon (arm64) only.
