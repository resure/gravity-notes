# Handoff — `feat/nested-folders`

Scratch doc for picking the branch back up. **Delete before merge** (prior handoffs were removed in a
`chore:` commit ahead of merge).

## Status: green, ready to continue or merge-prep

- Branch `feat/nested-folders`: **49 commits ahead of `main`**, **14 ahead of `origin`** (unpushed).
- Working tree clean. Last verified 2026-06-28.
- Checks all pass: `npm run typecheck` · `npm run lint` (0 errors, 23 pre-existing warnings) ·
  `npm run format:check` · `npm test` (**584 passing**) · `npm run build` · `cargo test` in
  `src-tauri` (**13 passing**).

## What this branch contains

Two big features layered on the `NoteStore` seam:

1. **Nested folders** (earlier work, MVP complete) — path-encoded note ids (`Work/Sub/Title.md`),
   first-class empty folders (`.gnkeep`), collapsible folder rail, move/rename, ⌘⇧M move picker,
   drag-and-drop, across all three backends. See git log `phase 1…12`.
2. **Media attachments** (this session, complete) — details below.

## Media attachments — shipped

Architecture is recorded in memory `attachments-architecture.md`; the short version:

- Images live in a root **`Attachments/`** folder. Markdown stores **root-relative** refs
  `![alt](Attachments/foo.png)`, resolved to `blob:` object URLs only at display time via a per-store
  **`AttachmentUrlCache`** (`src/attachments.ts`, provided through `AttachmentsContext`).
- **Seam** (`src/storage/types.ts`, all 3 backends; Tauri via Rust `attachment_*` commands in
  `src-tauri/src/lib.rs`): `writeAttachment` (unique name), `writeAttachmentAt` (exact path, for
  import), `readAttachment`, `listAttachments`, `removeAttachment`.
- **Core**: drag-drop / paste / image-command upload → `EditorPane` `handlers.uploadFile`; rendered
  by a custom image NodeView (`src/components/editor/attachmentImageView.tsx`, registered at
  `Priority.VeryHigh` via `attachmentImageExtension.ts`) and in the preview (`NotePreview.tsx`).
- **Management view**: TopBar → "Manage attachments…" (`AttachmentsDialog.tsx`) — thumbnails, size,
  used/unused (orphan) flags, per-file delete + bulk "Delete unused".
- **Export/import** (`src/storage/transfer.ts`): the zip bundles `Attachments/` bytes; import restores
  at exact refs (skip-if-exists).
- **Editor UX**: drag-to-resize (`=WxH`), alt→caption editor, click-to-zoom lightbox, tight selection
  ring, "image not found" state.
- **Duplicate note** (`useNotes.duplicate`, ⌘D / row menu): copies the body, so attachments are shared.

### Decisions baked in (don't re-litigate)

- Attachment filenames are **URL-safe** (`uniqueAttachmentName` collapses spaces/parens to `-`) — a
  space/`)` in `![](…)` breaks markdown-it (preview).
- Attachments are **shared**, never owned by one note. Delete-note / remove-image **keeps** the file
  (for a future trash/restore); cleanup is **manual** via "Delete unused". No auto-GC by design.

## Gotchas worth knowing (also in memory)

- `@diplodoc/transform` has **no `images` plugin** by default → `replaceImageSrc` never fires; the
  preview post-processes the rendered HTML to swap attachment `<img src>`.
- The editor seeds `alt` from the pasted **file name**; the NodeView only shows alt as a caption when
  it's not a default filename (`isCaption`).
- Selecting an image: ProseMirror outlines the node's container, which is full-width here, so we
  suppress it (`:has(.attachment-figure)`) and ring the image's frame instead.

## Remaining (see `TODO.md`)

- Tauri attachment IPC efficiency (bytes currently move as JSON number arrays).
- Verify the `/image` slash command surfaces the upload action.
- (Future) trash / restore for deleted notes.

## Known issue (user's local data, not the repo)

- `~/Documents/GravityNotes/Hello.md` still contains a stray `^[` (U+001B) where an image was, from
  the now-fixed lightbox-Escape bug (`ef158cb`). Re-insert that image to repair it.

## Verify end-to-end

1. `npm test && npm run typecheck && npm run lint && npm run build`; `cargo test` in `src-tauri`.
2. `npm run dev`, pick a backend, paste/drag an image → renders; resize, edit alt (→ caption),
   click-to-zoom (Esc closes), select (tight ring); Manage attachments lists it; duplicate (⌘D) →
   "Used by 2 notes"; export then import into a fresh store → image survives.
