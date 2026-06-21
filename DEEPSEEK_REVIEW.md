# DeepSeek Code Review — Gravity Notes

## Overview

Gravity Notes is a well-architected local-first Markdown note-taking app. The codebase is clean, well-tested, and follows strong conventions. This review identifies potential bugs, edge cases, performance concerns, and architectural improvements.

---

## Potential Bugs

### 1. Unhandled Promise rejection on IndexedDB startup
**File:** `src/storage/handlePersistence.ts:29-38`, call site `src/hooks/useNotesFolder.ts:45`

The `loadDirHandle()` call inside the `useEffect` async IIFE has no `try/catch`. If IndexedDB is unavailable (e.g., some private browsing modes block it), the promise rejects unhandled. While the `cancelled` guard prevents stale `setState` calls, a rejection would still be an unhandled promise rejection in the console.

**Fix:** Wrap `loadDirHandle()` in a `try/catch` and set state to `needs-folder` on error.

### 2. `keepMine` can silently overwrite a newer disk version
**File:** `src/hooks/useNotes.ts:315-329`

`keepMine()` saves with `conflict.diskUpdatedAt` as the optimistic-concurrency baseline. If the disk changed again between conflict detection and the user clicking "Keep mine", a second external edit could be silently overwritten (the mtime won't match, so it *will* throw `ConflictError` which is caught, but then the pending content is re-queued and no toast explains why "Keep mine" failed silently).

**Fix:** Add a toast when `keepMine` hits a follow-up conflict, or re-stat before saving.

### 3. Orphaned empty file if `saveAsCopy` fails mid-operation
**File:** `src/hooks/useNotes.ts:331-351`

`saveAsCopy` first calls `store.create()` (creating an empty file), then `store.save()` to write content. If `store.save()` throws, the empty file remains on disk as an orphaned note.

**Fix:** Wrap in a `try/catch` that removes the created file on save failure, or accept the empty note (current behavior — low severity).

### 4. Missing check for `editor._wysiwygView` type stability
**File:** `src/components/editorBody.ts:42-44`

The code accesses `editor._wysiwygView` — a private, undocumented property of `@gravity-ui/markdown-editor`. A minor version bump in that library could rename or remove this property, silently breaking the title↔body handoff (falling back to `false` returns and degraded navigation).

**Fix:** Pin the markdown-editor version more tightly in `package.json`, or add a runtime smoke test that verifies `_wysiwygView` is present before relying on it in production code.

### 5. `sanitizeTitle` can produce filenames starting/ending with spaces
**File:** `src/storage/fileSystemStore.ts:51-58`

Characters illegal in filenames are replaced with spaces, then consecutive spaces are collapsed. However, the replacement of a leading/trailing illegal char (e.g., `:MyNote`) produces ` MyNote` which is trimmed. The trim happens *after* collapse, so this is handled. However, if a title is composed entirely of illegal characters (e.g., `?*<>`), it ends up as `Untitled`, which is correct. **Low severity — appears handled.**

### 6. `stat()` not catching `TypeError` in addition to `NotFoundError`
**File:** `src/storage/fileSystemStore.ts:124-134`

`getFileHandle()` could throw other error types (e.g., `TypeError` for an invalid name, `SecurityError` for permission loss). Only `NotFoundError` is caught. Any other error propagates to callers.

**Fix:** Consider catching all `DOMException` variants and re-throwing only unexpected ones, or handle `SecurityError` specifically to surface a permission-lost state.

### 7. No `onerror` handler for the `request` in `tx()`
**File:** `src/storage/handlePersistence.ts:26-38`

The `tx` helper attaches `onerror` to the request but not `onerror` to the transaction itself. A transaction-level abort (e.g., quota exceeded) would leave the promise pending forever.

**Fix:** Add `transaction.onerror = () => reject(transaction.error)` or `transaction.onabort`.

---

## Architecture & Design

### 8. `useNotes` hook is too large (470 lines)
**File:** `src/hooks/useNotes.ts`

The hook manages: note CRUD, metadata persistence, autosave timers, conflict detection, visibility/beforeunload handlers, and external-change polling. This makes it hard to test individual behaviors and reason about.

**Suggestion:** Extract the autosave + conflict logic into a separate `useAutosave(store, onError)` hook, and the metadata sync into `useNotesMetadata(store)`.

### 9. `Workspace` component mixes layout and business logic (353 lines)
**File:** `src/components/Workspace.tsx`

Navigation logic (browse/commit/delete/rename callbacks, peek sidebar state machine, Esc fallback, etc.) lives directly in the layout component. Consider extracting the sidebar peek state into `useSidebar()` and the nvALT keyboard coordination into `useSearchNavigation()`.

### 10. No React error boundary
**File:** Missing

If any component in the tree throws during render, the entire app whitescreens. A root-level error boundary in `App.tsx` would degrade gracefully (show an error state with a "reload" button).

---

## Edge Cases

### 11. No confirmation before closing with unresolved conflict
**File:** `src/hooks/useNotes.ts:193-200`

`close()` flushes and clears, but doesn't check if `conflict` is set. If the user presses Esc to close while a conflict banner is showing, the conflict is silently discarded (observable: in `Workspace.tsx:320-323`, `discard()` is only called via the banner's Discard button, not via close). Actually, `close()` doesn't call `discard()` — it just clears state. The conflict state is abandoned. This is arguably correct (the conflict holds disk content; the user's unsaved edits were re-queued in `pendingRef` but not written), but the conflict banner disappears without resolution next time the note is opened.

### 12. No auto-scroll to focused/selected row in `NoteList`
**File:** `src/components/NoteList.tsx`

When browsing via keyboard (j/k or arrows), focus moves to the row via `.focus()`, but if the list is scrolled, the row might be off-screen. `focus()` on a `div[tabindex]` does scroll it into view in most browsers, but adding an explicit `scrollIntoView({block: 'nearest'})` would make it reliable.

### 13. `beforeunload` fires `flush()` but may not complete
**File:** `src/hooks/useNotes.ts:407-423`

The `beforeunload` handler calls `void flush()` (async) but browsers may cancel the page before the async file write completes. The BFCache and Page Lifecycle API provide more reliable patterns (`pagehide` + `fetch` with `keepalive`), but those don't apply to file system writes. This is a fundamental limitation of the FS Access API — not a code bug.

### 14. Empty string title in rename both in list and editor title
**File:** `src/components/NoteList.tsx:149-155`, `src/components/NoteTitle.tsx`

`commitRename` checks `next && next !== note.title` — an empty string is falsy and skipped. `NoteTitle.onBlur` calls `onCommit(draft)` unconditionally (unless reverted). If the user clears the title field in the editor and blurs, it calls `onRename` with an empty string, which `useNotes.rename` passes to `store.rename`, which calls `sanitizeTitle('')` → `'Untitled'`. The note is renamed to "Untitled.md" (or "Untitled 2.md" if that exists). This may be surprising.

### 15. `formatNoteDate` year cutoff
**File:** `src/components/NoteList.tsx:58-71`

Uses two-digit year (`YY`) via `(getFullYear() % 100)`. At century boundaries, notes from 2100 and 2000 would render identically. Minor cosmetic issue.

---

## Performance

### 16. `NoteList` re-renders all rows on every selection change
**File:** `src/components/NoteList.tsx`

`selectedId` changes on every cursor move (j/k/arrows), causing the entire `<NoteList>` to re-render. For large note collections, consider wrapping individual rows in `React.memo` with a comparison function that only checks `id`, `selectedId`, `editingId`, and `pinnedIds`.

### 17. `orderNotes` runs on every render
**File:** `src/components/Workspace.tsx:55-58`

Already wrapped in `useMemo`, but the deps `[notes.notes, notes.metadata]` change on every list refresh. For large collections (1000+ notes), the sort + filter pipeline runs synchronously. Consider using `useDeferredValue` to keep the UI responsive during filtering.

### 18. `list()` reads every file on every refresh
**File:** `src/storage/fileSystemStore.ts:69-87`

Every call to `list()` iterates all files in the directory handle. There's no incremental update pattern — creating a note refreshes the entire list. For large folders, this is O(n) file reads. A potential optimization: cache the last-known `NoteMeta[]` and only re-stat files whose `lastModified` changed. This is a v2 consideration, not a bug.

---

## Testing Coverage Gaps

| Missing Test | File |
|---|---|
| `handlePersistence` (IndexedDB helpers) | `src/storage/handlePersistence.ts` |
| `useNotesFolder` hook | `src/hooks/useNotesFolder.ts` |
| `NotePreview` component | `src/components/NotePreview.tsx` |
| `FakeDirectoryHandle.removeEntry` for non-existent name | `src/storage/fakeFileSystem.ts:102-106` |
| `editorCaret.isCaretOnFirstLine` (DOM layout-based, not jsdom-able) | `src/components/editorCaret.ts` |
| `stat()` non-NotFoundError exception path | `src/storage/fileSystemStore.ts:132` |
| `keepMine` follow-up conflict scenario | `src/hooks/useNotes.ts:315-329` |
| End-to-end conflict resolution flow in `Workspace` | Integration test |

---

## Code Quality & Safety

### 19. `asDirectoryHandle` unsound cast
**File:** `src/storage/fakeFileSystem.ts:109-111`

```ts
export function asDirectoryHandle(fake: FakeDirectoryHandle): FileSystemDirectoryHandle {
    return fake as unknown as FileSystemDirectoryHandle;
}
```

This double-cast is test-only, but if ever used in production code, it would silently mask type errors. Consider marking it with a `@internal` or `@test` JSDoc tag.

### 20. Inconsistent `void` usage for promise handling
Multiple patterns exist: `void fn()`, `void (async () => { ... })()`, and `.then()`. While this is idiomatic for explicit fire-and-forget, some places use `void fn()` where `await fn()` would be clearer (e.g., `Workspace.tsx:270` `onChangeFolder={() => void folder.forgetFolder()}`).

### 21. `.nvmrc` specifies Node 24, `package.json` engines requires `>=22`
**File:** `.nvmrc`, `package.json`

The `.nvmrc` pins Node 24, but `package.json` engines says `>=22`. The CI also uses Node 24. If Node 22 has different behavior, this mismatch could cause issues. Consider aligning them or pinning to the same major version.

---

## Security Notes

### 22. `dangerouslySetInnerHTML` with user-provided Markdown
**File:** `src/components/NotePreview.tsx:33`

The comment notes "the editor disallows raw HTML," which is correct for the WYSIWYG/markup modes. However, the `NotePreview` has no additional sanitization. If a user manually edits the `.md` file on disk to include raw HTML in their Markdown, it will be rendered as-is when previewed. Since these are the user's own files, this is an intentional design choice (trust local data), but it's worth documenting prominently.

---

## Summary

**Strengths:**
- Clean architecture with well-defined `NoteStore` abstraction
- Robust optimistic concurrency with conflict detection
- Comprehensive unit test suite for storage and critical hooks
- Keyboard-first UX with well-designed shortcuts
- Good error surfacing via toaster
- Thoughtful handling of edge cases (rename-then-edit, conflict-on-navigate, etc.)

**Key recommendations (by priority):**

1. **Add try/catch around `loadDirHandle()`** in `useNotesFolder` to handle IndexedDB unavailability
2. **Add React error boundary** at root level for graceful failure
3. **Extract autosave/conflict logic** from `useNotes` to reduce hook size
4. **Consider `React.memo`** on `NoteList` rows for large collections
5. **Add tests** for `handlePersistence`, `useNotesFolder`, and `NotePreview`
6. **Align `.nvmrc` and `package.json` engines** to the same Node version
7. **Add `transaction.onabort` handler** in `handlePersistence.ts`
