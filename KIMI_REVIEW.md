# Gravity Notes — Code Review (Kimi)

**Scope:** `src/`, configuration, tests, and docs for the local-first Markdown notes app. I did not modify application code while producing this review.

**Method:** Static analysis + running the existing test suite (`npm test`: 233/233 passing) and typecheck (`npm run typecheck`: clean). I read the existing `*_REVIEW.md` files to avoid restating the same points, and focus this report on findings that add new value or frame known issues with a different angle.

## TL;DR

The codebase is unusually solid for a v0.1 local-first app: a clean `NoteStore` seam, a deliberate ref-based autosave model, tolerant metadata handling, and strong keyboard UX. The biggest risks are the same ones everyone else found — **silent data loss around the save/delete/navigate lifecycle** — plus a few correctness edges in conflict resolution, focus management, and shortcut handling that are worth fixing before the next release. I also flag a handful of maintainability issues (large hooks, leaky abstractions, missing error boundaries) that will compound as the feature set grows.

Severity: 🔴 high · 🟠 medium · 🟡 low.

---

## 🔴 High-priority bugs & data-loss risks

### 1. `beforeunload` prompt is broken for normal pending edits

`useNotes` registers a `beforeunload` handler that tries to flush and then prompt:

```ts
// src/hooks/useNotes.ts:407-416
const onBeforeUnload = (event: BeforeUnloadEvent) => {
    void flush();
    if (pendingRef.current || conflict) {
        event.preventDefault();
        event.returnValue = '';
    }
};
```

Because `flush()` is `async`, it runs synchronously until its first `await` and immediately clears `pendingRef.current` at line 150. By the time the next statement checks `pendingRef.current`, it is already `null`. The prompt therefore **never fires for ordinary unsaved edits** (only for pre-existing conflicts). This is a live data-loss safety net that is currently dead.

**Fix:** capture `const hadPending = Boolean(pendingRef.current || conflict)` *before* calling `flush()`, and use that captured value to decide whether to set `event.returnValue`.

**Test:** dispatch `beforeunload` after `edit()` but before the autosave timer fires; assert `event.returnValue === ''`.

*(Confirmed independently; also reported by GPT and GLM.)*

### 2. Reverting to the originally-loaded content within the debounce window writes stale data

`EditorPane` suppresses change events whose value equals `note.content` (the content at open):

```ts
// src/components/EditorPane.tsx:77-85
const handleChange = () => {
    const value = editor.getValue();
    if (value !== note.content) {
        onChange(value);
    }
};
```

`note.content` never updates while the note is open. So if the user types `x`, then undoes (or backspaces) within 500 ms, the editor value returns to `note.content` and `onChange` is skipped — but `pendingRef` still holds the intermediate value and the timer is still armed. The next flush writes the intermediate value to disk while the editor shows the original.

**Fix:** suppress only the *first* change event after mount (an `initializedRef`), or always call `edit()` and let the storage layer treat identical values as no-ops.

**Test:** open a note, call `edit('hellox')`, then call `edit('hello')` (the original value), advance timers, and assert the disk content is `hello`.

*(Confirmed; also reported by Opus and GLM.)*

### 3. `flush()` failure overwrites edits typed during the save

```ts
// src/hooks/useNotes.ts:148-157
const pending = pendingRef.current;
if (!pending) return;
pendingRef.current = null;
try {
    const meta = await store.save(pending.id, pending.content, baselineRef.current ?? 0);
    // ...
} catch (err) {
    pendingRef.current = pending; // ← clobbers any newer edit()
```

If the user keeps typing while `store.save()` is in flight, those keystrokes are stored in `pendingRef`. On save failure, the old snapshot is restored on top of them.

**Fix:** only restore the failed snapshot if `pendingRef.current` is still `null`; otherwise preserve the newer pending edit and surface the error.

*(Confirmed; also reported by Cursor, Opus, GLM, Xiaomi.)*

### 4. `remove()` does not flush, and can drop active-note edits

`remove()` calls `store.remove(id)` before checking whether the active note has a pending edit:

```ts
// src/hooks/useNotes.ts:263-282
const remove = useCallback(async (id: string) => {
    try {
        await store.remove(id);
        if (pendingRef.current?.id === id) pendingRef.current = null;
```

Deleting a different note also bypasses `flush()`, so the active note's pending edit stays buffered but the subsequent `refresh()` re-reads stale bytes from disk. The UI's `saveState` can then show "saved" for data that has not actually been written.

**Fix:** `await flush()` at the start of `remove()`, or explicitly warn when deleting a note with unsaved edits.

*(Confirmed; also reported by others.)*

### 5. Changing folders drops debounced edits without confirmation

`App.tsx` wires the folder-change button directly to `folder.forgetFolder()`:

```tsx
// src/App.tsx:43
onChangeFolder={() => void folder.forgetFolder()}
```

`Workspace` unmounts, and the `useNotes` cleanup effect only clears the timer — it does not flush `pendingRef`. Any edit inside the 500 ms debounce window is silently discarded.

**Fix:** expose a way for `Workspace` to flush before `forgetFolder()`, or block/confirm folder changes while `saveState !== 'idle'` or `pendingRef` is set.

*(Confirmed; also reported by others.)*

### 6. Concurrent `open()` calls can land on the wrong note

`browse()` always calls `open()`, and `open()` does `await flush(); await store.get(id); ...` with no generation guard. A slow `store.get()` for an earlier note can resolve after a faster one for a later note, leaving the editor on stale content and writing a stale `active` id to metadata.

Two concrete triggers:

1. Rapid arrow-key browsing.
2. Re-clicking the already-open note (which also unnecessarily remounts the editor).

**Fix:** short-circuit `open()` when `id === metadataRef.current.active`, and add an `openGenerationRef` to ignore stale loads.

*(Confirmed; also reported by others.)*

### 7. `close()` clears `pendingRef` even when `flush()` failed and restored it

```ts
// src/hooks/useNotes.ts:193-200
const close = useCallback(async () => {
    await flush();
    pendingRef.current = null;
```

If `flush()` encounters a conflict or error, it restores `pendingRef` to preserve the user's content. `close()` unconditionally nulls it afterward, discarding that content.

**Fix:** only clear `pendingRef` if `flush()` did not restore it, or block `close()` while a conflict is unresolved.

*(Confirmed; also reported by Xiaomi.)*

---

## 🟠 Medium-priority correctness issues

### 8. Conflict resolver `keepMine()` gives up when the file was deleted

```ts
// src/hooks/useNotes.ts:315-329
const keepMine = useCallback(async () => {
    if (!conflict || conflict.deleted) return;
```

If the open note was deleted externally, the only recovery path is "Save as copy". But the local content still exists in `pendingRef`/`note`; there is no reason `keepMine()` could not recreate the file with the local content. The current early return is user-hostile.

**Fix:** in the deleted case, `keepMine()` should recreate the file (using `store.create` semantics or a dedicated recreate path) and write the local content back.

### 9. `saveAsCopy()` writes through a racy baseline

```ts
// src/hooks/useNotes.ts:337-338
const copy = await store.create(`${title} (conflicted copy)`);
await store.save(copy.id, content, copy.updatedAt ?? 0);
```

`store.create()` produces a zero-byte file whose `lastModified` becomes the baseline. Between `create()` and `save()`, nothing else should touch the file, but the pattern relies on that assumption. A stronger approach is to have `create()` accept optional initial content, or use `copy.updatedAt` as a fresh baseline atomically.

### 10. `useNotesFolder` bootstrap has two races

```ts
// src/hooks/useNotesFolder.ts:41-58
useEffect(() => {
    // ...
    const saved = await loadDirHandle();
    if (cancelled) return;
    if (!saved) { setState('needs-folder'); return; }
```

1. If the user clicks **Open notes folder** while the mount effect is still awaiting `loadDirHandle()`, the mount effect can finish later and overwrite the `ready` state with `needs-folder`.
2. If `loadDirHandle()` or `queryPermission()` rejects, the state remains `loading` forever and no error is shown.

**Fix:** add a generation/ref that invalidates the mount effect once the user interacts; wrap the bootstrap in `try/catch` and transition to `needs-folder` on failure.

*(Also reported by others; worth emphasizing because first-run UX is untested.)*

### 11. `handlePersistence` only closes IndexedDB on success

```ts
// src/storage/handlePersistence.ts:25-37
function tx<T>(...) {
    return openDb().then((db) => new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.transaction!.oncomplete = () => db.close();
    }));
}
```

If the request errors or the transaction aborts, `db.close()` is never called. In a long-lived session this leaks connections.

**Fix:** add `request.transaction!.onerror` and `onabort` handlers (or a `finally` equivalent) that also close `db`.

### 12. `rename()` has no optimistic concurrency guard

`save()` takes a `baseUpdatedAt` to detect external changes, but `rename()` does not. It reads the current content, copies it to a new file, and deletes the old one. If the file changed on disk between read and write, the rename silently copies stale content.

**Fix:** pass a baseline `updatedAt` into `rename()` and re-stat before writing; throw `ConflictError` if the file changed.

### 13. Non-atomic writes (rename and metadata) with silent corruption recovery

- `rename()`: copy → write → `removeEntry` with no rollback.
- `writeMetadata()`: writes JSON directly to `.gravity-notes.json` with no temp-file + replace.

A crash mid-write can duplicate/lose notes or corrupt the dotfile; `readMetadata()` then silently resets pins/sort/active to defaults.

**Fix:** write to a temp file and replace; keep a backup of the previous metadata so corruption is recoverable rather than silently reset.

*(Also reported by others; including because the silent reset is particularly dangerous for user data.)*

### 14. `NoteTitle` unmount commit can race against `useNotes` unmount

```ts
// src/components/NoteTitle.tsx:84-88
useEffect(() => {
    return () => {
        if (draftRef.current !== titleRef.current) onCommitRef.current(draftRef.current);
    };
}, []);
```

If `NoteTitle` unmounts because `Workspace` is unmounting (e.g., folder change), the unmount effect fires `onCommit` → `useNotes.rename()` → `store` access. React guarantees child cleanup runs before parent cleanup, so this is safe today, but the implicit ordering is fragile. Combined with issue #5 (folder change doesn't flush), this can also trigger an unexpected rename *after* the user asked to change folders.

**Fix:** guard the unmount commit so it does not fire when the component is unmounting due to a folder/workspace teardown.

### 15. `NotePreview` swallows transform errors into a blank pane

```ts
// src/components/NotePreview.tsx:22-28
try {
    return transform(markup).result.html;
} catch {
    return '';
}
```

A malformed note renders as empty in preview mode with no indication that rendering failed.

**Fix:** return a safe error message or fall back to escaped source text.

### 16. Search only matches titles, not bodies

`useNoteSearch.noteMatches` only checks `note.title.toLowerCase().includes(q)`. The README backlog lists "full-text search", but the current placeholder "Search or create a note…" implies the search covers note content. Until full-text search is implemented, this is a UX gap.

**Fix:** either index bodies (performance cost for large folders) or clarify the placeholder (e.g., "Search note titles…").

### 17. `previewFromContent` can produce empty snippets for markup-heavy notes

`FileSystemNoteStore.list()` reads only the first 500 bytes of each file, then `previewFromContent` strips Markdown syntax. If a note starts with a large code block, table, or front matter, the 500-byte window can be entirely consumed by markup, leaving an empty or misleading preview.

**Fix:** scan further into the file (or the whole file) when the first window yields no usable text, or parse the Markdown structure rather than stripping characters greedily.

### 18. `TopBar` search has no accessible name

The search input relies on its placeholder text for an accessible name. Placeholders are not reliably announced by screen readers.

**Fix:** add `aria-label="Search or create a note"`.

*(Also reported by others; including because it is a one-line fix with high a11y impact.)*

### 19. `F2` shortcut renames the list selection even while the editor title is focused

`useShortcuts` marks `renameSelected` with `inTyping: true`, so it fires inside inputs and contenteditables. If the user is editing the in-editor title and presses `F2`, the list row enters rename mode instead of the title being selected.

**Fix:** ignore `F2` when focus is inside `.note-title`, or route it to select the current editor title.

### 20. Collapsed sidebar breaks the Esc focus ladder

When the sidebar is collapsed, `Workspace__sidebar` has `visibility: hidden`. Pressing `Esc` from the editor calls `listRef.current?.focusSelected()`, which tries to focus a hidden row. Focus can fall to `<body>`, making the next `Esc` feel unresponsive.

**Fix:** when collapsed, route `escapeEditor` to peek the sidebar or focus the search box instead.

*(Also reported; including because it is a known backlog item with a clear mechanism.)*

---

## 🟡 Low-priority issues

### 21. `.DS_Store` is tracked despite being in `.gitignore`

`.gitignore` excludes `.DS_Store`, but the file is present in the working tree and appears to be committed. This will confuse contributors and agents.

**Fix:** `git rm --cached .DS_Store` and commit.

### 22. `build:single` is not exercised in CI

`vite.config.ts` has a `singlefile` mode and an `esbuild: {charset: 'ascii'}` workaround for a real past crash. CI only runs the normal `npm run build`.

**Fix:** add `npm run build:single` to `.github/workflows/ci.yml`.

*(Also reported by others.)*

### 23. `vite.config.ts` is excluded from typechecking

`tsconfig.json` includes only `src`, so config-level regressions in Vite/test setup are invisible to `tsc`.

**Fix:** add a `tsconfig.node.json` and a typecheck step for root configs.

*(Also reported by others.)*

### 24. Several direct dependencies are unused in `src/`

A grep of `src/` shows no imports for `@gravity-ui/components`, `@diplodoc/cut-extension`, `@diplodoc/file-extension`, `@diplodoc/tabs-extension`, `markdown-it`, `highlight.js`, `katex`, or `lowlight`. Some may be required as peer dependencies by `@gravity-ui/markdown-editor` or `@diplodoc/transform`; verify with `npx depcheck` before removing.

*(Also reported by Opus and others; worth confirming.)*

### 25. No React error boundary around `Workspace`

Storage errors surface via the toaster, but a render-time crash (e.g., from a corrupt note body or an unexpected editor state) blanks the entire app.

**Fix:** add an error boundary around `Workspace` (or `App`) with a "reload" fallback.

### 26. `main.tsx` uses a non-null assertion for `#root`

```ts
// src/main.tsx:23
createRoot(document.getElementById('root')!).render(...)
```

A missing root produces a cryptic runtime error. A guard with a friendly `console.error` or DOM message is cheap.

### 27. `useNotes` and `Workspace` are large and will keep growing

- `useNotes.ts`: 470 lines.
- `Workspace.tsx`: 353 lines.

Both mix state management, side effects, focus orchestration, and business logic. As features like tabs, tags, sync, or mobile views are added, these files will become hard to reason about.

**Fix:** consider splitting `useNotes` into smaller hooks (e.g., `useAutosave`, `useConflictDetector`, `useNoteList`) and extracting `Workspace` sub-layouts into smaller components.

### 28. `create()` produces a 0-byte file while `save()` produces a canonical `\n\n`-terminated file

Newly created notes are 0 bytes until the first autosave. External tools see an inconsistent file shape. The editor hides the difference, but it is a small polish issue.

**Fix:** write the canonical empty-body shape (`\n\n`) in `create()`.

### 29. `useNoteNavigation` does not clear selection when the selected note is filtered out

`useNoteSearch` filters the displayed list, but `selectedId` in `useNoteNavigation` can point to a hidden note. The list falls back to a visible row for focus, while app state still references the hidden note.

**Fix:** when `selectedId` is not in `filteredNotes`, either clear it or browse to the first visible match.

### 30. `NoteList` row actions are invisible to touch and keyboard users

Row actions are hidden with `opacity: 0` until hover/selection. On touch devices they are unreachable; keyboard users may tab into them without visual feedback.

**Fix:** show actions on `:focus-within` and consider always-visible icons on touch.

---

## Test coverage gaps

The existing suite is strong for storage CRUD, metadata transforms, and keyboard navigation. Whole critical paths have zero or thin coverage:

| Module/path | Why it matters |
|-------------|----------------|
| `src/storage/handlePersistence.ts` | First-run folder recovery; IndexedDB/permission errors. |
| `src/hooks/useNotesFolder.ts` | Entire folder state machine; mount-vs-pick race. |
| `src/components/FolderGate.tsx` | Unsupported/loading/permission/error screens. |
| `src/components/NotePreview.tsx` | Transform errors; empty markup. |
| `src/App.tsx` | Theme/folder wiring; folder change behavior. |
| `useNotes` debounce timing | 500 ms autosave, flush races, `beforeunload` prompt. |
| `useNotes` conflict lifecycle | Close/navigate during conflict, external delete, `keepMine` on deleted file. |
| `useNotes` concurrent `open()` | Wrong-note race. |
| Storage failure paths | Writable stream errors, partial rename, metadata write failure. |
| Real editor integration | Most component tests mock `@gravity-ui/markdown-editor`. |

**Suggested next tests:**

1. Deferred-promise tests for `flush()` races and concurrent `open()`.
2. `beforeunload` assertion after a pending edit.
3. Revert-to-original-within-debounce regression.
4. `useNotesFolder` tests with mocked IndexedDB and permission methods.
5. `handlePersistence` tests for transaction errors and `db.close()` behavior.
6. A single Playwright smoke test for create/edit/save/reload if browser automation is adopted.

---

## Recommended fix order

Prioritized by user-safety impact and implementation size:

1. **Fix `beforeunload` prompt ordering** (#1) — one line, restores a safety net.
2. **Fix revert-to-original stale save** (#2) — small, silent data-correctness bug.
3. **Flush or confirm before delete and folder change** (#4, #5) — high data-loss prevention.
4. **Fix `flush()` failure overwrite** (#3) — prevents async-save failures from eating keystrokes.
5. **Short-circuit same-note `open()` + add generation guard** (#6) — fixes remounts and wrong-note race.
6. **Fix `close()` clearing pending after failed flush** (#7) — small.
7. **Allow `keepMine()` to recreate a deleted file** (#8) — user-friendly conflict recovery.
8. **Harden `useNotesFolder` bootstrap** (#10) and add tests.
9. **Close IndexedDB on error** (#11) and add `handlePersistence` tests.
10. **Atomic metadata write + rename rollback** (#13) — protects folder state.
11. **Error boundary + a11y polish** (#18, #19, #20, #25) — cheap wins.
12. **CI/docs/deps cleanup** (#21–#24, README update).

---

## Summary

Gravity Notes is a thoughtfully architected v0.1 app. The `NoteStore` abstraction, ref-based autosave, and keyboard navigation are all strong foundations. The immediate priority is tightening the **save/delete/navigate lifecycle** so that user edits are never silently lost — the current gaps around `beforeunload`, delete, folder change, failed saves, and conflict navigation are the biggest risks. After that, the untested folder-persistence layer and a handful of focus/shortcut/a11y edges deserve attention. Fixing these will make the app feel reliable enough to trust with real notes.
