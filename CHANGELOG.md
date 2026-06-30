# Changelog

All notable changes to Gravity Notes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to adhere to
[Semantic Versioning](https://semver.org/).

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
