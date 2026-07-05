# Changelog

All notable changes to Gravity Notes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to adhere to
[Semantic Versioning](https://semver.org/).

## [0.6.0] - 2026-07-05

### Added

- **Appearance settings** — choose the note **editor font** (Sans — the native system font, a
  bundled Serif, or Mono), an **accent color** (amber, blue, or gray — it recolors the orb, the
  saving dot, the selection wash, and pins), and the **text width** of the reading column (narrow /
  normal / wide / no limit). Set them app-wide or per workspace in **Settings › Appearance**, and
  override font + width **per note** from the **⋯** button in the top bar (or **⌘⇧I**). Per-note
  choices are stored with the notes folder's metadata, so they survive renames and moves, travel
  with the folder, and come back after trash → restore.
- **Remote images** — images referenced by a web URL now render in notes in the desktop app.
- **Readable code highlighting in the dark theme** — code blocks get a proper dark palette instead
  of barely-legible light-theme colors.

### Changed

- **Notes list redesign** — a cleaner, ledger-style list: tighter rows, refined icon tiles and
  pinned/folder styling, and the note-appearance control moved to the top bar so it's always at
  hand while you scroll.
- **Typography polish** — the app chrome uses the native system font; each editor font carries its
  own tuned size and line-height; the title and body share an exact left edge.

### Fixed

- **Traffic lights sit centered in the title bar again on macOS 26** — the system now owns their
  position, instead of a manual placement macOS kept undoing on every layout pass.
- **Mouse selection in the editor works again** (a stale guard class was eating drags).
- **Clicking the blank space below a short note** drops the caret at the end again, in both editor
  modes — instead of doing nothing and unfocusing the editor.
- **Multiple windows no longer fight over settings** — an appearance change made in one window
  isn't silently reverted by another window's later write, and other windows pick it up live.
- The **note-appearance popover** no longer closes when you rename or move the open note.
- The update dialog's release notes keep the app font instead of following the editor font.

## [0.5.0] - 2026-07-03

### Added

- **Multiple workspaces** — open several note folders and move between them freely. An **Open
  Recent** submenu lists every folder you've opened; a **⌃R quick-switcher** filters them (↵ to
  open, ⌘↵ to open in a new window, ⌘⌫ to forget one); and on the desktop app each workspace can
  live in its **own window**, several at once. Relaunch reopens your last workspace.

### Fixed

- The floating **selection toolbar** no longer goes unresponsive after switching notes.
- **Folder rail** polish — dropped the accent bar on the focused row, and nudged top-level folders
  in from the window edge so their expand arrows aren't flush against it.

## [0.4.0] - 2026-07-02

### Added

- **Note icons (experimental)** — give any note a custom icon: pick a Gravity symbol or an
  emoji from a searchable picker (with full keyboard navigation), and it shows in the note list
  and beside the title. Turn it on in **Settings › Show note icons**.
- **Settings dialog (⌘,)** — a new preferences sheet, also reachable from the menu, with toggles
  for note icons and the editor toolbar.
- **Optional editor toolbar** — switch on a sticky formatting toolbar above the note
  (**Settings › Show editor toolbar**); it stays hidden by default so the surface remains
  markdown-first, and sticks to the top with a hairline once you scroll.

### Changed

- **Read-only preview (⌘⇧P) now matches the editor** — `{% cut %}` collapsibles render, colored
  text shows, and list spacing, typography, and the text-column width all line up with the
  WYSIWYG editor. Preview no longer adds a second scrollbar.

### Fixed

- A note's **icon is preserved across trash → restore**, now including across an app restart.
- **ArrowUp** from an empty first line hands off to the title.
- Assorted **editor glitches**: a toolbar caret jump, a stale preview after switching notes, and
  scroll/caret position when switching between notes with identical content.
- Restored the selection toolbar's **heading (Text / H1–H6) picker**.
- **⌘⇧P** no longer strands the top bar off-screen, and clicking the title padding focuses the
  title again.
- Native window **theme sync** and dialog polish (About dialog padding, startup flash).

## [0.3.0] - 2026-06-30

### Added

- **Automatic updates (desktop app)** — the macOS app now checks for a new release on launch and
  from a **Check for Updates…** menu item, then downloads, verifies, and installs the update in
  place and relaunches. Updates are delivered through GitHub Releases and verified by signature.

### Changed

- **Folders in the rail now start collapsed.** The folder tree opens fully collapsed and remembers
  the folders you expand, instead of showing every nested subfolder expanded by default.

### Fixed

- More resilient **folder-storage bootstrap** when the app starts up.
- Fixed **dialog rendering glitches**: content no longer blanks out while a dialog closes, and the
  page no longer flickers when the keyboard-shortcuts dialog opens.

## [0.2.0] - 2026-06-30

### Added

- **Local-first storage, your choice on first run** — a folder of plain `.md` files
  (native on macOS, with no per-session permission re-grant) or in-app storage. Export
  and import `.md` (single files or a zip) to move between them; folder structure and
  attachments are preserved both ways.
- **nvALT / Notational-Velocity workflow** — one box: type to search-or-create, arrow to
  preview, Enter to edit, Esc to step back, with inline tab-complete of the top match.
- **Full-text search** across note titles and bodies, ranked by relevance, with the
  matching passage shown as a snippet in the list.
- **Nested folders** — real subdirectories on disk, with a collapsible folder rail
  (⌘⇧\\), drag-and-drop filing, pinnable folders, and a move-to picker (⌘⇧M).
- **`[[wiki links]]` and backlinks** — a `[[` note picker, ⌘-click to follow a link
  (creating the note if it doesn't exist yet), and a "linked references" panel under each
  note. Stored verbatim as `[[Title]]`, so they stay Obsidian-compatible.
- **Recent-note history** — `⌘[` / `⌘]` to step back and forward through visited notes.
- **Media attachments** — drag or paste images into a note (written to a root
  `Attachments/` folder, referenced root-relatively); resize, caption, and click-to-zoom
  in a shared lightbox, plus an attachments manager (usage, sort, delete) and Reveal in
  Finder.
- **Trash** — deleting moves a note to a hidden `.trash/` folder you can restore from
  (back to its original folder) or empty (⌘⇧⌫).
- **WYSIWYG + Markdown editor** with a read-only preview mode, note pinning, four sort
  modes, duplicate (⌘D), light / dark / system themes, and a full keyboard-shortcut
  sheet (⌘/).
- **VS Code-style native title bar** for the desktop app.

### Performance

- Large folders (thousands of notes) stay responsive: a shared in-memory corpus loaded
  once for both search and backlinks, an incremental link index, a virtualized note list,
  bounded-concurrency file reads, and a debounced query on big vaults.
- Snappier note switching — browse-preview opens are coalesced, and the editor previews
  while you browse and is reused across switches instead of being torn down and rebuilt.

### Fixed

- Hardened throughout via a full code audit: the autosave lifecycle, conflict handling,
  attachment URL-cache lifetime (including a StrictMode dev-only regression), and numerous
  editor and folder edge cases.
