# Keyboard shortcuts

Press `⌘/` inside the app for this sheet, always up to date. `⌘` reads as `Ctrl` outside macOS.

## The search box

The search box is the heart of the app (nvALT-style **search or create**):

| Keys      | Action                                                                                  |
| --------- | --------------------------------------------------------------------------------------- |
| Type      | Full-text search of titles + bodies, ranked; the top match's title autocompletes inline |
| `Tab`     | Accept the inline autocomplete — fill the box with the top match's title                |
| `Enter`   | Open the top match — or **create** a note titled with the query when nothing matches    |
| `↓` / `↑` | Step into the results list                                                              |
| `Esc`     | Clear the query, then close the open note                                               |

## Navigation

| Keys                                | Action                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `↑` / `↓` (or `k` / `j`)            | Preview the previous / next note                                                      |
| `⌘J` / `⌘K`                         | Preview next / previous note (works while editing)                                    |
| `⌘[` / `⌘]`                         | Go back / forward through visited notes (browser-style history)                       |
| `Enter`                             | Edit the selected note (in the title → jump to the body)                              |
| `⌘Enter` / `⌘-click` / double-click | Open the selected note in its own window _(desktop)_                                  |
| `⌘0`                                | Show this workspace's main window _(desktop; also Window ▸ Main Window)_              |
| `Esc`                               | Editor → list → search (then close / clear)                                           |
| `Esc` `Esc`                         | Focus the search box                                                                  |
| `⌘L`                                | Jump to the search box (desktop app; browsers reserve it for the address bar)         |
| `⌘\`                                | Toggle the sidebar                                                                    |
| `⌘⇧\`                               | Toggle the folder rail                                                                |
| `⌘'`                                | Peek the collapsed sidebar / focus the list (again to close)                          |
| `⌃R`                                | Switch workspace — the recent-folders dialog (`↵` open, `⌘↵` new window, `⌘⌫` remove) |

## Editing

| Keys             | Action                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `⌘⇧Enter` / `⌘N` | New note, in the selected folder (`⌘N` in the desktop app; browsers reserve it)                                                           |
| `⌘⇧;`            | Toggle WYSIWYG / Markup                                                                                                                   |
| `⌘⇧P`            | Toggle read-only preview                                                                                                                  |
| `⌘⇧I`            | Note appearance — per-note font and text width                                                                                            |
| `⌘⇧K`            | Insert link (in the editor)                                                                                                               |
| `[[`             | Open the wiki-link note picker (in the editor)                                                                                            |
| `⌘-click` a link | Open a URL in your browser, or follow a `[[wiki link]]` to its note (creating it if needed); in read-only preview a plain click works too |
| `F2`             | Rename the selected note, or the focused folder in the rail                                                                               |
| `⌘⇧M`            | Move the selected note to a folder (from the list; in the editor it's the heading shortcut)                                               |
| `⌘D`             | Duplicate the selected note (most dependable in the desktop app; browsers reserve it)                                                     |
| `⌘⇧⌫`            | Move the selected note to the Trash (asks to confirm; recoverable)                                                                        |

## General

| Keys | Action                  |
| ---- | ----------------------- |
| `⌘/` | Show the shortcut sheet |
| `⌘,` | Open settings           |

## Folders

With the folder rail open (`⌘⇧\`) and a folder focused:

| Keys / mouse                | Action                                                                           |
| --------------------------- | -------------------------------------------------------------------------------- |
| Click a folder              | Scope the notes list to it (**All Notes** shows everything; search stays global) |
| `F2` / double-click         | Rename the folder                                                                |
| `n`                         | Create a subfolder                                                               |
| `⌫`                         | Remove an empty folder                                                           |
| Drag a note onto a folder   | File it there                                                                    |
| Drag a folder onto a folder | Nest it (onto **All Notes** to move it back to the root)                         |

With the rail closed, a small **folder chip** above the list names the active scope — click it to
open the rail, `✕` to go back to All Notes. **New note** (`⌘N`) lands in the selected folder.

## Mouse

**Right-click** a note or folder for its actions (pin, rename, move, duplicate, delete, …) — the
same menu the row's `⋯` button opens, at the cursor. **⌘-click** a note row opens it in its own
window (desktop). Neither moves your selection.
