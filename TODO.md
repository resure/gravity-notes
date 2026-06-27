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

Still to do:

- **Orphan garbage collection (automatic).** The management view surfaces orphans and offers manual
  "Delete unused", but deleting a _note_ still leaves its images behind. Optionally prompt/auto-clean
  an attachment when the last note referencing it is deleted.

- **Attachment export / import.** `src/storage/transfer.ts` currently zips only `.md` note bodies, so
  attachments do **not** survive export/import yet — most consequential for the IndexedDB backend,
  whose attachments live in the DB rather than as files on disk. Extend the zip to bundle the
  `Attachments/` bytes and restore them on import.

- **Editor image affordances.** The custom attachment NodeView renders a clean `<img>` but drops the
  package's resize handles and the hover settings popover (alt/title editing). Re-add resize + an
  alt/title editor for attachment images.

- **Tauri IPC efficiency.** `attachment_write`/`attachment_read` move bytes as JSON number arrays.
  Switch to a raw-bytes transport (e.g. `tauri::ipc::Response` / typed-array args) for large images.

- **Verify the `/image` slash command** surfaces the upload action in our editor config (toolbar
  button, drag-drop, and paste already route through the upload handler).
