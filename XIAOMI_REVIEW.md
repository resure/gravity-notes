# Gravity Notes — Xiaomi MiMo Code Review

**Reviewer:** MiMo Code Agent (xiaomi/mimo-v2.5-pro)
**Date:** 2026-06-22
**Scope:** Full codebase — architecture, correctness, performance, security, DX

All 233 tests pass, typecheck is clean, build succeeds. 14 ESLint warnings (0 errors).

---

## Verdict

A well-engineered local-first note app with a clean storage seam, deliberate editing architecture
(ref-based autosave, sessionId-keyed editor mounts), and strong keyboard UX. The main risk areas
are **data-loss edge cases in the save lifecycle**, **race conditions under rapid interaction**,
**multi-tab concurrency**, and **zero test coverage on the folder-persistence layer**.

---

## 1. Bugs & Data-Loss Risks

### 1.1 Delete drops unsaved edits without flushing

`useNotes.remove()` deletes the file on disk and clears `pendingRef` without calling `flush()`:

```ts
// src/hooks/useNotes.ts:263-276
const remove = useCallback(async (id: string) => {
    await store.remove(id);
    if (pendingRef.current?.id === id) pendingRef.current = null;
    // ...
```

Every other lifecycle method (`open`, `create`, `rename`, `close`) flushes first. If a user edits
a note and deletes it within the 500ms debounce window, the edit is silently lost.

**Fix:** `await flush()` before `store.remove()`.

### 1.2 Folder change drops unsaved edits

`App.tsx:43` wires `onChangeFolder` directly to `folder.forgetFolder()` with no flush or
confirmation. The `useNotes` unmount effect only clears the timer — it never writes `pendingRef`
to disk:

```ts
// src/hooks/useNotes.ts:399-404
useEffect(() => {
    return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
    };
}, []);
```

**Fix:** Flush before `forgetFolder`, or block folder change when `saveState === 'saving'` or
`pendingRef` is set.

### 1.3 `flush()` can lose keystrokes typed during the async save

`flush()` snapshots `pendingRef.current`, nulls it, then awaits `store.save()`. If the save
fails, it restores the snapshot — but any keystrokes that arrived during the async window are
gone:

```ts
// src/hooks/useNotes.ts:146-157
const pending = pendingRef.current;
pendingRef.current = null;
try {
    const meta = await store.save(pending.id, pending.content, baselineRef.current ?? 0);
    // ...
} catch (err) {
    pendingRef.current = pending; // ← overwrites any newer keystrokes
```

**Fix:** Use a generation counter or mutex to serialize flushes, or merge the restored pending
with whatever the editor currently holds.

### 1.4 Concurrent `open()` — stale result can win

Rapid arrow-key browsing fires overlapping `open()` calls. A slow `store.get()` for note A can
resolve after a newer `store.get()` for note B, leaving the editor on the wrong note. There is
no cancellation token or generation guard.

**Fix:** Track an open-generation counter; discard stale results.

### 1.5 `browse()` always calls `open()` even for the already-active note

Every click/arrow on the list calls `open()`, which does a full `store.get()` +
`writeMetadata()` + `bumpSession()` (editor remount). This is wasteful and causes
focus/scroll/caret loss on re-click.

**Fix:** Short-circuit in `browse()` when `id === activeId`.

### 1.6 Non-atomic rename can duplicate or lose a file

`fileSystemStore.rename()` is copy → write → delete with no rollback:

```ts
// src/storage/fileSystemStore.ts:172-182
const content = (await this.get(id)).content;
const handle = await this.dir.getFileHandle(nextName, {create: true});
const writable = await handle.createWritable();
await writable.write(canonicalBody(content));
await writable.close();
await this.dir.removeEntry(id);
```

Failure after creating the new file but before deleting the old one duplicates the note. Failure
after deleting loses the note entirely.

### 1.7 Non-atomic metadata write

`writeMetadata()` writes directly to the dotfile. A crash or browser kill mid-write produces
corrupt JSON. The tolerant `parseMetadata` resets to defaults, wiping all pins, sort preferences,
created timestamps, and the active note.

**Fix:** Write to a temp file, then rename (or use the same copy-then-delete pattern). The
FS Access API makes this awkward but not impossible.

### 1.8 `useNotesFolder` mount race

The mount effect can finish after `pickFolder()` and overwrite `'ready'` with `'needs-folder'`:

```ts
// src/hooks/useNotesFolder.ts:41-58
(async () => {
    const saved = await loadDirHandle();
    if (cancelled) return;
    if (!saved) { setState('needs-folder'); return; }
    // ...
})();
```

If the user picks a folder while `state === 'loading'`, the late effect completion can clobber
the ready state. Also, `loadDirHandle()` rejection leaves state stuck on `'loading'` (no catch).

**Fix:** Guard with a ref for user-initiated ready state; catch IDB errors.

### 1.9 `close()` clears `pendingRef` after `flush()` may have restored it

```ts
// src/hooks/useNotes.ts:193-200
const close = useCallback(async () => {
    await flush();
    pendingRef.current = null;  // ← flush() on error restores pendingRef, then this clears it
```

If `flush()` fails (e.g. conflict), it restores `pendingRef`. Then `close()` immediately clears
it, silently dropping the user's content.

**Fix:** Only clear `pendingRef` if `flush()` succeeded.

---

## 2. Correctness Issues

### 2.1 Case-only rename fails on case-insensitive filesystems

`fileSystemStore.rename('note.md', 'Note')` checks `exists('Note.md')` — on macOS/Windows (HFS+/
NTFS), the file exists (case-insensitive), so it throws `NameCollisionError`. The user cannot
change capitalization.

**Fix:** Detect case-only renames and bypass the collision check, or use a two-step rename
through a temp name.

### 2.2 `save()` is TOCTOU (check-then-write)

```ts
// src/storage/fileSystemStore.ts:110-118
const current = (await handle.getFile()).lastModified;
if (current !== baseUpdatedAt) throw new ConflictError(id, current);
const writable = await handle.createWritable();
await writable.write(canonicalBody(content));
```

The mtime check and the write are not atomic. Two tabs can both pass the check and write
simultaneously. This is inherent to the FS Access API's limitations but worth documenting.

### 2.3 `create()` produces an empty file; `save()` writes a trailing blank line

```ts
// fileSystemStore.ts:103-107
async create(title: string): Promise<NoteMeta> {
    const handle = await this.dir.getFileHandle(fileName, {create: true});
    // File is 0 bytes
```

```ts
// fileSystemStore.ts:116-118
await writable.write(canonicalBody(content)); // always ends with \n\n
```

Newly created notes are 0 bytes on disk; after the first save they become `\n\n`. The editor
sees a diff on open (0 bytes → empty string matches) so this doesn't cause a spurious save, but
the inconsistency could surprise external tools editing the same folder.

### 2.4 `open()` error leaves no feedback for initial load failures

```ts
// src/hooks/useNotes.ts:364-393
void (async () => {
    const [list, raw] = await Promise.all([store.list(), store.readMetadata()]);
    if (cancelled) return;
    // ...
})();
```

No `try/catch` — if `store.list()` or `store.readMetadata()` throws, the component silently
shows an empty state with no error toast. The user sees "No notes yet" instead of an error.

### 2.5 `NoteTitle` unmount commit can fire after `useNotes` unmount

```ts
// src/components/NoteTitle.tsx:84-88
useEffect(() => {
    return () => {
        if (draftRef.current !== titleRef.current) onCommitRef.current(draftRef.current);
    };
}, []);
```

If `NoteTitle` unmounts after `useNotes` (e.g. during folder change), `onCommit` calls
`useNotes.rename()` which accesses `store` — a stale or garbage-collected reference. React
guarantees child effects clean up before parent effects, so this should be safe in practice,
but the ordering dependency is fragile.

### 2.6 `browseRelative` uses `Array.includes` on every call

```ts
// src/components/Workspace.tsx:163
if (current && ids.includes(current)) {
    index = Math.min(Math.max(ids.indexOf(current) + delta, 0), ids.length - 1);
```

Two linear scans per arrow press. Negligible for small lists, but worth noting for the backlog
item of full-text search across large note collections.

---

## 3. Performance

### 3.1 Every `browse()` → full `store.get()` + `writeMetadata()`

Arrow-key navigation triggers a full file read and metadata write per keypress. For a folder
with 100+ notes, this is expensive. The metadata write is especially wasteful since it only
changes `active`.

**Fix:** Debounce the `active` persistence, or use a separate lightweight persistence for the
active note id.

### 3.2 `refresh()` re-reads the entire folder

`refresh()` calls `store.list()`, which reads the first 500 bytes of every `.md` file. This
happens after every create, rename, and delete. For large folders, this is O(n) file reads.

**Fix:** Incremental list updates (add/remove single entries) instead of full re-reads.

### 3.3 Bundle size: 4.2 MB JS (1.25 MB gzipped)

The production build emits a 4.2 MB main chunk. The `@diplodoc/tabs-extension` dependency uses
`eval` (Vite warns about this). The `@gravity-ui/markdown-editor` is the heaviest dependency.

**Fix:** Dynamic import the editor (code-split), tree-shake unused Gravity components, audit
`@diplodoc/*` deps.

### 3.4 `handlePersistence.tx` opens a new DB connection per call

```ts
// src/storage/handlePersistence.ts:25-37
function tx<T>(mode, run) {
    return openDb().then((db) => new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
        // ...
        request.transaction!.oncomplete = () => db.close();
    }));
}
```

Each `saveDirHandle`, `loadDirHandle`, or `clearDirHandle` opens and closes the DB. This is
fine for the current usage (once on load, once on folder pick) but would be wasteful if the
API were called frequently.

---

## 4. Accessibility

### 4.1 Missing `aria-label` on icon-only buttons

- Theme switcher button (`ThemeSwitcher.tsx:23`) uses `title` only — no `aria-label`.
- Help button (`TopBar.tsx:161`) uses `title` only.
- Sidebar toggle (`TopBar.tsx:150-158`) has `aria-label` — this one is correct.

### 4.2 Search field has no accessible name

The search input (`TopBar.tsx:112-120`) relies on `placeholder` for its label. Screen readers
may not announce it. Add an `aria-label="Search or create a note"`.

### 4.3 Row actions hidden on touch

```css
/* NoteList.css:83-84 */
.note-list__actions { opacity: 0; }
.note-list__item:hover .note-list__actions { opacity: 1; }
```

On touch devices, hover never fires, so the pin/rename/delete menu is unreachable. Consider
always-visible actions or a long-press gesture.

### 4.4 Peek dismiss uses `mousedown` only

```ts
// src/components/Workspace.tsx:96
document.addEventListener('mousedown', onPointerDown);
```

Should use `pointerdown` for touch compatibility. Alternatively, `touchstart` as a fallback.

### 4.5 No `prefers-reduced-motion` support

The status dot blink animation (`TopBar.css:33`) and sidebar slide transition
(`Workspace.css:74-77`) should respect `prefers-reduced-motion: reduce`.

### 4.6 Collapsed sidebar Esc sends focus to a hidden element

When the sidebar is collapsed (`visibility: hidden`), Esc from the editor calls
`listRef.current?.focusSelected()` — focusing a hidden element. This is technically valid
(hidden elements can receive focus) but disorienting for keyboard users.

---

## 5. Security

### 5.1 `NotePreview` uses `dangerouslySetInnerHTML`

```tsx
// src/components/NotePreview.tsx:33
<div className="note-preview__body yfm" dangerouslySetInnerHTML={{__html: html}} />
```

The `transform()` call converts user Markdown to HTML. The comment says "the editor disallows
raw HTML," but the preview renders the raw Markdown the user wrote. If the user types
`<script>alert(1)</script>` in a note, it depends on whether `@diplodoc/transform` strips it.
This should be verified — the transform library may or may not sanitize HTML.

**Risk:** Low (local-first app, user is the attacker), but worth confirming.

### 5.2 No validation of note `id` before `getFileHandle`

`fileSystemStore` passes the `id` (which is the filename) directly to `getFileHandle()`. The
browser should reject path traversal (`../../etc/passwd`), but the store doesn't validate.
For a local-first app with a user-selected folder, this is low risk.

### 5.3 IndexedDB handle persistence is origin-scoped

Standard — the directory handle stored in IndexedDB is only accessible from the same origin.
No additional risk beyond what the browser enforces.

---

## 6. Test Coverage Gaps

### 6.1 No tests for:

| Module | Risk |
|--------|------|
| `handlePersistence.ts` | IndexedDB save/load/clear — the code users hit first on reload |
| `useNotesFolder.ts` | Entire folder state machine (loading → needs-folder → ready) |
| `FolderGate.tsx` | The first screen every user sees |
| `NotePreview.tsx` | `transform()` error handling, empty markup |
| `App.tsx` | Theme persistence, provider wiring |

### 6.2 Untested paths in tested modules:

- 500ms debounced autosave timer (use `vi.useFakeTimers`)
- `flush()` → `ConflictError` / `NotFoundError` paths
- External delete detection via refocus `stat()`
- `beforeunload` warning for unsaved edits
- Delete with pending edits (the bug in 1.1)
- Concurrent `open()` race
- Conflict flow end-to-end in `Workspace`
- `setSortMode` / `togglePin` from hook level
- `keepMine()` when the note was deleted (early return, no recovery)

### 6.3 `FakeDirectoryHandle` doesn't simulate real FS behavior

The fake doesn't model:
- Concurrent writable streams (two `createWritable()` calls on the same file)
- File locking
- Case-insensitive name matching (macOS/Windows)
- Permission errors

These are the exact failure modes the real app encounters.

---

## 7. Code Quality & DX

### 7.1 14 ESLint warnings (0 errors)

- 3 `@typescript-eslint/no-shadow` warnings from `forwardRef` patterns in `NoteList`, `NotePreview`,
  `NoteTitle`. These are idiomatic React but could be suppressed with a targeted rule.
- 1 `consistent-return` in `useNotesFolder.ts` (the `return () => { cancelled = true; }` cleanup).
- 1 `no-non-null-assertion` in `main.tsx` (`document.getElementById('root')!`).
- 1 `no-non-null-assertion` in `handlePersistence.ts` (`request.transaction!`).

### 7.2 `.DS_Store` committed to the repo

The directory listing shows `.DS_Store` in the working tree. It should be in `.gitignore`.

### 7.3 `vite.config.ts` not typechecked

`tsconfig.json` `include` is `["src"]`, so `vite.config.ts` (project root) is excluded from
type checking. Regressions in test config go unnoticed.

### 7.4 `build:single` not in CI

The `vite build --mode singlefile` path (self-contained HTML) is not tested in CI. Regressions
in the single-file build (e.g. the `esbuild: {charset: 'ascii'}` requirement) go unnoticed.

### 7.5 README and CLAUDE.md lag the code

Both are missing:
- nvALT search-or-create workflow
- Keyboard shortcuts (the full SHORTCUTS table)
- Pinning and sort modes
- Conflict handling and the metadata dotfile
- `TopBar`, `NoteTitle`, `NotePreview`, `ConflictBanner`, `ShortcutsDialog` components
- The `useNoteNavigation`, `useNoteSearch`, `useShortcuts` hooks

### 7.6 Potentially unused direct dependencies

These may be transitive deps of `@gravity-ui/markdown-editor` listed as direct deps:
- `@gravity-ui/components`
- `@diplodoc/file-extension`
- `@diplodoc/cut-extension`
- `markdown-it`
- `highlight.js`
- `katex`
- `lowlight`

Verify with `npx depcheck` or similar.

---

## 8. Architecture Observations

### 8.1 The `NoteStore` seam is well-designed

The `NoteStore` interface in `types.ts` is storage-agnostic. `FileSystemNoteStore` is the only
implementation. The `FakeDirectoryHandle` gives good test coverage. This makes adding an
`IndexedDBStore` or `ApiStore` straightforward.

### 8.2 Editing architecture is deliberate and correct

The `pendingRef` + 500ms debounce + flush-on-navigate pattern avoids remounting the markdown
editor mid-typing. The `sessionId` key separates rename (same session, no remount) from browse
(new session, fresh mount). This is well thought out.

### 8.3 Metadata layer is robust

`parseMetadata` is tolerant (never throws), `reconcile` self-heals ghost pins/active, and
`orderNotes` is a pure function. The immutable transform pattern (`withPinToggled`, etc.) is
clean and testable.

### 8.4 Keyboard UX is comprehensive

The nvALT-style search-or-create, Esc ladder (editor → list → search → close), sidebar peek,
and global shortcuts are all well-coordinated. The `SHORTCUTS` table is the single source of
truth for both the handler and the help dialog.

### 8.5 Missing: React error boundary

Storage errors go to the toaster, but a render crash (e.g. from a corrupt note body) blanks
the entire app. An error boundary around `Workspace` would degrade more gracefully.

### 8.6 Missing: `FileSystemObserver` API

The app detects external changes via `stat()` on refocus. The `FileSystemObserver` API (when
available) would provide real-time file change notifications without polling.

---

## 9. Recommended Fix Order

Prioritized by user impact and implementation effort:

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 1 | Flush before `remove()` | Small | Prevents data loss on delete |
| 2 | Flush before `forgetFolder()` + confirmation | Small | Prevents data loss on folder switch |
| 3 | Short-circuit `open()` when `id === activeId` | Small | Fixes click remount, reduces race surface |
| 4 | Serialize `open()` with generation counter | Medium | Fixes rapid-navigation wrong-note bug |
| 5 | Fix `close()` clearing pending after failed flush | Small | Prevents data loss on close-during-error |
| 6 | `useNotesFolder` mount race + error handling | Medium | Fixes first-run UX |
| 7 | Initial load error handling in `useNotes` | Small | Prevents silent empty state |
| 8 | Case-folding rename collision check | Small | macOS/Windows rename fix |
| 9 | `handlePersistence` tests + `db.close()` in `finally` | Medium | Covers the reload-persistence layer |
| 10 | Add `aria-label` to icon buttons + search | Small | Accessibility |
| 11 | Use `pointerdown` for peek dismiss | Trivial | Touch support |
| 12 | Add `prefers-reduced-motion` | Trivial | Accessibility |
| 13 | Update README/CLAUDE.md | Medium | Documentation accuracy |
| 14 | Add `build:single` to CI | Trivial | CI coverage |
| 15 | Code-split the editor bundle | Medium | Bundle size |

---

*Generated by MiMo Code Agent — June 2026.*
