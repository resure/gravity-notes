# Changelog

All notable changes to Gravity Notes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to adhere to
[Semantic Versioning](https://semver.org/).

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
