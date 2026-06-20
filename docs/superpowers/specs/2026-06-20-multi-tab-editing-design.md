# Multi-tab Editing — Design

- **Date:** 2026-06-20
- **Status:** Implemented
- **Sub-project:** Net-new feature, sequenced after Sort & Pinning (3b). Not part of the original
  1–5 roadmap; grew out of a request to "save the currently open notes across reloads."

## Context

Today the workspace shows exactly **one** note at a time. `useNotes` owns a single `selectedId` /
`selectedNote`, `Workspace` renders one `EditorPane` for it, and on reload nothing is reopened — the
init effect lists notes and reads metadata (sort/pins via `.gravity-notes.json`) but selects nothing,
so the user lands on the empty placeholder.

The user wants several notes open at once, switchable like editor tabs, and **all of them restored on
reload**. That turns the single selection into a small workspace-session: an ordered set of open
notes plus which one is active.

The app already has the two seams this needs:

- **A per-folder metadata dotfile** (`.gravity-notes.json`, `NoteStore.readMetadata`/`writeMetadata`)
  that persists non-note state (sort, pins, created stamps) and travels with the folder. Open tabs are
  the same kind of per-folder UI state, so they live here too.
- **Editor remount-on-change**: each `EditorPane` is keyed `` `${id}:${updatedAt}` ``. When a note is
  reloaded from disk after an external edit, its `updatedAt` changes, the editor remounts with fresh
  content, and cursor/scroll/undo reset — exactly the behavior we want for an externally-changed tab.

The hard part is that the app's trickiest logic — debounced autosave, save-on-close, and external-edit
conflict detection — is currently written for "the one selected note." It must become "each open
note," while the cross-cutting concerns (flush-all-on-unload, scan-all-on-focus) stay correct.

## Goal

Let the user **keep multiple notes open as tabs**, switch between them losslessly, and **have the open
set and active tab restored on reload** — without regressing autosave, save-on-close, or conflict
handling, and without mutating note `.md` files.

### Success criteria

- Opening notes from the sidebar accumulates **tabs**; clicking an already-open note **activates its
  existing tab** (no duplicates). Creating a note opens it in a new active tab.
- Switching tabs is **instant and lossless** — every open tab keeps a live editor mounted, preserving
  its cursor, scroll, and undo history. The exception: a tab **reloaded from disk** after an external
  edit starts fresh (content from disk, reset position/history), which falls out of the existing
  keyed-remount behavior.
- The **open tab set and active tab persist** in `.gravity-notes.json` and are **restored on reload**.
  Tabs whose note no longer exists on disk are silently dropped.
- Each open note **autosaves independently** (its own pending edit, baseline mtime, and debounce
  timer). A tab switched away from still saves itself; `beforeunload` flushes **all** dirty tabs.
- **External-edit conflicts are detected per open tab.** Returning focus scans every open tab; a
  conflicted tab shows a marker, and the conflict banner appears when that tab is active.
- No regressions to search, sort, pinning, list keyboard navigation, rename, or delete.

## Decisions (with rationale)

- **Approach A — centralize per-tab state in `useNotes`** (vs. per-tab `useNoteSession` hooks). The
  cross-cutting concerns (flush-all on unload, scan-all on focus, persistence) are inherently global;
  centralizing keeps them correct in one place and reuses the proven `flush`/`save`/conflict logic,
  generalized from "the selected note" to "each open note." Per-tab hooks would need a cross-session
  registry to coordinate those globals — awkward for no real isolation win here.
- **Keep all open editors mounted** (vs. mount only the active one). The user wants per-tab cursor /
  scroll / undo preserved across switches. Inactive editors are hidden with `display:none` so their
  ProseMirror state survives. Cost: N live editors in memory — acceptable for the handful of tabs a
  note app realistically holds; noted as a risk below.
- **Persist tabs in the existing dotfile** (vs. `localStorage`/IndexedDB). Open tabs are per-folder UI
  state, exactly like sort and pins, and should travel with the folder. Reuses `readMetadata`/
  `writeMetadata` and `reconcile`'s self-healing of stale ids. Additive, so still `version: 1`.
- **Defer tab keyboard shortcuts to a follow-up.** The natural bindings — ⌘W (close), ⌘1–9 / Ctrl+Tab
  (switch) — are browser-reserved and cannot be reliably intercepted from a web page. v1 is
  click-driven (click to switch, × to close); shipping shortcuts that fight the browser would be worse
  than none.

## Detailed design

### Data model — `.gravity-notes.json`

`NotesMetadata` gains two additive fields (schema stays `version: 1`; old dotfiles default them):

```ts
export interface NotesMetadata {
  version: 1;
  sort: SortMode;
  pinned: readonly string[];
  created: Readonly<Record<string, number>>;
  /** Open tab ids, in tab (left-to-right) order. */
  open: readonly string[];
  /** Active tab id, or null when no tabs are open. Always an element of `open` when non-null. */
  active: string | null;
}
```

`DEFAULT_METADATA` adds `open: [], active: null`. `parseMetadata` tolerantly reads `open` (array of
strings) and `active` (string or null), coercing anything unexpected to the defaults — and **clamps**:
drops `active` if it is not in `open`.

### Pure metadata layer (`src/storage/metadata.ts`)

New pure helpers beside `withPinToggled` etc.:

- `withOpened(meta, id)` — if `id` not in `open`, append it; set `active = id`. (Re-opening an
  already-open note just activates it.)
- `withClosed(meta, id)` — remove `id` from `open`; if it was `active`, set `active` to the **right
  neighbor**, else the left, else `null`.
- `withActive(meta, id)` — set `active = id` (caller guarantees `id ∈ open`).

Extend the existing helpers:

- `withRenamed(meta, oldId, newId)` — also remap `open` entries and `active`.
- `withRemoved(meta, id)` — also apply `withClosed`'s open/active logic.
- `reconcile(meta, liveIds)` — also filter `open` to live ids and clamp `active` into the filtered set
  (drops tabs whose file was deleted externally).

### Hook layer (`src/hooks/useNotes.ts`)

The single-note state generalizes to per-id collections:

| Today                                     | Becomes                                                           |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `selectedId: string \| null`              | `openIds: string[]` + `activeId: string \| null`                  |
| `selectedNote: Note \| null`              | `openNotes: Map<string, Note>` (content for mounting each editor) |
| `saveState: SaveState`                    | `saveStates: Map<string, SaveState>`                              |
| `conflict: NoteConflict \| null`          | `conflicts: Map<string, NoteConflict>`                            |
| `pendingRef` / `baselineRef` / `timerRef` | the same, each a `Map<string, …>` keyed by id                     |

`openIds` / `activeId` are derived from `metadata.open` / `metadata.active` (single source of truth),
so tab mutations go through `persistMetadata(withOpened/…)` just like pins. `openNotes` and the
per-id refs are local working state, not persisted.

New / changed API on `UseNotes`:

- `open(id)` — flush nothing required; load content via `store.get` into `openNotes` (if not already
  loaded), seed `baseline[id]`, then `persistMetadata(withOpened(meta, id))`. Already-open → just
  `activate(id)`.
- `close(id)` — `flush(id)` any pending edit first, then drop `openNotes`/refs for `id` and
  `persistMetadata(withClosed(meta, id))`.
- `activate(id)` — `persistMetadata(withActive(meta, id))`; focus handled in the component layer.
- `edit(id, content)` — takes an explicit id (was implicit `selectedId`); writes `pending[id]`, sets
  `saveState[id] = 'saving'`, resets `timer[id]`, fires `flush(id)` on the debounce. (Only the focused
  editor emits changes, so in practice `id === activeId`, but the id is explicit for correctness.)
- `flush(id)` / `save` / conflict resolvers (`reloadDisk`/`keepMine`/`saveAsCopy`/`discard`) operate
  on a given id, reading/writing the per-id maps. `select` is replaced by `open`/`activate`.

`create` opens the new note as a tab (`open(meta.id)` after `refresh`). `rename` of an open note
updates its tab id (`withRenamed` already remaps; also move its `openNotes`/refs entry to the new id).
`remove` of an open note closes its tab.

Global concerns stay centralized and become "for each open id":

- **`beforeunload`** flushes **every** dirty tab (iterate `pending` map); warns if any pending/conflict.
- **`visibilitychange`** best-effort flushes all dirty tabs.
- **focus / visibility check** scans **every** open tab via `store.stat`, setting `conflicts[id]` for
  any that changed or were deleted on disk.

### Restore on load

The init effect, after `reconcile(meta, liveIds)`:

1. `Promise.all(meta.open.map(id => store.get(id)))`, tolerating failures (a vanished file → that id
   is dropped from `open`/`active` and the dotfile is rewritten).
2. Seed `openNotes` and `baseline[id]` from each loaded note.
3. Set `activeId = meta.active` (clamped to a still-open id, else the first open, else `null`).
4. Focus the active editor.

### Component layer (`src/components/`)

- **`TabBar` (new)** — renders `openIds` in order from the notes list (titles), the active tab styled,
  and per-tab affordances: an **unsaved dot** when `pending` has the id, a **conflict marker** when
  `conflicts` has it, and a **× close** button. Click a tab → `activate`; click × (or middle-click) →
  `close`. Overflow scrolls horizontally. Prefer Gravity UI's `Tabs`; if its close-affordance API is
  awkward, fall back to a lightweight custom strip built from Gravity primitives + design tokens (the
  plan verifies the API first).
- **`Workspace`** — the editor `<main>` becomes: `TabBar` (when any tab is open) above a stack of
  **one mounted `EditorPane` per open id**, inactive ones hidden with `display:none`. The conflict
  banner renders for the active tab when `conflicts.has(activeId)`. Empty `openIds` → existing
  placeholder. Sidebar `onSelect` calls `notes.open(id)`; the header save-state shows
  `saveStates.get(activeId)`.
- **`EditorPane`** — gains an `active: boolean` prop; only the active pane autofocuses, and switching
  tabs focuses the newly-active editor (via the existing editor instance handle). `onChange` is bound
  to the pane's own id: `onChange={(c) => notes.edit(note.id, c)}`.

### Data flow

```
sidebar click / create ─▶ useNotes.open(id) ─▶ load content + withOpened ─▶ writeMetadata
                                                       │
tab click ─▶ activate(id) ─▶ withActive ─▶ writeMetadata ─▶ focus active editor
                                                       │
keystroke in active editor ─▶ edit(id, content) ─▶ debounce ─▶ flush(id) ─▶ store.save
                                                       │
× / middle-click ─▶ close(id) ─▶ flush(id) ─▶ drop state + withClosed ─▶ writeMetadata
reload ─▶ init effect ─▶ reconcile + load all open ─▶ restore tabs + active
```

### Error handling

Unchanged surface: storage failures throw and `useNotes` translates to `onError` toasts. Per-tab
conflicts use the existing `ConflictError` / `NotFoundError` path, now stored per id. A failed restore
of one tab drops only that tab; the rest open normally.

## Testing (TDD)

- **`metadata.ts`** (pure): `withOpened` (append + activate, re-open activates without duplicate),
  `withClosed` (neighbor-activation: right, then left, then null), `withActive`, and `open`/`active`
  handling in `withRenamed` / `withRemoved` / `reconcile`. Plus `parseMetadata` tolerance + `active`
  clamping.
- **`useNotes`** (hook, fake store): open accumulates tabs; re-open activates; close activates a
  neighbor and flushes pending; per-tab autosave (edit tab A, switch to B, A still saves); restore on
  remount from metadata; per-tab conflict detection on focus; rename/remove of an open tab.
- **`TabBar`** (component): renders tabs in order, active styling, unsaved dot + conflict marker,
  activate on click, close on × / middle-click.
- **`Workspace`** (integration): open-from-sidebar adds a tab; switching preserves the other editor;
  restore reopens the persisted set + active tab; placeholder when no tabs.

## Out of scope (YAGNI)

- Tab keyboard shortcuts (deferred — browser-reserved keys; see Decisions).
- Drag-to-reorder tabs, "preview" tabs (single-click preview / double-click pin, VS Code style),
  pinned tabs, or a max-tab cap / overflow menu (horizontal scroll suffices).
- Per-window/per-device tab sets (the dotfile is per-folder and shared, consistent with sort/pins).
- Restoring cursor/scroll position _across reloads_ (only across in-session tab switches; reload
  remounts editors fresh).

## Risks & mitigations

- **Memory: N live editors.** Each mounted ProseMirror editor is heavy. Mitigation: accept for the
  realistic handful of tabs; `display:none` keeps inactive ones cheap to render. Revisit a mount-cap
  only if it proves a problem.
- **Focus fights on mount.** Multiple `autofocus` editors would compete. Mitigation: only the active
  pane autofocuses; an explicit focus call on tab switch.
- **Hidden-editor layout quirks.** A `display:none` ProseMirror may need re-measure on reveal.
  Mitigation: verify on switch; if needed, nudge the editor on activation.
- **Dotfile write frequency.** Every open/close/switch writes the dotfile. Mitigation: these are
  user-paced and infrequent — same cadence as today's sort/pin writes; no debounce needed.

## Implementation order

1. `metadata.ts` data-model fields + pure helpers + tests (no UI).
2. `useNotes` generalization to per-id maps + tab actions + restore + tests.
3. `TabBar` component + tests.
4. `Workspace` / `EditorPane` wiring (mounted-stack, active prop, conflict banner) + integration test.
5. Manual verification in a Chromium browser; update the roadmap in `CLAUDE.md`.
