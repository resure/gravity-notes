# Changelog

All notable changes to Sol are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to adhere to
[Semantic Versioning](https://semver.org/).

Sol began as **Gravity Notes**; its history up to v0.7.0 lives in that project. This changelog
starts fresh at 1.0.0, because the app it describes is a different one.

## [1.0.0] - 2026-08-10

Sol is Gravity Notes redrawn — same notes, same files on disk, an entirely new surface. The
GravityUI component library is gone; every control is now drawn from scratch on
[Base UI](https://base-ui.com), against one warm palette with a single amber accent.

### Added

- **A new shell.** Three panes at 236 / 324 / fill, separated by a step in tint rather than by a
  rule. A 44px frameless title bar carries the **Orb** (everything app-wide), a window-centred
  search field, and — where a save toast used to fire on every save — a **sync dot and one word**.
  The note list gains a scope header, time groups (Pinned / Today / Yesterday / Earlier), and 58px
  rows that stay exact at three thousand notes.
- **Linked references** as a collapsible bar at the foot of the editor, rather than a panel that
  took the writing surface's height.
- **A per-note appearance menu.** Font and width strips live in the note's own **⋯** menu, where
  "Default" inherits what Settings sets.

### Changed

- **The block editor is the only editor.** The ProseMirror-based rich engine is gone; a note the
  Markdown parser can't round-trip perfectly opens in raw source instead of being silently
  rewritten. `⌘⇧;` toggles blocks ↔ source.
- **Settings is one Appearance section** — editor font and text width, committing live behind a
  scrim you can see past. The per-workspace appearance layer, the accent-colour picker and the
  note-icons feature are cut.
- **PT Serif** sets note titles and the editor's H1/H2, with Cyrillic coverage; the app chrome
  stays on the system font.
- **The metadata sidecar is now `.sol-notes.json`.** On first open, Sol copies an existing
  `.gravity-notes.json` under the new name and leaves the original in place, so pins, sort order,
  the trash registry and per-note appearance all come across — and an older Gravity Notes install
  pointed at the same folder keeps working. Empty-folder markers are written as `.solkeep`;
  `.gnkeep` is honoured indefinitely.

### Removed

- `@gravity-ui/uikit`, `@gravity-ui/icons`, `@gravity-ui/markdown-editor` and the ProseMirror /
  CodeMirror / emoji-catalog dependencies that came with them.

### Upgrading from Gravity Notes

Sol is a separate app with its own identity, so it starts at the folder gate: **re-pick your notes
folder** and everything in it — including your pins and preferences — comes back. Notes kept in
**in-browser storage** do not transfer automatically: export them from Gravity Notes (`Export all
notes…`) and import the zip into Sol. Your `.md` files are never touched by any of this.
