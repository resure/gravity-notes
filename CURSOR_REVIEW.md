# Gravity Notes — Project Analysis

Overall this is a well-structured local-first app: a clean `NoteStore` seam, thoughtful keyboard navigation, strong unit tests around storage and navigation, and deliberate editing architecture (refs + debounced flush instead of re-rendering the editor on every keystroke). The main risks are **data loss edge cases**, **concurrency in multi-tab use**, and **untested folder-persistence code**.

---

## What's working well

- **Storage abstraction** — `NoteStore` in `types.ts` keeps FS details out of the UI; `FakeDirectoryHandle` gives solid test coverage for CRUD, conflicts, and metadata.
- **Editing model** — `pendingRef` + 500ms debounce + flush on navigation avoids remounting `@gravity-ui/markdown-editor` mid-typing; `sessionId` separates rename remounts from browse navigation.
- **Metadata layer** — tolerant `parseMetadata`, pure `orderNotes`, pin/sort/active in `.gravity-notes.json` are well tested.
- **Navigation** — nvALT search/create, roving tabindex, Esc focus ladder, sidebar peek — covered by extensive `Workspace.test.tsx`.
- **CI** — lint, format, typecheck, test, build on push/PR.

---

## High priority — potential bugs / data loss

### 1. Delete without flushing pending edits

`remove()` deletes on disk immediately and clears `pendingRef` without calling `flush()`:

```263:276:src/hooks/useNotes.ts
    const remove = useCallback(
        async (id: string) => {
            try {
                await store.remove(id);
                if (pendingRef.current?.id === id) pendingRef.current = null;
                // ...
```

`open`, `create`, `rename`, and `close` all flush first. Deleting the active note within the 500ms debounce window drops unsaved edits silently.

**Fix:** `await flush()` before `store.remove`, or prompt if pending/conflict exists.

### 2. Folder change drops unsaved edits

`App.tsx` wires folder change directly to `forgetFolder()` with no flush or confirmation. On unmount, `useNotes` only clears the autosave timer — it does not flush `pendingRef`:

```399:404:src/hooks/useNotes.ts
    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);
```

**Fix:** flush before `forgetFolder`, or confirm when `saveState !== 'idle'` or `pendingRef` is set.

### 3. `flush()` failure can overwrite newer edits

On save failure, `pendingRef` is restored to the snapshot taken at flush start. Keystrokes during the async `store.save()` are lost:

```146:157:src/hooks/useNotes.ts
        pendingRef.current = null;
        try {
            const meta = await store.save(...);
        } catch (err) {
            pendingRef.current = pending; // never drop the user's content
```

**Fix:** merge restored pending with current editor content, or serialize flushes with a mutex.

### 4. Concurrent `open()` — stale load can win

Rapid browse (arrow keys, re-clicking rows) fires overlapping `open()` calls with no generation token. A slow `get()` for an old note can finish after a newer one, leaving the editor on the wrong note.

`browse()` always calls `open()`, even for the already-active note — unnecessary disk read + `bumpSession()` remounts the editor:

```253:253:src/components/NoteList.tsx
                                onClick={() => !editing && browseRow(note.id)}
```

**Fix:** short-circuit when `id === activeId`; add open-generation / ignore stale results.

### 5. `useNotesFolder` mount race

The mount effect can finish after `pickFolder()` and overwrite `'ready'` with `'needs-folder'`:

```41:58:src/hooks/useNotesFolder.ts
        (async () => {
            const saved = await loadDirHandle();
            if (cancelled) return;
            if (!saved) {
                setState('needs-folder');
                return;
            }
```

If the user picks a folder while `state === 'loading'`, a late effect completion can clobber the ready state. `loadDirHandle()` rejection also leaves state stuck on `'loading'` (no catch).

**Fix:** guard with a ref for user-initiated ready state; catch IDB errors → `setError` + `needs-folder`.

### 6. Non-atomic rename can duplicate or lose files

Rename is copy → write → delete with no rollback:

```172:182:src/storage/fileSystemStore.ts
        const content = (await this.get(id)).content;
        const handle = await this.dir.getFileHandle(nextName, {create: true});
        // write new file, then remove old
```

Failure after create but before delete duplicates the note; failure after delete loses it.

### 7. Corrupt metadata resets all folder state

Non-atomic metadata write + tolerant parse means a partial write on crash can wipe pins, sort, created stamps, and active note on next load. `writeMetadata` has no temp-file + replace pattern.

---

## Medium priority — correctness & UX

| Issue | Where | Impact |
|-------|-------|--------|
| Case-only rename on macOS/Windows | `fileSystemStore.rename` | `note.md` → `Note` throws `NameCollisionError` (case-insensitive FS) |
| Navigate away during conflict | `useNotes.open` | Documented: abandons conflict edits via `setConflict(null)` |
| `close()` clears pending after conflict flush | `useNotes.close` | `flush()` may restore `pendingRef`, then line 195 clears it |
| Editor title commit lacks list-rename guards | `NoteTitle.tsx` | Empty/whitespace title → `Untitled.md` collision |
| Conflict banner non-blocking | `Workspace` | User can keep typing; autosave paused silently |
| Optimistic metadata, no rollback | `persistMetadata` | Pin/sort/active UI diverges from disk on write failure |
| `refresh()` reconciles in memory only | `useNotes` | Ghost pins/active on disk until next metadata write |
| `grantPermission` doesn't set `folderName` | `useNotesFolder` | "Grant access to ''" if mount effect failed |
| Search filter vs selection drift | `Workspace` + `useNoteSearch` | Selected note filtered out → no visible selection, focus mismatch |
| IndexedDB connection leak | `handlePersistence.tx` | `db.close()` only on `oncomplete`, not on transaction error |

### Concurrency (multi-tab)

- Last-write-wins for `.gravity-notes.json` (pins, sort, active).
- mtime-only conflict detection — coarse FS resolution can miss or false-trigger conflicts.
- Parallel `create('Untitled')` — both tabs can race on `uniqueFileName`.

These are product limitations worth documenting; full fix needs merge semantics or single-tab guidance.

---

## Accessibility & mobile

- Icon buttons use `title` instead of `aria-label` (folder, help, theme).
- Search field has no accessible name beyond placeholder.
- Row actions (pin/rename/delete) hidden until hover — poor on touch.
- Peek dismiss uses `mousedown` only — may not work on touch.
- Esc refocuses hidden list when sidebar collapsed (`visibility: hidden`).
- No `prefers-reduced-motion` for status blink / sidebar animation.
- `MobileProvider` present but unused; fixed 280px sidebar, no responsive breakpoints.

---

## Test coverage gaps

**No tests at all:**

- `handlePersistence.ts` (IndexedDB save/load/clear, permissions)
- `useNotesFolder.ts` (entire state machine)
- `FolderGate.tsx`
- `NotePreview.tsx`
- `App.tsx`

**Partial gaps in tested modules:**

- 500ms debounced autosave timer (`vi.useFakeTimers`)
- `flush()` → `ConflictError` / `NotFoundError`
- External delete detection via refocus `stat()`
- `beforeunload` warning for unsaved edits
- Delete with pending edits
- Concurrent `open()`
- Conflict flow end-to-end in `Workspace`
- `setSortMode` / `togglePin` from hook level

---

## Infrastructure & dependencies

- **`build:single` not in CI** — `esbuild: { charset: 'ascii' }` exists for single-file builds; regressions go unnoticed.
- **`vite.config.ts` not typechecked** — excluded from `tsconfig.json` `include`.
- **Possibly unused direct deps** — `@gravity-ui/components`, several `@diplodoc/*` extensions, `markdown-it`, `highlight.js`, `katex`, `lowlight` (likely transitive via markdown-editor).
- **No coverage tooling** — no `test:coverage` script or CI thresholds.
- **README / CLAUDE.md lag code** — missing nvALT search, shortcuts, pinning, sort modes, conflict handling, metadata dotfile; architecture diagrams omit `TopBar`, navigation hooks.

---

## Recommended fix order

If you want to tackle these incrementally, this order maximizes user safety:

1. **Flush before delete and folder change** — smallest change, highest data-loss prevention.
2. **Short-circuit `open()` for same note** — fixes click remount + reduces race surface.
3. **Serialize `open()` with generation counter** — fixes rapid-navigation wrong-note bug.
4. **`useNotesFolder` race + error handling + tests** — first-run UX is untested.
5. **`handlePersistence` tests + `db.close()` in `finally`**
6. **Atomic metadata write** (temp + replace) — protects pins/sort/active
7. **Case-folding rename collision check** — macOS/Windows
8. **Conflict UX** — disable editor or block navigation with clear messaging
9. **Align `NoteTitle` commit with list rename** (trim, reject empty)
10. **Docs + CI** — update README/CLAUDE, add `build:single` to CI, trim unused deps

---

## Architecture notes (longer term)

- **`FileSystemObserver`** (when available) instead of focus-only `stat()` polling for external changes.
- **Content hash or generation counter** alongside mtime for conflict detection.
- **`InMemoryNoteStore`** for hook tests that don't need FS semantics.
- **React error boundary** around `Workspace` — storage errors go to toaster, render crashes blank the app.
- **Split `tsconfig`** — `tsconfig.build.json` excluding tests; typecheck `vite.config.ts`.

---

## Storage layer detail

The storage layer is cleanly abstracted, with deliberate choices (mtime conflicts, tolerant metadata parsing, canonical EOF whitespace) that are tested and documented in code comments. Additional storage-specific findings:

### Potential bugs

| Issue | Location | Notes |
|-------|----------|-------|
| Rename no-op omits `updatedAt` | `fileSystemStore.ts` ~164–166 | No-op rename returns meta without `updatedAt` |
| Metadata corruption silently resets | `fileSystemStore.ts` ~147–151 | Corrupt JSON → full metadata reset |
| Non-atomic metadata write | `fileSystemStore.ts` ~154–158 | No temp-file + rename; crash mid-write → corrupt JSON |
| IndexedDB connection leak | `handlePersistence.ts` ~25–37 | `db.close()` only on `oncomplete` |
| Case-only rename fails | `fileSystemStore.ts` ~163–170 | Case-insensitive FS treats as collision |
| `save()` check-then-write (TOCTOU) | `fileSystemStore.ts` ~110–118 | mtime check then write — not atomic |
| `create()` inconsistent file shape | `fileSystemStore.ts` ~103–107 | Zero-byte file vs `canonicalBody()` from `save()` |

### Edge cases not handled

| Edge case | Behavior |
|-----------|----------|
| Title `"foo.md"` | Becomes `foo.md.md` via sanitize + unique filename |
| Windows reserved names (`CON`, `NUL`, …) | Not filtered |
| Trailing dots/spaces in titles | Allowed; invalid on Windows |
| Duplicate pins in metadata JSON | Accepted |
| `active: ""` (empty string) | Treated as valid active id |
| NaN / negative `created` timestamps | Accepted if `typeof value === 'number'` |
| Dotfiles like `.secret.md` | Listed as notes |
| UTF-8 split in preview scan | `slice(0, 500)` may split a code point |
| Very large note bodies | Full file read into memory |
| `uniqueFileName` infinite loop | No upper bound if every candidate exists |
| Metadata `version !== 1` | Full reset; no field-level migration |

### Security notes

- Scope is user-granted directory (good) — FS Access API sandbox limits traversal.
- No validation of note `id` strings before `getFileHandle` — browser should reject bad paths, but store doesn't fail fast.
- Metadata file is unsigned and user-editable — UX confusion, not RCE.
- IndexedDB handle persistence is origin-scoped — standard XSS hygiene applies.
- No encryption at rest — expected for local-first Markdown app.

---

## Hooks layer detail

### Additional hook bugs

| Issue | Location | Notes |
|-------|----------|-------|
| Failed initial load | `useNotes.ts` ~364–393 | `list()` / `readMetadata()` throw → empty state, no toast |
| Unmount does not flush | `useNotes.ts` ~399–404 | Folder change can lose debounced edits |
| `browse` always calls `open` | `useNoteNavigation.ts` ~64–71 | Even for already-active note |
| `keepMine()` when deleted | `useNotes` | Early return; only `saveAsCopy` recovers |

### Race conditions

1. Parallel `open()` / `browse()` — no serialization or request token.
2. Parallel `persistMetadata()` — last `writeMetadata` wins on disk.
3. Parallel `flush()` — mostly safe except failure overwrite bug.
4. Refocus conflict detector — async `check()` has no cancellation.
5. `metadataRef` vs React `metadata` state — `edit()`'s `conflict` dependency can be stale.
6. `useNotesFolder` mount vs user gesture — effect can clobber ready state.

### Performance

- Every `browse()` → full `open()` (`store.get()` + `writeMetadata()` per arrow key).
- `refresh()` → full `store.list()` with preview head read — costly for large folders.
- `beforeunload` / `visibilitychange` fire-and-forget `flush()` — browser may kill tab before save.

---

## UI component detail

### Additional UI bugs

| Issue | Location | Notes |
|-------|----------|-------|
| Re-click open note remounts editor | `NoteList.tsx` + `useNotes.open` | Focus/scroll/caret loss |
| `NotePreview` swallows transform errors | `NotePreview.tsx` ~22–27 | Blank preview, no feedback |
| Search highlight length mismatch | `NoteList.tsx` ~43–54 | Non-ASCII case-fold pairs |
| `main.tsx` assumes `#root` exists | `main.tsx` ~23–27 | Non-null assertion |

### UX edge cases

| Edge case | Behavior |
|-----------|----------|
| Selected note filtered out of search | No visible `aria-selected` row |
| `F2` while editing in-editor title | Renames list selection, not editor title |
| Whitespace-only editor title on blur | Sanitized to `Untitled`, may collide |
| Browse during unresolved conflict | Navigating away discards conflict edits |
| `FolderGate` loading flash | Same welcome UI as `needs-folder` |
| Delete dialog + Enter | Confirms delete (easy accidental trigger) |
| `localStorage` write failures | Uncaught for theme and sidebar state |
| CSS `:has()` for checklist styling | Unsupported in older browsers |

### UI improvement suggestions

**High priority:**

1. Short-circuit `open()` when `id === activeId`.
2. Flush pending edits before `forgetFolder()` + confirmation dialog.
3. Align `NoteTitle` commit with list rename (trim, reject empty).
4. Disable or dim `EditorPane` during conflict.

**Medium priority:**

5. Add `aria-label` to search, folder, help, theme, sidebar toggle.
6. Peek dismiss: use `pointerdown` instead of `mousedown` only.
7. Collapsed-sidebar Esc: peek sidebar or focus search instead of hidden list.
8. Expose row actions on touch.
9. `NotePreview` error state when `transform()` throws.

**Lower priority:**

10. `prefers-reduced-motion` for animations.
11. Responsive layout on narrow viewports.
12. Search highlight with `Intl.Collator` or segment-aware matching.
13. Single scroll container for editor/preview.
14. Error boundary around `App` / `Workspace`.
15. Folder change confirmation when `saveState === 'saving' | 'error'`.

---

## Summary

The codebase is in good shape for a v0.1 local-first app. The highest-impact work is tightening the **save/delete/navigate lifecycle** (flush ordering, open serialization) and **testing folder persistence** — the code users hit first and the layer with zero test coverage today.

If implementing fixes, start with flush-before-delete and flush-before-folder-change — small diffs with the biggest safety win.

---

*Generated by Cursor project review — June 2026.*
