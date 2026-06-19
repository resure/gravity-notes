# Robustness & Data Safety — Design

- **Date:** 2026-06-19
- **Status:** Approved (pending final spec review)
- **Sub-project:** 2 of 5 in the Gravity Notes improvement roadmap

## Context

Gravity Notes stores each note as a plain `.md` file the user "fully owns" and is invited to edit
elsewhere (another editor, Dropbox/iCloud sync). But the app currently:

1. **Silently overwrites external edits.** `useNotes.flush()` (src/hooks/useNotes.ts) calls
   `store.save(id, content)` with no check that the file changed on disk since it was loaded. An
   external edit made between load and autosave is clobbered.
2. **Can lose the last edits on close.** The `beforeunload`/`visibilitychange` handlers fire an
   async `flush()`; an async File System Access write cannot complete reliably during a hard tab
   close, so edits made in the last ~500 ms (the autosave debounce) can be lost silently.

We already have the raw material for detection: `store.get` returns `updatedAt` (the file's
`lastModified`), so the currently-open note has a known baseline to compare against.

## Goal

Prevent silent data loss from external edits and from closing the tab mid-edit, with a
non-disruptive UX.

### Success criteria

- An external edit to the open note is **detected** (at autosave time and when returning to the
  tab) and surfaced via a non-blocking banner — never silently overwritten.
- The user can resolve a conflict three ways without losing data: **reload disk**, **keep mine
  (overwrite)**, or **save mine as a copy**.
- Closing the tab with unsaved edits triggers the browser's native "unsaved changes" warning.
- Store-level optimistic-concurrency logic is covered by tests.

## Decisions (with rationale)

| Decision             | Choice                                                 | Rationale                                                                                                                                                           |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detection mechanism  | Optimistic concurrency in `NoteStore`                  | Check-then-write next to the file handle; the same seam a future `ApiStore` would use (ETags/versions).                                                             |
| Conflict UX          | Non-blocking banner                                    | Autosaves are silent and debounced; a modal mid-typing is disruptive. Banner pauses autosave until resolved.                                                        |
| Detection timing     | Save-time **and** on tab/window refocus                | Warns before the user types over a stale version, not only when autosave fires.                                                                                     |
| Save-on-close        | Best-effort flush **+** native unsaved-changes warning | The FS Access API can't write synchronously; warning the user is the only reliable guarantee.                                                                       |
| Conflicted-copy name | `<title> (conflicted copy)`                            | Familiar (Dropbox-style); `create()` already resolves further collisions.                                                                                           |
| Test scope           | Store-level only this slice                            | The data-loss-prevention logic lives in the store and is testable with the existing fake. Hook/UI tests wait for the Core UX slice's jsdom + Testing Library setup. |

## Detailed design

### Storage layer (`src/storage/`)

**`NoteStore` interface changes (`types.ts`):**

- `save(id: string, content: string, baseUpdatedAt: number): Promise<NoteMeta>` — was
  `(id, content) => Promise<void>`. Reads the file's current `lastModified`; if it differs from
  `baseUpdatedAt`, throws `ConflictError`; otherwise writes and returns the new `NoteMeta` (with the
  real post-write `lastModified`). Returning real meta also fixes the current `Date.now()`
  approximation used when re-sorting the list.
- `stat(id: string): Promise<number | null>` — current `lastModified`, or `null` if the file no
  longer exists. Powers refocus checks and external-delete detection.
- `ConflictError extends Error` — carries `{id: string; diskUpdatedAt: number}` and a stable
  `name = 'ConflictError'` for `instanceof` checks.

**`FileSystemNoteStore` (`fileSystemStore.ts`):**

- `save`: `getFileHandle(id)` → read `getFile().lastModified` as `current`; if
  `current !== baseUpdatedAt` throw `new ConflictError(id, current)`; else `createWritable` → write →
  close; re-read `lastModified` and return `{id, title, updatedAt}`.
- `stat`: `getFileHandle(id)` → `getFile().lastModified`; catch `NotFoundError` → return `null`.
- `get/list/create/rename/remove` unchanged. `rename` is not conflict-guarded — it writes to a
  freshly uniquified file name (no overwrite risk) and the hook re-selects afterward, resetting the
  baseline.
- **Known limitation:** a tiny TOCTOU window exists between the mtime check and the write. Acceptable
  for a local single-user app; documented, not engineered away.

### Hook layer (`src/hooks/useNotes.ts`)

- **Baseline tracking:** `baselineRef: number | null` — set on `select` from `get().updatedAt`,
  updated after each successful save from the returned meta. Normal saves do **not** mutate
  `selectedNote` state (so the editor isn't remounted mid-typing — see UI).
- **Guarded `flush`:** call `store.save(id, content, baselineRef)`.
  - success → set `baselineRef` to the new `updatedAt`, `saveState='saved'`, update the list with the
    real `updatedAt`;
  - `ConflictError` → set `conflict = {id, diskUpdatedAt}`, `saveState='conflict'`, **do not clear
    `pendingRef`** (keep the user's content), stop scheduling autosaves;
  - other error → restore `pendingRef` (so the edit isn't dropped), `saveState='error'`, toast.
- **`edit` during a conflict:** still records into `pendingRef` so the user may keep typing, but does
  not schedule a save while `conflict` is set.
- **Resolvers (exposed by the hook):**
  - `keepMine()` — `save(id, pendingRef.content, conflict.diskUpdatedAt)` (the disk mtime as baseline
    makes the guard pass), update baseline, clear `conflict`, resume.
  - `reloadDisk()` — discard `pendingRef`, `get(id)`, `setSelectedNote(diskNote)` (new `updatedAt`
    remounts the editor with disk content — see UI), set baseline, clear `conflict`. Does **not** go
    through `select()` (which would flush the conflicting pending content).
  - `saveAsCopy()` — `create("<title> (conflicted copy)")`, `save(copy.id, myContent, copy.updatedAt)`,
    then `select(copy.id)`; the on-disk original is left untouched. Clear `conflict`.
- **Proactive detection:** a `visibilitychange→visible` / window `focus` handler calls
  `store.stat(selectedId)` when a note is open and no conflict is pending; if the value differs from
  `baselineRef` (changed) or is `null` (deleted), raise the conflict state without writing.
- **Save-on-close:** keep the best-effort `flush` on `visibilitychange`. Add a `beforeunload` handler
  that calls `event.preventDefault()` and sets `event.returnValue = ''` **only when** `pendingRef`
  has content or a conflict is unresolved, triggering the browser's native warning.

### UI layer (`src/components/`)

- **`ConflictBanner.tsx`** — a small presentational component using Gravity `Alert`
  (`theme="warning"`), rendered above the editor when `conflict` is set, with three actions:
  **Reload**, **Keep mine**, **Save as copy** (and copy that adapts for the deleted-on-disk case).
- **`EditorPane`** key changes from `selectedNote.id` to `` `${selectedNote.id}:${selectedNote.updatedAt}` ``
  so `reloadDisk` (new mtime) forces a fresh editor while normal editing/saving (which never touches
  `selectedNote`) keeps it mounted.
- **`Workspace`** renders `ConflictBanner` above `EditorPane` and passes the resolvers; `SaveState`
  gains `'conflict'` for the header status label.

### Error handling

- `ConflictError` is a typed class checked via `instanceof`.
- Non-conflict save failures restore `pendingRef` and toast (no silent loss).
- External deletion (`stat` → `null`, or `save`/`get` hitting `NotFoundError`) surfaces the banner in
  a "deleted on disk" variant offering **Save mine** (recreate via `create` + write) or **Discard**.

### Testing

Extend `fakeFileSystem.ts` so `save` honors the baseline (throws `ConflictError` on mismatch, returns
new meta) and add `stat`; tests simulate an external edit by re-seeding a file with a newer
`lastModified`. New store tests in `fileSystemStore.test.ts`:

- `save` with a matching baseline writes and returns the new `updatedAt`;
- `save` with a stale baseline throws `ConflictError` carrying the disk `updatedAt`, and leaves the
  file's content untouched;
- `keepMine`-style save using the disk mtime as baseline succeeds;
- `stat` returns the current `lastModified`, and `null` for a missing file.

Hook/UI behavior (banner, resolvers, refocus, beforeunload) is verified manually this slice;
automated hook tests arrive with the Core UX slice's jsdom + Testing Library setup.

## Out of scope (YAGNI)

- Automated hook/component tests (deferred to Core UX).
- Continuous file watching/polling (only save-time + refocus checks; the FS Access API has no change
  events).
- Three-way merge UI — we offer reload / overwrite / copy, not a merge.
- Conflict handling for `rename` (writes to a unique name; no overwrite risk).

## Risks & mitigations

- **TOCTOU window** between check and write — accepted for a single-user local app; documented.
- **`beforeunload` async writes** can't be guaranteed — mitigated by the native warning prompt rather
  than pretending the write completes.
- **Interface change ripples** to the fake and existing tests — covered by the plan; `npm run build`
  - tests confirm.

## Implementation order

1. `ConflictError` + `NoteStore` interface (`save` signature, `stat`).
2. `FileSystemNoteStore` guarded `save` + `stat`.
3. Extend the fake + store tests (red → green).
4. `useNotes`: baseline, guarded flush, conflict state + resolvers.
5. Proactive refocus detection + `beforeunload` warning.
6. `ConflictBanner` + `EditorPane` key + `Workspace` wiring.
7. Full verification (lint, typecheck, test, build) + manual smoke of a conflict.
