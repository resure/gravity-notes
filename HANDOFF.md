# Handoff — `feat/nested-folders`

Nested-folder support for Gravity Notes. **MVP is complete and green**; the next planned work is
**UX polish** (see the backlog below). This doc is branch scratch — delete it before merge.

## TL;DR

A note's id is now its POSIX relative path (`Work/Sub/Title.md`); folders are first-class objects
you can create empty, pin, and delete. You can create/move/organize notes into folders, expand/
collapse the tree, and move notes via a ⌘⇧M picker **or** drag-and-drop. Works fully **in-browser
(IndexedDB)** and on the **desktop (Tauri/Rust)**. The **Chromium web folder backend (FSA) is the one
gap** — its folder ops are stubbed (phase 11).

- **Verification:** 436 TS tests + 8 Rust tests, `npm run typecheck`, `npm run lint` (0 errors),
  `npm run build` — all green. Each of the 12 commits is independently green.
- **Run it:** `npm run dev` (in-browser) or `npm run tauri:dev` (desktop). The web/FSA backend can't
  create folders yet — use in-browser or desktop to exercise folders.

## Design decisions (locked)

- **Path-encoded ids** over a separate folder field: the whole stack already treats a note id as one
  opaque exact-string key (metadata, search corpus, `useNotes` pending/generation, IndexedDB keys),
  so nesting is **zero data migration**. Virtual/tag folders were rejected.
- **First-class empty folders**: `.gnkeep` marker on disk (Tauri) / a marker set in the KV store
  (IndexedDB). `.gnkeep` **counts as content**, so the empty-ancestor auto-prune never destroys a
  deliberately-created folder. Create + prune shipped together.
- **Pins are per-folder, and folders are pinnable.** Tree order per level:
  `[pinned folders → unpinned folders → pinned notes → unpinned notes]`.
- **Move-onto-collision = hard-fail** (`NameCollisionError`), mirroring rename.
- **Move gestures = both** keyboard picker (⌘⇧M) and drag-and-drop.
- **⌘N creates into the focused folder** (the selected note's dir); the top-bar find-or-create stays
  at root.
- Per the owner: cross-backend compatibility was de-prioritized ("no clients yet") — the metadata
  v1→v2 version bump was dropped; the `reconcile` recursion-guard is kept only as a cheap invariant.

## Architecture (what changed, where)

- **`src/storage/noteText.ts`** — path helpers: `sanitizeSegment` (+ `sanitizeTitle` alias),
  `basename`/`dirname`/`joinPath`, `sanitizeDir` (drops `.`/`..`), basename-first `titleFromFileName`,
  `FOLDER_MARKER` (`.gnkeep`).
- **`src/storage/types.ts`** — `NoteStore` gained `create(title, parentPath?)`, `move(id, destFolder)`,
  `createFolder`/`removeFolder`/`listFolders`, and `listsRecursively`.
- **`src/storage/metadata.ts`** — `reconcile(meta, liveIds, {recursive})`: when not recursive, keeps
  any id containing `/` (a nested id the backend can't yet enumerate) instead of pruning it.
- **`src/search.ts`** — final sort tiebreak on full path-id (deterministic order for same-leaf notes).
- **`src/storage/indexedDbStore.ts`** — full impl; folders = note-prefixes ∪ a KV `folders` marker set.
- **`src/storage/tauriStore.ts` + `src-tauri/src/lib.rs`** — recursive listing, `create_dir_all`,
  EXDEV-fallback move, **lexical `resolve_within` traversal guard on every path arg** (the only
  containment defense — the `notes_*` commands bypass the capability scope), `.gnkeep` + safe prune.
- **`src/storage/fileSystemStore.ts`** — FSA: `create(parentPath)`/`move`/folder ops **throw**
  (interim); `listFolders` returns `[]`; `listsRecursively = false`. ← **phase 11 finishes this.**
- **`src/hooks/useNotes.ts`** — `move()` is **live-editor-safe** (handles keystrokes typed during the
  move's await window: flush → store.move → clearTimer → fixed-order id-swap/persist/baseline-reseed/
  re-point+re-arm pending, gated by `moveInProgressRef`). Exposes `folders`, `createFolder`,
  `removeFolder`; `create` takes `parentPath`.
- **`src/tree.ts`** — pure `buildTree(notes, folders, metadata, collapsed) → TreeRow[]` +
  `visibleNoteIds()` (the cursor projection; headers skipped). Encodes the pin-ordering rule.
- **`src/components/NoteList.tsx`** — renders `TreeRow[]`: folder headers (disclosure Button + ＋ +
  menu), indented notes, inline New-Folder row, "Move to…" picker, draggable notes / drop-target
  folders, crumb in search mode.
- **`src/components/Workspace.tsx`** — owns the persisted `collapsedFolders` set; builds the tree when
  idle / a flat ranked list when searching; routes ⌘J/⌘K + delete-neighbor through `visibleNoteIds`;
  wires ⌘N-into-folder and ⌘⇧M.
- **`src/shortcuts.ts`** — `moveSelected` / `mod+shift+m`.

## Phase status

Done: **1** helpers · **2** fake-FS harness · **3** reconcile guard + `listsRecursively` + search
tiebreak · **4+6** interface + IndexedDB · **5** guard wiring · **7** Tauri/Rust · **8** live-editor-safe
move · **9a** empty folders · **9b** useNotes folders · **9c-1** `buildTree` · **9c-2** tree render ·
**9c-3** move gestures.

Deferred:

- **Phase 11 — web/FSA folder ops** *(the one real capability gap)*: per-segment `getDirectoryHandle`
  walk for recursive list/getAll + path-aware get/save/create/rename/move + nested case-only rename +
  empty-dir prune + the fake-FS harness already supports nesting. Then flip its `listsRecursively`.
- **Phase 10 — folder rename / move-subtree**: `moveFolder` returning an explicit per-child
  `{from,to,updatedAt}` remap; `withBulkRenamed` in metadata; crash-safe subtree copy
  (copy→verify→delete); apply the same open-child pending/baseline reconciliation as single move.
- **Phase 12 — nested import**: `transfer.ts` should preserve zip subfolder paths (currently flattens).

## UX backlog (next focus)

1. **Folder UI is dead on the Chromium web/FSA backend** — "New Folder"/"Move to…" throw a toast there.
   Either hide folder affordances when the active store can't do folders, or finish phase 11. *(Top of
   the list — it's a broken surface, not just polish.)*
2. **Keyboard collapse/expand** — the j/k/arrow cursor only lands on notes; collapsing a folder needs a
   mouse click on the caret (or Tab to it). Add Left=collapse / Right=expand on a note row (and a way
   to land on / act on headers).
3. **Move picker** — flat list of full paths; no tree indentation, no filter/typeahead for many
   folders, doesn't exclude the note's current folder. A tree-shaped or filterable picker would help.
4. **Drag-and-drop** — only drops *into* folder headers; no drop-to-root, no folder dragging (needs
   phase 10), no autoscroll, minimal drop affordance.
5. **Folder rename** — not possible yet (phase 10); a common expectation.
6. **Empty/placeholder states** for empty folders and the create-first-folder moment.
7. **ARIA** — notes use `listbox`/`option`; folder headers are labelled disclosure buttons. A proper
   `tree`/`treeitem` model would be more correct for screen readers (deferred to avoid test churn).
8. Confirm the **per-folder pin ordering** and **⌘N-into-folder** feel right in real use.

## Resuming

- The phased plan + decisions also live in agent memory (`nested-folders-plan.md`).
- Commit history on the branch is granular and labelled by phase — `git log --oneline main..HEAD`.
- The original design (3 architects + judge panel + 7 adversaries) and the subsystem map are in the
  session transcript; the adversarial findings drove the move/guard/prune correctness work.
