# Handoff — `feat/nested-folders`

Nested-folder support for Gravity Notes. **Complete and green across all three backends**, with the
collapsible folder-rail UX shipped. This doc is branch scratch — delete it before merge.

## TL;DR

A note's id is its POSIX relative path (`Work/Sub/Title.md`); folders are first-class objects you can
create empty, pin, delete, **rename, and reparent**. Folders live in a **collapsible left rail** (off
by default → the app stays a 2-pane nvALT view); selecting a folder scopes the **flat** notes list to
its _direct_ notes ("All Notes" = everything), while search stays **global**. Notes move by dragging
onto a rail folder (or "All Notes" = root), a ⌘⇧M picker, or the row "Move to…" menu; **folders**
themselves drag to reparent (or onto "All Notes" → root) and rename in place (double-click / F2 /
menu). Works on **all three backends** — in-browser (IndexedDB), desktop (Tauri/Rust), and the
**Chromium web folder backend (FSA)**.

- **Verification:** 523 TS tests + 10 Rust tests, `npm run typecheck`, `npm run lint` (0 errors),
  `npm run build` — all green.
- **Run it:** `npm run dev` (in-browser, or a Chromium folder) or `npm run tauri:dev` (desktop).
  Toggle the folder rail with **⌘⇧\\** or the folder button in the list toolbar.

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
- **Move gestures = both** keyboard picker (⌘⇧M) and drag-and-drop (onto rail folders / "All Notes").
- **Folders are a collapsible rail** (3-pane: Folders | Notes | Editor), off by default so the app
  stays 2-pane/nvALT; the notes list is flat again, scoped to the selected folder's _direct_ notes
  ("All Notes" = everything). Search stays **global** and overrides the folder scope (path crumbs on
  results). Rejected the inline tree (one narrow column doing two jobs) and a no-pane scope chip.
- **⌘N creates into the selected folder** (⌘⇧\\ toggles the rail); the top-bar find-or-create stays
  at root.
- Per the owner: cross-backend compatibility was de-prioritized ("no clients yet") — the metadata
  v1→v2 version bump was dropped; the `reconcile` recursion-guard is kept only as a cheap invariant.

## Architecture (what changed, where)

- **`src/storage/noteText.ts`** — path helpers: `sanitizeSegment` (+ `sanitizeTitle` alias),
  `basename`/`dirname`/`joinPath`, `sanitizeDir` (drops `.`/`..`), basename-first `titleFromFileName`,
  `FOLDER_MARKER` (`.gnkeep`).
- **`src/storage/types.ts`** — `NoteStore` gained `create(title, parentPath?)`, `move(id, destFolder)`,
  `moveFolder(fromPath, toPath)`, `createFolder`/`removeFolder`/`listFolders`, and `listsRecursively`.
- **`src/storage/metadata.ts`** — `reconcile(meta, liveIds, {recursive})` (keeps nested ids when a
  backend can't enumerate them) + `withReprefixed(meta, from, to)`, the metadata side of a folder
  move/rename (re-prefixes note + folder pins, created stamps, and the active id under the moved path).
- **`src/search.ts`** — final sort tiebreak on full path-id (deterministic order for same-leaf notes).
- **`src/storage/indexedDbStore.ts`** — full impl; folders = note-prefixes ∪ a KV `folders` marker set.
- **`src/storage/tauriStore.ts` + `src-tauri/src/lib.rs`** — recursive listing, `create_dir_all`,
  EXDEV-fallback move, `notes_move_dir` (atomic subtree rename + prune of the old parent), **lexical
  `resolve_within` traversal guard on every path arg** (the only containment defense — the `notes_*`
  commands bypass the capability scope), `.gnkeep` + safe prune.
- **`src/storage/fileSystemStore.ts`** — FSA: full folder support (phase 11). Per-segment
  `resolveDir` walk; recursive `walkNotes` for list/getAll (skips dot-dirs); path-aware
  get/save/stat/create/rename/move; `createFolder` (`.gnkeep`) / `removeFolder` / recursive
  `listFolders`; `moveFolder` via a recursive `copyTree` (no atomic dir rename in the FSA) + prune;
  empty-ancestor prune on move/remove (mirrors the Rust `is_prunable`); `listsRecursively = true`.
- **`src/hooks/useNotes.ts`** — `move()` and `moveFolder()` are **live-editor-safe** (handle a
  keystroke typed during the await window: flush → store op → re-point the open note in place
  [id-swap / `withReprefixed` persist / baseline-reseed via `stat` / carry+re-arm pending], gated by
  `moveInProgressRef`). Exposes `folders`, `createFolder`, `removeFolder`, `moveFolder`; `create`
  takes `parentPath`.
- **`src/tree.ts`** — pure `buildFolderTree(folders, notes, metadata, collapsed) → FolderRow[]`
  (folders only; recursive note counts; pin-ordering) + `notesInFolder(notes, folder|null)` (direct
  children; `null` = All Notes) + `buildMoveTargets(folders, notes, metadata, currentFolder,
collapsed, query) → MoveTargetRow[]` (the move picker's tree: reuses `buildFolderTree`, marks the
  current folder `disabled`, name-filters to matches + ancestors, flags `matched` for highlight).
- **`src/components/MoveToDialog.tsx`** — the tree-shaped, filterable "Move to…" picker (combobox
  pattern: an autofocused filter field over a `listbox` of indented folder rows; `aria-activedescendant`
  drives the highlight). Typeahead highlights the first match; ↑↓ move it (skipping the disabled
  current folder), ⏎ moves, Esc cancels, click picks, carets collapse (unfiltered). Root is a row
  named "Root" that filters uniformly. State is **lifted to `Workspace`** (`movingNoteId`), where the
  full folders/notes/metadata live; `NoteList` just emits `onRequestMove(id)` and ⌘⇧M sets it directly.
- **`src/components/FolderRail.tsx`** — the folder rail: an "All Notes" row + the folder tree (caret
  collapse, pin, a quiet count that yields to the ⋯ menu on hover, inline new-folder/rename editors),
  **drag-and-drop** (note→folder, folder→folder reparent, →root; self/descendant-guarded), and
  roving-tabindex keyboard nav (↑↓ select, →/← expand/collapse or step to parent, Enter → list, `n`
  new subfolder, `⌫` delete-empty, double-click/F2 rename). Footer "New Folder". `tree`/`treeitem` ARIA.
- **`src/components/NoteList.tsx`** — a **flat** note list again (`notes: NoteMeta[]`): rename / delete
  / pin, "Move to…" (emits `onRequestMove`; the picker is owned by `Workspace`), draggable notes,
  search crumbs. Toolbar = rail toggle + sort + New; ← steps focus into the rail.
- **`src/components/Workspace.tsx`** — owns persisted `selectedFolder`, `railOpen`, and
  `collapsedFolders`; builds the rail tree; scopes the list to the selected folder's direct notes
  (global ranked results while searching); routes ⌘J/⌘K + delete-neighbor through the flat list; wires
  the rail ↔ list focus handoff, ⌘N-into-folder, ⌘⇧M, and ⌘⇧\\.
- **`src/shortcuts.ts`** — `moveSelected` / `mod+shift+m`; `toggleFolderRail` / `mod+shift+\\` (matched
  by `code: 'Backslash'`).

## Phase status

Done: **1** helpers · **2** fake-FS harness · **3** reconcile guard + `listsRecursively` + search
tiebreak · **4+6** interface + IndexedDB · **5** guard wiring · **7** Tauri/Rust · **8** live-editor-safe
move · **9a** empty folders · **9b** useNotes folders · **9c** `buildTree` + tree render + move
gestures · **10** folder move/rename (subtree re-key via `moveFolder` + `withReprefixed`, all three
backends + Rust `notes_move_dir`; live-editor-safe re-point) · **11** web/FSA folder ops (recursive
walk, path-aware ops, `.gnkeep` + prune, nested case-only rename) · **rail UX** (collapsible 3-pane,
flat folder-scoped list, global search, ⌘⇧\\) · **rail v2** (folder drag-and-drop + reparent, drop-to-
root, inline rename, in-rail keys `n`/`⌫`/F2, quiet hover-yielding counts, footer New-Folder) · **move
picker v2** (`MoveToDialog`: tree-shaped + name-filter typeahead + current-folder excluded; state
lifted to `Workspace`, `NoteList` emits `onRequestMove`).

Deferred:

- **Phase 12 — nested import**: `transfer.ts` should preserve zip subfolder paths (currently flattens).

## UX backlog (next focus)

Resolved: the dead-FSA surface (phase 11); keyboard collapse/expand (→/←) + folder nav in the rail;
drop-to-root; `tree`/`treeitem` ARIA; **folder rename** (double-click / F2 / menu) and **folder
drag-and-drop** to reparent (phase 10); the "strange numbers / paddings" (quiet hover-yielding counts,
even 30px rows, footer New-Folder); **move picker polish** (`MoveToDialog`: tree-shaped + name-filter
typeahead + current-folder excluded; visually browser-verified across tree / filter / current states).

Still open:

1. **Empty/placeholder states** — the create-first-folder moment, and an empty selected folder.
2. **Nested import** (phase 12) — `transfer.ts` still flattens zip subfolders.
3. **Drag affordance polish** — no autoscroll near the rail edges; only a row highlight (no drop-line).
4. Confirm the **rail defaults** and **⌘N-into-folder** feel right; consider auto-previewing the first
   note when you enter a folder.

## Resuming

- The phased plan + decisions also live in agent memory (`nested-folders-plan.md`).
- Commit history on the branch is granular and labelled by phase — `git log --oneline main..HEAD`.
- The original design (3 architects + judge panel + 7 adversaries) and the subsystem map are in the
  session transcript; the adversarial findings drove the move/guard/prune correctness work.

### Next session — start here

1. **See it:** `npm run dev`, open the rail with ⌘⇧\\. Folders are real on in-browser + desktop + the
   Chromium folder backend. Try: create / rename / delete folders, drag a note onto a folder, drag a
   folder onto another (reparent) or onto "All Notes" (→ root), ⌘N into the selected folder.
2. **Highest-value next:** **empty/placeholder states** (the create-first-folder moment + an empty
   selected folder), then **nested import** (phase 12 — `transfer.ts` flattens zip subfolders; preserve
   the paths). The move picker (⌘⇧M) is done — tree-shaped, name-filter typeahead, current folder
   greyed/disabled (`MoveToDialog`).
3. **Visual caveat:** the rail polish (counts, padding, footer) shipped but was **not screenshot-
   verified by the agent** (no browser tooling in that session) — eyeball it and tweak `FolderRail.css`
   if anything's off. (The move picker _was_ browser-verified this session.)

### Gotchas / things to watch

- **No atomic dir rename in the FSA** — `moveFolder` there is copy-then-delete (`copyTree`), so note
  mtimes change on a web-folder folder-move. `useNotes.moveFolder` re-`stat`s the open note to re-seed
  its conflict baseline, so it's handled, but keep it in mind for crash-safety hardening.
- **Optimistic reprefix:** `Workspace.handleMoveFolder` re-prefixes `selectedFolder` + `collapsedFolders`
  _before_ the async move resolves; a rejected move (collision) leaves selection pointing at a path the
  "vanished folder" effect then resets to All Notes. Minor, but a place to harden (return success from
  `useNotes.moveFolder` and reprefix only then).
- **Web-safe chords:** `⌘N` / `⌘⇧N` are reserved by browsers, so folder creation has no global chord —
  it's the footer button + in-rail `n`. `⌘⇧\\` / `F2` / bare keys are web-safe.

### Before merge

- Delete this `HANDOFF.md`.
- Decide whether **phase 12 (nested import)** blocks merge — it's the only deferred capability.
- Optionally curate/squash the branch's granular phase commits if a linear history is preferred.
