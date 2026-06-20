# Sort & Pinning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selectable sort modes (Updated / Title / Created) and pin-to-top for notes, persisted in a folder dotfile, without mutating note files or breaking search / keyboard / conflict flows.

**Architecture:** A new pure metadata+ordering layer (`src/storage/metadata.ts`) holds the data shapes and all logic (parse, immutable transforms, reconcile, `orderNotes`). The `NoteStore` interface grows two methods — `readMetadata`/`writeMetadata` — that persist a `.gravity-notes.json` blob; `FileSystemNoteStore` implements them, the in-memory fake needs no change. `useNotes` owns the metadata blob (loaded on mount, mutated on pin/sort/create/rename/remove, reconciled against live files on refresh). Ordering becomes a pure function memoized in `Workspace`, feeding the existing `useNoteSearch`. `NoteList` gains a sort `Select` and a ⋯-menu Pin/Unpin item with a display-only pin icon.

**Tech Stack:** React 18 + TypeScript (strict), `@gravity-ui/uikit` (`Select`), `@gravity-ui/icons` (`Pin`/`PinFill`/`PinSlash`), Vitest (node `*.test.ts` + jsdom `*.test.tsx`), Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-20-sort-pinning-design.md`

**Convention reminder:** Source files use **4-space indent** + single quotes (Gravity Prettier). The code snippets below render at 2-space because Prettier formats markdown code fences with its base config, not the `*.ts` override — copy the code for its content, then let `npm run lint:fix` / `npm run format` normalize indentation in the real files (each task's typecheck/test steps will pass regardless of indent). Every git commit message must end with the trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 1: Pure metadata + ordering module

**Files:**

- Modify: `src/storage/types.ts` (add `SortMode` and `NotesMetadata` types only — no interface-method change yet)
- Create: `src/storage/metadata.ts`
- Test: `src/storage/metadata.test.ts`

- [ ] **Step 1: Add the metadata types to `types.ts`**

Add these exports near the top of `src/storage/types.ts` (after the `Note` interface, before `NoteStore`). They are pure type declarations and break nothing:

```ts
/** How the note list is ordered. */
export type SortMode = 'updated' | 'title' | 'created';

/** Per-folder notes metadata, persisted alongside the notes (not in any note body). */
export interface NotesMetadata {
  /** Schema version for forward-compatibility. */
  version: 1;
  /** Active sort mode. */
  sort: SortMode;
  /** Pinned note ids. Treated as a membership set; array order is not significant. */
  pinned: string[];
  /** Note id → creation time (epoch ms), stamped on create. */
  created: Record<string, number>;
}
```

- [ ] **Step 2: Write the failing test** at `src/storage/metadata.test.ts`

```ts
import {describe, expect, it} from 'vitest';

import type {NoteMeta} from './types';

import {
  DEFAULT_METADATA,
  METADATA_FILENAME,
  orderNotes,
  parseMetadata,
  reconcile,
  withCreatedStamp,
  withPinToggled,
  withRemoved,
  withRenamed,
  withSortMode,
} from './metadata';

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

  it('does not share references with DEFAULT_METADATA', () => {
    const parsed = parseMetadata({});
    expect(parsed.pinned).not.toBe(DEFAULT_METADATA.pinned);
    expect(parsed.created).not.toBe(DEFAULT_METADATA.created);
  });
});

describe('immutable transforms', () => {
  const base = {version: 1, sort: 'updated', pinned: ['A.md'], created: {'A.md': 1}} as const;

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

  it('withRenamed migrates pin membership and the created entry', () => {
    const next = withRenamed(base, 'A.md', 'A2.md');
    expect(next.pinned).toEqual(['A2.md']);
    expect(next.created).toEqual({'A2.md': 1});
  });

  it('withRenamed is a no-op when the id is unchanged', () => {
    expect(withRenamed(base, 'A.md', 'A.md')).toEqual(base);
  });

  it('withRemoved drops the id from pinned and created', () => {
    const next = withRemoved(base, 'A.md');
    expect(next.pinned).toEqual([]);
    expect(next.created).toEqual({});
  });
});

describe('reconcile', () => {
  it('drops pinned and created entries for ids that are not live', () => {
    const meta = {
      version: 1,
      sort: 'updated',
      pinned: ['A.md', 'ghost.md'],
      created: {'A.md': 1, 'ghost.md': 2},
    } as const;
    const next = reconcile(meta, ['A.md', 'B.md']);
    expect(next.pinned).toEqual(['A.md']);
    expect(next.created).toEqual({'A.md': 1});
  });
});

describe('orderNotes', () => {
  const notes = [
    note('B.md', 'Beta', 300),
    note('A.md', 'Alpha', 100),
    note('C.md', 'Charlie', 200),
  ];

  it('sorts by updated (newest first) by default', () => {
    const meta = {...DEFAULT_METADATA};
    expect(orderNotes(notes, meta).map((n) => n.id)).toEqual(['B.md', 'C.md', 'A.md']);
  });

  it('sorts by title A→Z', () => {
    const meta = {...DEFAULT_METADATA, sort: 'title' as const};
    expect(orderNotes(notes, meta).map((n) => n.title)).toEqual(['Alpha', 'Beta', 'Charlie']);
  });

  it('sorts by created (newest first), falling back to updatedAt when unstamped', () => {
    const meta = {...DEFAULT_METADATA, sort: 'created' as const, created: {'A.md': 999}};
    // A has an explicit created of 999 (newest); B and C fall back to updatedAt 300/200.
    expect(orderNotes(notes, meta).map((n) => n.id)).toEqual(['A.md', 'B.md', 'C.md']);
  });

  it('keeps pinned notes on top, each group sorted by the active sort', () => {
    const meta = {...DEFAULT_METADATA, sort: 'title' as const, pinned: ['C.md']};
    // C is pinned (alone on top); the rest are alphabetical.
    expect(orderNotes(notes, meta).map((n) => n.id)).toEqual(['C.md', 'A.md', 'B.md']);
  });

  it('does not mutate the input array', () => {
    const input = [...notes];
    orderNotes(input, {...DEFAULT_METADATA, sort: 'title'});
    expect(input.map((n) => n.id)).toEqual(['B.md', 'A.md', 'C.md']);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/storage/metadata.test.ts`
Expected: FAIL — cannot resolve `./metadata` (module does not exist yet).

- [ ] **Step 4: Implement `src/storage/metadata.ts`**

```ts
import type {NoteMeta, NotesMetadata, SortMode} from './types';

/** Sidecar file holding the folder's notes metadata. Not a `.md` file, so `list()` ignores it. */
export const METADATA_FILENAME = '.gravity-notes.json';

/** The metadata for a folder with no pins, no stamps, and the default sort. */
export const DEFAULT_METADATA: NotesMetadata = {
  version: 1,
  sort: 'updated',
  pinned: [],
  created: {},
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
  return {version: 1, sort, pinned, created};
}

function cloneDefault(): NotesMetadata {
  return {version: 1, sort: 'updated', pinned: [], created: {}};
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
  return {...meta, pinned, created};
}

export function withRemoved(meta: NotesMetadata, id: string): NotesMetadata {
  const created = {...meta.created};
  delete created[id];
  return {...meta, pinned: meta.pinned.filter((p) => p !== id), created};
}

/** Drop pinned/created entries whose id is no longer a live file (self-heals external deletes). */
export function reconcile(meta: NotesMetadata, liveIds: string[]): NotesMetadata {
  const live = new Set(liveIds);
  const created: Record<string, number> = {};
  for (const [id, time] of Object.entries(meta.created)) {
    if (live.has(id)) created[id] = time;
  }
  return {...meta, pinned: meta.pinned.filter((id) => live.has(id)), created};
}

/** Pure ordering: pinned notes first, each group sorted by the active sort. Does not mutate input. */
export function orderNotes(notes: NoteMeta[], meta: NotesMetadata): NoteMeta[] {
  const pinnedSet = new Set(meta.pinned);
  const compare = comparatorFor(meta.sort, meta.created);
  const pinned = notes.filter((n) => pinnedSet.has(n.id)).sort(compare);
  const rest = notes.filter((n) => !pinnedSet.has(n.id)).sort(compare);
  return [...pinned, ...rest];
}

function comparatorFor(sort: SortMode, created: Record<string, number>) {
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

function createdOf(note: NoteMeta, created: Record<string, number>): number {
  return created[note.id] ?? note.updatedAt ?? 0;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/storage/metadata.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
git add src/storage/types.ts src/storage/metadata.ts src/storage/metadata.test.ts
git commit -m "feat: add notes metadata + ordering layer (sort, pins, created)"
```

---

## Task 2: Persist metadata through the store

**Files:**

- Modify: `src/storage/types.ts` (add two methods to `NoteStore`)
- Modify: `src/storage/fileSystemStore.ts` (implement them)
- Test: `src/storage/fileSystemStore.test.ts` (extend)

> Adding the interface methods and the implementation in the **same** task keeps `npm run typecheck` green at the commit. The in-memory fake needs no change — it already serves arbitrary filenames.

- [ ] **Step 1: Write the failing tests** — append this `describe` block to `src/storage/fileSystemStore.test.ts` (keep existing imports; add `DEFAULT_METADATA` to the metadata import if you reference it — here we don't):

```ts
describe('metadata', () => {
  it('returns defaults when the dotfile is absent', async () => {
    const meta = await store.readMetadata();
    expect(meta).toEqual({version: 1, sort: 'updated', pinned: [], created: {}});
  });

  it('round-trips metadata through write/read', async () => {
    await store.writeMetadata({
      version: 1,
      sort: 'title',
      pinned: ['Ideas.md'],
      created: {'Ideas.md': 123},
    });
    const meta = await store.readMetadata();
    expect(meta.sort).toBe('title');
    expect(meta.pinned).toEqual(['Ideas.md']);
    expect(meta.created).toEqual({'Ideas.md': 123});
  });

  it('returns defaults when the dotfile is corrupt JSON', async () => {
    dir.seedFile('.gravity-notes.json', 'not json{', 10);
    const meta = await store.readMetadata();
    expect(meta).toEqual({version: 1, sort: 'updated', pinned: [], created: {}});
  });

  it('never surfaces the dotfile as a note', async () => {
    dir.seedFile('Real.md', 'hi', 1);
    await store.writeMetadata({version: 1, sort: 'updated', pinned: [], created: {}});
    const metas = await store.list();
    expect(metas.map((m) => m.id)).toEqual(['Real.md']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/storage/fileSystemStore.test.ts -t metadata`
Expected: FAIL — `store.readMetadata is not a function`.

- [ ] **Step 3a: Add the interface methods** to `NoteStore` in `src/storage/types.ts` (after `stat`, before the closing brace):

```ts
    /** Read the folder's notes metadata (sort, pins, created times); defaults if absent or corrupt. */
    readMetadata(): Promise<NotesMetadata>;
    /** Persist the folder's notes metadata. */
    writeMetadata(meta: NotesMetadata): Promise<void>;
```

- [ ] **Step 3b: Implement them** in `src/storage/fileSystemStore.ts`. Update the top import line and add the two methods (place them after `stat`):

Change the imports at the top of the file to:

```ts
import {DEFAULT_METADATA, METADATA_FILENAME, parseMetadata} from './metadata';
import {ConflictError, type Note, type NoteMeta, type NotesMetadata, type NoteStore} from './types';
```

Add these methods inside the class (after `stat`):

```ts
    async readMetadata(): Promise<NotesMetadata> {
        let text: string;
        try {
            const handle = await this.dir.getFileHandle(METADATA_FILENAME);
            text = await (await handle.getFile()).text();
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotFoundError') {
                return DEFAULT_METADATA;
            }
            throw err;
        }
        try {
            return parseMetadata(JSON.parse(text));
        } catch {
            return DEFAULT_METADATA; // corrupt JSON → defaults rather than crashing
        }
    }

    async writeMetadata(meta: NotesMetadata): Promise<void> {
        const handle = await this.dir.getFileHandle(METADATA_FILENAME, {create: true});
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(meta, null, 2));
        await writable.close();
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/storage/fileSystemStore.test.ts` then `npm run typecheck`
Expected: PASS for the store tests; typecheck clean (interface and impl agree).

- [ ] **Step 5: Commit**

```bash
git add src/storage/types.ts src/storage/fileSystemStore.ts src/storage/fileSystemStore.test.ts
git commit -m "feat: persist notes metadata via readMetadata/writeMetadata"
```

---

## Task 3: Wire metadata into `useNotes`

**Files:**

- Modify: `src/hooks/useNotes.ts`
- Test: `src/hooks/useNotes.test.tsx` (extend)

> Uses a `metadataRef` (mirroring the existing `baselineRef`) so mutations always read current state — important because the app runs in `<StrictMode>` and because rapid create/pin actions must not drop entries computed from a stale closure. Metadata writes happen **outside** `setState` updaters.

- [ ] **Step 1: Write the failing tests** — append this block to `src/hooks/useNotes.test.tsx`. Add these imports at the top if not present: `act`, `renderHook`, `waitFor` are already imported; reuse them.

```ts
describe('useNotes metadata', () => {
  async function setup(seed?: (dir: FakeDirectoryHandle) => void) {
    const onError = vi.fn();
    const dir = new FakeDirectoryHandle();
    seed?.(dir);
    const store = new FileSystemNoteStore(asDirectoryHandle(dir));
    const hook = renderHook(() => useNotes(store, onError));
    await waitFor(() => expect(hook.result.current.saveState).toBe('idle'));
    return {hook, dir, store, onError};
  }

  it('stamps a created time when creating a note', async () => {
    const {hook, store} = await setup();
    await act(async () => {
      await hook.result.current.create();
    });
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
    const id = hook.result.current.notes[0].id;
    expect((await store.readMetadata()).created[id]).toBeGreaterThan(0);
  });

  it('persists the sort mode', async () => {
    const {hook, store} = await setup();
    await act(async () => {
      hook.result.current.setSortMode('title');
    });
    await waitFor(async () => expect((await store.readMetadata()).sort).toBe('title'));
    expect(hook.result.current.metadata.sort).toBe('title');
  });

  it('toggles a pin and persists it', async () => {
    const {hook, store} = await setup((dir) => dir.seedFile('Note.md', 'x', 100));
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
    await act(async () => {
      hook.result.current.togglePin('Note.md');
    });
    await waitFor(async () => expect((await store.readMetadata()).pinned).toContain('Note.md'));
    expect(hook.result.current.metadata.pinned).toContain('Note.md');
  });

  it('migrates a pin when a note is renamed', async () => {
    const {hook, store} = await setup((dir) => dir.seedFile('Old.md', 'x', 100));
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
    await act(async () => {
      hook.result.current.togglePin('Old.md');
    });
    await act(async () => {
      await hook.result.current.rename('Old.md', 'New');
    });
    const meta = await store.readMetadata();
    expect(meta.pinned).toEqual(['New.md']);
  });

  it('prunes metadata when a note is removed', async () => {
    const {hook, store} = await setup((dir) => dir.seedFile('Gone.md', 'x', 100));
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
    await act(async () => {
      hook.result.current.togglePin('Gone.md');
    });
    await act(async () => {
      await hook.result.current.remove('Gone.md');
    });
    expect((await store.readMetadata()).pinned).not.toContain('Gone.md');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/useNotes.test.tsx -t "useNotes metadata"`
Expected: FAIL — `setSortMode`/`togglePin`/`metadata` are not on the hook result.

- [ ] **Step 3a: Update imports + the `UseNotes` interface** in `src/hooks/useNotes.ts`.

Change the storage import line to bring in the metadata helpers and types:

```ts
import {
  DEFAULT_METADATA,
  reconcile,
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
  type NotesMetadata,
  type NoteStore,
  type SortMode,
} from '../storage/types';
```

Add to the `UseNotes` interface (after `notes: NoteMeta[];`):

```ts
    /** Folder metadata: active sort, pinned ids, created stamps. */
    metadata: NotesMetadata;
    /** Change the active sort mode (persisted). */
    setSortMode(sort: SortMode): void;
    /** Pin or unpin a note (persisted). */
    togglePin(id: string): void;
```

- [ ] **Step 3b: Add metadata state + a ref + the apply/persist helpers.** Inside `useNotes`, after the existing `const [conflict, setConflict] = useState<NoteConflict | null>(null);` line, add:

```ts
const [metadata, setMetadata] = useState<NotesMetadata>(DEFAULT_METADATA);
/** Always-current metadata, so mutations never read a stale render closure. */
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
```

- [ ] **Step 3c: Reconcile metadata on refresh and stop hard-sorting on save.** Replace the existing `refresh` and `bumpInList` definitions with:

```ts
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
  // Order is re-derived by orderNotes(); only the timestamp changes here.
  setNotes((prev) => prev.map((n) => (n.id === id ? {...n, updatedAt} : n)));
}, []);
```

- [ ] **Step 3d: Stamp/migrate/prune on create/rename/remove.**

In `create`, after `const meta = await store.create('Untitled');` and before `await refresh();`, add:

```ts
await persistMetadata(withCreatedStamp(metadataRef.current, meta.id, meta.updatedAt ?? 0));
```

In `rename`, after `const meta = await store.rename(id, nextTitle);` and before `await refresh();`, add:

```ts
if (meta.id !== id) {
  await persistMetadata(withRenamed(metadataRef.current, id, meta.id));
}
```

In `remove`, after `await store.remove(id);` and before the `if (pendingRef.current?.id === id)` line, add:

```ts
await persistMetadata(withRemoved(metadataRef.current, id));
```

- [ ] **Step 3e: Load metadata on mount.** Replace the existing initial-load effect:

```ts
// Initial load.
useEffect(() => {
  void refresh();
}, [refresh]);
```

with one that loads notes **and** metadata together, reconciling stale ids:

```ts
// Initial load: notes + metadata, reconciling any stale pinned/created ids.
useEffect(() => {
  let cancelled = false;
  void (async () => {
    const [list, meta] = await Promise.all([store.list(), store.readMetadata()]);
    if (cancelled) return;
    setNotes(list);
    applyMetadata(
      reconcile(
        meta,
        list.map((n) => n.id),
      ),
    );
  })();
  return () => {
    cancelled = true;
  };
}, [store, applyMetadata]);
```

- [ ] **Step 3f: Export the new fields.** In the returned object at the end of `useNotes`, add `metadata`, `setSortMode`, and `togglePin` (e.g. right after `notes,`):

```ts
        notes,
        metadata,
        setSortMode,
        togglePin,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/useNotes.test.tsx` then `npm run typecheck`
Expected: PASS for all `useNotes` tests (new + existing conflict-resolver tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useNotes.ts src/hooks/useNotes.test.tsx
git commit -m "feat: own notes metadata in useNotes (sort, pin, created, reconcile)"
```

---

## Task 4: Sort control + pin UI in `NoteList`, wired through `Workspace`

**Files:**

- Modify: `src/components/NoteList.tsx`
- Modify: `src/components/NoteList.css`
- Modify: `src/components/Workspace.tsx`
- Test: `src/components/NoteList.test.tsx` (extend)

> `NoteList` gains four required props; `Workspace` (its only caller) is updated in the same task so `npm run typecheck` stays green at the commit.

- [ ] **Step 1: Write the failing tests.** In `src/components/NoteList.test.tsx`, first extend the shared `setup` defaults so existing tests still compile — add these four entries to the `props` object inside `setup` (alongside `onDelete: vi.fn()`):

```ts
        sortMode: 'updated',
        onSortChange: vi.fn(),
        pinnedIds: [],
        onTogglePin: vi.fn(),
```

Then append these `describe` blocks:

```ts
describe('NoteList — sort control', () => {
  it('changes the sort mode via the sort control', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', {name: /Updated/}));
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
    const props = setup();
    const alpha = screen.getByRole('option', {name: /Alpha/});
    await user.click(within(alpha).getByRole('button'));
    await user.click(await screen.findByRole('menuitem', {name: /Pin to top/}));
    expect(props.onTogglePin).toHaveBeenCalledWith('Alpha.md');
  });

  it('unpins a pinned note from the menu', async () => {
    const user = userEvent.setup();
    const props = setup({pinnedIds: ['Alpha.md']});
    const alpha = screen.getByRole('option', {name: /Alpha/});
    await user.click(within(alpha).getByRole('button'));
    await user.click(await screen.findByRole('menuitem', {name: /Unpin/}));
    expect(props.onTogglePin).toHaveBeenCalledWith('Alpha.md');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/NoteList.test.tsx -t "sort control"` and `... -t pinning`
Expected: FAIL — no sort control / pin icon / Pin menu item yet.

- [ ] **Step 3a: Update `NoteList.tsx`.** Change the icon + uikit imports:

```ts
import {Ellipsis, Pencil, Pin, PinFill, PinSlash, Plus, TrashBin} from '@gravity-ui/icons';
import {Button, Dialog, DropdownMenu, Icon, Select, Text, TextInput} from '@gravity-ui/uikit';
```

Update the type import to include `SortMode`:

```ts
import type {NoteMeta, SortMode} from '../storage/types';
```

Add the four props to `NoteListProps` (after `notes: NoteMeta[];`):

```ts
    sortMode: SortMode;
    onSortChange: (mode: SortMode) => void;
    pinnedIds: string[];
    onTogglePin: (id: string) => void;
```

Destructure them in the component signature (add to the existing destructure list):

```ts
    sortMode,
    onSortChange,
    pinnedIds,
    onTogglePin,
```

Inside the component body, before the `return`, derive a pin lookup:

```ts
const pinnedSet = new Set(pinnedIds);
```

In the header (`note-list__header`), add the sort `Select` between the title and the New button. Replace the header block with:

```tsx
<div className="note-list__header">
  <Text variant="subheader-2">Notes</Text>
  <div className="note-list__header-actions">
    <Select
      className="note-list__sort"
      size="m"
      value={[sortMode]}
      onUpdate={([next]) => onSortChange(next as SortMode)}
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
```

In the row's non-editing branch, add the pin icon before the title and a Pin/Unpin menu item. Replace the `<>...</>` non-editing fragment (the block starting with `<Text className="note-list__title" ellipsis>`) with:

```tsx
<>
  {pinnedSet.has(note.id) ? <Icon className="note-list__pin" data={PinFill} size={14} /> : null}
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
```

- [ ] **Step 3b: Add styles** to `src/components/NoteList.css` (append):

```css
.note-list__header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.note-list__sort {
  flex-shrink: 0;
}

.note-list__pin {
  flex-shrink: 0;
  color: var(--g-color-text-warning);
}
```

- [ ] **Step 3c: Wire `Workspace.tsx`.** Add the `orderNotes` import:

```ts
import {orderNotes} from '../storage/metadata';
```

Replace the `useNoteSearch` wiring line:

```ts
const {query, setQuery, filteredNotes} = useNoteSearch(notes.notes);
```

with an ordered base list feeding search:

```ts
const orderedNotes = useMemo(
  () => orderNotes(notes.notes, notes.metadata),
  [notes.notes, notes.metadata],
);
const {query, setQuery, filteredNotes} = useNoteSearch(orderedNotes);
```

(`useMemo` is already imported in `Workspace.tsx`.)

Pass the four new props to `<NoteList>` (add alongside the existing props):

```tsx
                        sortMode={notes.metadata.sort}
                        onSortChange={notes.setSortMode}
                        pinnedIds={notes.metadata.pinned}
                        onTogglePin={notes.togglePin}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/NoteList.test.tsx` then `npm run typecheck`
Expected: PASS for all `NoteList` tests (new + existing); typecheck clean.

> If the sort `Select`'s popup proves hard to drive in jsdom, confirm the trigger is found by `getByRole('button', {name: /Updated/})` and the options render with `role="option"`; both are standard Gravity `Select` behavior and the delete test already drives a Gravity popup the same way.

- [ ] **Step 5: Commit**

```bash
git add src/components/NoteList.tsx src/components/NoteList.css src/components/NoteList.test.tsx src/components/Workspace.tsx
git commit -m "feat: sort control + pin/unpin in the note list"
```

---

## Task 5: Shortcuts descriptor + help-dialog completeness (3a polish)

**Files:**

- Create: `src/shortcuts.ts`
- Modify: `src/components/ShortcutsDialog.tsx` (render from the descriptor)
- Modify: `src/hooks/useShortcuts.ts` (derive global bindings from the descriptor)
- Test: `src/components/ShortcutsDialog.test.tsx` (extend), `src/hooks/useShortcuts.test.tsx` (unchanged — must stay green)

> Single source of truth removes the hand-maintained drift and adds the previously-missing rows (Enter to open, Esc to clear search). The keydown handler becomes data-driven over the same descriptor.

- [ ] **Step 1: Write the failing test** — replace the body of `src/components/ShortcutsDialog.test.tsx` with:

```ts
import {screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {SHORTCUTS} from '../shortcuts';
import {renderWithProviders} from '../test/render';

import {ShortcutsDialog} from './ShortcutsDialog';

describe('ShortcutsDialog', () => {
    it('renders a row for every shortcut in the descriptor', () => {
        renderWithProviders(<ShortcutsDialog open onClose={vi.fn()} />);
        for (const shortcut of SHORTCUTS) {
            expect(screen.getByText(shortcut.description)).toBeInTheDocument();
        }
    });

    it('includes the previously-missing rows', () => {
        renderWithProviders(<ShortcutsDialog open onClose={vi.fn()} />);
        expect(screen.getByText('Open the focused note')).toBeInTheDocument();
        expect(screen.getByText('Clear search')).toBeInTheDocument();
    });

    it('renders nothing when closed', () => {
        renderWithProviders(<ShortcutsDialog open={false} onClose={vi.fn()} />);
        expect(screen.queryByText('Focus search')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/ShortcutsDialog.test.tsx`
Expected: FAIL — cannot resolve `../shortcuts`.

- [ ] **Step 3a: Create `src/shortcuts.ts`**

```ts
/** The set of actions the global keyboard handler can invoke. */
export type ShortcutAction = 'focusSearch' | 'createNote' | 'toggleEditorMode' | 'openHelp';

/** How a globally-handled shortcut maps to a key event. */
export interface GlobalBinding {
  /** 'mod' = ⌘/Ctrl combo; 'bare' = the key alone (gated against typing surfaces). */
  trigger: 'mod' | 'bare';
  /** `event.key` to match (lower-cased for the 'mod' trigger). */
  key: string;
  /** Which action to fire. */
  action: ShortcutAction;
}

/** One row of the keyboard-shortcut help sheet, and (optionally) its global binding. */
export interface ShortcutDescriptor {
  /** Gravity <Hotkey> value, e.g. 'mod+k'. */
  keys: string;
  /** Human description shown in the help dialog. */
  description: string;
  /** Help-dialog grouping. */
  group: 'Navigation' | 'Editing' | 'General';
  /** Present when the global handler (useShortcuts) owns this key; absent for list-scoped keys. */
  global?: GlobalBinding;
}

/** Single source of truth for both the global handler and the help dialog. */
export const SHORTCUTS: ShortcutDescriptor[] = [
  {
    keys: 'mod+k',
    description: 'Focus search',
    group: 'Navigation',
    global: {trigger: 'mod', key: 'k', action: 'focusSearch'},
  },
  {keys: 'up', description: 'Previous note', group: 'Navigation'},
  {keys: 'down', description: 'Next note', group: 'Navigation'},
  {keys: 'enter', description: 'Open the focused note', group: 'Navigation'},
  {keys: 'esc', description: 'Clear search', group: 'Navigation'},
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

/** Help-dialog group order. */
export const SHORTCUT_GROUPS: ShortcutDescriptor['group'][] = ['Navigation', 'Editing', 'General'];
```

- [ ] **Step 3b: Render `ShortcutsDialog` from the descriptor.** Replace the body of `src/components/ShortcutsDialog.tsx` with:

```tsx
import {Dialog, Hotkey, Text} from '@gravity-ui/uikit';

import {SHORTCUT_GROUPS, SHORTCUTS} from '../shortcuts';

import './ShortcutsDialog.css';

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Read-only help sheet listing the app's keyboard shortcuts, derived from SHORTCUTS. */
export function ShortcutsDialog({open, onClose}: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} size="s">
      <Dialog.Header caption="Keyboard shortcuts" />
      <Dialog.Body>
        <div className="shortcuts-dialog">
          {SHORTCUT_GROUPS.map((group) => {
            const rows = SHORTCUTS.filter((shortcut) => shortcut.group === group);
            if (rows.length === 0) return null;
            return (
              <div key={group} className="shortcuts-dialog__group">
                <Text variant="subheader-1" color="secondary">
                  {group}
                </Text>
                {rows.map((shortcut) => (
                  <div key={shortcut.keys} className="shortcuts-dialog__row">
                    <Text>{shortcut.description}</Text>
                    <Hotkey value={shortcut.keys} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Dialog.Body>
    </Dialog>
  );
}
```

- [ ] **Step 3c: Make `useShortcuts` data-driven over the descriptor.** Replace the body of `src/hooks/useShortcuts.ts` with:

```ts
import {useEffect, useRef} from 'react';

import {SHORTCUTS, type ShortcutAction} from '../shortcuts';

export type ShortcutActions = Record<ShortcutAction, () => void>;

/** True when keystrokes should be left to the focused text surface. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

/**
 * Global keyboard shortcuts, driven by the SHORTCUTS descriptor (the same source
 * the help dialog renders from). Command-modifier combos act regardless of focus
 * and preventDefault; bare keys (the `?` help key) are gated so they never steal a
 * keystroke from the editor or an input. List ↑/↓ navigation lives in NoteList.
 *
 * Actions are read through a ref so the listener binds once and always calls the
 * latest callbacks, even though `Workspace` passes a fresh object each render.
 */
export function useShortcuts(actions: ShortcutActions): void {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return; // a held key shouldn't fire the action repeatedly
      const mod = event.metaKey || event.ctrlKey;
      for (const {global: binding} of SHORTCUTS) {
        if (!binding) continue;
        if (binding.trigger === 'mod') {
          if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === binding.key) {
            event.preventDefault();
            actionsRef.current[binding.action]();
            return;
          }
        } else if (event.key === binding.key && !isTypingTarget(document.activeElement)) {
          event.preventDefault();
          actionsRef.current[binding.action]();
          return;
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // Intentional empty deps: listener binds once; latest actions always read via actionsRef.
  }, []);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/ShortcutsDialog.test.tsx src/hooks/useShortcuts.test.tsx` then `npm run typecheck`
Expected: PASS — the new dialog tests and the existing `useShortcuts` tests (mod+k/ctrl+j/mod+//?/repeat) all green; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shortcuts.ts src/components/ShortcutsDialog.tsx src/hooks/useShortcuts.ts src/components/ShortcutsDialog.test.tsx
git commit -m "refactor: single shortcuts descriptor; complete help dialog"
```

---

## Task 6: Full verification + roadmap update

**Files:**

- Modify: `CLAUDE.md` (mark slice 3b status)

- [ ] **Step 1: Run the whole suite + all gates**

Run, in order:

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

Expected: all green. If `format:check` flags files, run `npm run format` and re-commit.

- [ ] **Step 2: Manual smoke (real browser)**

Run `npm run dev`, open the app, pick a folder with a few notes, then verify:

- The sort control switches between Updated / Title (A→Z) / Created and reorders the list.
- Pin to top from the ⋯ menu hoists a note above the rest with a pin icon; Unpin restores it.
- Reload the page — the sort mode and pins persist (a `.gravity-notes.json` appears in the folder).
- Search still filters the ordered list, pinned matches stay on top, and ↑/↓/⌘K still navigate.
- The `?` help dialog shows the new Enter/Esc rows.

- [ ] **Step 3: Update the roadmap** in `CLAUDE.md`. Change the slice-3b line under "Roadmap & active work" from:

```
   - ⬜ **Sort & pinning — 3b** (next) — sort modes + pinned notes; introduces the metadata-persistence
     layer (the architectural decision deferred from 3a; touches the `NoteStore` interface).
     Kickoff: `docs/superpowers/handoffs/2026-06-20-sort-pinning-kickoff.md`.
```

to:

```
   - ✅ **Sort & pinning — 3b** — sort modes (updated/title/created) + pinned notes, persisted in a
     `.gravity-notes.json` folder dotfile via `NoteStore.readMetadata`/`writeMetadata`; ordering moved
     to a pure `orderNotes`. Spec: `docs/superpowers/specs/2026-06-20-sort-pinning-design.md`.
```

- [ ] **Step 4: Commit**

```bash
npm run format
git add CLAUDE.md
git commit -m "docs: mark Sort & Pinning (3b) complete in the roadmap"
```

---

## Self-review checklist (completed during planning)

- **Spec coverage:** dotfile data model → Task 1/2; `readMetadata`/`writeMetadata` on `NoteStore` → Task 2; pure `orderNotes` + reconcile + transforms → Task 1; `useNotes` load/setSortMode/togglePin/create-stamp/rename-migrate/remove-prune/bumpInList-no-sort → Task 3; sort `Select` + pin icon + ⋯ Pin/Unpin + `Workspace` `orderNotes` memo → Task 4; help-dialog completeness + single descriptor + divergence guard → Task 5; full verification + manual smoke → Task 6. Manual drag-reorder and a sort/pin keyboard shortcut are correctly out of scope.
- **Type consistency:** `NotesMetadata`/`SortMode` defined in `types.ts` (Task 1), consumed identically in `metadata.ts`, `fileSystemStore.ts`, `useNotes.ts`, `NoteList.tsx`, `Workspace.tsx`. Helper names (`withSortMode`, `withPinToggled`, `withCreatedStamp`, `withRenamed`, `withRemoved`, `reconcile`, `orderNotes`, `parseMetadata`, `DEFAULT_METADATA`, `METADATA_FILENAME`) match across the module, its tests, and its consumers. `ShortcutAction`/`ShortcutActions` are defined once (`shortcuts.ts` / `useShortcuts.ts`) with no import cycle (only `useShortcuts → shortcuts`).
- **Green-at-each-commit:** interface methods land with their implementation (Task 2); `NoteList`'s new required props land with their `Workspace` caller (Task 4); `useShortcuts.test.tsx` is preserved unchanged and the data-driven handler keeps every case green (Task 5).
- **No placeholders:** every code step shows complete code; every run step gives the command and expected result.
