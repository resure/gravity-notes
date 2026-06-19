# Robustness & Data Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect external edits before overwriting them (surfaced via a non-blocking banner with reload / keep-mine / save-as-copy), and warn before losing unsaved edits on tab close.

**Architecture:** Optimistic concurrency in the `NoteStore` — `save` takes the baseline `lastModified` it expects and throws `ConflictError` if the file changed on disk; a new `stat` powers proactive checks. `useNotes` tracks the baseline, pauses autosave on conflict, and exposes resolvers; a `ConflictBanner` renders the choices.

**Tech Stack:** TypeScript, React 18, File System Access API, Vitest, `@gravity-ui/uikit` `Alert`.

**Spec:** `docs/superpowers/specs/2026-06-19-robustness-data-safety-design.md`

**Note on tests:** Store-level optimistic-concurrency tests are the automated deliverable (the data-loss-prevention logic lives there). Hook/UI behavior is verified manually this slice; automated hook tests arrive with the Core UX slice's jsdom + Testing Library setup.

---

## File overview

| File                                  | Responsibility                                                             | Action |
| ------------------------------------- | -------------------------------------------------------------------------- | ------ |
| `src/storage/types.ts`                | `ConflictError`, `save` signature, `stat`                                  | Modify |
| `src/storage/fileSystemStore.ts`      | Guarded `save`, `stat`, real-mtime `create`                                | Modify |
| `src/storage/fileSystemStore.test.ts` | Conflict + stat tests; update existing save call                           | Modify |
| `src/hooks/useNotes.ts`               | Baseline, guarded flush, conflict state + resolvers, refocus, beforeunload | Modify |
| `src/components/ConflictBanner.tsx`   | Presentational conflict banner                                             | Create |
| `src/components/Workspace.tsx`        | Render banner, key editor by `id:updatedAt`, wire resolvers                | Modify |
| `src/components/Workspace.css`        | Banner spacing                                                             | Modify |

---

## Task 1: Storage layer — `ConflictError`, guarded `save`, `stat`

**Files:**

- Modify: `src/storage/types.ts`
- Modify: `src/storage/fileSystemStore.ts`
- Modify: `src/storage/fileSystemStore.test.ts`

- [ ] **Step 1: Add `ConflictError` and update the `NoteStore` interface in `src/storage/types.ts`**

Append the `ConflictError` class at the end of the file, and replace the `save` line in `NoteStore` and add `stat`. The full updated `NoteStore` interface plus the new class:

```ts
export interface NoteStore {
  /** List all notes, typically sorted by most-recently-updated. */
  list(): Promise<NoteMeta[]>;
  /** Load a single note's full content. */
  get(id: string): Promise<Note>;
  /**
   * Create a new, empty note with a unique title and return its meta.
   * @param title preferred title; the store resolves collisions (e.g. "Untitled 2").
   */
  create(title: string): Promise<NoteMeta>;
  /**
   * Persist the body of an existing note using optimistic concurrency.
   * @param baseUpdatedAt the `updatedAt` the caller last saw for this note.
   * @returns the note's new meta (with the post-write `updatedAt`).
   * @throws ConflictError if the file's on-disk `lastModified` differs from `baseUpdatedAt`.
   */
  save(id: string, content: string, baseUpdatedAt: number): Promise<NoteMeta>;
  /**
   * Rename a note. Returns the new meta (the id may change, e.g. for file-backed
   * stores where the id is derived from the file name).
   */
  rename(id: string, nextTitle: string): Promise<NoteMeta>;
  /** Delete a note. */
  remove(id: string): Promise<void>;
  /** Current `lastModified` for a note, or `null` if it no longer exists. */
  stat(id: string): Promise<number | null>;
}

/** Thrown by {@link NoteStore.save} when the file changed on disk since the baseline. */
export class ConflictError extends Error {
  constructor(
    readonly id: string,
    readonly diskUpdatedAt: number,
  ) {
    super(`"${id}" changed on disk`);
    this.name = 'ConflictError';
  }
}
```

- [ ] **Step 2: Implement guarded `save`, `stat`, and real-mtime `create` in `src/storage/fileSystemStore.ts`**

Update the import line and replace the `create` and `save` methods, and add `stat`. New import line (add `ConflictError`):

```ts
import {ConflictError, type Note, type NoteMeta, type NoteStore} from './types';
```

Replace `create` (it must return the file's real `lastModified`, not `Date.now()`, so the first save's baseline matches disk):

```ts
    async create(title: string): Promise<NoteMeta> {
        const fileName = await this.uniqueFileName(sanitizeTitle(title));
        const handle = await this.dir.getFileHandle(fileName, {create: true});
        const updatedAt = (await handle.getFile()).lastModified;
        return {id: fileName, title: titleFromFileName(fileName), updatedAt};
    }
```

Replace `save` (guarded check-then-write, returns new meta):

```ts
    async save(id: string, content: string, baseUpdatedAt: number): Promise<NoteMeta> {
        const handle = await this.dir.getFileHandle(id);
        const current = (await handle.getFile()).lastModified;
        if (current !== baseUpdatedAt) {
            throw new ConflictError(id, current);
        }
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        const updatedAt = (await handle.getFile()).lastModified;
        return {id, title: titleFromFileName(id), updatedAt};
    }
```

Add `stat` immediately after `save`:

```ts
    async stat(id: string): Promise<number | null> {
        try {
            const handle = await this.dir.getFileHandle(id);
            return (await handle.getFile()).lastModified;
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotFoundError') {
                return null;
            }
            throw err;
        }
    }
```

- [ ] **Step 3: Update the existing round-trip test and add the `ConflictError` import in `src/storage/fileSystemStore.test.ts`**

Change the import line to also import `ConflictError`:

```ts
import {ConflictError, FileSystemNoteStore} from './fileSystemStore';
```

Wait — `ConflictError` lives in `./types`, not `./fileSystemStore`. Use two import lines:

```ts
import {FakeDirectoryHandle, asDirectoryHandle} from './fakeFileSystem';
import {FileSystemNoteStore} from './fileSystemStore';
import {ConflictError} from './types';
```

Update the `round-trips content through save` test to pass the baseline (the seeded mtime `10`):

```ts
it('round-trips content through save', async () => {
  dir.seedFile('Ideas.md', 'old', 10);

  await store.save('Ideas.md', 'new body', 10);

  expect((await store.get('Ideas.md')).content).toBe('new body');
});
```

- [ ] **Step 4: Run existing tests to confirm the signature change didn't break them**

Run: `npm test`
Expected: all existing tests PASS (13 from before, with the one updated call).

- [ ] **Step 5: Add conflict + stat tests in `src/storage/fileSystemStore.test.ts`**

Insert these two `describe` blocks just before the final closing `});` of the top-level `describe`:

```ts
describe('save conflict detection', () => {
  it('throws ConflictError when the file changed on disk since the baseline', async () => {
    dir.seedFile('Note.md', 'original', 100);
    dir.seedFile('Note.md', 'edited elsewhere', 250); // external edit bumps mtime

    await expect(store.save('Note.md', 'my version', 100)).rejects.toBeInstanceOf(ConflictError);
    // The rejected save must not have touched the on-disk content.
    expect((await store.get('Note.md')).content).toBe('edited elsewhere');
  });

  it('reports the current disk mtime on the conflict', async () => {
    dir.seedFile('Note.md', 'a', 100);
    dir.seedFile('Note.md', 'b', 250);

    await expect(store.save('Note.md', 'c', 100)).rejects.toMatchObject({
      name: 'ConflictError',
      diskUpdatedAt: 250,
    });
  });

  it('writes when the baseline matches the current disk mtime (keep-mine)', async () => {
    dir.seedFile('Note.md', 'a', 100);
    dir.seedFile('Note.md', 'b', 250);

    const meta = await store.save('Note.md', 'mine', 250);

    expect(meta.updatedAt).toBeGreaterThan(250);
    expect((await store.get('Note.md')).content).toBe('mine');
  });

  it('returns the new mtime so the next save uses a fresh baseline', async () => {
    dir.seedFile('Note.md', 'a', 100);

    const first = await store.save('Note.md', 'b', 100);
    const second = await store.save('Note.md', 'c', first.updatedAt ?? 0);

    expect((await store.get('Note.md')).content).toBe('c');
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt ?? 0);
  });
});

describe('stat', () => {
  it('returns the current lastModified', async () => {
    dir.seedFile('Note.md', 'x', 77);

    expect(await store.stat('Note.md')).toBe(77);
  });

  it('returns null for a missing file', async () => {
    expect(await store.stat('Ghost.md')).toBeNull();
  });
});
```

- [ ] **Step 6: Run the suite, lint, and typecheck**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all tests PASS (now 19), lint 0 errors, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/storage/types.ts src/storage/fileSystemStore.ts src/storage/fileSystemStore.test.ts
git commit -m "feat(storage): optimistic-concurrency save + stat with ConflictError"
```

---

## Task 2: Hook — baseline, guarded flush, conflict resolvers, refocus, beforeunload

**Files:**

- Modify: `src/hooks/useNotes.ts`

- [ ] **Step 1: Replace `src/hooks/useNotes.ts` in full**

This adds baseline tracking, the guarded flush (keeps pending content on any failure), conflict state, the three resolvers + discard, proactive refocus detection, and the beforeunload warning.

```ts
import {useCallback, useEffect, useRef, useState} from 'react';

import {ConflictError, type Note, type NoteMeta, type NoteStore} from '../storage/types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

const AUTOSAVE_DELAY = 500;

/** A detected external change to the currently-open note. */
export interface NoteConflict {
  id: string;
  /** On-disk `lastModified` at detection (0 when the file was deleted). */
  diskUpdatedAt: number;
  /** True when the file was deleted on disk rather than modified. */
  deleted: boolean;
}

export interface UseNotes {
  notes: NoteMeta[];
  selectedId: string | null;
  /** Full content of the selected note (the editor's initial markup). */
  selectedNote: Note | null;
  saveState: SaveState;
  /** Set when the open note changed on disk underneath us; null otherwise. */
  conflict: NoteConflict | null;
  select(id: string): Promise<void>;
  create(): Promise<void>;
  rename(id: string, nextTitle: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Queue a debounced autosave for the currently selected note. */
  edit(content: string): void;
  /** Conflict resolvers. */
  reloadDisk(): Promise<void>;
  keepMine(): Promise<void>;
  saveAsCopy(): Promise<void>;
  discard(): void;
}

/**
 * Owns the note list, the current selection, and debounced autosave for a given
 * `NoteStore`. Editing is decoupled from React state on purpose: keystrokes only
 * flow into a ref + debounce timer (not `setState`), so the markdown editor
 * instance is never re-created mid-typing.
 *
 * Saves use optimistic concurrency: `baselineRef` tracks the on-disk `lastModified`
 * we last saw; a save whose baseline no longer matches disk raises a `conflict`
 * instead of overwriting, and autosave pauses until it is resolved.
 */
export function useNotes(store: NoteStore, onError: (message: string) => void): UseNotes {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [conflict, setConflict] = useState<NoteConflict | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest unsaved edit, tagged with the note it belongs to. */
  const pendingRef = useRef<{id: string; content: string} | null>(null);
  /** Last on-disk `lastModified` we've seen for the selected note. */
  const baselineRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setNotes(await store.list());
  }, [store]);

  const bumpInList = useCallback((id: string, updatedAt: number | undefined) => {
    setNotes((prev) =>
      [...prev]
        .map((n) => (n.id === id ? {...n, updatedAt} : n))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    );
  }, []);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    try {
      const meta = await store.save(pending.id, pending.content, baselineRef.current ?? 0);
      baselineRef.current = meta.updatedAt ?? null;
      setSaveState('saved');
      bumpInList(pending.id, meta.updatedAt);
    } catch (err) {
      pendingRef.current = pending; // never drop the user's content
      if (err instanceof ConflictError) {
        setConflict({id: err.id, diskUpdatedAt: err.diskUpdatedAt, deleted: false});
        setSaveState('conflict');
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setConflict({id: pending.id, diskUpdatedAt: 0, deleted: true});
        setSaveState('conflict');
      } else {
        setSaveState('error');
        onError(err instanceof Error ? err.message : 'Failed to save note');
      }
    }
  }, [store, onError, bumpInList]);

  const select = useCallback(
    async (id: string) => {
      await flush();
      try {
        const note = await store.get(id);
        baselineRef.current = note.updatedAt ?? null;
        setSelectedNote(note);
        setSelectedId(id);
        setConflict(null);
        setSaveState('idle');
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to open note');
      }
    },
    [flush, store, onError],
  );

  const create = useCallback(async () => {
    await flush();
    try {
      const meta = await store.create('Untitled');
      await refresh();
      await select(meta.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create note');
    }
  }, [flush, store, refresh, select, onError]);

  const rename = useCallback(
    async (id: string, nextTitle: string) => {
      await flush();
      try {
        const meta = await store.rename(id, nextTitle);
        await refresh();
        if (selectedId === id) {
          await select(meta.id);
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to rename note');
      }
    },
    [flush, store, refresh, select, selectedId, onError],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await store.remove(id);
        if (pendingRef.current?.id === id) {
          pendingRef.current = null;
        }
        if (selectedId === id) {
          setSelectedId(null);
          setSelectedNote(null);
          setConflict(null);
        }
        await refresh();
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to delete note');
      }
    },
    [store, refresh, selectedId, onError],
  );

  const edit = useCallback(
    (content: string) => {
      if (!selectedId) return;
      pendingRef.current = {id: selectedId, content};
      if (conflict) return; // autosave is paused until the conflict is resolved
      setSaveState('saving');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flush();
      }, AUTOSAVE_DELAY);
    },
    [selectedId, conflict, flush],
  );

  const reloadDisk = useCallback(async () => {
    const id = conflict?.id;
    if (!id) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    try {
      const note = await store.get(id);
      baselineRef.current = note.updatedAt ?? null;
      setSelectedNote(note); // new updatedAt remounts the editor with disk content
      setSelectedId(id);
      setConflict(null);
      setSaveState('idle');
      bumpInList(id, note.updatedAt);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to reload note');
    }
  }, [conflict, store, onError, bumpInList]);

  const keepMine = useCallback(async () => {
    if (!conflict || conflict.deleted) return;
    const content = pendingRef.current?.content ?? selectedNote?.content ?? '';
    pendingRef.current = null;
    try {
      const meta = await store.save(conflict.id, content, conflict.diskUpdatedAt);
      baselineRef.current = meta.updatedAt ?? null;
      setConflict(null);
      setSaveState('saved');
      bumpInList(conflict.id, meta.updatedAt);
    } catch (err) {
      pendingRef.current = {id: conflict.id, content};
      onError(err instanceof Error ? err.message : 'Failed to save note');
    }
  }, [conflict, selectedNote, store, onError, bumpInList]);

  const saveAsCopy = useCallback(async () => {
    if (!conflict) return;
    const content = pendingRef.current?.content ?? selectedNote?.content ?? '';
    const title = selectedNote?.title ?? 'Note';
    pendingRef.current = null;
    try {
      const copy = await store.create(`${title} (conflicted copy)`);
      await store.save(copy.id, content, copy.updatedAt ?? 0);
      setConflict(null);
      await refresh();
      await select(copy.id);
    } catch (err) {
      pendingRef.current = {id: conflict.id, content};
      onError(err instanceof Error ? err.message : 'Failed to save a copy');
    }
  }, [conflict, selectedNote, store, refresh, select, onError]);

  const discard = useCallback(() => {
    pendingRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setConflict(null);
    setSelectedId(null);
    setSelectedNote(null);
    setSaveState('idle');
    void refresh();
  }, [refresh]);

  // Initial load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Best-effort save when hidden; warn before unload if edits are unsaved.
  useEffect(() => {
    const onHide = () => {
      void flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      void flush();
      if (pendingRef.current || conflict) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flush, conflict]);

  // Detect external changes when returning to the tab/window.
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const id = selectedId;
      if (!id || conflict || pendingRef.current) return;
      const diskMtime = await store.stat(id);
      if (diskMtime === null) {
        setConflict({id, diskUpdatedAt: 0, deleted: true});
        setSaveState('conflict');
      } else if (baselineRef.current !== null && diskMtime !== baselineRef.current) {
        setConflict({id, diskUpdatedAt: diskMtime, deleted: false});
        setSaveState('conflict');
      }
    };
    const onFocus = () => {
      void check();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [selectedId, conflict, store]);

  return {
    notes,
    selectedId,
    selectedNote,
    saveState,
    conflict,
    select,
    create,
    rename,
    remove,
    edit,
    reloadDisk,
    keepMine,
    saveAsCopy,
    discard,
  };
}
```

- [ ] **Step 2: Lint, typecheck, build**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: 0 lint errors (warnings acceptable), typecheck clean, build succeeds. If `react-hooks/exhaustive-deps` warns on an effect, verify the dep array matches the code and adjust; do not silence with a disable unless the dep is genuinely stable.

- [ ] **Step 3: Run tests (store tests must still pass)**

Run: `npm test`
Expected: 19 tests PASS (the hook isn't unit-tested this slice; this confirms nothing regressed).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useNotes.ts
git commit -m "feat(notes): conflict-aware autosave with reload/keep/copy + close warning"
```

---

## Task 3: UI — conflict banner and editor wiring

**Files:**

- Create: `src/components/ConflictBanner.tsx`
- Modify: `src/components/Workspace.tsx`
- Modify: `src/components/Workspace.css`

- [ ] **Step 1: Create `src/components/ConflictBanner.tsx`**

```tsx
import {Alert} from '@gravity-ui/uikit';

interface ConflictBannerProps {
  deleted: boolean;
  onReload: () => void;
  onKeepMine: () => void;
  onSaveAsCopy: () => void;
  onDiscard: () => void;
}

/**
 * Non-blocking banner shown when the open note changed (or was deleted) on disk
 * outside the app. Autosave is paused until the user picks a resolution.
 */
export function ConflictBanner({
  deleted,
  onReload,
  onKeepMine,
  onSaveAsCopy,
  onDiscard,
}: ConflictBannerProps) {
  if (deleted) {
    return (
      <Alert
        theme="warning"
        title="Deleted on disk"
        message="This note was deleted outside the app. Save your version as a copy, or discard it."
        actions={[
          {text: 'Save as copy', handler: onSaveAsCopy},
          {text: 'Discard', handler: onDiscard},
        ]}
      />
    );
  }
  return (
    <Alert
      theme="warning"
      title="Changed on disk"
      message="This note was modified outside the app. Reload the disk version, keep yours (overwrite), or save yours as a copy."
      actions={[
        {text: 'Reload', handler: onReload},
        {text: 'Keep mine', handler: onKeepMine},
        {text: 'Save as copy', handler: onSaveAsCopy},
      ]}
    />
  );
}
```

- [ ] **Step 2: Wire the banner and conflict-aware editor key into `src/components/Workspace.tsx`**

Add the import (alphabetical, before `NoteList`):

```ts
import {ConflictBanner} from './ConflictBanner';
```

Add a `'conflict'` entry to `SAVE_LABEL`:

```ts
const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
  conflict: 'Changed on disk',
};
```

Replace the `<main className="workspace__editor">…</main>` block so the banner renders above the editor and the editor is keyed by `id:updatedAt`:

```tsx
<main className="workspace__editor">
  {notes.selectedNote ? (
    <>
      {notes.conflict ? (
        <div className="workspace__conflict">
          <ConflictBanner
            deleted={notes.conflict.deleted}
            onReload={() => void notes.reloadDisk()}
            onKeepMine={() => void notes.keepMine()}
            onSaveAsCopy={() => void notes.saveAsCopy()}
            onDiscard={notes.discard}
          />
        </div>
      ) : null}
      <EditorPane
        key={`${notes.selectedNote.id}:${notes.selectedNote.updatedAt}`}
        note={notes.selectedNote}
        onChange={notes.edit}
      />
    </>
  ) : (
    <div className="workspace__placeholder">
      <Text variant="body-2" color="secondary">
        Select a note, or create a new one to start writing.
      </Text>
    </div>
  )}
</main>
```

- [ ] **Step 3: Add banner spacing to `src/components/Workspace.css`**

Append:

```css
.workspace__conflict {
  padding: 12px 12px 0;
}
```

- [ ] **Step 4: Lint, typecheck, build**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: 0 lint errors, typecheck clean, build succeeds. If lint flags the `Alert` `actions` prop shape or `message` name, confirm against `node_modules/@gravity-ui/uikit/build/esm/components/Alert/types.d.ts` and adjust (verified at planning time as `actions?: ReactNode | AlertAction[]`, `AlertAction = {text, handler}`).

- [ ] **Step 5: Commit**

```bash
git add src/components/ConflictBanner.tsx src/components/Workspace.tsx src/components/Workspace.css
git commit -m "feat(ui): conflict banner with reload/keep/copy/discard"
```

---

## Task 4: Verify and open PR

**Files:** none (verification + PR)

- [ ] **Step 1: Full pipeline locally**

Run: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`
Expected: every step passes; 19 tests green.

- [ ] **Step 2: Manual smoke (Chromium)**

Run: `npm run dev`, open a folder, then in a separate editor modify the open note's `.md` file and switch back to the tab. Verify the "Changed on disk" banner appears with Reload / Keep mine / Save as copy, that **Reload** shows the external content, **Keep mine** overwrites it, and **Save as copy** creates `<title> (conflicted copy).md`. Type, then close the tab and confirm the browser warns about unsaved changes.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin robustness-data-safety
gh pr create --base main --head robustness-data-safety \
  --title "Robustness & data safety: external-edit conflicts + save-on-close" \
  --body "Implements docs/superpowers/specs/2026-06-19-robustness-data-safety-design.md. See plan docs/superpowers/plans/2026-06-19-robustness-data-safety.md."
```

Expected: CI (`verify`) runs and goes green. Confirm before considering the slice done.

---

## Self-review

- **Spec coverage:** guarded `save` + `ConflictError` + `stat` (Task 1); baseline tracking, conflict state, reload/keep-mine/save-as-copy/discard resolvers, proactive refocus detection, beforeunload warning (Task 2); non-blocking banner + `id:updatedAt` editor key + `SaveState` `'conflict'` (Task 3); store-level tests (Task 1); manual smoke (Task 4). Deleted-on-disk handled via the banner's deleted variant. Out-of-scope items (hook/UI auto-tests, polling, merge UI, rename guarding) intentionally excluded. ✓
- **Placeholder scan:** every step has full code; the only conditional is the Task 3 Step 4 Alert-prop confirmation, which states the verified shape rather than hand-waving. ✓
- **Type/name consistency:** `ConflictError(id, diskUpdatedAt)`, `NoteConflict {id, diskUpdatedAt, deleted}`, `save(id, content, baseUpdatedAt) => NoteMeta`, `stat(id) => number | null`, and the resolver names `reloadDisk/keepMine/saveAsCopy/discard` are identical across Tasks 1–3 and the `ConflictBanner` props. `SaveState` includes `'conflict'` wherever it's used. ✓
