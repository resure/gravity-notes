# TODO

Deferred follow-ups. Roadmap/backlog proper lives in `README.md`; this file tracks work
intentionally cut from a shipped feature so the gaps are explicit.

## Media attachments — follow-ups

The first round shipped the core: drag-drop / paste / image-command upload into the editor, storage
under a root `Attachments/` folder across all three backends (FSA-web, Tauri/Rust, IndexedDB), and
rendering in both the editor and the read-only preview. Image refs in Markdown are root-relative
(`Attachments/foo.png`), resolved to `blob:` URLs at display time so saved notes stay clean.

Still to do:

- **Attachments management view.** A UI to list, preview (thumbnails), and delete attachments —
  e.g. a TopBar/storage-menu entry. Needs new `NoteStore` methods `listAttachments()` and
  `removeAttachment(ref)` (the same per-backend pattern as `writeAttachment`/`readAttachment`; a Rust
  `attachment_list`/`attachment_remove` pair for the Tauri backend).

- **Orphan garbage collection.** Deleting a note does **not** delete its images today (an attachment
  may be referenced by more than one note). Add detection of attachments unreferenced by any note,
  surfaced in the management view (and/or an opt-in cleanup). Depends on `listAttachments` +
  `removeAttachment`.

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
