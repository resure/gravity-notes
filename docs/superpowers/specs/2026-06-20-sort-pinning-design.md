# Sort & Pinning — Design

- **Date:** 2026-06-20
- **Status:** Approved (pending final spec review)
- **Sub-project:** 3b of 5 in the Gravity Notes improvement roadmap (the back half of sub-project 3)

## Context

Slice 3a made the note list searchable, keyboard-drivable, and rename-in-place, and stood up the
jsdom + Testing Library foundation. It deliberately left out **sort options** and **pinning** because
both need something the app does not have: a place to persist data that is not a note's body. Notes
are plain `.md` files — the filename is the id, the name minus `.md` is the title, and the only
timestamp available is the file's `lastModified`. There is no metadata layer.

This slice adds that layer. It is the one architectural decision the kickoff
(`docs/superpowers/handoffs/2026-06-20-sort-pinning-kickoff.md`) flagged as central to the whole
roadmap: where do pins, the chosen sort mode, and creation times live, and how does that stay behind
the storage-agnostic `NoteStore` seam.

Today ordering is hardcoded in two places: `FileSystemNoteStore.list()` sorts newest-first by
`updatedAt`, and `useNotes.bumpInList` re-sorts the same way after each save. With pins and selectable
sort, ordering becomes a real function of (notes, metadata) and moves to a single pure place.

## Goal

Let the user **choose how the note list is ordered** and **keep chosen notes at the top**, persisting
both with the folder so they travel and survive reloads — without mutating note files or breaking the
existing search / keyboard / conflict flows.

### Success criteria

- A **sort control** in the sidebar header offers **Updated (newest first)** (the current default),
  **Title (A→Z)**, and **Created (newest first)**. The choice persists across reloads.
- Notes can be **pinned to the top** (and unpinned) from the ⋯ menu; pinned notes show a pin icon and
  stay above unpinned notes regardless of the active sort.
- Pins, sort mode, and creation times are stored in a **folder dotfile** (`.gravity-notes.json`) that
  travels with the folder; note `.md` files are never modified by this feature.
- Sort and pinning compose with search (order the base list, then filter) and with the existing
  roving-tabindex keyboard navigation, with no regressions to selection, autosave, or conflict
  handling.
- The metadata layer self-heals: pins/created entries for notes deleted or renamed outside the app are
  dropped; a missing or corrupt dotfile falls back to defaults rather than crashing.
- **Folded-in 3a polish:** the shortcuts help dialog is complete and structurally guarded against
  drift from the real bindings.

## Decisions (with rationale)

| Decision                 | Choice                                                                   | Rationale                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metadata home            | A folder dotfile, `.gravity-notes.json`                                  | Fits a global sort mode + a pin list naturally, keeps note files pure plain-markdown (no editor round-trip risk), and travels with the folder so it syncs via Dropbox/iCloud.       |
| Sort modes in scope      | Updated (default), Title (A→Z), Created (newest first)                   | Updated is today's behavior; Title is free (title is the filename); Created is cheap once the dotfile exists. Manual drag-reorder is deferred (real UI lift) with `order` reserved. |
| Pinned sub-ordering      | `pinned` is a membership **set**; both groups sort by the active sort    | Predictable: switching to Title alphabetizes within the pinned group too. Avoids maintaining a separate pin order no UI exposes.                                                    |
| Created time source      | Stamp `created[id]` on create; fall back to `updatedAt` when absent      | The FS Access API has no birthtime. New notes get a real stamp (the fresh file's mtime); pre-existing notes sort by mtime — no backfill write, no crash.                            |
| `NoteStore` change       | Add `readMetadata()` / `writeMetadata(meta)` only                        | Minimal, storage-agnostic growth. The blob is persisted by the store; all metadata _logic_ lives in pure helpers, so alternative backends stay drop-in.                             |
| Ordering location        | A pure `orderNotes(notes, metadata)`, memoized in `Workspace`            | One place to reason about order, mirroring how `useNoteSearch` sits. Replaces the two hardcoded sorts; `bumpInList` stops sorting.                                                  |
| Sort/pin while searching | Order the base list, then filter (search feeds on ordered notes)         | Pinned matches stay on top; the pin icon persists in filtered results. Same pipeline shape 3a already established.                                                                  |
| Pin affordance           | ⋯ menu "Pin to top" / "Unpin"; pin icon on pinned rows is display-only   | Consistent with the existing Rename/Delete menu and fully keyboard-accessible; no new interactive element inside listbox options to reason about for a11y.                          |
| Pinned visual treatment  | Icon only — one continuous list, pinned sorted to top, no divider/labels | Chosen in the visual brainstorm: least chrome for a compact sidebar; the pin icon alone signals "pinned."                                                                           |
| Dotfile external changes | Last-write-wins + reconcile-against-live-files on read; no conflict UI   | The dotfile is our own bookkeeping, not user content. Reconciliation self-heals stale ids; full TOCTOU handling (as for notes) is overkill here.                                    |
| New shortcuts            | None for sort/pin this slice                                             | Keeps 3b focused; sort/pin are mouse-driven. The help dialog gains documentation rows for existing keys, not new bindings.                                                          |

## Detailed design

### Data model — `.gravity-notes.json`

A single JSON file at the folder root:

```jsonc
{
  "version": 1,
  "sort": "updated", // "updated" | "title" | "created"
  "pinned": ["Roadmap.md", "Ideas.md"], // note ids; treated as a SET (array order not significant)
  "created": {"Roadmap.md": 1718900000000}, // id → epoch ms, stamped on create
  // "order": string[] is reserved for a future Manual sort and is NOT written in 3b
}
```

- It is not a `.md` file, so `list()` (which filters to `.md`) never surfaces it as a note, and
  `uniqueFileName` never collides with it.
- A missing file, a parse error, or an unrecognized `version` resolves to `DEFAULT_METADATA`
  (`{version: 1, sort: 'updated', pinned: [], created: {}}`). The feature degrades to "everything
  unpinned, sorted by updated" rather than failing.
- `pinned` is persisted as an array (JSON has no set) but used as a membership set; display order
  within the pinned group comes from the active sort, not the array.

### Pure metadata + ordering layer (`src/storage/metadata.ts`, new)

No I/O — trivially unit-tested.

- `NotesMetadata` type, `SortMode = 'updated' | 'title' | 'created'`, and `DEFAULT_METADATA`.
- `parseMetadata(raw: unknown): NotesMetadata` — tolerant parse: validate shape/version, coerce to
  defaults on anything unexpected (used by `readMetadata`).
- Immutable transforms returning a new blob:
  - `withSortMode(meta, mode)`
  - `withPinToggled(meta, id)` — add/remove id in `pinned`
  - `withCreatedStamp(meta, id, t)` — set `created[id]` if absent
  - `withRenamed(meta, oldId, newId)` — migrate pin membership and the `created` entry
  - `withRemoved(meta, id)` — drop from `pinned` and `created`
  - `reconcile(meta, liveIds: string[])` — drop `pinned`/`created` entries whose id is not a live file
- `orderNotes(notes: NoteMeta[], meta: NotesMetadata): NoteMeta[]`:
  1. Partition into pinned vs. unpinned by the `pinned` set.
  2. Sort each group by `meta.sort`: **updated** → `updatedAt` desc; **title** → `title`
     `localeCompare` asc; **created** → `(created[id] ?? updatedAt)` desc.
  3. Return pinned group followed by unpinned group. Stable within ties.

### Storage layer (`NoteStore` + implementations)

`src/storage/types.ts` — add two methods to `NoteStore` and export the metadata types:

```ts
/** Read the folder's notes metadata (sort, pins, created times); defaults if absent/corrupt. */
readMetadata(): Promise<NotesMetadata>;
/** Persist the folder's notes metadata. */
writeMetadata(meta: NotesMetadata): Promise<void>;
```

`src/storage/fileSystemStore.ts` — implement against `.gravity-notes.json`:

- `readMetadata`: `getFileHandle('.gravity-notes.json')` → read text → `parseMetadata`. `NotFoundError`
  → `DEFAULT_METADATA`. A JSON/shape error also resolves to defaults (never throws for a bad file).
- `writeMetadata`: `getFileHandle(..., {create: true})` → `createWritable` → write
  `JSON.stringify(meta, null, 2)` → close.
- No change to `list/get/create/save/rename/remove/stat`; metadata stays a separate surface. (The
  `.md` filter already excludes the dotfile.)

The in-memory fake (`src/storage/fakeFileSystem.ts`) **needs no changes** — it already serves
arbitrary filenames through `getFileHandle`/`createWritable`/`values`, so `readMetadata`/
`writeMetadata` round-trip through it as-is.

### Hook layer (`src/hooks/`)

**`useNotes.ts` (changed)** owns the metadata blob because the note operations it already owns must
keep metadata in sync:

- Load `metadata` into state on mount, alongside the initial `list()`.
- Expose `metadata`, `setSortMode(mode)`, and `togglePin(id)`. Each applies a pure transform and
  persists via `writeMetadata`; failures route to the existing `onError` toaster and never block note
  editing.
- `create`: after `store.create`, stamp `created[id] = meta.updatedAt` (the fresh file's mtime ≈ birth
  time — no `Date.now`) and persist.
- `rename`: after `store.rename`, apply `withRenamed(oldId, newId)` so a pinned/created note keeps its
  pin and creation time across the id change.
- `remove`: apply `withRemoved(id)` and persist.
- `bumpInList` **stops sorting** — it only updates the changed note's `updatedAt`; order is re-derived
  downstream by `orderNotes`. (The store's `list()` may keep returning newest-first as a stable base;
  `orderNotes` is the authority.)
- `reconcile(metadata, liveIds)` runs whenever the list is (re)loaded, dropping stale ids.
- Selection, autosave, and all conflict resolvers (`reloadDisk`/`keepMine`/`saveAsCopy`/`discard`) are
  otherwise unchanged — metadata is orthogonal to note content and its concurrency.

Ordering itself stays a **pure function** (`orderNotes`), memoized in `Workspace`, rather than a hook —
it has no local state (sort mode lives in `metadata`). This mirrors `useNoteSearch` sitting downstream.

### Component layer (`src/components/`)

**`NoteList.tsx` (changed)** — new props: `sortMode`, `onSortChange`, `pinnedIds` (or `isPinned`), and
`onTogglePin`.

- **Sort control** in the header (beside "New"): a compact Gravity `Select` bound to `sortMode`/
  `onSortChange`, options Updated / Title (A→Z) / Created.
- **Pin icon** (`@gravity-ui/icons` `Pin`) rendered on rows whose id is pinned — display-only, leading
  the title; unpinned rows reserve the same space so titles stay aligned.
- **⋯ menu** gains a leading item: **"Pin to top"** when unpinned / **"Unpin"** when pinned (with a
  `Pin` icon), above Rename and Delete; it calls `onTogglePin(id)`.
- Search field, match highlighting, `listbox`/`option` roles, roving tabindex, inline rename, and the
  delete dialog are unchanged — they already operate on whatever ordered+filtered array they are given.

**`Workspace.tsx` (changed)** — the wiring hub:

- `const orderedNotes = useMemo(() => orderNotes(notes.notes, notes.metadata), [notes.notes, notes.metadata])`.
- `useNoteSearch(orderedNotes)` → `filteredNotes` (unchanged hook; it preserves input order, so pins +
  sort survive filtering).
- Pass `sortMode`/`onSortChange`/`pinnedIds`/`onTogglePin` through to `NoteList`.

### Folded-in 3a review polish

- **Help-dialog completeness:** add rows for Enter/Space (open the focused note), Esc (clear search),
  and F2 (rename) — keys that exist but were missing from the sheet.
- **Label-drift guard (structural):** introduce a single `SHORTCUTS` descriptor (key + label + group +
  scope) as the source of truth. `ShortcutsDialog` renders its rows from the descriptor; `useShortcuts`
  derives its global ⌘-bindings from the same descriptor where it owns them (list-only keys are
  descriptor rows documented as handled in `NoteList`). A test asserts the dialog renders a row for
  every descriptor entry, so adding/removing a binding without updating the sheet fails CI.

### Data flow

```
                       ┌─ sort control ─▶ onSortChange ─▶ useNotes.setSortMode ─▶ writeMetadata
notes + metadata ─▶ orderNotes ─▶ useNoteSearch (filter) ─▶ NoteList (renders ordered, filtered list)
                       └─ ⋯ Pin/Unpin ─▶ onTogglePin ─▶ useNotes.togglePin ─▶ writeMetadata
create ─▶ stamp created[id]   rename ─▶ migrate id   remove ─▶ prune id   list refresh ─▶ reconcile
```

### Error handling

Unchanged model: storage errors surface through the existing toaster (`onError` in `Workspace`).
`readMetadata` never throws for a bad/missing file (defaults instead). `writeMetadata` failures toast
and leave the in-memory state as the user set it; note content and its autosave/conflict path are
independent of metadata writes.

## Testing (TDD)

**node `*.test.ts`:**

- `metadata.test.ts` — `parseMetadata` (valid, missing fields, wrong version, garbage → defaults); each
  `with*` transform; `reconcile` drops stale ids; `orderNotes` for all three modes, the
  `created → updatedAt` fallback, pinned-first grouping, and tie stability.
- `fileSystemStore.test.ts` (extend) — `readMetadata`/`writeMetadata` round-trip through the fake;
  missing file → defaults; corrupt JSON → defaults; the dotfile is not returned by `list()`.
- `useNotes.test.tsx` (extend) — `create` stamps `created`; `rename` migrates pin + created;
  `remove` prunes; `setSortMode` and `togglePin` persist via `writeMetadata`; existing conflict-
  resolver tests still pass.

**jsdom `*.test.tsx`:**

- `NoteList.test.tsx` (extend) — pin icon shows only on pinned rows; ⋯ "Pin to top"/"Unpin" calls
  `onTogglePin`; the sort `Select` calls `onSortChange`; keyboard nav still works over a reordered
  list.
- `ShortcutsDialog.test.tsx` (extend) — the new rows render; the descriptor-divergence guard test.

## Out of scope (YAGNI)

- **Manual drag-and-drop ordering** — deferred; `order` is reserved in the schema so it lands later
  with no migration.
- **A keyboard shortcut for sort or pin** — mouse-driven this slice.
- **Conflict UI for the dotfile** — last-write-wins + reconcile is sufficient for our own bookkeeping
  file.
- **Frontmatter / per-note metadata** — rejected (mutates owned files, editor round-trip risk, no home
  for global sort).
- **Migrating or persisting backfilled created times** — absent stamps fall back to `updatedAt` at
  sort time; no write.

## Risks & mitigations

- **Stale ids after external rename/delete** — `reconcile` on every list refresh drops orphaned
  pinned/created entries; covered by `metadata.test.ts`.
- **Corrupt or hand-edited dotfile** — `parseMetadata`/`readMetadata` coerce to defaults and never
  throw; covered by store tests.
- **Ordering regressions** vs the old hardcoded sort — `orderNotes` is pure and exhaustively tested;
  `bumpInList` no longer sorts, removing the second source of truth.
- **Metadata write failures** (permissions, disk) — surfaced via the toaster; note CRUD proceeds
  regardless so a failed pin can never cost the user note content.
- **a11y of the reordered listbox** — roving tabindex already keys off the rendered array; pin/sort
  only change that array's contents/order, exercised by `NoteList` keyboard tests.

## Implementation order

1. `src/storage/metadata.ts`: types, `DEFAULT_METADATA`, `parseMetadata`, the `with*` transforms,
   `reconcile`, `orderNotes` (tests → impl).
2. `NoteStore` interface + `FileSystemNoteStore.readMetadata`/`writeMetadata` (tests → impl).
3. `useNotes` metadata wiring: load, `setSortMode`, `togglePin`, create-stamp, rename-migrate,
   remove-prune, `bumpInList` no longer sorts, reconcile-on-refresh (tests → impl).
4. `NoteList`: sort `Select`, pin icon, ⋯ Pin/Unpin (tests → impl).
5. `Workspace`: `orderNotes` memo feeding `useNoteSearch`; pass sort/pin props through.
6. 3a polish: `SHORTCUTS` descriptor, `ShortcutsDialog` rows + completeness, divergence guard test.
7. Full verification (lint, format:check, typecheck, test, build) + manual smoke of sort switching,
   pin/unpin, persistence across reload, and search-while-pinned.

```

```
