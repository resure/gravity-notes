# TODO

Deferred follow-ups. Roadmap/backlog proper lives in `README.md`; this file tracks work
intentionally cut from a shipped feature so the gaps are explicit.

## Media attachments — follow-ups

Shipped so far:

- **Core.** Drag-drop / paste / image-command upload into the editor, storage under a root
  `Attachments/` folder across all three backends (FSA-web, Tauri/Rust, IndexedDB), and rendering in
  both the editor and the read-only preview. Image refs in Markdown are root-relative
  (`Attachments/foo.png`), resolved to `blob:` URLs at display time so saved notes stay clean.
- **Management view.** TopBar → "Manage attachments…" dialog lists every attachment with a thumbnail,
  size, and a "used by N notes" / "Unused" badge (orphan detection), with per-file delete and a bulk
  "Delete unused". Seam methods `listAttachments()` / `removeAttachment(ref)` (+ Rust
  `attachment_list` / `attachment_remove`) back it.
- **Export / import.** The export zip now bundles `Attachments/` bytes at their exact refs, and import
  restores them (skip-if-exists) via `writeAttachmentAt(ref, blob)`, so images survive a roundtrip —
  including the IndexedDB backend, whose attachments live in the DB rather than on disk.
- **Editor affordances.** The custom image NodeView supports drag-to-resize (persisted as imsize
  `=WxH`), an alt-text editor (shown as a caption when set; the default filename isn't), click-to-zoom
  (full-size overlay), a selection ring, and an "image not found" state.
- **Duplicate note** (`useNotes.duplicate`, ⌘D / row menu) copies the body verbatim, so the copy
  shares the original's attachments (no byte copy).
- **Manager polish + Reveal in Finder.** The attachments dialog sorts by recent / size / name and
  opens any image full-size via a shared `Lightbox` (pinch / ctrl-scroll zoom, drag-pan, double-click
  reset — also reused by the editor's click-to-zoom). On the desktop app, "Reveal in Finder" is offered
  for notes, folders, and attachments (optional `NoteStore.reveal` → Rust `reveal_path`, `open -R`);
  feature-detected, so it's hidden on the web / in-browser backends, which have no file to reveal.

Lifecycle policy (decided 2026-06-28): attachments are **shared**, never owned by one note.
Deleting a note, or removing an image while editing, **keeps** the file (a future trash/restore will
want it); cleanup is **manual** via Manage attachments → "Delete unused". So there is intentionally
**no** automatic orphan GC on delete.

Still to do:

- **Tauri IPC efficiency.** `attachment_write`/`attachment_read` move bytes as JSON number arrays.
  Switch to a raw-bytes transport (e.g. `tauri::ipc::Response` / typed-array args) for large images.
- **Verify the `/image` slash command** surfaces the upload action in our editor config (toolbar
  button, drag-drop, and paste already route through the upload handler).
- **(Future) trash / restore for deleted notes** — the reason attachments are kept on delete.
- **Selected-image caret line (cosmetic).** Selecting an image in the editor leaves a faint vertical
  caret line beside it — the browser's _native object-selection caret_ (both Blink and WebKit), drawn
  next to the selected inline `contenteditable=false` node. It ignores `caret-color`, `user-select`,
  and gravity's own cursor hiding. The CSS levers that hide it have unacceptable side effects
  (`-webkit-user-modify: read-only` freezes the editor; `font-size: 0` hides sibling text in the
  paragraph), so a real fix needs ProseMirror-level work: make the image a block node, or add custom
  selection handling so a selected image doesn't leave an adjacent caret.
