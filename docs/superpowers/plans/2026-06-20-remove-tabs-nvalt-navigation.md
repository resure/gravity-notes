# Remove Tabs + nvALT Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the multi-tab UI/data model (one note open at a time) and add a keyboard-first nvALT browse/edit flow — arrow to live-preview, Enter to edit, Esc to step back out (editor → list → close).

**Architecture:** Collapse `useNotes` back to the proven single-note model (`note`/`saveState`/`conflict` + one pending/baseline/timer ref), persisting the single open note as `metadata.active`. A new `useNoteNavigation` hook owns the list cursor, a 150 ms debounced preview, and the editor↔list↔search focus transitions. `EditorPane` focuses only on a _commit_ mount and reports an unhandled `Escape`; `NoteList` emits browse/commit/escape intents and exposes `focusSelected()`; `Workspace` wires them with one mounted editor. `TabBar` is deleted.

**Tech Stack:** React 18 + TypeScript (strict), Vite, Vitest + Testing Library + jsdom, Gravity UI (`@gravity-ui/uikit`, `@gravity-ui/markdown-editor`), File System Access API behind the `NoteStore` seam.

**Spec:** `docs/superpowers/specs/2026-06-20-remove-tabs-nvalt-navigation-design.md`

**Conventions:** 4-space indent + single quotes in source (`npm run lint:fix` enforces). Prettier reformats fenced code in `.md` to 2-space, so this plan's code blocks are 2-space — when you paste into `.ts`/`.tsx` files, run `npm run lint:fix` to convert. `void promise()` marks intentional unawaited promises. Errors surface through `onError` (toaster). Keep persistence behind `NoteStore`.

**Commit trailer (every commit):**

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## Task 1: Remove tabs → single-note pane

Collapse the storage metadata, `useNotes`, `EditorPane`, and `Workspace` from the per-tab model to a single open note, and delete `TabBar`. End state: a working single-note app — click a sidebar note to open+edit it, `Esc` closes it, the last note is restored on reload. No nvALT browsing yet (that is Task 3).

**Files:**

- Modify: `src/storage/types.ts` (the `NotesMetadata` interface)
- Modify: `src/storage/metadata.ts` (drop tab helpers; repurpose `active`)
- Modify: `src/storage/metadata.test.ts` (rewrite tab-transform tests)
- Modify: `src/hooks/useNotes.ts` (single-note rewrite)
- Modify: `src/hooks/useNotes.test.tsx` (single-note rewrite)
- Modify: `src/components/EditorPane.tsx` (`autofocus` prop + `onEscape` + `focus()` handle)
- Modify: `src/components/EditorPane.test.tsx`
- Modify: `src/components/Workspace.tsx` (single pane; `open`/`note`/`activeId`)
- Modify: `src/components/Workspace.test.tsx`
- Modify: `src/components/Workspace.css` (drop tab-pane rules; add `.editor-pane`)
- Delete: `src/components/TabBar.tsx`, `src/components/TabBar.css`, `src/components/TabBar.test.tsx`

- [ ] **Step 1: Update the `NotesMetadata` type — drop `open`, keep `active`**

In `src/storage/types.ts`, replace the two tab fields with a single `active`:

```ts
/** Per-folder notes metadata, persisted alongside the notes (not in any note body). */
export interface NotesMetadata {
  /** Schema version for forward-compatibility. */
  version: 1;
  /** Active sort mode. */
  sort: SortMode;
  /** Pinned note ids. Treated as a membership set; array order is not significant. */
  pinned: readonly string[];
  /** Note id → creation time (epoch ms), stamped on create. */
  created: Readonly<Record<string, number>>;
  /** The single open / last-open note id, or null when none is open. Restored on reload. */
  active: string | null;
}
```

(Remove the old `open: readonly string[]` field and the old `active` doc comment that referenced `open`.)

- [ ] **Step 2: Rewrite the metadata pure-layer tests (red)**

Replace the whole of `src/storage/metadata.test.ts` with the single-active version. Note the shared `base`/`meta` literals drop `open` and the import list drops `withClosed`/`withOpened`:

```ts
import {describe, expect, it} from 'vitest';

import {
  DEFAULT_METADATA,
  METADATA_FILENAME,
  orderNotes,
  parseMetadata,
  reconcile,
  withActive,
  withCreatedStamp,
  withPinToggled,
  withRemoved,
  withRenamed,
  withSortMode,
} from './metadata';
import type {NoteMeta} from './types';

const note = (id: string, title: string, updatedAt: number): NoteMeta => ({id, title, updatedAt});

describe('METADATA_FILENAME', () => {
  it('is a dotfile so list() (which filters to .md) ignores it', () => {
    expect(METADATA_FILENAME).toBe('.gravity-notes.json');
    expect(METADATA_FILENAME.endsWith('.md')).toBe(false);
  });
});

describe('parseMetadata', () => {
  it('returns defaults for non-objects', () => {
    expect(parseMetadata(null)).toEqual(DEFAULT_METADATA);
    expect(parseMetadata('nope')).toEqual(DEFAULT_METADATA);
    expect(parseMetadata(42)).toEqual(DEFAULT_METADATA);
  });

  it('returns defaults for an unrecognized version', () => {
    expect(parseMetadata({version: 2, sort: 'title', pinned: [], created: {}})).toEqual(
      DEFAULT_METADATA,
    );
  });

  it('keeps valid fields and coerces invalid ones', () => {
    const parsed = parseMetadata({
      version: 1,
      sort: 'title',
      pinned: ['A.md', 7, 'B.md'],
      created: {'A.md': 100, 'B.md': 'bad'},
    });
    expect(parsed.sort).toBe('title');
    expect(parsed.pinned).toEqual(['A.md', 'B.md']);
    expect(parsed.created).toEqual({'A.md': 100});
  });

  it('falls back to updated for an unknown sort', () => {
    expect(parseMetadata({version: 1, sort: 'sideways', pinned: [], created: {}}).sort).toBe(
      'updated',
    );
  });

  it('defaults active to null when absent', () => {
    const parsed = parseMetadata({version: 1, sort: 'updated', pinned: [], created: {}});
    expect(parsed.active).toBeNull();
  });

  it('keeps a valid active id and nulls a non-string one', () => {
    expect(
      parseMetadata({version: 1, sort: 'updated', pinned: [], created: {}, active: 'B.md'}).active,
    ).toBe('B.md');
    expect(
      parseMetadata({version: 1, sort: 'updated', pinned: [], created: {}, active: 7}).active,
    ).toBeNull();
  });

  it('does not share references with DEFAULT_METADATA', () => {
    const parsed = parseMetadata({});
    expect(parsed.pinned).not.toBe(DEFAULT_METADATA.pinned);
    expect(parsed.created).not.toBe(DEFAULT_METADATA.created);
  });
});

describe('immutable transforms', () => {
  const base = {
    version: 1,
    sort: 'updated',
    pinned: ['A.md'],
    created: {'A.md': 1},
    active: 'A.md',
  } as const;

  it('withSortMode sets the sort without mutating the input', () => {
    const next = withSortMode(base, 'created');
    expect(next.sort).toBe('created');
    expect(base.sort).toBe('updated');
  });

  it('withPinToggled adds then removes an id', () => {
    const added = withPinToggled(base, 'B.md');
    expect(added.pinned).toEqual(['A.md', 'B.md']);
    const removed = withPinToggled(added, 'A.md');
    expect(removed.pinned).toEqual(['B.md']);
  });

  it('withCreatedStamp records a time only when absent', () => {
    const stamped = withCreatedStamp(base, 'B.md', 200);
    expect(stamped.created).toEqual({'A.md': 1, 'B.md': 200});
    const unchanged = withCreatedStamp(stamped, 'B.md', 999);
    expect(unchanged.created['B.md']).toBe(200);
  });
});

describe('active transforms', () => {
  const base = {
    version: 1,
    sort: 'updated',
    pinned: [],
    created: {},
    active: 'A.md',
  } as const;

  it('withActive sets the active id', () => {
    expect(withActive(base, 'B.md').active).toBe('B.md');
  });

  it('withActive(null) clears the active id', () => {
    expect(withActive(base, null).active).toBeNull();
  });

  it('withRenamed remaps the active id', () => {
    const next = withRenamed(base, 'A.md', 'A2.md');
    expect(next.active).toBe('A2.md');
  });

  it('withRenamed leaves a non-active id alone', () => {
    const next = withRenamed({...base, active: 'B.md'}, 'A.md', 'A2.md');
    expect(next.active).toBe('B.md');
  });

  it('withRemoved clears active when the removed id was active', () => {
    expect(withRemoved(base, 'A.md').active).toBeNull();
  });

  it('withRemoved keeps active when removing a different id', () => {
    expect(withRemoved(base, 'Z.md').active).toBe('A.md');
  });
});

describe('reconcile', () => {
  it('drops pinned/created entries for ids that are not live and clears a dead active', () => {
    const meta = {
      version: 1,
      sort: 'updated',
      pinned: ['A.md', 'ghost.md'],
      created: {'A.md': 1, 'ghost.md': 2},
      active: 'ghost.md',
    } as const;
    const next = reconcile(meta, ['A.md', 'B.md']);
    expect(next.pinned).toEqual(['A.md']);
    expect(next.created).toEqual({'A.md': 1});
    expect(next.active).toBeNull();
  });

  it('keeps a live active id', () => {
    const meta = {version: 1, sort: 'updated', pinned: [], created: {}, active: 'A.md'} as const;
    expect(reconcile(meta, ['A.md']).active).toBe('A.md');
  });
});

describe('orderNotes', () => {
  const notes = [
    note('B.md', 'Beta', 300),
    note('A.md', 'Alpha', 100),
    note('C.md', 'Charlie', 200),
  ];

  it('sorts by updated (newest first) by default', () => {
    expect(orderNotes(notes, {...DEFAULT_METADATA}).map((n) => n.id)).toEqual([
      'B.md',
      'C.md',
      'A.md',
    ]);
  });

  it('sorts by title A→Z', () => {
    const meta = {...DEFAULT_METADATA, sort: 'title' as const};
    expect(orderNotes(notes, meta).map((n) => n.title)).toEqual(['Alpha', 'Beta', 'Charlie']);
  });

  it('sorts by created (newest first), falling back to updatedAt when unstamped', () => {
    const meta = {...DEFAULT_METADATA, sort: 'created' as const, created: {'A.md': 999}};
    expect(orderNotes(notes, meta).map((n) => n.id)).toEqual(['A.md', 'B.md', 'C.md']);
  });

  it('keeps pinned notes on top, each group sorted by the active sort', () => {
    const meta = {...DEFAULT_METADATA, sort: 'title' as const, pinned: ['C.md']};
    expect(orderNotes(notes, meta).map((n) => n.id)).toEqual(['C.md', 'A.md', 'B.md']);
  });

  it('does not mutate the input array', () => {
    const input = [...notes];
    orderNotes(input, {...DEFAULT_METADATA, sort: 'title'});
    expect(input.map((n) => n.id)).toEqual(['B.md', 'A.md', 'C.md']);
  });
});
```

- [ ] **Step 3: Run the metadata tests to confirm they fail**

Run: `npx vitest run src/storage/metadata.test.ts`
Expected: FAIL — `withClosed`/`withOpened` no longer imported; `withActive(base, null)`/`withRemoved` active behavior not yet implemented; type errors on `active`.

- [ ] **Step 4: Rewrite `src/storage/metadata.ts` for the single active note**

Replace the file's top constants and the affected helpers. Full new file:

```ts
import type {NoteMeta, NotesMetadata, SortMode} from './types';

/** Sidecar file holding the folder's notes metadata. Not a `.md` file, so `list()` ignores it. */
export const METADATA_FILENAME = '.gravity-notes.json';

/** The metadata for a folder with no pins, no stamps, the default sort, and nothing open. */
export const DEFAULT_METADATA: NotesMetadata = {
  version: 1,
  sort: 'updated',
  pinned: [],
  created: {},
  active: null,
};

const SORT_MODES: readonly SortMode[] = ['updated', 'title', 'created'];

/** Tolerant parse: coerce anything unexpected to defaults; never throws. */
export function parseMetadata(raw: unknown): NotesMetadata {
  if (typeof raw !== 'object' || raw === null) return cloneDefault();
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return cloneDefault();

  const sort = SORT_MODES.includes(obj.sort as SortMode) ? (obj.sort as SortMode) : 'updated';
  const pinned = Array.isArray(obj.pinned)
    ? obj.pinned.filter((x): x is string => typeof x === 'string')
    : [];
  const created: Record<string, number> = {};
  if (typeof obj.created === 'object' && obj.created !== null) {
    for (const [id, value] of Object.entries(obj.created as Record<string, unknown>)) {
      if (typeof value === 'number') created[id] = value;
    }
  }
  const active = typeof obj.active === 'string' ? obj.active : null;
  return {version: 1, sort, pinned, created, active};
}

function cloneDefault(): NotesMetadata {
  return {version: 1, sort: 'updated', pinned: [], created: {}, active: null};
}

export function withSortMode(meta: NotesMetadata, sort: SortMode): NotesMetadata {
  return {...meta, sort};
}

export function withPinToggled(meta: NotesMetadata, id: string): NotesMetadata {
  const pinned = meta.pinned.includes(id)
    ? meta.pinned.filter((p) => p !== id)
    : [...meta.pinned, id];
  return {...meta, pinned};
}

/** Set the single open note (pass `null` to close). */
export function withActive(meta: NotesMetadata, id: string | null): NotesMetadata {
  return {...meta, active: id};
}

export function withCreatedStamp(meta: NotesMetadata, id: string, created: number): NotesMetadata {
  if (meta.created[id] !== undefined) return meta;
  return {...meta, created: {...meta.created, [id]: created}};
}

export function withRenamed(meta: NotesMetadata, oldId: string, newId: string): NotesMetadata {
  if (oldId === newId) return meta;
  const pinned = meta.pinned.map((p) => (p === oldId ? newId : p));
  const created = {...meta.created};
  if (oldId in created) {
    created[newId] = created[oldId];
    delete created[oldId];
  }
  const active = meta.active === oldId ? newId : meta.active;
  return {...meta, pinned, created, active};
}

export function withRemoved(meta: NotesMetadata, id: string): NotesMetadata {
  const created = {...meta.created};
  delete created[id];
  return {
    ...meta,
    pinned: meta.pinned.filter((p) => p !== id),
    created,
    active: meta.active === id ? null : meta.active,
  };
}

/** Drop pinned/created entries whose id is no longer a live file; null a dead active. Self-heals external deletes. */
export function reconcile(meta: NotesMetadata, liveIds: string[]): NotesMetadata {
  const live = new Set(liveIds);
  const created: Record<string, number> = {};
  for (const [id, time] of Object.entries(meta.created)) {
    if (live.has(id)) created[id] = time;
  }
  const active = meta.active && live.has(meta.active) ? meta.active : null;
  return {...meta, pinned: meta.pinned.filter((id) => live.has(id)), created, active};
}

/** Pure ordering: pinned notes first, each group sorted by the active sort. Does not mutate input. */
export function orderNotes(notes: NoteMeta[], meta: NotesMetadata): NoteMeta[] {
  const pinnedSet = new Set(meta.pinned);
  const compare = comparatorFor(meta.sort, meta.created);
  const pinned = notes.filter((n) => pinnedSet.has(n.id)).sort(compare);
  const rest = notes.filter((n) => !pinnedSet.has(n.id)).sort(compare);
  return [...pinned, ...rest];
}

function comparatorFor(sort: SortMode, created: Readonly<Record<string, number>>) {
  switch (sort) {
    case 'title':
      return (a: NoteMeta, b: NoteMeta) => a.title.localeCompare(b.title);
    case 'created':
      return (a: NoteMeta, b: NoteMeta) => createdOf(b, created) - createdOf(a, created);
    case 'updated':
    default:
      return (a: NoteMeta, b: NoteMeta) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  }
}

function createdOf(note: NoteMeta, created: Readonly<Record<string, number>>): number {
  return created[note.id] ?? note.updatedAt ?? 0;
}
```

- [ ] **Step 5: Run the metadata tests to confirm they pass**

Run: `npx vitest run src/storage/metadata.test.ts`
Expected: PASS (all describes green).

- [ ] **Step 6: Rewrite the `useNotes` tests for the single-note model (red)**

Replace the whole of `src/hooks/useNotes.test.tsx`:

```tsx
import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {FakeDirectoryHandle, asDirectoryHandle} from '../storage/fakeFileSystem';
import {FileSystemNoteStore} from '../storage/fileSystemStore';
import {METADATA_FILENAME} from '../storage/metadata';

import {useNotes} from './useNotes';

beforeEach(() => {
  // The refocus detector early-returns unless the document reports "visible".
  Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'});
});

async function setup(seed?: (dir: FakeDirectoryHandle) => void) {
  const onError = vi.fn();
  const dir = new FakeDirectoryHandle();
  seed?.(dir);
  const store = new FileSystemNoteStore(asDirectoryHandle(dir));
  const hook = renderHook(() => useNotes(store, onError));
  await waitFor(() => expect(hook.result.current.notes).toBeDefined());
  return {hook, dir, store, onError};
}

describe('useNotes — single note', () => {
  it('opens a note as the active note and persists it', async () => {
    const {hook, store} = await setup((dir) => dir.seedFile('A.md', 'a', 100));
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
    await act(async () => {
      await hook.result.current.open('A.md');
    });
    expect(hook.result.current.activeId).toBe('A.md');
    expect(hook.result.current.note?.content).toBe('a');
    await waitFor(async () => expect((await store.readMetadata()).active).toBe('A.md'));
  });

  it('opening another note flushes the outgoing pending edit', async () => {
    const {hook, store} = await setup((dir) => {
      dir.seedFile('A.md', 'a', 100);
      dir.seedFile('B.md', 'b', 200);
    });
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
    await act(async () => {
      await hook.result.current.open('A.md');
    });
    act(() => {
      hook.result.current.edit('edited a');
    });
    // Switch before the 500 ms autosave timer fires; the switch must flush A first.
    await act(async () => {
      await hook.result.current.open('B.md');
    });
    expect(hook.result.current.activeId).toBe('B.md');
    expect((await store.get('A.md')).content).toBe('edited a');
  });

  it('autosaves the open note on hide', async () => {
    const {hook, store} = await setup((dir) => dir.seedFile('A.md', 'a', 100));
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
    await act(async () => {
      await hook.result.current.open('A.md');
    });
    act(() => {
      hook.result.current.edit('edited a');
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(async () => expect((await store.get('A.md')).content).toBe('edited a'));
  });

  it('creating a note opens it as the active note', async () => {
    const {hook, store} = await setup();
    await act(async () => {
      await hook.result.current.create();
    });
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
    const id = hook.result.current.notes[0].id;
    expect(hook.result.current.activeId).toBe(id);
    await waitFor(async () => expect((await store.readMetadata()).active).toBe(id));
  });

  it('restores the active note on remount', async () => {
    const onError = vi.fn();
    const dir = new FakeDirectoryHandle();
    dir.seedFile('A.md', 'a', 100);
    dir.seedFile('B.md', 'b', 200);
    const store = new FileSystemNoteStore(asDirectoryHandle(dir));
    const first = renderHook(() => useNotes(store, onError));
    await waitFor(() => expect(first.result.current.notes).toHaveLength(2));
    await act(async () => {
      await first.result.current.open('B.md');
    });
    await waitFor(async () => expect((await store.readMetadata()).active).toBe('B.md'));

    const second = renderHook(() => useNotes(store, onError));
    await waitFor(() => expect(second.result.current.activeId).toBe('B.md'));
    expect(second.result.current.note?.content).toBe('b');
  });

  it('clears a restored active id whose file no longer exists', async () => {
    const onError = vi.fn();
    const dir = new FakeDirectoryHandle();
    dir.seedFile('A.md', 'a', 100);
    dir.seedFile(
      METADATA_FILENAME,
      JSON.stringify({version: 1, sort: 'updated', pinned: [], created: {}, active: 'Ghost.md'}),
    );
    const store = new FileSystemNoteStore(asDirectoryHandle(dir));
    const hook = renderHook(() => useNotes(store, onError));
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
    expect(hook.result.current.activeId).toBeNull();
    expect(hook.result.current.note).toBeNull();
  });

  it('closing clears the active note', async () => {
    const {hook, store} = await setup((dir) => dir.seedFile('A.md', 'a', 100));
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
    await act(async () => {
      await hook.result.current.open('A.md');
    });
    await act(async () => {
      await hook.result.current.close();
    });
    expect(hook.result.current.activeId).toBeNull();
    expect(hook.result.current.note).toBeNull();
    await waitFor(async () => expect((await store.readMetadata()).active).toBeNull());
  });

  it('renames the active note in place', async () => {
    const {hook, store} = await setup((dir) => dir.seedFile('Old.md', 'x', 100));
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
    await act(async () => {
      await hook.result.current.open('Old.md');
    });
    await act(async () => {
      await hook.result.current.rename('Old.md', 'New');
    });
    expect(hook.result.current.activeId).toBe('New.md');
    expect(hook.result.current.note?.content).toBe('x');
    await waitFor(async () => expect((await store.readMetadata()).active).toBe('New.md'));
  });

  it('removing the active note clears it', async () => {
    const {hook} = await setup((dir) => dir.seedFile('A.md', 'a', 100));
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
    await act(async () => {
      await hook.result.current.open('A.md');
    });
    await act(async () => {
      await hook.result.current.remove('A.md');
    });
    expect(hook.result.current.activeId).toBeNull();
    expect(hook.result.current.note).toBeNull();
  });
});

async function setupConflict() {
  const onError = vi.fn();
  const dir = new FakeDirectoryHandle();
  dir.seedFile('Note.md', 'disk v1', 100);
  const store = new FileSystemNoteStore(asDirectoryHandle(dir));
  const hook = renderHook(() => useNotes(store, onError));
  await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
  await act(async () => {
    await hook.result.current.open('Note.md');
  });
  await waitFor(() => expect(hook.result.current.activeId).toBe('Note.md'));
  // An external edit bumps the mtime past the baseline (100).
  dir.seedFile('Note.md', 'disk v2', 200);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(hook.result.current.conflict).toBeTruthy());
  return {hook, dir, store, onError};
}

describe('useNotes — conflict resolvers', () => {
  it('detects an external change on refocus', async () => {
    const {hook} = await setupConflict();
    expect(hook.result.current.conflict).toMatchObject({id: 'Note.md', deleted: false});
    expect(hook.result.current.saveState).toBe('conflict');
  });

  it('reloadDisk loads the disk version and clears the conflict', async () => {
    const {hook} = await setupConflict();
    await act(async () => {
      await hook.result.current.reloadDisk();
    });
    expect(hook.result.current.conflict).toBeNull();
    expect(hook.result.current.note?.content).toBe('disk v2');
  });

  it('keepMine overwrites disk with the local edits', async () => {
    const {hook, store} = await setupConflict();
    act(() => {
      hook.result.current.edit('my edits');
    });
    await act(async () => {
      await hook.result.current.keepMine();
    });
    expect(hook.result.current.conflict).toBeNull();
    expect((await store.get('Note.md')).content).toBe('my edits');
  });

  it('saveAsCopy writes a copy and leaves the original on disk', async () => {
    const {hook, store} = await setupConflict();
    act(() => {
      hook.result.current.edit('my edits');
    });
    await act(async () => {
      await hook.result.current.saveAsCopy();
    });
    expect(hook.result.current.conflict).toBeNull();
    expect(hook.result.current.activeId).toBe('Note (conflicted copy).md');
    expect((await store.get('Note (conflicted copy).md')).content).toBe('my edits');
    expect((await store.get('Note.md')).content).toBe('disk v2');
  });

  it('discard clears the conflict and closes the note', async () => {
    const {hook} = await setupConflict();
    act(() => {
      hook.result.current.discard();
    });
    await waitFor(() => expect(hook.result.current.activeId).toBeNull());
    expect(hook.result.current.conflict).toBeNull();
  });
});
```

- [ ] **Step 7: Run the `useNotes` tests to confirm they fail**

Run: `npx vitest run src/hooks/useNotes.test.tsx`
Expected: FAIL — `useNotes` still exposes the tab API (`openIds`/`open(id)` semantics, `edit(id, content)`, `conflicts` map).

- [ ] **Step 8: Rewrite `src/hooks/useNotes.ts` to the single-note model**

Full new file:

```ts
import {useCallback, useEffect, useRef, useState} from 'react';

import {
  DEFAULT_METADATA,
  reconcile,
  withActive,
  withCreatedStamp,
  withPinToggled,
  withRemoved,
  withRenamed,
  withSortMode,
} from '../storage/metadata';
import {
  ConflictError,
  type Note,
  type NoteMeta,
  type NoteStore,
  type NotesMetadata,
  type SortMode,
} from '../storage/types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

const AUTOSAVE_DELAY = 500;

/** A detected external change to the open note. */
export interface NoteConflict {
  id: string;
  /** On-disk `lastModified` at detection (0 when the file was deleted). */
  diskUpdatedAt: number;
  /** True when the file was deleted on disk rather than modified. */
  deleted: boolean;
}

export interface UseNotes {
  notes: NoteMeta[];
  /** Folder metadata: active sort, pinned ids, created stamps, the open note. */
  metadata: NotesMetadata;
  setSortMode(sort: SortMode): void;
  togglePin(id: string): void;
  /** The single open note's id (mirrors `metadata.active`), or null. */
  activeId: string | null;
  /** Full content of the open note (the editor's initial markup), or null. */
  note: Note | null;
  saveState: SaveState;
  /** Set when the open note changed on disk underneath us; null otherwise. */
  conflict: NoteConflict | null;
  /** Load a note into the single editor pane and make it active (persisted). Flushes the outgoing note first. */
  open(id: string): Promise<void>;
  /** Close the open note (placeholder). */
  close(): Promise<void>;
  /** Create a new empty note, open it, and return its id (null on failure). */
  create(): Promise<string | null>;
  rename(id: string, nextTitle: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Queue a debounced autosave for the open note. */
  edit(content: string): void;
  /** Conflict resolvers (act on the open note). */
  reloadDisk(): Promise<void>;
  keepMine(): Promise<void>;
  saveAsCopy(): Promise<void>;
  discard(): void;
}

/**
 * Owns the note list, the single open note (`metadata.active`), and debounced
 * autosave for a given `NoteStore`. Editing is decoupled from React state: keystrokes
 * flow into a ref + timer (not `setState`), so the editor is never re-created mid-typing.
 * Switching notes (`open`) flushes the outgoing note's pending edit first.
 */
export function useNotes(store: NoteStore, onError: (message: string) => void): UseNotes {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [conflict, setConflict] = useState<NoteConflict | null>(null);
  const [metadata, setMetadata] = useState<NotesMetadata>(DEFAULT_METADATA);
  const metadataRef = useRef<NotesMetadata>(DEFAULT_METADATA);

  const applyMetadata = useCallback((next: NotesMetadata) => {
    metadataRef.current = next;
    setMetadata(next);
  }, []);

  const persistMetadata = useCallback(
    async (next: NotesMetadata) => {
      applyMetadata(next);
      try {
        await store.writeMetadata(next);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to save notes metadata');
      }
    },
    [applyMetadata, store, onError],
  );

  const setSortMode = useCallback(
    (sort: SortMode) => void persistMetadata(withSortMode(metadataRef.current, sort)),
    [persistMetadata],
  );
  const togglePin = useCallback(
    (id: string) => void persistMetadata(withPinToggled(metadataRef.current, id)),
    [persistMetadata],
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest unsaved edit, tagged with the note it belongs to. */
  const pendingRef = useRef<{id: string; content: string} | null>(null);
  /** Last on-disk `lastModified` we've seen for the open note. */
  const baselineRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const list = await store.list();
    setNotes(list);
    applyMetadata(
      reconcile(
        metadataRef.current,
        list.map((n) => n.id),
      ),
    );
  }, [store, applyMetadata]);

  const bumpInList = useCallback((id: string, updatedAt: number | undefined) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? {...n, updatedAt} : n)));
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(async () => {
    clearTimer();
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
  }, [store, onError, bumpInList, clearTimer]);

  const open = useCallback(
    async (id: string) => {
      await flush();
      try {
        const loaded = await store.get(id);
        baselineRef.current = loaded.updatedAt ?? null;
        setNote(loaded);
        setConflict(null);
        setSaveState('idle');
        await persistMetadata(withActive(metadataRef.current, id));
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to open note');
      }
    },
    [flush, store, persistMetadata, onError],
  );

  const close = useCallback(async () => {
    await flush();
    pendingRef.current = null;
    clearTimer();
    setNote(null);
    setConflict(null);
    setSaveState('idle');
    await persistMetadata(withActive(metadataRef.current, null));
  }, [flush, clearTimer, persistMetadata]);

  const create = useCallback(async (): Promise<string | null> => {
    await flush();
    try {
      const meta = await store.create('Untitled');
      await persistMetadata(withCreatedStamp(metadataRef.current, meta.id, meta.updatedAt ?? 0));
      await refresh();
      await open(meta.id);
      return meta.id;
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create note');
      return null;
    }
  }, [flush, store, persistMetadata, refresh, open, onError]);

  const rename = useCallback(
    async (id: string, nextTitle: string) => {
      if (conflict?.id === id) {
        onError('Resolve the conflict before renaming this note.');
        return;
      }
      await flush();
      try {
        const meta = await store.rename(id, nextTitle);
        const wasActive = metadataRef.current.active === id;
        if (meta.id !== id) {
          await persistMetadata(withRenamed(metadataRef.current, id, meta.id));
          if (pendingRef.current?.id === id) pendingRef.current = null;
        }
        await refresh();
        if (wasActive && meta.id !== id) {
          // Reload under the new id so the editor remounts cleanly (new key).
          const reloaded = await store.get(meta.id);
          baselineRef.current = reloaded.updatedAt ?? null;
          setNote(reloaded);
          setConflict(null);
          setSaveState('idle');
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to rename note');
      }
    },
    [conflict, flush, store, persistMetadata, refresh, onError],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await store.remove(id);
        if (pendingRef.current?.id === id) pendingRef.current = null;
        const wasActive = metadataRef.current.active === id;
        await persistMetadata(withRemoved(metadataRef.current, id));
        if (wasActive) {
          clearTimer();
          setNote(null);
          setConflict(null);
          setSaveState('idle');
        }
        await refresh();
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to delete note');
      }
    },
    [store, persistMetadata, refresh, clearTimer, onError],
  );

  const edit = useCallback(
    (content: string) => {
      const id = metadataRef.current.active;
      if (!id) return;
      pendingRef.current = {id, content};
      if (conflict) return; // autosave is paused until the conflict is resolved
      setSaveState('saving');
      clearTimer();
      timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DELAY);
    },
    [conflict, flush, clearTimer],
  );

  const reloadDisk = useCallback(async () => {
    const id = conflict?.id;
    if (!id) return;
    clearTimer();
    pendingRef.current = null;
    try {
      const loaded = await store.get(id);
      baselineRef.current = loaded.updatedAt ?? null;
      setNote(loaded); // new updatedAt remounts the editor with disk content
      setConflict(null);
      setSaveState('idle');
      bumpInList(id, loaded.updatedAt);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to reload note');
    }
  }, [conflict, store, onError, bumpInList, clearTimer]);

  const keepMine = useCallback(async () => {
    if (!conflict || conflict.deleted) return;
    const content = pendingRef.current?.content ?? note?.content ?? '';
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
  }, [conflict, note, store, onError, bumpInList]);

  const saveAsCopy = useCallback(async () => {
    if (!conflict) return;
    const content = pendingRef.current?.content ?? note?.content ?? '';
    const title = note?.title ?? 'Note';
    pendingRef.current = null;
    try {
      const copy = await store.create(`${title} (conflicted copy)`);
      await store.save(copy.id, content, copy.updatedAt ?? 0);
      await persistMetadata(withCreatedStamp(metadataRef.current, copy.id, copy.updatedAt ?? 0));
      setConflict(null);
      await refresh();
      await open(copy.id);
    } catch (err) {
      pendingRef.current = {id: conflict.id, content};
      onError(err instanceof Error ? err.message : 'Failed to save a copy');
    }
  }, [conflict, note, store, refresh, open, persistMetadata, onError]);

  const discard = useCallback(() => {
    pendingRef.current = null;
    clearTimer();
    setConflict(null);
    setNote(null);
    setSaveState('idle');
    void persistMetadata(withActive(metadataRef.current, null));
    void refresh();
  }, [clearTimer, persistMetadata, refresh]);

  // Initial load: notes + metadata, reconcile, then restore the open note (if any).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [list, raw] = await Promise.all([store.list(), store.readMetadata()]);
      if (cancelled) return;
      const meta = reconcile(
        raw,
        list.map((n) => n.id),
      );
      let loaded: Note | null = null;
      if (meta.active) {
        try {
          loaded = await store.get(meta.active);
        } catch {
          loaded = null;
        }
      }
      if (cancelled) return;
      const reconciled: NotesMetadata = loaded ? meta : {...meta, active: null};
      setNotes(list);
      applyMetadata(reconciled);
      if (loaded) {
        baselineRef.current = loaded.updatedAt ?? null;
        setNote(loaded);
      }
      if (reconciled.active !== meta.active) {
        void store.writeMetadata(reconciled); // heal the dotfile if active vanished
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, applyMetadata]);

  // Clear any pending autosave timer when the hook unmounts.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Best-effort save when hidden; warn before unload if edits are unsaved.
  useEffect(() => {
    const onHide = () => void flush();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      void flush();
      if (pendingRef.current || conflict) {
        event.preventDefault();
        // eslint-disable-next-line no-param-reassign -- standard beforeunload idiom to trigger the browser's unsaved-changes prompt
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

  // Detect an external change to the open note when returning to the tab/window.
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const id = metadataRef.current.active;
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
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [conflict, store]);

  return {
    notes,
    metadata,
    setSortMode,
    togglePin,
    activeId: metadata.active,
    note,
    saveState,
    conflict,
    open,
    close,
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

- [ ] **Step 9: Run the `useNotes` tests to confirm they pass**

Run: `npx vitest run src/hooks/useNotes.test.tsx`
Expected: PASS (both describes green).

- [ ] **Step 10: Commit the storage + hook collapse**

```bash
git add src/storage/types.ts src/storage/metadata.ts src/storage/metadata.test.ts src/hooks/useNotes.ts src/hooks/useNotes.test.tsx
git commit -m "$(cat <<'EOF'
refactor(notes): collapse storage + useNotes to a single open note

Drop metadata.open[] and the tab helpers; repurpose metadata.active as the
single open/last-open note (restored on reload). useNotes returns one
note/saveState/conflict with flush-before-switch preserved.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

(The app does not type-check yet — `Workspace`/`EditorPane`/`TabBar` still use the tab API. The next steps fix that before any whole-suite gate.)

- [ ] **Step 11: Update the `EditorPane` tests for the commit-focus + escape model (red)**

Replace the whole of `src/components/EditorPane.test.tsx`:

```tsx
import {createRef} from 'react';

import {fireEvent, render} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {fakeEditor, setEditorMode, focus} = vi.hoisted(() => {
  const setEditorMode = vi.fn();
  const focus = vi.fn();
  return {
    setEditorMode,
    focus,
    fakeEditor: {
      currentMode: 'wysiwyg' as 'wysiwyg' | 'markup',
      setEditorMode,
      focus,
      getValue: () => '',
      on: () => {},
      off: () => {},
    },
  };
});

vi.mock('@gravity-ui/markdown-editor', () => ({
  useMarkdownEditor: () => fakeEditor,
  MarkdownEditorView: () => null,
}));

import {EditorPane, type EditorPaneHandle} from './EditorPane';

const NOTE = {id: 'a.md', title: 'a', content: 'hello', updatedAt: 1};

describe('EditorPane — toggleMode', () => {
  beforeEach(() => {
    fakeEditor.currentMode = 'wysiwyg';
    setEditorMode.mockClear();
  });

  it('switches to markup when currently in wysiwyg', () => {
    const ref = createRef<EditorPaneHandle>();
    render(
      <EditorPane
        ref={ref}
        note={NOTE}
        autofocus={false}
        onChange={() => {}}
        onEscape={() => {}}
      />,
    );
    ref.current?.toggleMode();
    expect(setEditorMode).toHaveBeenCalledWith('markup');
  });
});

describe('EditorPane — focus', () => {
  beforeEach(() => focus.mockClear());

  it('focuses on mount when autofocus is true (a commit open)', () => {
    render(<EditorPane note={NOTE} autofocus={true} onChange={() => {}} onEscape={() => {}} />);
    expect(focus).toHaveBeenCalled();
  });

  it('does not focus on mount when autofocus is false (a preview open)', () => {
    render(<EditorPane note={NOTE} autofocus={false} onChange={() => {}} onEscape={() => {}} />);
    expect(focus).not.toHaveBeenCalled();
  });

  it('focuses via the imperative handle', () => {
    const ref = createRef<EditorPaneHandle>();
    render(
      <EditorPane
        ref={ref}
        note={NOTE}
        autofocus={false}
        onChange={() => {}}
        onEscape={() => {}}
      />,
    );
    expect(focus).not.toHaveBeenCalled();
    ref.current?.focus();
    expect(focus).toHaveBeenCalledTimes(1);
  });
});

describe('EditorPane — escape', () => {
  it('fires onEscape when Escape bubbles out of the editor', () => {
    const onEscape = vi.fn();
    const {container} = render(
      <EditorPane note={NOTE} autofocus={false} onChange={() => {}} onEscape={onEscape} />,
    );
    fireEvent.keyDown(container.querySelector('.editor-pane')!, {key: 'Escape'});
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 12: Run the `EditorPane` tests to confirm they fail**

Run: `npx vitest run src/components/EditorPane.test.tsx`
Expected: FAIL — `EditorPane` still takes `active` (not `autofocus`/`onEscape`); no `.editor-pane` wrapper; no `focus()` on the handle.

- [ ] **Step 13: Rewrite `src/components/EditorPane.tsx`**

```tsx
import {forwardRef, useEffect, useImperativeHandle} from 'react';

import {MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';

import type {Note} from '../storage/types';

export interface EditorPaneHandle {
  /** Flip between the WYSIWYG and Markup editing modes. */
  toggleMode(): void;
  /** Move keyboard focus into the editor. */
  focus(): void;
}

interface EditorPaneProps {
  note: Note;
  /** Focus the editor on (re)mount — true only when opened to edit (a "commit"); false for a browse preview. */
  autofocus: boolean;
  onChange: (markup: string) => void;
  /** Fired when an otherwise-unhandled Escape bubbles out of the editor (exit to the list). */
  onEscape: () => void;
}

/**
 * Wraps the Gravity markdown editor for the single open note. The editor instance is
 * re-created whenever the note id changes (via the `deps` argument), loading that note's
 * markup. It focuses on (re)mount only when `autofocus` is set (a commit open); a browse
 * preview mounts unfocused, leaving focus on the note list. Same-note commits focus via
 * the `focus()` handle. An Escape that the editor itself does not consume bubbles to the
 * wrapper and calls `onEscape`.
 */
export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane(
  {note, autofocus, onChange, onEscape},
  ref,
) {
  const editor = useMarkdownEditor(
    {
      md: {html: false},
      initial: {markup: note.content, mode: 'wysiwyg'},
    },
    [note.id],
  );

  useImperativeHandle(
    ref,
    () => ({
      toggleMode() {
        editor.setEditorMode(editor.currentMode === 'wysiwyg' ? 'markup' : 'wysiwyg');
      },
      focus() {
        editor.focus();
      },
    }),
    [editor],
  );

  useEffect(() => {
    const handleChange = () => {
      const value = editor.getValue();
      // Ignore the no-op change emitted while the initial markup loads, so we don't
      // rewrite the file (and bump it to the top of the list) on open.
      if (value !== note.content) {
        onChange(value);
      }
    };
    editor.on('change', handleChange);
    return () => {
      editor.off('change', handleChange);
    };
  }, [editor, note.content, onChange]);

  // Focus only on (re)mount when this open was a commit. `editor` changes per note id.
  useEffect(() => {
    if (autofocus) editor.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus only on (re)mount; same-note commits use the focus() handle
  }, [editor]);

  return (
    <div
      className="editor-pane"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onEscape();
      }}
    >
      <MarkdownEditorView stickyToolbar autofocus={autofocus} editor={editor} />
    </div>
  );
});
```

- [ ] **Step 14: Run the `EditorPane` tests to confirm they pass**

Run: `npx vitest run src/components/EditorPane.test.tsx`
Expected: PASS.

- [ ] **Step 15: Update `src/components/Workspace.css` — drop tab-pane rules, add `.editor-pane`**

Remove the `.workspace__pane` and `.workspace__pane[hidden]` rules. Change `.workspace__panes` to drop `position: relative` (no overlay stack now). Add an `.editor-pane` rule. The relevant section becomes:

```css
.workspace__panes {
  flex: 1;
  min-height: 0;
}

.editor-pane {
  height: 100%;
}
```

(Leave `.workspace__placeholder` and `.workspace__conflict` as they are.)

- [ ] **Step 16: Rewrite the `Workspace` tests for the single-note pane (red)**

Replace the whole of `src/components/Workspace.test.tsx`:

```tsx
import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@gravity-ui/markdown-editor', () => ({
  useMarkdownEditor: () => ({
    currentMode: 'wysiwyg',
    setEditorMode: vi.fn(),
    focus: vi.fn(),
    getValue: () => '',
    on: () => {},
    off: () => {},
  }),
  MarkdownEditorView: () => null,
}));

import {FakeDirectoryHandle, asDirectoryHandle} from '../storage/fakeFileSystem';
import {renderWithProviders} from '../test/render';

import {Workspace} from './Workspace';

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'});
});

function renderWorkspace() {
  const dir = new FakeDirectoryHandle();
  dir.seedFile('Alpha.md', 'a', 100);
  dir.seedFile('Beta.md', 'b', 200);
  renderWithProviders(
    <Workspace
      dir={asDirectoryHandle(dir)}
      folderName="notes"
      theme="light"
      onToggleTheme={vi.fn()}
      onChangeFolder={vi.fn()}
    />,
  );
  return {dir};
}

describe('Workspace — single note', () => {
  it('shows the placeholder until a note is opened', async () => {
    renderWorkspace();
    await screen.findByRole('option', {name: /Alpha/});
    expect(screen.getByText(/Select a note/)).toBeInTheDocument();
  });

  it('opens a sidebar note into the editor with no tab strip', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('option', {name: /Alpha/});
    await user.click(screen.getByRole('option', {name: /Alpha/}));
    await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 17: Run the `Workspace` tests to confirm they fail**

Run: `npx vitest run src/components/Workspace.test.tsx`
Expected: FAIL — `Workspace` still renders `TabBar` and uses the tab API.

- [ ] **Step 18: Rewrite `src/components/Workspace.tsx` for the single-note pane**

Full new file (sidebar `onSelect` opens the one note; editor passes `autofocus` always-on and `onEscape` = close — Task 3 swaps these for the nav hook):

```tsx
import {useCallback, useMemo, useRef, useState} from 'react';

import {CircleQuestion, Folder, Moon, Sun} from '@gravity-ui/icons';
import {Button, Icon, Label, Text, type Theme, useToaster} from '@gravity-ui/uikit';

import {useNoteSearch} from '../hooks/useNoteSearch';
import {type SaveState, useNotes} from '../hooks/useNotes';
import {useShortcuts} from '../hooks/useShortcuts';
import {FileSystemNoteStore} from '../storage/fileSystemStore';
import {orderNotes} from '../storage/metadata';

import {ConflictBanner} from './ConflictBanner';
import {EditorPane, type EditorPaneHandle} from './EditorPane';
import {NoteList} from './NoteList';
import {ShortcutsDialog} from './ShortcutsDialog';

import './Workspace.css';

interface WorkspaceProps {
  dir: FileSystemDirectoryHandle;
  folderName: string | null;
  theme: Theme;
  onToggleTheme: () => void;
  onChangeFolder: () => void;
}

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
  conflict: 'Changed on disk',
};

export function Workspace({dir, folderName, theme, onToggleTheme, onChangeFolder}: WorkspaceProps) {
  const store = useMemo(() => new FileSystemNoteStore(dir), [dir]);
  const {add} = useToaster();

  const onError = useCallback(
    (message: string) => {
      add({
        name: `notes-error-${Date.now()}`,
        title: 'Something went wrong',
        content: message,
        theme: 'danger',
        autoHiding: 5000,
      });
    },
    [add],
  );

  const notes = useNotes(store, onError);
  const orderedNotes = useMemo(
    () => orderNotes(notes.notes, notes.metadata),
    [notes.notes, notes.metadata],
  );
  const {query, setQuery, filteredNotes} = useNoteSearch(orderedNotes);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<EditorPaneHandle>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useShortcuts({
    focusSearch: () => searchInputRef.current?.focus(),
    createNote: () => void notes.create(),
    toggleEditorMode: () => editorRef.current?.toggleMode(),
    openHelp: () => setHelpOpen(true),
  });

  return (
    <div className="workspace">
      <header className="workspace__header">
        <div className="workspace__brand">
          <Text variant="subheader-2">Gravity Notes</Text>
          <Label theme="unknown" icon={<Icon data={Folder} size={14} />}>
            {folderName ?? 'Folder'}
          </Label>
        </div>
        <div className="workspace__header-right">
          <Text color="secondary" className="workspace__save-state">
            {SAVE_LABEL[notes.saveState]}
          </Text>
          <Button
            view="flat"
            size="m"
            onClick={() => setHelpOpen(true)}
            title="Keyboard shortcuts (?)"
          >
            <Icon data={CircleQuestion} />
          </Button>
          <Button view="flat" size="m" onClick={onChangeFolder} title="Change folder">
            Change folder
          </Button>
          <Button
            view="flat"
            size="m"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <Icon data={theme === 'dark' ? Sun : Moon} />
          </Button>
        </div>
      </header>

      <div className="workspace__body">
        <aside className="workspace__sidebar">
          <NoteList
            notes={filteredNotes}
            selectedId={notes.activeId}
            query={query}
            onQueryChange={setQuery}
            searchInputRef={searchInputRef}
            onSelect={(id) => void notes.open(id)}
            onCreate={() => void notes.create()}
            onRename={(id, title) => void notes.rename(id, title)}
            onDelete={(id) => void notes.remove(id)}
            sortMode={notes.metadata.sort}
            onSortChange={notes.setSortMode}
            pinnedIds={notes.metadata.pinned}
            onTogglePin={notes.togglePin}
          />
        </aside>

        <main className="workspace__editor">
          {notes.note ? (
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
              <div className="workspace__panes">
                <EditorPane
                  ref={editorRef}
                  key={`${notes.note.id}:${notes.note.updatedAt}`}
                  note={notes.note}
                  autofocus={true}
                  onChange={notes.edit}
                  onEscape={() => void notes.close()}
                />
              </div>
            </>
          ) : (
            <div className="workspace__placeholder">
              <Text variant="body-2" color="secondary">
                Select a note, or create a new one to start writing.
              </Text>
            </div>
          )}
        </main>
      </div>

      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 19: Delete the `TabBar` files**

```bash
git rm src/components/TabBar.tsx src/components/TabBar.css src/components/TabBar.test.tsx
```

- [ ] **Step 20: Run the full gate (typecheck + lint + tests + build)**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: typecheck clean, lint 0 errors (pre-existing warnings OK), all tests pass, build OK. If lint reports formatting on the files you touched, run `npm run lint:fix` and re-run.

- [ ] **Step 21: Commit the single-note pane**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(workspace): remove tabs, restore the single-note editor pane

EditorPane gains autofocus (commit-only) + onEscape (bubble) + focus(); Workspace
renders one editor for the open note and deletes TabBar. Last note restored on reload.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `useNoteNavigation` hook (standalone)

Build the keyboard-first browse/edit navigation hook in isolation — it owns the list cursor (`selectedId`), the 150 ms debounced preview, and the focus transitions. It has no component imports (it takes focus handles via small ref interfaces), so it compiles and tests green on its own; Task 3 wires it in.

**Files:**

- Create: `src/hooks/useNoteNavigation.ts`
- Create: `src/hooks/useNoteNavigation.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useNoteNavigation.test.tsx`:

```tsx
import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {type NoteNavigationDeps, useNoteNavigation} from './useNoteNavigation';

function makeDeps(over: Partial<NoteNavigationDeps> = {}): NoteNavigationDeps {
  return {
    activeId: null,
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    editorRef: {current: {focus: vi.fn()}},
    listRef: {current: {focusSelected: vi.fn()}},
    searchInputRef: {current: {focus: vi.fn()}},
    ...over,
  };
}

describe('useNoteNavigation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('browse updates the cursor instantly and previews after the debounce', () => {
    const deps = makeDeps();
    const {result} = renderHook(() => useNoteNavigation(deps));
    act(() => {
      result.current.browse('A.md');
    });
    expect(result.current.selectedId).toBe('A.md');
    expect(deps.open).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(deps.open).toHaveBeenCalledWith('A.md');
  });

  it('rapid browse only previews the note settled on', () => {
    const deps = makeDeps();
    const {result} = renderHook(() => useNoteNavigation(deps));
    act(() => {
      result.current.browse('A.md');
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      result.current.browse('B.md');
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(deps.open).toHaveBeenCalledTimes(1);
    expect(deps.open).toHaveBeenCalledWith('B.md');
  });

  it('commit on a not-yet-open note opens it with autofocus', () => {
    const deps = makeDeps({activeId: null});
    const {result} = renderHook(() => useNoteNavigation(deps));
    act(() => {
      result.current.commit('A.md');
    });
    expect(deps.open).toHaveBeenCalledWith('A.md');
    expect(result.current.editorAutofocus).toBe(true);
  });

  it('commit on the already-open note focuses the editor without reopening', () => {
    const focus = vi.fn();
    const deps = makeDeps({activeId: 'A.md', editorRef: {current: {focus}}});
    const {result} = renderHook(() => useNoteNavigation(deps));
    act(() => {
      result.current.commit('A.md');
    });
    expect(deps.open).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('escapeEditor focuses the selected list row', () => {
    const focusSelected = vi.fn();
    const deps = makeDeps({listRef: {current: {focusSelected}}});
    const {result} = renderHook(() => useNoteNavigation(deps));
    act(() => {
      result.current.escapeEditor();
    });
    expect(focusSelected).toHaveBeenCalledTimes(1);
  });

  it('escapeList closes the note and focuses the search box', () => {
    const focus = vi.fn();
    const deps = makeDeps({searchInputRef: {current: {focus}}});
    const {result} = renderHook(() => useNoteNavigation(deps));
    act(() => {
      result.current.escapeList();
    });
    expect(deps.close).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('syncs the cursor to the restored open note', () => {
    const {result, rerender} = renderHook(
      (props: {activeId: string | null}) => useNoteNavigation(makeDeps({activeId: props.activeId})),
      {initialProps: {activeId: null as string | null}},
    );
    expect(result.current.selectedId).toBeNull();
    rerender({activeId: 'A.md'});
    expect(result.current.selectedId).toBe('A.md');
  });

  it('prepareCommit arms editor autofocus for the next mount', () => {
    const deps = makeDeps();
    const {result} = renderHook(() => useNoteNavigation(deps));
    expect(result.current.editorAutofocus).toBe(false);
    act(() => {
      result.current.prepareCommit();
    });
    expect(result.current.editorAutofocus).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/useNoteNavigation.test.tsx`
Expected: FAIL — `useNoteNavigation` does not exist.

- [ ] **Step 3: Implement `src/hooks/useNoteNavigation.ts`**

```ts
import {useCallback, useEffect, useRef, useState} from 'react';
import type {RefObject} from 'react';

/** The list cursor previews after this idle delay, so holding an arrow stays smooth. */
const PREVIEW_DELAY = 150;

export interface NoteNavigationDeps {
  /** The currently open note id (from `useNotes`), or null. */
  activeId: string | null;
  /** Load + activate a note (from `useNotes`). */
  open(id: string): Promise<void>;
  /** Close the open note (from `useNotes`). */
  close(): Promise<void>;
  editorRef: RefObject<{focus(): void} | null>;
  listRef: RefObject<{focusSelected(): void} | null>;
  searchInputRef: RefObject<{focus(): void} | null>;
}

export interface UseNoteNavigation {
  /** The list cursor (drives the row highlight); updates instantly, leads `activeId` during the preview debounce. */
  selectedId: string | null;
  /** Whether the next editor (re)mount should grab focus (true after a commit). */
  editorAutofocus: boolean;
  /** Set the cursor without previewing (used after deleting the last note). */
  setSelected(id: string | null): void;
  /** Arm the editor to focus on its next mount (used before creating a note). */
  prepareCommit(): void;
  /** Move the highlight and (debounced) preview the note; focus stays in the list. */
  browse(id: string): void;
  /** Open the note for editing and focus the editor. */
  commit(id: string): void;
  /** Leave the editor: return focus to the selected list row (the note stays open). */
  escapeEditor(): void;
  /** Close the open note and move focus to the search box. */
  escapeList(): void;
}

/**
 * Keyboard-first browse/edit navigation for the single-pane note app. Owns the list
 * cursor (`selectedId`, instant) and a debounced preview that loads the highlighted note
 * into the editor without stealing focus. `commit` focuses the editor; `escapeEditor` /
 * `escapeList` walk focus back down (editor → list → search + close). Storage stays in
 * `useNotes`; this hook only sequences intent + focus.
 */
export function useNoteNavigation(deps: NoteNavigationDeps): UseNoteNavigation {
  const {activeId, editorRef, listRef, searchInputRef} = deps;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorAutofocus, setEditorAutofocus] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read open/close through refs so the callbacks stay stable and never call a stale closure.
  const openRef = useRef(deps.open);
  openRef.current = deps.open;
  const closeRef = useRef(deps.close);
  closeRef.current = deps.close;

  const cancelPreview = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const browse = useCallback(
    (id: string) => {
      setSelectedId(id);
      setEditorAutofocus(false);
      cancelPreview();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void openRef.current(id);
      }, PREVIEW_DELAY);
    },
    [cancelPreview],
  );

  const commit = useCallback(
    (id: string) => {
      cancelPreview();
      setSelectedId(id);
      if (id === activeId) {
        editorRef.current?.focus();
      } else {
        setEditorAutofocus(true);
        void openRef.current(id);
      }
    },
    [activeId, cancelPreview, editorRef],
  );

  const escapeEditor = useCallback(() => {
    listRef.current?.focusSelected();
  }, [listRef]);

  const escapeList = useCallback(() => {
    cancelPreview();
    void closeRef.current();
    searchInputRef.current?.focus();
  }, [cancelPreview, searchInputRef]);

  const prepareCommit = useCallback(() => setEditorAutofocus(true), []);

  // Sync the cursor to the restored open note on first load.
  useEffect(() => {
    if (selectedId === null && activeId !== null) setSelectedId(activeId);
  }, [activeId, selectedId]);

  // Clear a pending preview timer on unmount.
  useEffect(() => cancelPreview, [cancelPreview]);

  return {
    selectedId,
    editorAutofocus,
    setSelected: setSelectedId,
    prepareCommit,
    browse,
    commit,
    escapeEditor,
    escapeList,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/useNoteNavigation.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck + lint the new files**

Run: `npm run typecheck && npm run lint`
Expected: clean (run `npm run lint:fix` if formatting needs the 4-space conversion).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useNoteNavigation.ts src/hooks/useNoteNavigation.test.tsx
git commit -m "$(cat <<'EOF'
feat(notes): add useNoteNavigation hook for nvALT browse/edit

Owns the list cursor, a 150ms debounced preview, and the editor/list/search
focus transitions. Standalone (focus handles via ref interfaces); wired next.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire nvALT navigation

Turn `NoteList` into a presentational component that emits browse/commit/escape intents and exposes `focusSelected()`, then rewire `Workspace` to drive everything through `useNoteNavigation` (live preview, cold-start search focus, delete-neighbor preview). `EditorPane` already has the `autofocus`/`onEscape`/`focus()` shape from Task 1.

**Files:**

- Modify: `src/components/NoteList.tsx` (forwardRef + intents + `focusSelected()`)
- Modify: `src/components/NoteList.test.tsx`
- Modify: `src/components/Workspace.tsx` (wire the nav hook)
- Modify: `src/components/Workspace.test.tsx`

- [ ] **Step 1: Rewrite the `NoteList` tests (red)**

Replace the whole of `src/components/NoteList.test.tsx`:

```tsx
import {createRef} from 'react';

import {screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import type {NoteMeta} from '../storage/types';
import {renderWithProviders} from '../test/render';

import {NoteList, type NoteListHandle, type NoteListProps} from './NoteList';

const NOTES: NoteMeta[] = [
  {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
  {id: 'Beta.md', title: 'Beta', updatedAt: 2},
];

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    notes: NOTES,
    selectedId: 'Alpha.md',
    query: '',
    onQueryChange: vi.fn(),
    searchInputRef: createRef<HTMLInputElement>(),
    onBrowse: vi.fn(),
    onCommit: vi.fn(),
    onEscapeList: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    sortMode: 'updated',
    onSortChange: vi.fn(),
    pinnedIds: [],
    onTogglePin: vi.fn(),
    ...overrides,
  };
  const ref = createRef<NoteListHandle>();
  renderWithProviders(<NoteList ref={ref} {...(props as NoteListProps)} />);
  return {props, ref};
}

describe('NoteList — list & a11y', () => {
  it('renders notes as a listbox of options', () => {
    setup();
    expect(screen.getByRole('listbox', {name: 'Notes'})).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('marks the selected option and makes it the roving-tabindex target', () => {
    setup({selectedId: 'Beta.md'});
    const selected = screen.getByRole('option', {name: /Beta/});
    const other = screen.getByRole('option', {name: /Alpha/});
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected).toHaveAttribute('tabindex', '0');
    expect(other).toHaveAttribute('aria-selected', 'false');
    expect(other).toHaveAttribute('tabindex', '-1');
  });

  it('browses a note on single click', async () => {
    const user = userEvent.setup();
    const {props} = setup();
    await user.click(screen.getByText('Beta'));
    expect(props.onBrowse).toHaveBeenCalledWith('Beta.md');
  });

  it('browses the neighbor on ArrowDown', async () => {
    const user = userEvent.setup();
    const {props} = setup({selectedId: 'Alpha.md'});
    screen.getByRole('option', {name: /Alpha/}).focus();
    await user.keyboard('{ArrowDown}');
    expect(props.onBrowse).toHaveBeenCalledWith('Beta.md');
  });

  it('commits the focused note on Enter', async () => {
    const user = userEvent.setup();
    const {props} = setup({selectedId: 'Alpha.md'});
    screen.getByRole('option', {name: /Alpha/}).focus();
    await user.keyboard('{Enter}');
    expect(props.onCommit).toHaveBeenCalledWith('Alpha.md');
  });

  it('escapes the list on Escape over a row', async () => {
    const user = userEvent.setup();
    const {props} = setup({selectedId: 'Alpha.md'});
    screen.getByRole('option', {name: /Alpha/}).focus();
    await user.keyboard('{Escape}');
    expect(props.onEscapeList).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when there are no notes', () => {
    setup({notes: []});
    expect(screen.getByText(/No notes yet/)).toBeInTheDocument();
  });
});

describe('NoteList — focus handle', () => {
  it('focusSelected() moves DOM focus to the selected row', () => {
    const {ref} = setup({selectedId: 'Beta.md'});
    ref.current?.focusSelected();
    expect(screen.getByRole('option', {name: /Beta/})).toHaveFocus();
  });
});

describe('NoteList — inline rename', () => {
  it('renames via F2 and commits on Enter', async () => {
    const user = userEvent.setup();
    const {props} = setup({selectedId: 'Alpha.md'});
    screen.getByRole('option', {name: /Alpha/}).focus();
    await user.keyboard('{F2}');
    const input = screen.getByDisplayValue('Alpha');
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');
    expect(props.onRename).toHaveBeenCalledWith('Alpha.md', 'Renamed');
    expect(props.onRename).toHaveBeenCalledTimes(1);
  });

  it('commits a rename on blur', async () => {
    const user = userEvent.setup();
    const {props} = setup();
    await user.dblClick(screen.getByText('Beta'));
    const input = screen.getByDisplayValue('Beta');
    await user.clear(input);
    await user.type(input, 'Beta 2');
    await user.tab();
    expect(props.onRename).toHaveBeenCalledWith('Beta.md', 'Beta 2');
    expect(props.onRename).toHaveBeenCalledTimes(1);
  });

  it('cancels a rename on Escape', async () => {
    const user = userEvent.setup();
    const {props} = setup();
    await user.dblClick(screen.getByText('Beta'));
    const input = screen.getByDisplayValue('Beta');
    await user.clear(input);
    await user.type(input, 'Nope{Escape}');
    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('is a no-op when the title is unchanged', async () => {
    const user = userEvent.setup();
    const {props} = setup();
    await user.dblClick(screen.getByText('Beta'));
    await user.type(screen.getByDisplayValue('Beta'), '{Enter}');
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it('is a no-op when the title is emptied', async () => {
    const user = userEvent.setup();
    const {props} = setup();
    await user.dblClick(screen.getByText('Beta'));
    const input = screen.getByDisplayValue('Beta');
    await user.clear(input);
    await user.type(input, '{Enter}');
    expect(props.onRename).not.toHaveBeenCalled();
  });
});

describe('NoteList — delete', () => {
  it('deletes a note after confirming', async () => {
    const user = userEvent.setup();
    const {props} = setup();
    const beta = screen.getByRole('option', {name: /Beta/});
    await user.click(within(beta).getByRole('button'));
    await user.click(await screen.findByRole('menuitem', {name: /Delete/}));
    await user.click(screen.getByRole('button', {name: 'Delete'}));
    expect(props.onDelete).toHaveBeenCalledWith('Beta.md');
  });
});

describe('NoteList — search', () => {
  it('calls onQueryChange when typing in the search field', async () => {
    const user = userEvent.setup();
    const {props} = setup();
    await user.type(screen.getByPlaceholderText('Search'), 'x');
    expect(props.onQueryChange).toHaveBeenCalledWith('x');
  });

  it('highlights the matched substring in titles', () => {
    setup({query: 'lph'});
    const mark = document.querySelector('mark');
    expect(mark?.textContent).toBe('lph');
  });

  it('shows a no-results message when filtered to empty with a query', () => {
    setup({notes: [], query: 'zzz'});
    expect(screen.getByText(/No notes match/)).toBeInTheDocument();
  });

  it('commits the top match on Enter in the search field', async () => {
    const user = userEvent.setup();
    const {props} = setup({query: 'a'});
    screen.getByPlaceholderText('Search').focus();
    await user.keyboard('{Enter}');
    expect(props.onCommit).toHaveBeenCalledWith('Alpha.md');
  });

  it('enters the list on ArrowDown from the search field', async () => {
    const user = userEvent.setup();
    const {props} = setup({selectedId: 'Beta.md'});
    screen.getByPlaceholderText('Search').focus();
    await user.keyboard('{ArrowDown}');
    expect(props.onBrowse).toHaveBeenCalledWith('Beta.md');
  });

  it('clears the query on Escape when the search field has text', async () => {
    const user = userEvent.setup();
    const {props} = setup({query: 'beta'});
    screen.getByPlaceholderText('Search').focus();
    await user.keyboard('{Escape}');
    expect(props.onQueryChange).toHaveBeenCalledWith('');
    expect(props.onEscapeList).not.toHaveBeenCalled();
  });

  it('escapes the list on Escape when the search field is empty', async () => {
    const user = userEvent.setup();
    const {props} = setup({query: ''});
    screen.getByPlaceholderText('Search').focus();
    await user.keyboard('{Escape}');
    expect(props.onEscapeList).toHaveBeenCalledTimes(1);
  });
});

describe('NoteList — sort control', () => {
  it('changes the sort mode via the sort control', async () => {
    const user = userEvent.setup();
    const {props} = setup();
    await user.click(screen.getByRole('combobox', {name: 'Sort notes'}));
    await user.click(await screen.findByRole('option', {name: 'Title (A→Z)'}));
    expect(props.onSortChange).toHaveBeenCalledWith('title');
  });
});

describe('NoteList — pinning', () => {
  it('shows a pin icon on pinned notes only', () => {
    setup({pinnedIds: ['Alpha.md']});
    const alpha = screen.getByRole('option', {name: /Alpha/});
    const beta = screen.getByRole('option', {name: /Beta/});
    expect(alpha.querySelector('.note-list__pin')).toBeTruthy();
    expect(beta.querySelector('.note-list__pin')).toBeFalsy();
  });

  it('pins an unpinned note from the menu', async () => {
    const user = userEvent.setup();
    const {props} = setup();
    const alpha = screen.getByRole('option', {name: /Alpha/});
    await user.click(within(alpha).getByRole('button'));
    await user.click(await screen.findByRole('menuitem', {name: /Pin to top/}));
    expect(props.onTogglePin).toHaveBeenCalledWith('Alpha.md');
  });

  it('unpins a pinned note from the menu', async () => {
    const user = userEvent.setup();
    const {props} = setup({pinnedIds: ['Alpha.md']});
    const alpha = screen.getByRole('option', {name: /Alpha/});
    await user.click(within(alpha).getByRole('button'));
    await user.click(await screen.findByRole('menuitem', {name: /Unpin/}));
    expect(props.onTogglePin).toHaveBeenCalledWith('Alpha.md');
  });
});
```

- [ ] **Step 2: Run the `NoteList` tests to confirm they fail**

Run: `npx vitest run src/components/NoteList.test.tsx`
Expected: FAIL — `NoteList` has no `onBrowse`/`onCommit`/`onEscapeList`, is not a `forwardRef`, and exports no `NoteListHandle`.

- [ ] **Step 3: Rewrite `src/components/NoteList.tsx`**

Full new file:

```tsx
import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject} from 'react';

import {Ellipsis, Pencil, Pin, PinFill, PinSlash, Plus, TrashBin} from '@gravity-ui/icons';
import {Button, Dialog, DropdownMenu, Icon, Select, Text, TextInput} from '@gravity-ui/uikit';

import type {NoteMeta, SortMode} from '../storage/types';

import './NoteList.css';

export interface NoteListHandle {
  /** Move keyboard focus to the selected row (used when leaving the editor). */
  focusSelected(): void;
}

export interface NoteListProps {
  notes: NoteMeta[];
  selectedId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  searchInputRef: RefObject<HTMLInputElement>;
  /** Preview a note (move the highlight): arrow nav, single click, ↓/↑ from the search box. */
  onBrowse: (id: string) => void;
  /** Open a note for editing: Enter on a row, Enter in the search box (top match). */
  onCommit: (id: string) => void;
  /** Esc on a focused row (or in an empty search box): close the open note. */
  onEscapeList: () => void;
  onCreate: () => void;
  onRename: (id: string, nextTitle: string) => void;
  onDelete: (id: string) => void;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  pinnedIds: readonly string[];
  onTogglePin: (id: string) => void;
}

function highlightMatch(title: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return title;
  const idx = title.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return title;
  return (
    <>
      {title.slice(0, idx)}
      <mark className="note-list__match">{title.slice(idx, idx + q.length)}</mark>
      {title.slice(idx + q.length)}
    </>
  );
}

export const NoteList = forwardRef<NoteListHandle, NoteListProps>(function NoteList(
  {
    notes,
    selectedId,
    query,
    onQueryChange,
    searchInputRef,
    onBrowse,
    onCommit,
    onEscapeList,
    onCreate,
    onRename,
    onDelete,
    sortMode,
    onSortChange,
    pinnedIds,
    onTogglePin,
  },
  ref,
) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deleting, setDeleting] = useState<NoteMeta | null>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const editInputRef = useRef<HTMLInputElement>(null);

  // Focus the rename field when inline editing begins.
  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  // The item that is tabbable: the selected one, else the first.
  const focusableId =
    selectedId && notes.some((n) => n.id === selectedId) ? selectedId : (notes[0]?.id ?? null);

  useImperativeHandle(
    ref,
    () => ({
      focusSelected() {
        if (focusableId) itemRefs.current.get(focusableId)?.focus();
      },
    }),
    [focusableId],
  );

  const startRename = (note: NoteMeta) => {
    setEditValue(note.title);
    setEditingId(note.id);
  };

  const commitRename = (note: NoteMeta) => {
    const next = editValue.trim();
    setEditingId(null);
    if (next && next !== note.title) {
      onRename(note.id, next);
    }
  };

  /** Move the highlight to a row, preview it, and keep DOM focus on the list. */
  const browseRow = (id: string) => {
    onBrowse(id);
    itemRefs.current.get(id)?.focus();
  };

  const moveSelection = (fromId: string, delta: number) => {
    const index = notes.findIndex((n) => n.id === fromId);
    if (index === -1) return;
    const next = notes[Math.min(Math.max(index + delta, 0), notes.length - 1)];
    if (next && next.id !== fromId) browseRow(next.id);
  };

  const onItemKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, note: NoteMeta) => {
    if (editingId === note.id) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveSelection(note.id, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveSelection(note.id, -1);
        break;
      case 'Enter':
        event.preventDefault();
        onCommit(note.id);
        break;
      case 'Escape':
        event.preventDefault();
        onEscapeList();
        break;
      case 'F2':
        event.preventDefault();
        startRename(note);
        break;
    }
  };

  const pinnedSet = new Set(pinnedIds);

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && notes.length > 0) {
      event.preventDefault();
      onCommit(notes[0].id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (query) onQueryChange('');
      else onEscapeList();
    } else if (event.key === 'ArrowDown' && notes.length > 0) {
      event.preventDefault();
      const target =
        selectedId && notes.some((n) => n.id === selectedId) ? selectedId : notes[0].id;
      browseRow(target);
    } else if (event.key === 'ArrowUp' && notes.length > 0) {
      event.preventDefault();
      const target =
        selectedId && notes.some((n) => n.id === selectedId)
          ? selectedId
          : notes[notes.length - 1].id;
      browseRow(target);
    }
  };

  return (
    <div className="note-list">
      <div className="note-list__header">
        <Text variant="subheader-2">Notes</Text>
        <div className="note-list__header-actions">
          <Select
            className="note-list__sort"
            aria-label="Sort notes"
            size="m"
            value={[sortMode]}
            onUpdate={([next]) => {
              if (next) onSortChange(next as SortMode);
            }}
            options={[
              {value: 'updated', content: 'Updated'},
              {value: 'title', content: 'Title (A→Z)'},
              {value: 'created', content: 'Created'},
            ]}
          />
          <Button view="action" size="m" onClick={onCreate}>
            <Icon data={Plus} />
            New
          </Button>
        </div>
      </div>

      <div className="note-list__search">
        <TextInput
          controlRef={searchInputRef}
          value={query}
          onUpdate={onQueryChange}
          placeholder="Search"
          hasClear
          onKeyDown={onSearchKeyDown}
        />
      </div>

      <div className="note-list__items" role="listbox" aria-label="Notes">
        {notes.length === 0 ? (
          <div className="note-list__empty">
            <Text color="secondary">
              {query ? `No notes match “${query}”.` : 'No notes yet. Create your first one.'}
            </Text>
          </div>
        ) : (
          notes.map((note) => {
            const selected = note.id === selectedId;
            const editing = note.id === editingId;
            const tabbable = !editing && note.id === focusableId;
            return (
              <div
                key={note.id}
                ref={(el) => {
                  if (el) itemRefs.current.set(note.id, el);
                  else itemRefs.current.delete(note.id);
                }}
                className={'note-list__item' + (selected ? ' note-list__item_selected' : '')}
                role="option"
                aria-selected={selected}
                tabIndex={tabbable ? 0 : -1}
                onClick={() => onBrowse(note.id)}
                onDoubleClick={() => startRename(note)}
                onKeyDown={(e) => onItemKeyDown(e, note)}
              >
                {editing ? (
                  <TextInput
                    className="note-list__edit"
                    controlRef={editInputRef}
                    value={editValue}
                    onUpdate={setEditValue}
                    onBlur={() => commitRename(note)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename(note);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setEditingId(null);
                      }
                    }}
                  />
                ) : (
                  <>
                    {pinnedSet.has(note.id) ? (
                      <Icon className="note-list__pin" data={PinFill} size={14} aria-hidden />
                    ) : null}
                    <Text className="note-list__title" ellipsis>
                      {highlightMatch(note.title, query)}
                    </Text>
                    <div className="note-list__actions">
                      <DropdownMenu
                        renderSwitcher={(props) => (
                          <Button
                            {...props}
                            view="flat"
                            size="s"
                            onClick={(e) => {
                              e.stopPropagation();
                              props.onClick?.(e);
                            }}
                          >
                            <Icon data={Ellipsis} />
                          </Button>
                        )}
                        items={[
                          {
                            text: pinnedSet.has(note.id) ? 'Unpin' : 'Pin to top',
                            iconStart: <Icon data={pinnedSet.has(note.id) ? PinSlash : Pin} />,
                            action: () => onTogglePin(note.id),
                          },
                          {
                            text: 'Rename',
                            iconStart: <Icon data={Pencil} />,
                            action: () => startRename(note),
                          },
                          {
                            text: 'Delete',
                            theme: 'danger',
                            iconStart: <Icon data={TrashBin} />,
                            action: () => setDeleting(note),
                          },
                        ]}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} size="s">
        <Dialog.Header caption="Delete note" />
        <Dialog.Body>
          <Text>
            Delete “{deleting?.title}”? This permanently removes the file from your folder.
          </Text>
        </Dialog.Body>
        <Dialog.Footer
          textButtonApply="Delete"
          textButtonCancel="Cancel"
          propsButtonApply={{view: 'outlined-danger'}}
          onClickButtonApply={() => {
            if (deleting) onDelete(deleting.id);
            setDeleting(null);
          }}
          onClickButtonCancel={() => setDeleting(null)}
        />
      </Dialog>
    </div>
  );
});
```

- [ ] **Step 4: Run the `NoteList` tests to confirm they pass**

Run: `npx vitest run src/components/NoteList.test.tsx`
Expected: PASS.

(The app does not type-check yet — `Workspace` still passes `onSelect`. The next steps fix that before the whole-suite gate.)

- [ ] **Step 5: Rewrite the `Workspace` tests for the nvALT flows (red)**

Replace the whole of `src/components/Workspace.test.tsx`:

```tsx
import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@gravity-ui/markdown-editor', () => ({
  useMarkdownEditor: () => ({
    currentMode: 'wysiwyg',
    setEditorMode: vi.fn(),
    focus: vi.fn(),
    getValue: () => '',
    on: () => {},
    off: () => {},
  }),
  MarkdownEditorView: () => null,
}));

import {FakeDirectoryHandle, asDirectoryHandle} from '../storage/fakeFileSystem';
import {renderWithProviders} from '../test/render';

import {Workspace} from './Workspace';

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'});
});

function renderWorkspace() {
  const dir = new FakeDirectoryHandle();
  dir.seedFile('Alpha.md', 'a', 100);
  dir.seedFile('Beta.md', 'b', 200);
  renderWithProviders(
    <Workspace
      dir={asDirectoryHandle(dir)}
      folderName="notes"
      theme="light"
      onToggleTheme={vi.fn()}
      onChangeFolder={vi.fn()}
    />,
  );
  return {dir};
}

describe('Workspace — nvALT navigation', () => {
  it('shows the placeholder until a note is opened, and never a tab strip', async () => {
    renderWorkspace();
    await screen.findByRole('option', {name: /Alpha/});
    expect(screen.getByText(/Select a note/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('previews a note in the editor on click', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('option', {name: /Beta/});
    await user.click(screen.getByRole('option', {name: /Beta/}));
    await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
  });

  it('moves the highlight as you arrow the list', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('option', {name: /Beta/});
    // updated-desc order is [Beta, Alpha]; click Beta then arrow down to Alpha.
    await user.click(screen.getByRole('option', {name: /Beta/}));
    await waitFor(() =>
      expect(screen.getByRole('option', {name: /Beta/})).toHaveAttribute('aria-selected', 'true'),
    );
    await user.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(screen.getByRole('option', {name: /Alpha/})).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('creates a note and opens it', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('option', {name: /Alpha/});
    await user.click(screen.getByRole('button', {name: 'New'}));
    await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('option', {name: /Untitled/})).toBeInTheDocument());
  });

  it('previews a neighbor after deleting the open note', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('option', {name: /Beta/});
    await user.click(screen.getByRole('option', {name: /Beta/}));
    // Wait until Beta is actually open (placeholder gone) so the delete sees it as active.
    await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());

    const beta = screen.getByRole('option', {name: /Beta/});
    await user.click(within(beta).getByRole('button'));
    await user.click(await screen.findByRole('menuitem', {name: /Delete/}));
    await user.click(screen.getByRole('button', {name: 'Delete'}));

    await waitFor(() =>
      expect(screen.queryByRole('option', {name: /Beta/})).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('option', {name: /Alpha/})).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('closes the open note on Escape in an empty search box', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('option', {name: /Beta/});
    await user.click(screen.getByRole('option', {name: /Beta/}));
    await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
    await user.click(screen.getByPlaceholderText('Search'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByText(/Select a note/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Run the `Workspace` tests to confirm they fail**

Run: `npx vitest run src/components/Workspace.test.tsx`
Expected: FAIL — `Workspace` does not yet wire `useNoteNavigation` (no live preview / neighbor-on-delete), and still passes `onSelect`.

- [ ] **Step 7: Rewrite `src/components/Workspace.tsx` to wire the nav hook**

Full new file:

```tsx
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {CircleQuestion, Folder, Moon, Sun} from '@gravity-ui/icons';
import {Button, Icon, Label, Text, type Theme, useToaster} from '@gravity-ui/uikit';

import {useNoteNavigation} from '../hooks/useNoteNavigation';
import {useNoteSearch} from '../hooks/useNoteSearch';
import {type SaveState, useNotes} from '../hooks/useNotes';
import {useShortcuts} from '../hooks/useShortcuts';
import {FileSystemNoteStore} from '../storage/fileSystemStore';
import {orderNotes} from '../storage/metadata';

import {ConflictBanner} from './ConflictBanner';
import {EditorPane, type EditorPaneHandle} from './EditorPane';
import {NoteList, type NoteListHandle} from './NoteList';
import {ShortcutsDialog} from './ShortcutsDialog';

import './Workspace.css';

interface WorkspaceProps {
  dir: FileSystemDirectoryHandle;
  folderName: string | null;
  theme: Theme;
  onToggleTheme: () => void;
  onChangeFolder: () => void;
}

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
  conflict: 'Changed on disk',
};

export function Workspace({dir, folderName, theme, onToggleTheme, onChangeFolder}: WorkspaceProps) {
  const store = useMemo(() => new FileSystemNoteStore(dir), [dir]);
  const {add} = useToaster();

  const onError = useCallback(
    (message: string) => {
      add({
        name: `notes-error-${Date.now()}`,
        title: 'Something went wrong',
        content: message,
        theme: 'danger',
        autoHiding: 5000,
      });
    },
    [add],
  );

  const notes = useNotes(store, onError);
  const orderedNotes = useMemo(
    () => orderNotes(notes.notes, notes.metadata),
    [notes.notes, notes.metadata],
  );
  const {query, setQuery, filteredNotes} = useNoteSearch(orderedNotes);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<EditorPaneHandle>(null);
  const listRef = useRef<NoteListHandle>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const nav = useNoteNavigation({
    activeId: notes.activeId,
    open: notes.open,
    close: notes.close,
    editorRef,
    listRef,
    searchInputRef,
  });

  // Land in the search box on first load (nvALT: ready to type); a restored note is previewed unfocused.
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const handleCreate = useCallback(() => {
    nav.prepareCommit(); // arm autofocus so the new note mounts focused
    void (async () => {
      const id = await notes.create();
      if (id) nav.setSelected(id);
    })();
  }, [notes, nav]);

  const handleDelete = useCallback(
    (id: string) => {
      const ids = filteredNotes.map((n) => n.id);
      const idx = ids.indexOf(id);
      const neighbor = ids[idx + 1] ?? ids[idx - 1] ?? null;
      const wasActive = notes.activeId === id;
      void (async () => {
        await notes.remove(id);
        if (wasActive) {
          if (neighbor) nav.browse(neighbor);
          else nav.setSelected(null);
        }
      })();
    },
    [filteredNotes, notes, nav],
  );

  useShortcuts({
    focusSearch: () => searchInputRef.current?.focus(),
    createNote: handleCreate,
    toggleEditorMode: () => editorRef.current?.toggleMode(),
    openHelp: () => setHelpOpen(true),
  });

  return (
    <div className="workspace">
      <header className="workspace__header">
        <div className="workspace__brand">
          <Text variant="subheader-2">Gravity Notes</Text>
          <Label theme="unknown" icon={<Icon data={Folder} size={14} />}>
            {folderName ?? 'Folder'}
          </Label>
        </div>
        <div className="workspace__header-right">
          <Text color="secondary" className="workspace__save-state">
            {SAVE_LABEL[notes.saveState]}
          </Text>
          <Button
            view="flat"
            size="m"
            onClick={() => setHelpOpen(true)}
            title="Keyboard shortcuts (?)"
          >
            <Icon data={CircleQuestion} />
          </Button>
          <Button view="flat" size="m" onClick={onChangeFolder} title="Change folder">
            Change folder
          </Button>
          <Button
            view="flat"
            size="m"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <Icon data={theme === 'dark' ? Sun : Moon} />
          </Button>
        </div>
      </header>

      <div className="workspace__body">
        <aside className="workspace__sidebar">
          <NoteList
            ref={listRef}
            notes={filteredNotes}
            selectedId={nav.selectedId}
            query={query}
            onQueryChange={setQuery}
            searchInputRef={searchInputRef}
            onBrowse={nav.browse}
            onCommit={nav.commit}
            onEscapeList={nav.escapeList}
            onCreate={handleCreate}
            onRename={(id, title) => void notes.rename(id, title)}
            onDelete={handleDelete}
            sortMode={notes.metadata.sort}
            onSortChange={notes.setSortMode}
            pinnedIds={notes.metadata.pinned}
            onTogglePin={notes.togglePin}
          />
        </aside>

        <main className="workspace__editor">
          {notes.note ? (
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
              <div className="workspace__panes">
                <EditorPane
                  ref={editorRef}
                  key={`${notes.note.id}:${notes.note.updatedAt}`}
                  note={notes.note}
                  autofocus={nav.editorAutofocus}
                  onChange={notes.edit}
                  onEscape={nav.escapeEditor}
                />
              </div>
            </>
          ) : (
            <div className="workspace__placeholder">
              <Text variant="body-2" color="secondary">
                Select a note, or create a new one to start writing.
              </Text>
            </div>
          )}
        </main>
      </div>

      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 8: Run the `Workspace` tests to confirm they pass**

Run: `npx vitest run src/components/Workspace.test.tsx`
Expected: PASS.

- [ ] **Step 9: Run the full gate**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: typecheck clean, lint 0 errors (pre-existing warnings OK), all tests pass, build OK. Run `npm run lint:fix` if formatting needs the 4-space conversion, then re-run.

- [ ] **Step 10: Commit the nvALT wiring**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(workspace): wire nvALT browse/edit navigation

NoteList emits browse/commit/escape intents + focusSelected(); Workspace drives
useNoteNavigation for live preview, cold-start search focus, and delete-neighbor.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Shortcut descriptors, docs, and verification

Refresh the help-sheet descriptors for the new flow, update the roadmap docs, and run the full verification pass (including a manual Chromium smoke, since the folder picker can't be automated).

**Files:**

- Modify: `src/shortcuts.ts` (descriptions)
- Modify: `src/components/ShortcutsDialog.test.tsx` (only if it asserts a changed description)
- Modify: `CLAUDE.md` (roadmap)
- Modify: `README.md` (drop tab mentions; record the nvALT direction)

- [ ] **Step 1: Update `src/shortcuts.ts` descriptions**

Replace the `SHORTCUTS` array's `up`/`down`/`enter`/`esc` rows (global bindings and the rest unchanged). The full new array:

```ts
/** Single source of truth for both the global handler and the help dialog. */
export const SHORTCUTS: ShortcutDescriptor[] = [
  {
    keys: 'mod+k',
    description: 'Focus search',
    group: 'Navigation',
    global: {trigger: 'mod', key: 'k', action: 'focusSearch'},
  },
  {keys: 'up', description: 'Preview previous note', group: 'Navigation'},
  {keys: 'down', description: 'Preview next note', group: 'Navigation'},
  {keys: 'enter', description: 'Edit the selected note', group: 'Navigation'},
  {keys: 'esc', description: 'Editor → list, then close (or clear search)', group: 'Navigation'},
  {
    keys: 'mod+j',
    description: 'New note',
    group: 'Editing',
    global: {trigger: 'mod', key: 'j', action: 'createNote'},
  },
  {
    keys: 'mod+/',
    description: 'Toggle WYSIWYG / Markup',
    group: 'Editing',
    global: {trigger: 'mod', key: '/', action: 'toggleEditorMode'},
  },
  {keys: 'f2', description: 'Rename selected note', group: 'Editing'},
  {
    keys: '?',
    description: 'Show this help',
    group: 'General',
    global: {trigger: 'bare', key: '?', action: 'openHelp'},
  },
];
```

- [ ] **Step 2: Reconcile the shortcut tests**

Run: `npx vitest run src/hooks/useShortcuts.test.tsx src/components/ShortcutsDialog.test.tsx`
Expected: `useShortcuts` PASSES unchanged (its assertions are behavioral — `mod+k`/`ctrl+j`/`mod+/`/`?`). If `ShortcutsDialog.test.tsx` asserts a now-changed description string (e.g. the old `'Clear search'` for `esc`, or `'Previous note'`/`'Next note'`/`'Open the focused note'`), update those expected strings to the new descriptions above. Re-run until green.

- [ ] **Step 3: Update `CLAUDE.md` roadmap**

In the "Roadmap & active work" list, under section 3, mark the Multi-tab Editing entry as superseded and add the new slice. Replace the `Multi-tab editing` bullet with:

```markdown
- ✅ **Multi-tab editing** (superseded) — shipped then reverted; see below.
- ✅ **Remove tabs + nvALT navigation** — reverted multi-tab to a single-pane
  Notational-Velocity model: one open note persisted as `metadata.active`, a
  `useNoteNavigation` hook for arrow-to-preview / Enter-to-edit / Esc-to-step-back.
  Spec: `docs/superpowers/specs/2026-06-20-remove-tabs-nvalt-navigation-design.md`.
```

- [ ] **Step 4: Update `README.md`**

In `README.md`, remove the "remove tabs" line from the `### TODO` section (it is now done) and drop any tab references from Features/Architecture. Leave the remaining design-polish and backlog items intact. Add a one-line note under Features:

```markdown
- Keyboard-first navigation (nvALT / Notational Velocity style): arrow to preview, Enter to edit, Esc to step back
```

- [ ] **Step 5: Format docs + run the full gate**

```bash
npm run format
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: format writes Markdown/CSS cleanly; typecheck clean; lint 0 errors; all tests pass; build OK.

- [ ] **Step 6: Manual Chromium smoke (cannot be automated — the folder picker is a native dialog)**

Run: `npm run dev`, open in Chrome/Edge, pick a folder with a few `.md` files, and confirm:

1. The app lands with focus in the search box; no tab strip anywhere.
2. ↑/↓ in the list live-previews each note in the editor (smooth while held); the highlight follows.
3. `Enter` (or clicking into the editor) moves the cursor into the editor; typing autosaves (the header shows "Saving…" → "Saved").
4. `Esc` in the editor returns focus to the highlighted row (note still shown); `Esc` again closes it to the placeholder with focus back in search.
5. ↓ from the search box jumps into the list and previews.
6. Create (⌘/Ctrl+J or "New") opens an editable, focused new note.
7. Delete the open note → the neighbor is previewed (or placeholder if the folder is empty).
8. Edit a note, then externally change its file on disk and refocus the tab → the conflict banner appears with Reload / Keep mine / Save a copy / Discard all working.
9. Reload (re-grant folder permission) → the last open note returns as a preview.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
docs(shortcuts): refresh help descriptors + roadmap for nvALT navigation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done — what this produced

- **No tabs.** One editor pane bound to `metadata.active`; `TabBar` deleted.
- **nvALT navigation.** Arrow to live-preview (150 ms debounced), Enter/click-into-editor to edit, Esc to walk editor → list → close; ↓/↑ from search enters the list; last note restored on reload; cold start focuses search.
- **No regressions.** Autosave, save-on-close, single-note conflict detection + all four resolvers, search, sort, pinning, rename, delete, and list a11y preserved — covered by the rewritten `metadata` / `useNotes` / `useNoteNavigation` / `EditorPane` / `NoteList` / `Workspace` test suites.

**Deferred to later README slices (out of scope here):** visual polish (accent, line-height, dash bullets, editor padding, hide toolbar); the `F2`-from-editor and `⌘K`-vs-insert-link bugs; manual save + crash buffer.
