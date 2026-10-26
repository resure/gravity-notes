# Keyboard shortcuts

Press `⌘/` inside the app for this sheet, always up to date; type to filter it by action or by keys
(`link`, `cmd+k`, `⌘⇧;`). `⌘` reads as `Ctrl` outside macOS.

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
| `⌘⇧J` / `⌘⇧K`                       | Preview next / previous note (works while editing)                                    |
| `⌘⌥[` / `⌘⌥]`                       | Go back / forward through visited notes (browser-style history)                       |
| `Enter`                             | Edit the selected note (in the title → jump to the body)                              |
| `⌘Enter` / `⌘-click` / double-click | Open the selected note in its own window _(desktop)_                                  |
| `⌘0`                                | Show this workspace's main window _(desktop; also Window ▸ Main Window)_              |
| `Esc`                               | Editor → list → search (then close / clear)                                           |
| `Esc` `Esc`                         | Focus the search box                                                                  |
| `⌘L`                                | Jump to the search box (desktop app; browsers reserve it for the address bar)         |
| `⌘\`                                | Show / hide the left panel — the notes list, and the folders when they are on         |
| `⌘⇧\`                               | Show / hide the folders (the list toolbar's folder button)                            |
| `⌘'`                                | Peek the collapsed sidebar / focus the list (again to close)                          |
| `⌃R`                                | Switch workspace — the recent-folders dialog (`↵` open, `⌘↵` new window, `⌘⌫` remove) |

## Editing

| Keys             | Action                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `⌘⇧Enter` / `⌘N` | New note, in the selected folder (`⌘N` in the desktop app; browsers reserve it)                                                           |
| `⌘⇧;`            | Toggle blocks / Markdown source — the raw text behind the blocks, with Markdown highlighting                                              |
| `⌘F`             | In Markdown source: find and replace (`⌘G` / `⌘⇧G` next / previous); `⌥↑` / `⌥↓` move a line, `Enter` continues a list                    |
| `⌘↑` / `⌘↓`      | Jump to the start / end of the note                                                                                                       |
| `⌘⇧P`            | Toggle read-only preview                                                                                                                  |
| `⌘⇧I`            | This note’s menu — per-note font and text width, plus its file actions                                                                    |
| `⌘K`             | Link the selected text, or edit the link the caret is in (clear the URL to unlink)                                                        |
| `[[`             | Open the wiki-link note picker; the last row always offers to insert a link to a note that doesn't exist yet                              |
| `⌘-click` a link | Open a URL in your browser, or follow a `[[wiki link]]` to its note (creating it if needed); in read-only preview a plain click works too |
| `⌘Enter`         | Follow the `[[wiki link]]` under the caret (⌘-click does the same); in a to-do, tick it                                                   |
| Caret in a link  | Actions appear under it — a URL: Open / Edit / Unlink; a `[[wiki link]]`: Open / Change note / Edit text (`[[Note\|text]]`) / Unlink      |
| `F2`             | Rename the selected note, or the focused folder in the rail                                                                               |
| `⌘⇧M`            | Move the selected note to a folder (from the list; in the editor it's a typing chord)                                                     |
| `⌘D`             | Duplicate the selected note (most dependable in the desktop app; browsers reserve it) — in the body it duplicates the block               |
| `⌘⇧⌫`            | Move the selected note to the Trash (asks to confirm; recoverable)                                                                        |

### In the note body

The block editor owns these itself; they do nothing outside the body.

| Keys        | Action                                                                |
| ----------- | --------------------------------------------------------------------- |
| `/`         | Open the block menu (at the start of a block or after a space)        |
| `⌘B`        | Bold the selection                                                    |
| `⌘I`        | Italicise the selection                                               |
| `⌘U`        | Underline the selection                                               |
| `⌘⇧S`       | Strike through the selection                                          |
| `⌘E`        | Inline code                                                           |
| `⌘C`        | Copy the selection as Markdown                                        |
| `⌘⇧C`       | Copy the selection as plain text (Markdown stripped)                  |
| `⌘⇧V`       | Paste without formatting                                              |
| `⌘A`        | Select the block, then every block in the note                        |
| `⌘⌥0`       | Turn the block into text                                              |
| `⌘⌥1`–`⌘⌥3` | Heading 1–3                                                           |
| `⌘⌥4`       | To-do                                                                 |
| `⌘⌥5`       | Bulleted list                                                         |
| `⌘⌥6`       | Numbered list                                                         |
| `⌘⌥7`       | Toggle                                                                |
| `⌘⌥8`       | Code block (pressing a block's own chord again turns it back to text) |
| `⇧Enter`    | Line break inside the block                                           |
| `⌘]` / `⌘[` | Indent / outdent the block                                            |
| `Tab`       | Indent the block (`⇧Tab` outdents); in a table, move to the next cell |
| `Esc`       | Select the block; again to leave the editor                           |

As you type, `# ` through `###### ` make headings; `- `, `* ` and `+ ` make bullets;
`7. ` starts numbering at 7; `[] ` and `[x] ` make tasks; `> ` makes a quote; `---` makes a divider
and ` ``` ` a code block. In a code block `Tab` / `⇧Tab` indent and dedent the line and `Enter`
keeps its indent.
Paired `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `==mark==` and `++underline++`
apply inline formatting. A backslash before the opening delimiter keeps it literal.

A text selection across blocks (a drag, or `⇧↑` / `⇧↓` / `⇧←` / `⇧→` past a block's edge) behaves
as in any text editor: copying, cutting, typing over or deleting it acts on exactly the selected text,
and the text before and after it joins into one block. Where an end of it is not text — an image,
a table, a collapsed toggle — the blocks it touches go whole, as with `Esc` + `⇧↓`.

With a block selected (after `Esc`):

| Keys           | Action                                                  |
| -------------- | ------------------------------------------------------- |
| `↑` / `↓`      | Move the selection to the previous / next block         |
| `⇧↑` / `⇧↓`    | Extend the selection                                    |
| `⌘↑` / `⌘↓`    | Move the selected block(s) up / down, children included |
| `Tab` / `⇧Tab` | Indent / outdent the selected block(s)                  |
| `↵`            | Edit the block again, caret at its end                  |
| `⌘D`           | Duplicate the selected block(s)                         |
| `⌫`            | Delete the selected block(s)                            |

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
| `⌫`                         | Remove an empty folder (asks to confirm)                                         |
| Drag a note onto a folder   | File it there                                                                    |
| Drag a folder onto a folder | Nest it (onto **All Notes** to move it back to the root)                         |

With the rail closed, a small **folder chip** above the list names the active scope — click it to
open the rail, `✕` to go back to All Notes. **New note** (`⌘N`) lands in the selected folder.

## Panels

The folder rail and the notes list resize by dragging the divider on their right edge
(double-click it to reset). With a divider focused (`Tab`):

| Keys           | Action                                 |
| -------------- | -------------------------------------- |
| `←` / `→`      | Nudge the width by 16px                |
| `Home` / `End` | Jump to the narrowest / widest allowed |

## Mouse

**Right-click** a note or folder for its actions (pin, rename, move, duplicate, delete, …) — the
same menu the row's `⋯` button opens, at the cursor. **⌘-click** a note row opens it in its own
window (desktop). Neither moves your selection. **Drag** the divider beside the folder rail or
the notes list to resize it; **double-click** the divider resets the width.
