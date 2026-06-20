# Multi-tab Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user keep multiple notes open as switchable editor tabs and restore the open set + active tab across reloads.

**Architecture:** Centralize per-tab state in `useNotes` (Approach A): the single `selectedId`/`selectedNote` become `openIds` + `activeId` plus per-id maps for loaded notes, save state, conflicts, pending edits, baselines, and autosave timers. Open tabs + active tab persist in the existing `.gravity-notes.json` dotfile. Every open tab keeps a live `EditorPane` mounted (inactive ones hidden with the `hidden` attribute) so switching is lossless; an externally-changed tab remounts fresh on reload via the existing `id:updatedAt` key.

**Tech Stack:** React 18 + TypeScript (strict), `@gravity-ui/uikit` + `@gravity-ui/icons`, `@gravity-ui/markdown-editor`, Vitest + Testing Library + jsdom, File System Access API behind the `NoteStore` interface.

**Spec:** `docs/superpowers/specs/2026-06-20-multi-tab-editing-design.md`

**Execution order & the typecheck window:** Tasks 1–3 are independent and leave the whole project green. Task 4 rewrites `useNotes`; its gate is `npm test` (Vitest), which stays green because no test imports `Workspace`. `npm run build` (tsc) will report errors in `Workspace.tsx` only between Task 4 and Task 5 — Task 5 rewires `Workspace` and restores a green `tsc`, and Task 6 runs the full build.

---

## File structure

- `src/storage/types.ts` — **modify**: add `open` / `active` to `NotesMetadata`.
- `src/storage/metadata.ts` — **modify**: defaults, `parseMetadata`, `reconcile`, `withRenamed`, `withRemoved`; new `withOpened` / `withClosed` / `withActive`.
- `src/storage/metadata.test.ts` — **modify**: satisfy the new type in existing literals; add tab-helper tests.
- `src/components/EditorPane.tsx` — **modify**: add `active` prop (gates autofocus + focus-on-activate), expose `focus()` on the handle.
- `src/components/EditorPane.test.tsx` — **modify**: add `focus` to the editor mock; pass `active`.
- `src/components/TabBar.tsx` — **create**: the tab strip.
- `src/components/TabBar.css` — **create**: tab strip styles.
- `src/components/TabBar.test.tsx` — **create**: tab strip tests.
- `src/hooks/useNotes.ts` — **modify (rewrite)**: per-tab state model + `open`/`activate`/`close` + restore.
- `src/hooks/useNotes.test.tsx` — **modify**: migrate conflict tests to the new API; add tab tests.
- `src/components/Workspace.tsx` — **modify**: render `TabBar` + the mounted editor stack; wire tab actions.
- `src/components/Workspace.css` — **modify**: editor column + hidden panes.
- `src/components/Workspace.test.tsx` — **create**: open-from-sidebar → tab integration test.
- `CLAUDE.md` — **modify**: record the feature in the roadmap.

---

## Task 1: Metadata data model + pure helpers

**Files:**

- Modify: `src/storage/types.ts`
- Modify: `src/storage/metadata.ts`
- Test: `src/storage/metadata.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/storage/metadata.test.ts`, first update the import to include the new helpers:

```ts
import {
  DEFAULT_METADATA,
  METADATA_FILENAME,
  orderNotes,
  parseMetadata,
  reconcile,
  withActive,
  withClosed,
  withCreatedStamp,
  withOpened,
  withPinToggled,
  withRemoved,
  withRenamed,
  withSortMode,
} from './metadata';
```

Update the existing `immutable transforms` `base` literal (it must now satisfy `NotesMetadata`):

```ts
const base = {
  version: 1,
  sort: 'updated',
  pinned: ['A.md'],
  created: {'A.md': 1},
  open: ['A.md'],
  active: 'A.md',
} as const;
```

Update both `reconcile` test literals to include the new fields (add these two lines inside each `meta` object, after `created`):

```ts
            open: [],
            active: null,
```

Append these new `describe` blocks at the end of the file:

```ts
describe('parseMetadata — open tabs', () => {
  it('defaults open/active when absent', () => {
    const parsed = parseMetadata({version: 1, sort: 'updated', pinned: [], created: {}});
    expect(parsed.open).toEqual([]);
    expect(parsed.active).toBeNull();
  });

  it('keeps a valid open list and active id, dropping non-strings', () => {
    const parsed = parseMetadata({
      version: 1,
      sort: 'updated',
      pinned: [],
      created: {},
      open: ['A.md', 7, 'B.md'],
      active: 'B.md',
    });
    expect(parsed.open).toEqual(['A.md', 'B.md']);
    expect(parsed.active).toBe('B.md');
  });

  it('clears active when it is not in open', () => {
    const parsed = parseMetadata({
      version: 1,
      sort: 'updated',
      pinned: [],
      created: {},
      open: ['A.md'],
      active: 'ghost.md',
    });
    expect(parsed.active).toBeNull();
  });
});

describe('tab transforms', () => {
  const base = {
    version: 1,
    sort: 'updated',
    pinned: [],
    created: {},
    open: ['A.md', 'B.md'],
    active: 'A.md',
  } as const;

  it('withOpened appends a new id and activates it', () => {
    const next = withOpened(base, 'C.md');
    expect(next.open).toEqual(['A.md', 'B.md', 'C.md']);
    expect(next.active).toBe('C.md');
  });

  it('withOpened only activates an already-open id (no duplicate)', () => {
    const next = withOpened(base, 'B.md');
    expect(next.open).toEqual(['A.md', 'B.md']);
    expect(next.active).toBe('B.md');
  });

  it('withActive sets the active id', () => {
    expect(withActive(base, 'B.md').active).toBe('B.md');
  });

  it('withClosed removes the id and activates the right neighbor when closing active', () => {
    const next = withClosed(base, 'A.md');
    expect(next.open).toEqual(['B.md']);
    expect(next.active).toBe('B.md');
  });

  it('withClosed activates the left neighbor when closing the last (active) tab', () => {
    const next = withClosed({...base, active: 'B.md'}, 'B.md');
    expect(next.open).toEqual(['A.md']);
    expect(next.active).toBe('A.md');
  });

  it('withClosed leaves active null when closing the only tab', () => {
    const next = withClosed(
      {version: 1, sort: 'updated', pinned: [], created: {}, open: ['A.md'], active: 'A.md'},
      'A.md',
    );
    expect(next.open).toEqual([]);
    expect(next.active).toBeNull();
  });

  it('withClosed keeps active when closing a non-active tab', () => {
    const next = withClosed(base, 'B.md');
    expect(next.open).toEqual(['A.md']);
    expect(next.active).toBe('A.md');
  });

  it('withRenamed remaps open entries and active', () => {
    const next = withRenamed(base, 'A.md', 'A2.md');
    expect(next.open).toEqual(['A2.md', 'B.md']);
    expect(next.active).toBe('A2.md');
  });

  it('withRemoved drops the id from open and reactivates a neighbor', () => {
    const next = withRemoved(base, 'A.md');
    expect(next.open).toEqual(['B.md']);
    expect(next.active).toBe('B.md');
  });

  it('reconcile drops open ids that are not live and clamps active', () => {
    const next = reconcile(base, ['B.md']);
    expect(next.open).toEqual(['B.md']);
    expect(next.active).toBe('B.md');
  });

  it('reconcile clamps active to null when nothing is live', () => {
    const next = reconcile(base, []);
    expect(next.open).toEqual([]);
    expect(next.active).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/storage/metadata.test.ts`
Expected: FAIL — `withOpened`/`withClosed`/`withActive` are not exported, and the new `open`/`active` fields don't exist on `NotesMetadata`.

- [ ] **Step 3: Add `open`/`active` to the `NotesMetadata` type**

In `src/storage/types.ts`, extend the interface (add the two fields after `created`):

```ts
export interface NotesMetadata {
  /** Schema version for forward-compatibility. */
  version: 1;
  /** Active sort mode. */
  sort: SortMode;
  /** Pinned note ids. Treated as a membership set; array order is not significant. */
  pinned: readonly string[];
  /** Note id → creation time (epoch ms), stamped on create. */
  created: Readonly<Record<string, number>>;
  /** Open tab ids, in tab (left-to-right) order. */
  open: readonly string[];
  /** Active tab id, or null when no tabs are open. Always an element of `open` when non-null. */
  active: string | null;
}
```

- [ ] **Step 4: Update defaults, parse, reconcile, and the rename/remove transforms; add the tab helpers**

In `src/storage/metadata.ts`:

Replace `DEFAULT_METADATA`:

```ts
export const DEFAULT_METADATA: NotesMetadata = {
  version: 1,
  sort: 'updated',
  pinned: [],
  created: {},
  open: [],
  active: null,
};
```

Replace `cloneDefault`:

```ts
function cloneDefault(): NotesMetadata {
  return {version: 1, sort: 'updated', pinned: [], created: {}, open: [], active: null};
}
```

In `parseMetadata`, replace the final `return` with open/active parsing + clamping:

```ts
const open = Array.isArray(obj.open)
  ? obj.open.filter((x): x is string => typeof x === 'string')
  : [];
let active = typeof obj.active === 'string' ? obj.active : null;
if (active !== null && !open.includes(active)) active = null;
return {version: 1, sort, pinned, created, open, active};
```

Replace `withRenamed` (add open/active remap):

```ts
export function withRenamed(meta: NotesMetadata, oldId: string, newId: string): NotesMetadata {
  if (oldId === newId) return meta;
  const pinned = meta.pinned.map((p) => (p === oldId ? newId : p));
  const created = {...meta.created};
  if (oldId in created) {
    created[newId] = created[oldId];
    delete created[oldId];
  }
  const open = meta.open.map((o) => (o === oldId ? newId : o));
  const active = meta.active === oldId ? newId : meta.active;
  return {...meta, pinned, created, open, active};
}
```

Replace `withRemoved` (drop from open/active by reusing `withClosed`):

```ts
export function withRemoved(meta: NotesMetadata, id: string): NotesMetadata {
  const created = {...meta.created};
  delete created[id];
  const base = {...meta, pinned: meta.pinned.filter((p) => p !== id), created};
  return withClosed(base, id);
}
```

Replace `reconcile` (also prune open + clamp active):

```ts
export function reconcile(meta: NotesMetadata, liveIds: string[]): NotesMetadata {
  const live = new Set(liveIds);
  const created: Record<string, number> = {};
  for (const [id, time] of Object.entries(meta.created)) {
    if (live.has(id)) created[id] = time;
  }
  const open = meta.open.filter((id) => live.has(id));
  const active = meta.active && live.has(meta.active) ? meta.active : (open[0] ?? null);
  return {...meta, pinned: meta.pinned.filter((id) => live.has(id)), created, open, active};
}
```

Add the three new tab helpers (place them next to `withPinToggled`):

```ts
/** Open `id` as a tab (appending if new) and make it active. */
export function withOpened(meta: NotesMetadata, id: string): NotesMetadata {
  const open = meta.open.includes(id) ? meta.open : [...meta.open, id];
  return {...meta, open, active: id};
}

/** Make an already-open tab active. */
export function withActive(meta: NotesMetadata, id: string): NotesMetadata {
  return {...meta, active: id};
}

/** Close `id`; if it was active, activate the right neighbor, else the left, else nothing. */
export function withClosed(meta: NotesMetadata, id: string): NotesMetadata {
  const idx = meta.open.indexOf(id);
  if (idx === -1) return meta;
  const open = meta.open.filter((o) => o !== id);
  let active = meta.active;
  if (active === id) {
    active = meta.open[idx + 1] ?? meta.open[idx - 1] ?? null;
  }
  return {...meta, open, active};
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/storage/metadata.test.ts`
Expected: PASS (all metadata tests).

- [ ] **Step 6: Commit**

```bash
git add src/storage/types.ts src/storage/metadata.ts src/storage/metadata.test.ts
git commit -m "$(cat <<'EOF'
feat(metadata): add open-tabs + active-tab to the folder metadata

Adds open/active fields to NotesMetadata with tolerant parsing + active
clamping, new withOpened/withClosed/withActive helpers, and open/active
handling in withRenamed/withRemoved/reconcile.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `EditorPane` active prop + focus

**Files:**

- Modify: `src/components/EditorPane.tsx`
- Test: `src/components/EditorPane.test.tsx`

- [ ] **Step 1: Update the test mock and add a focus-on-activate test**

In `src/components/EditorPane.test.tsx`, add `focus` to the hoisted fake editor:

```ts
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
```

Update the two existing `render(...)` calls to pass `active` (toggleMode works regardless of active):

```ts
        render(<EditorPane ref={ref} note={NOTE} active={true} onChange={() => {}} />);
```

Add a new `describe` block:

```ts
describe('EditorPane focus', () => {
    beforeEach(() => focus.mockClear());

    it('focuses the editor when mounted active', () => {
        render(<EditorPane note={NOTE} active={true} onChange={() => {}} />);
        expect(focus).toHaveBeenCalled();
    });

    it('does not focus the editor when mounted inactive', () => {
        render(<EditorPane note={NOTE} active={false} onChange={() => {}} />);
        expect(focus).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/EditorPane.test.tsx`
Expected: FAIL — `EditorPane` has no `active` prop and never calls `focus`.

- [ ] **Step 3: Add the `active` prop and focus behavior**

Replace `src/components/EditorPane.tsx` with:

```tsx
import {forwardRef, useEffect, useImperativeHandle} from 'react';

import {MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';

import type {Note} from '../storage/types';

export interface EditorPaneHandle {
  /** Flip between the WYSIWYG and Markup editing modes. */
  toggleMode(): void;
}

interface EditorPaneProps {
  note: Note;
  /** Whether this pane is the visible/active tab. Only the active pane autofocuses. */
  active: boolean;
  onChange: (markup: string) => void;
}

/**
 * Wraps the Gravity markdown editor for a single note.
 *
 * One pane is mounted per open tab; inactive panes are hidden by the parent but
 * stay mounted to preserve their cursor/scroll/undo state. The editor instance is
 * re-created whenever the note id (or its on-disk `updatedAt`) changes via the
 * `deps` argument, loading that note's markup as the initial value. Only the active
 * pane autofocuses, and it refocuses whenever it becomes active.
 */
export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane(
  {note, active, onChange},
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
    }),
    [editor],
  );

  useEffect(() => {
    const handleChange = () => {
      const value = editor.getValue();
      // Ignore the no-op change emitted while the initial markup is loaded, so we
      // don't rewrite the file (and bump it to the top of the list) on open.
      if (value !== note.content) {
        onChange(value);
      }
    };
    editor.on('change', handleChange);
    return () => {
      editor.off('change', handleChange);
    };
  }, [editor, note.content, onChange]);

  // Focus when this pane becomes the active tab (and on initial mount-as-active).
  useEffect(() => {
    if (active) editor.focus();
  }, [active, editor]);

  return <MarkdownEditorView stickyToolbar autofocus={active} editor={editor} />;
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/EditorPane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/EditorPane.tsx src/components/EditorPane.test.tsx
git commit -m "$(cat <<'EOF'
feat(editor): add active prop to EditorPane for multi-tab mounting

Only the active pane autofocuses and it refocuses when it becomes active,
so inactive tabs can stay mounted (and keep their state) without fighting
over focus.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `TabBar` component

**Files:**

- Create: `src/components/TabBar.tsx`
- Create: `src/components/TabBar.css`
- Test: `src/components/TabBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/TabBar.test.tsx`:

```tsx
import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {renderWithProviders} from '../test/render';

import {TabBar, type TabDescriptor} from './TabBar';

const TABS: TabDescriptor[] = [
  {id: 'Alpha.md', title: 'Alpha', unsaved: false, conflict: false},
  {id: 'Beta.md', title: 'Beta', unsaved: true, conflict: false},
];

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    tabs: TABS,
    activeId: 'Alpha.md',
    onActivate: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  renderWithProviders(<TabBar {...(props as React.ComponentProps<typeof TabBar>)} />);
  return props;
}

describe('TabBar', () => {
  it('renders a tab per descriptor', () => {
    setup();
    expect(screen.getByRole('tab', {name: 'Alpha'})).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: 'Beta'})).toBeInTheDocument();
  });

  it('marks the active tab', () => {
    setup({activeId: 'Beta.md'});
    expect(screen.getByRole('tab', {name: 'Beta'})).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('tab', {name: 'Alpha'})).toHaveAttribute('aria-current', 'false');
  });

  it('activates a tab on click', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('tab', {name: 'Beta'}));
    expect(props.onActivate).toHaveBeenCalledWith('Beta.md');
  });

  it('closes a tab from its close button', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', {name: 'Close Alpha'}));
    expect(props.onClose).toHaveBeenCalledWith('Alpha.md');
  });

  it('shows an unsaved indicator only on unsaved tabs', () => {
    setup(); // Alpha is saved, Beta is unsaved
    expect(screen.getAllByLabelText('Unsaved changes')).toHaveLength(1);
  });

  it('shows a conflict indicator on conflicted tabs', () => {
    setup({tabs: [{id: 'Alpha.md', title: 'Alpha', unsaved: false, conflict: true}]});
    expect(screen.getByLabelText('Changed on disk')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/TabBar.test.tsx`
Expected: FAIL — `./TabBar` does not exist.

- [ ] **Step 3: Create the component**

Create `src/components/TabBar.tsx`:

```tsx
import {Xmark} from '@gravity-ui/icons';
import {Button, Icon} from '@gravity-ui/uikit';

import './TabBar.css';

/** One open tab's display state. */
export interface TabDescriptor {
  id: string;
  title: string;
  /** True while the tab has a pending (debouncing) edit. */
  unsaved: boolean;
  /** True when the tab's note changed on disk underneath us. */
  conflict: boolean;
}

interface TabBarProps {
  tabs: TabDescriptor[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

/**
 * Horizontal strip of open-note tabs. Click a tab to activate it; click its ×
 * (or middle-click the tab) to close it. A custom strip rather than Gravity's
 * `Tabs` because each tab needs its own close button — a separate interactive
 * element that a `Tab`-as-button can't cleanly nest.
 */
export function TabBar({tabs, activeId, onActivate, onClose}: TabBarProps) {
  return (
    <div className="tab-bar" role="tablist" aria-label="Open notes">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={`tab-bar__tab${isActive ? ' tab-bar__tab_active' : ''}`}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.id);
              }
            }}
          >
            {/* Marker is a sibling of the tab button so it stays out of the
                            tab's accessible name but remains its own labelled element. */}
            {tab.conflict ? (
              <span
                className="tab-bar__marker tab-bar__marker_conflict"
                role="img"
                aria-label="Changed on disk"
              />
            ) : tab.unsaved ? (
              <span
                className="tab-bar__marker tab-bar__marker_unsaved"
                role="img"
                aria-label="Unsaved changes"
              />
            ) : null}
            <button
              type="button"
              className="tab-bar__label"
              role="tab"
              aria-current={isActive}
              onClick={() => onActivate(tab.id)}
            >
              <span className="tab-bar__title">{tab.title}</span>
            </button>
            <Button
              view="flat"
              size="s"
              className="tab-bar__close"
              aria-label={`Close ${tab.title}`}
              onClick={() => onClose(tab.id)}
            >
              <Icon data={Xmark} size={14} />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
```

Create `src/components/TabBar.css`:

```css
.tab-bar {
  display: flex;
  align-items: stretch;
  gap: 2px;
  flex-shrink: 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--g-color-line-generic);
  background-color: var(--g-color-base-background);
}

.tab-bar__tab {
  display: flex;
  align-items: center;
  max-width: 220px;
  border-right: 1px solid var(--g-color-line-generic);
}

.tab-bar__tab_active {
  background-color: var(--g-color-base-selection);
}

.tab-bar__label {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 6px 4px 6px 8px;
  border: none;
  background: transparent;
  color: var(--g-color-text-primary);
  font: inherit;
  cursor: pointer;
}

.tab-bar__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-bar__marker {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-left: 10px;
  border-radius: 50%;
}

.tab-bar__marker_unsaved {
  background-color: var(--g-color-text-secondary);
}

.tab-bar__marker_conflict {
  background-color: var(--g-color-text-danger);
}

.tab-bar__close {
  margin-right: 4px;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/TabBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/TabBar.tsx src/components/TabBar.css src/components/TabBar.test.tsx
git commit -m "$(cat <<'EOF'
feat(tabs): add TabBar strip with close + unsaved/conflict markers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `useNotes` multi-tab rewrite

**Files:**

- Modify (rewrite): `src/hooks/useNotes.ts`
- Test: `src/hooks/useNotes.test.tsx`

> **Gate for this task is `npm test`.** `npm run build` (tsc) will report errors in `Workspace.tsx` until Task 5 — that is expected.

- [ ] **Step 1: Rewrite the hook tests for the new API + add tab tests**

Replace the entire contents of `src/hooks/useNotes.test.tsx` with:

```tsx
import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {FakeDirectoryHandle, asDirectoryHandle} from '../storage/fakeFileSystem';
import {FileSystemNoteStore} from '../storage/fileSystemStore';
import {METADATA_FILENAME} from '../storage/metadata';

import {useNotes} from './useNotes';

beforeEach(() => {
  // The refocus detector early-returns unless the document reports "visible".
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
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

  // Returning to the tab detects the change.
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(hook.result.current.conflicts.get('Note.md')).toBeTruthy());

  return {hook, dir, store, onError};
}

describe('useNotes conflict resolvers', () => {
  it('detects an external change on refocus', async () => {
    const {hook} = await setupConflict();
    expect(hook.result.current.conflicts.get('Note.md')).toMatchObject({
      id: 'Note.md',
      deleted: false,
    });
    expect(hook.result.current.saveStates.get('Note.md')).toBe('conflict');
  });

  it('reloadDisk loads the disk version and clears the conflict', async () => {
    const {hook} = await setupConflict();
    await act(async () => {
      await hook.result.current.reloadDisk();
    });
    expect(hook.result.current.conflicts.has('Note.md')).toBe(false);
    expect(hook.result.current.openNotes.get('Note.md')?.content).toBe('disk v2');
  });

  it('keepMine overwrites disk with the local edits', async () => {
    const {hook, store} = await setupConflict();
    act(() => {
      hook.result.current.edit('Note.md', 'my edits');
    });
    await act(async () => {
      await hook.result.current.keepMine();
    });
    expect(hook.result.current.conflicts.has('Note.md')).toBe(false);
    expect((await store.get('Note.md')).content).toBe('my edits');
  });

  it('saveAsCopy writes a copy and leaves the original on disk', async () => {
    const {hook, store} = await setupConflict();
    act(() => {
      hook.result.current.edit('Note.md', 'my edits');
    });
    await act(async () => {
      await hook.result.current.saveAsCopy();
    });
    expect(hook.result.current.conflicts.has('Note.md')).toBe(false);
    expect(hook.result.current.activeId).toBe('Note (conflicted copy).md');
    expect((await store.get('Note (conflicted copy).md')).content).toBe('my edits');
    expect((await store.get('Note.md')).content).toBe('disk v2');
    expect((await store.readMetadata()).created['Note (conflicted copy).md']).toBeGreaterThan(0);
  });

  it('discard clears the conflict and closes the tab', async () => {
    const {hook} = await setupConflict();
    act(() => {
      hook.result.current.discard();
    });
    await waitFor(() => expect(hook.result.current.activeId).toBeNull());
    expect(hook.result.current.conflicts.has('Note.md')).toBe(false);
    expect(hook.result.current.openIds).toEqual([]);
  });
});

describe('useNotes tabs', () => {
  async function setup(seed?: (dir: FakeDirectoryHandle) => void) {
    const onError = vi.fn();
    const dir = new FakeDirectoryHandle();
    seed?.(dir);
    const store = new FileSystemNoteStore(asDirectoryHandle(dir));
    const hook = renderHook(() => useNotes(store, onError));
    await waitFor(() => expect(hook.result.current.notes).toBeDefined());
    return {hook, dir, store, onError};
  }

  it('opening notes accumulates tabs and activates the latest', async () => {
    const {hook} = await setup((dir) => {
      dir.seedFile('A.md', 'a', 100);
      dir.seedFile('B.md', 'b', 200);
    });
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
    await act(async () => {
      await hook.result.current.open('A.md');
    });
    await act(async () => {
      await hook.result.current.open('B.md');
    });
    expect(hook.result.current.openIds).toEqual(['A.md', 'B.md']);
    expect(hook.result.current.activeId).toBe('B.md');
  });

  it('re-opening an already-open note just activates it (no duplicate)', async () => {
    const {hook} = await setup((dir) => {
      dir.seedFile('A.md', 'a', 100);
      dir.seedFile('B.md', 'b', 200);
    });
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
    await act(async () => {
      await hook.result.current.open('A.md');
    });
    await act(async () => {
      await hook.result.current.open('B.md');
    });
    await act(async () => {
      await hook.result.current.open('A.md');
    });
    expect(hook.result.current.openIds).toEqual(['A.md', 'B.md']);
    expect(hook.result.current.activeId).toBe('A.md');
  });

  it('closing the active tab activates a neighbor', async () => {
    const {hook} = await setup((dir) => {
      dir.seedFile('A.md', 'a', 100);
      dir.seedFile('B.md', 'b', 200);
    });
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
    await act(async () => {
      await hook.result.current.open('A.md');
    });
    await act(async () => {
      await hook.result.current.open('B.md');
    });
    await act(async () => {
      await hook.result.current.close('B.md');
    });
    expect(hook.result.current.openIds).toEqual(['A.md']);
    expect(hook.result.current.activeId).toBe('A.md');
    expect(hook.result.current.openNotes.has('B.md')).toBe(false);
  });

  it('persists open tabs and restores them on remount', async () => {
    const onError = vi.fn();
    const dir = new FakeDirectoryHandle();
    dir.seedFile('A.md', 'a', 100);
    dir.seedFile('B.md', 'b', 200);
    const store = new FileSystemNoteStore(asDirectoryHandle(dir));

    const first = renderHook(() => useNotes(store, onError));
    await waitFor(() => expect(first.result.current.notes).toHaveLength(2));
    await act(async () => {
      await first.result.current.open('A.md');
    });
    await act(async () => {
      await first.result.current.open('B.md');
    });
    await waitFor(async () => expect((await store.readMetadata()).open).toEqual(['A.md', 'B.md']));

    // A fresh hook over the same store restores the tabs.
    const second = renderHook(() => useNotes(store, onError));
    await waitFor(() => expect(second.result.current.openIds).toEqual(['A.md', 'B.md']));
    expect(second.result.current.activeId).toBe('B.md');
    expect(second.result.current.openNotes.get('A.md')?.content).toBe('a');
  });

  it('drops a restored tab whose file no longer exists', async () => {
    const onError = vi.fn();
    const dir = new FakeDirectoryHandle();
    dir.seedFile('A.md', 'a', 100);
    dir.seedFile(
      METADATA_FILENAME,
      JSON.stringify({
        version: 1,
        sort: 'updated',
        pinned: [],
        created: {},
        open: ['A.md', 'Ghost.md'],
        active: 'Ghost.md',
      }),
    );
    const store = new FileSystemNoteStore(asDirectoryHandle(dir));
    const hook = renderHook(() => useNotes(store, onError));
    await waitFor(() => expect(hook.result.current.openIds).toEqual(['A.md']));
    expect(hook.result.current.activeId).toBe('A.md');
  });

  it('autosaves each open tab independently on hide', async () => {
    const {hook, store} = await setup((dir) => {
      dir.seedFile('A.md', 'a', 100);
      dir.seedFile('B.md', 'b', 200);
    });
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
    await act(async () => {
      await hook.result.current.open('A.md');
    });
    await act(async () => {
      await hook.result.current.open('B.md');
    });
    act(() => {
      hook.result.current.edit('A.md', 'edited a');
      hook.result.current.edit('B.md', 'edited b');
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(async () => expect((await store.get('A.md')).content).toBe('edited a'));
    expect((await store.get('B.md')).content).toBe('edited b');
  });

  it('creating a note opens it as the active tab', async () => {
    const {hook, store} = await setup();
    await act(async () => {
      await hook.result.current.create();
    });
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
    const id = hook.result.current.notes[0].id;
    expect(hook.result.current.openIds).toEqual([id]);
    expect(hook.result.current.activeId).toBe(id);
    expect((await store.readMetadata()).open).toEqual([id]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/hooks/useNotes.test.tsx`
Expected: FAIL — `open`/`activate`/`close`/`openIds`/`openNotes`/`saveStates`/`conflicts` and `edit(id, content)` don't exist yet.

- [ ] **Step 3: Rewrite the hook**

Replace the entire contents of `src/hooks/useNotes.ts` with:

```ts
import {useCallback, useEffect, useRef, useState} from 'react';

import {
  DEFAULT_METADATA,
  reconcile,
  withActive,
  withClosed,
  withCreatedStamp,
  withOpened,
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

/** A detected external change to an open note. */
export interface NoteConflict {
  id: string;
  /** On-disk `lastModified` at detection (0 when the file was deleted). */
  diskUpdatedAt: number;
  /** True when the file was deleted on disk rather than modified. */
  deleted: boolean;
}

export interface UseNotes {
  notes: NoteMeta[];
  /** Folder metadata: active sort, pinned ids, created stamps, open tabs. */
  metadata: NotesMetadata;
  setSortMode(sort: SortMode): void;
  togglePin(id: string): void;
  /** Open tab ids, in tab order (mirrors metadata.open). */
  openIds: readonly string[];
  /** Active tab id (mirrors metadata.active). */
  activeId: string | null;
  /** Loaded content for each open tab, keyed by id. */
  openNotes: ReadonlyMap<string, Note>;
  /** Save state per open tab. */
  saveStates: ReadonlyMap<string, SaveState>;
  /** Detected external change per open tab. */
  conflicts: ReadonlyMap<string, NoteConflict>;
  /** Open a note in a tab, or activate it if already open. */
  open(id: string): Promise<void>;
  /** Make an already-open tab active. */
  activate(id: string): void;
  /** Close a tab, flushing any pending edit first. */
  close(id: string): Promise<void>;
  create(): Promise<void>;
  rename(id: string, nextTitle: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Queue a debounced autosave for a specific open note. */
  edit(id: string, content: string): void;
  /** Conflict resolvers — act on the active tab's conflict. */
  reloadDisk(): Promise<void>;
  keepMine(): Promise<void>;
  saveAsCopy(): Promise<void>;
  discard(): void;
}

/**
 * Owns the note list, the open tabs + active tab, and debounced autosave for a
 * given `NoteStore` (Approach A: per-tab state centralized here). Editing is
 * decoupled from React state on purpose: keystrokes only flow into per-id refs +
 * debounce timers (not `setState`), so a mounted editor is never re-created
 * mid-typing.
 *
 * Each open note carries its own pending edit, baseline `lastModified`, autosave
 * timer, save state, and conflict — so a tab switched away from still saves
 * itself, `beforeunload` flushes every dirty tab, and external-edit detection
 * scans every open tab. Open tabs + the active tab persist in the folder metadata.
 */
export function useNotes(store: NoteStore, onError: (message: string) => void): UseNotes {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [metadata, setMetadata] = useState<NotesMetadata>(DEFAULT_METADATA);
  const metadataRef = useRef<NotesMetadata>(DEFAULT_METADATA);

  const [openNotes, setOpenNotes] = useState<Map<string, Note>>(new Map());
  const openNotesRef = useRef<Map<string, Note>>(openNotes);
  const [saveStates, setSaveStates] = useState<Map<string, SaveState>>(new Map());
  const [conflicts, setConflicts] = useState<Map<string, NoteConflict>>(new Map());
  const conflictsRef = useRef<Map<string, NoteConflict>>(conflicts);

  // Per-id working state (non-render): pending edit, last-seen mtime, autosave timer.
  const pendingRef = useRef<Map<string, string>>(new Map());
  const baselineRef = useRef<Map<string, number | null>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

  // --- map mutators that keep refs in sync for reads inside callbacks ---
  const putOpenNote = useCallback((id: string, note: Note) => {
    setOpenNotes((prev) => {
      const next = new Map(prev).set(id, note);
      openNotesRef.current = next;
      return next;
    });
  }, []);
  const dropFromMaps = useCallback((id: string) => {
    setOpenNotes((prev) => {
      const next = new Map(prev);
      next.delete(id);
      openNotesRef.current = next;
      return next;
    });
    setSaveStates((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setConflicts((prev) => {
      const next = new Map(prev);
      next.delete(id);
      conflictsRef.current = next;
      return next;
    });
  }, []);
  const setSaveStateFor = useCallback((id: string, state: SaveState) => {
    setSaveStates((prev) => new Map(prev).set(id, state));
  }, []);
  const setConflictFor = useCallback((id: string, conflict: NoteConflict) => {
    setConflicts((prev) => {
      const next = new Map(prev).set(id, conflict);
      conflictsRef.current = next;
      return next;
    });
  }, []);
  const clearConflictFor = useCallback((id: string) => {
    setConflicts((prev) => {
      const next = new Map(prev);
      next.delete(id);
      conflictsRef.current = next;
      return next;
    });
  }, []);

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

  const clearTimer = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  const flush = useCallback(
    async (id: string) => {
      clearTimer(id);
      const content = pendingRef.current.get(id);
      if (content === undefined) return;
      pendingRef.current.delete(id);
      try {
        const meta = await store.save(id, content, baselineRef.current.get(id) ?? 0);
        baselineRef.current.set(id, meta.updatedAt ?? null);
        setSaveStateFor(id, 'saved');
        bumpInList(id, meta.updatedAt);
      } catch (err) {
        pendingRef.current.set(id, content); // never drop the user's content
        if (err instanceof ConflictError) {
          setConflictFor(id, {id, diskUpdatedAt: err.diskUpdatedAt, deleted: false});
          setSaveStateFor(id, 'conflict');
        } else if (err instanceof DOMException && err.name === 'NotFoundError') {
          setConflictFor(id, {id, diskUpdatedAt: 0, deleted: true});
          setSaveStateFor(id, 'conflict');
        } else {
          setSaveStateFor(id, 'error');
          onError(err instanceof Error ? err.message : 'Failed to save note');
        }
      }
    },
    [store, onError, bumpInList, clearTimer, setSaveStateFor, setConflictFor],
  );

  const open = useCallback(
    async (id: string) => {
      if (!metadataRef.current.open.includes(id)) {
        try {
          const note = await store.get(id);
          baselineRef.current.set(id, note.updatedAt ?? null);
          putOpenNote(id, note);
          setSaveStateFor(id, 'idle');
        } catch (err) {
          onError(err instanceof Error ? err.message : 'Failed to open note');
          return;
        }
        await persistMetadata(withOpened(metadataRef.current, id));
      } else {
        await persistMetadata(withActive(metadataRef.current, id));
      }
    },
    [store, onError, persistMetadata, putOpenNote, setSaveStateFor],
  );

  const activate = useCallback(
    (id: string) => void persistMetadata(withActive(metadataRef.current, id)),
    [persistMetadata],
  );

  const close = useCallback(
    async (id: string) => {
      await flush(id);
      clearTimer(id);
      pendingRef.current.delete(id);
      baselineRef.current.delete(id);
      dropFromMaps(id);
      await persistMetadata(withClosed(metadataRef.current, id));
    },
    [flush, clearTimer, dropFromMaps, persistMetadata],
  );

  const create = useCallback(async () => {
    try {
      const meta = await store.create('Untitled');
      await refresh();
      await persistMetadata(withCreatedStamp(metadataRef.current, meta.id, meta.updatedAt ?? 0));
      await open(meta.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create note');
    }
  }, [store, refresh, persistMetadata, open, onError]);

  const rename = useCallback(
    async (id: string, nextTitle: string) => {
      await flush(id);
      try {
        const meta = await store.rename(id, nextTitle);
        const wasOpen = metadataRef.current.open.includes(id);
        if (meta.id !== id) {
          await persistMetadata(withRenamed(metadataRef.current, id, meta.id));
          const base = baselineRef.current.get(id);
          if (base !== undefined) baselineRef.current.set(meta.id, base);
          baselineRef.current.delete(id);
          clearTimer(id);
          pendingRef.current.delete(id);
        }
        await refresh();
        if (wasOpen && meta.id !== id) {
          // Reload under the new id so the editor remounts cleanly (new key).
          const note = await store.get(meta.id);
          baselineRef.current.set(meta.id, note.updatedAt ?? null);
          setOpenNotes((prev) => {
            const next = new Map(prev);
            next.delete(id);
            next.set(meta.id, note);
            openNotesRef.current = next;
            return next;
          });
          setSaveStates((prev) => {
            const next = new Map(prev);
            const prior = next.get(id) ?? 'idle';
            next.delete(id);
            next.set(meta.id, prior);
            return next;
          });
          clearConflictFor(id);
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to rename note');
      }
    },
    [flush, store, persistMetadata, refresh, clearTimer, clearConflictFor, onError],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await store.remove(id);
        clearTimer(id);
        pendingRef.current.delete(id);
        baselineRef.current.delete(id);
        dropFromMaps(id);
        await persistMetadata(withRemoved(metadataRef.current, id));
        await refresh();
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to delete note');
      }
    },
    [store, clearTimer, dropFromMaps, persistMetadata, refresh, onError],
  );

  const edit = useCallback(
    (id: string, content: string) => {
      pendingRef.current.set(id, content);
      if (conflictsRef.current.has(id)) return; // autosave paused until resolved
      setSaveStateFor(id, 'saving');
      clearTimer(id);
      timersRef.current.set(
        id,
        setTimeout(() => void flush(id), AUTOSAVE_DELAY),
      );
    },
    [flush, clearTimer, setSaveStateFor],
  );

  const reloadDisk = useCallback(async () => {
    const id = metadataRef.current.active;
    if (!id || !conflictsRef.current.has(id)) return;
    clearTimer(id);
    pendingRef.current.delete(id);
    try {
      const note = await store.get(id);
      baselineRef.current.set(id, note.updatedAt ?? null);
      putOpenNote(id, note); // new updatedAt remounts the editor with disk content
      clearConflictFor(id);
      setSaveStateFor(id, 'idle');
      bumpInList(id, note.updatedAt);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to reload note');
    }
  }, [store, onError, bumpInList, clearTimer, putOpenNote, clearConflictFor, setSaveStateFor]);

  const keepMine = useCallback(async () => {
    const id = metadataRef.current.active;
    const conflict = id ? conflictsRef.current.get(id) : undefined;
    if (!id || !conflict || conflict.deleted) return;
    const content = pendingRef.current.get(id) ?? openNotesRef.current.get(id)?.content ?? '';
    pendingRef.current.delete(id);
    try {
      const meta = await store.save(id, content, conflict.diskUpdatedAt);
      baselineRef.current.set(id, meta.updatedAt ?? null);
      clearConflictFor(id);
      setSaveStateFor(id, 'saved');
      bumpInList(id, meta.updatedAt);
    } catch (err) {
      pendingRef.current.set(id, content);
      onError(err instanceof Error ? err.message : 'Failed to save note');
    }
  }, [store, onError, bumpInList, clearConflictFor, setSaveStateFor]);

  const saveAsCopy = useCallback(async () => {
    const id = metadataRef.current.active;
    const conflict = id ? conflictsRef.current.get(id) : undefined;
    if (!id || !conflict) return;
    const current = openNotesRef.current.get(id);
    const content = pendingRef.current.get(id) ?? current?.content ?? '';
    const title = current?.title ?? 'Note';
    pendingRef.current.delete(id);
    try {
      const copy = await store.create(`${title} (conflicted copy)`);
      await store.save(copy.id, content, copy.updatedAt ?? 0);
      await refresh();
      await persistMetadata(withCreatedStamp(metadataRef.current, copy.id, copy.updatedAt ?? 0));
      clearConflictFor(id);
      await open(copy.id);
    } catch (err) {
      pendingRef.current.set(id, content);
      onError(err instanceof Error ? err.message : 'Failed to save a copy');
    }
  }, [store, refresh, persistMetadata, open, clearConflictFor, onError]);

  const discard = useCallback(() => {
    const id = metadataRef.current.active;
    if (!id) return;
    clearTimer(id);
    pendingRef.current.delete(id);
    baselineRef.current.delete(id);
    dropFromMaps(id);
    void persistMetadata(withClosed(metadataRef.current, id));
    void refresh();
  }, [clearTimer, dropFromMaps, persistMetadata, refresh]);

  // Initial load: notes + metadata, reconcile, then load content for every open tab.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [list, raw] = await Promise.all([store.list(), store.readMetadata()]);
      if (cancelled) return;
      const meta = reconcile(
        raw,
        list.map((n) => n.id),
      );
      const loaded = await Promise.all(
        meta.open.map(async (id) => {
          try {
            return await store.get(id);
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const okNotes = loaded.filter((n): n is Note => n !== null);
      const okIds = new Set(okNotes.map((n) => n.id));
      const nextOpen = meta.open.filter((id) => okIds.has(id));
      const nextActive =
        meta.active && okIds.has(meta.active) ? meta.active : (nextOpen[0] ?? null);
      const reconciled: NotesMetadata = {...meta, open: nextOpen, active: nextActive};

      const openMap = new Map<string, Note>();
      const stateMap = new Map<string, SaveState>();
      for (const n of okNotes) {
        openMap.set(n.id, n);
        stateMap.set(n.id, 'idle');
        baselineRef.current.set(n.id, n.updatedAt ?? null);
      }
      setNotes(list);
      applyMetadata(reconciled);
      openNotesRef.current = openMap;
      setOpenNotes(openMap);
      setSaveStates(stateMap);
      // Heal the dotfile if we had to drop any open tabs.
      if (nextOpen.length !== meta.open.length || nextActive !== meta.active) {
        void store.writeMetadata(reconciled);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, applyMetadata]);

  // Best-effort save when hidden; warn before unload if any tab has unsaved edits.
  useEffect(() => {
    const flushAll = () => {
      for (const id of [...pendingRef.current.keys()]) void flush(id);
    };
    const onHide = () => flushAll();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      flushAll();
      if (pendingRef.current.size > 0 || conflictsRef.current.size > 0) {
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
  }, [flush]);

  // Detect external changes for every open tab when returning to the tab/window.
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      for (const id of metadataRef.current.open) {
        if (conflictsRef.current.has(id) || pendingRef.current.has(id)) continue;
        const diskMtime = await store.stat(id);
        if (diskMtime === null) {
          setConflictFor(id, {id, diskUpdatedAt: 0, deleted: true});
          setSaveStateFor(id, 'conflict');
        } else {
          const base = baselineRef.current.get(id);
          if (base !== undefined && base !== null && diskMtime !== base) {
            setConflictFor(id, {id, diskUpdatedAt: diskMtime, deleted: false});
            setSaveStateFor(id, 'conflict');
          }
        }
      }
    };
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [store, setConflictFor, setSaveStateFor]);

  return {
    notes,
    metadata,
    setSortMode,
    togglePin,
    openIds: metadata.open,
    activeId: metadata.active,
    openNotes,
    saveStates,
    conflicts,
    open,
    activate,
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/hooks/useNotes.test.tsx`
Expected: PASS (all conflict + tab tests).

- [ ] **Step 5: Run the full Vitest suite**

Run: `npm test`
Expected: PASS. (`npm run build`/tsc will fail on `Workspace.tsx` until Task 5 — do not run it here.)

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useNotes.ts src/hooks/useNotes.test.tsx
git commit -m "$(cat <<'EOF'
feat(notes): per-tab state model in useNotes for multi-tab editing

Replaces the single selection with openIds + activeId and per-id maps for
loaded notes, save state, conflicts, pending edits, baselines, and autosave
timers. Adds open/activate/close, restores open tabs on load, flushes every
dirty tab on hide/unload, and scans every open tab for external edits.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire `Workspace` to the tabbed editor stack

**Files:**

- Modify: `src/components/Workspace.tsx`
- Modify: `src/components/Workspace.css`
- Test: `src/components/Workspace.test.tsx` (create)

- [ ] **Step 1: Write the failing integration test**

Create `src/components/Workspace.test.tsx`:

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

describe('Workspace tabs', () => {
  it('opens a sidebar note as a tab and adds a second tab', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('option', {name: /Alpha/});

    await user.click(screen.getByRole('option', {name: /Alpha/}));
    await waitFor(() =>
      expect(screen.getByRole('tablist', {name: 'Open notes'})).toBeInTheDocument(),
    );
    expect(screen.getByRole('tab', {name: 'Alpha'})).toBeInTheDocument();

    await user.click(screen.getByRole('option', {name: /Beta/}));
    await waitFor(() => expect(screen.getByRole('tab', {name: 'Beta'})).toBeInTheDocument());
  });

  it('closes a tab from its close button', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('option', {name: /Alpha/});
    await user.click(screen.getByRole('option', {name: /Alpha/}));
    await screen.findByRole('tab', {name: 'Alpha'});

    await user.click(screen.getByRole('button', {name: 'Close Alpha'}));
    await waitFor(() => expect(screen.queryByRole('tab', {name: 'Alpha'})).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/Workspace.test.tsx`
Expected: FAIL — `Workspace` still uses the old single-note API (no `tablist` rendered).

- [ ] **Step 3: Rewrite the Workspace body**

In `src/components/Workspace.tsx`, update the imports to add `TabBar`:

```tsx
import {ConflictBanner} from './ConflictBanner';
import {EditorPane, type EditorPaneHandle} from './EditorPane';
import {NoteList} from './NoteList';
import {ShortcutsDialog} from './ShortcutsDialog';
import {TabBar, type TabDescriptor} from './TabBar';

import './Workspace.css';
```

Replace the `useShortcuts` block's `selectedId`-dependent wiring and the editor `<main>`. First, just below the existing `const {query, setQuery, filteredNotes} = useNoteSearch(orderedNotes);` line, add the active-conflict lookup and tab descriptors:

```tsx
const activeConflict = notes.activeId ? (notes.conflicts.get(notes.activeId) ?? null) : null;
const activeSaveState = notes.activeId ? (notes.saveStates.get(notes.activeId) ?? 'idle') : 'idle';
const tabs: TabDescriptor[] = notes.openIds.map((id) => ({
  id,
  title: notes.notes.find((n) => n.id === id)?.title ?? id.replace(/\.md$/i, ''),
  unsaved: notes.saveStates.get(id) === 'saving',
  conflict: notes.conflicts.has(id),
}));
```

Change the sidebar `NoteList` to highlight the active tab and open on select — update these two props:

```tsx
                        selectedId={notes.activeId}
                        onSelect={(id) => void notes.open(id)}
```

Change the header save-state to use the active tab:

```tsx
<Text color="secondary" className="workspace__save-state">
  {SAVE_LABEL[activeSaveState]}
</Text>
```

Replace the entire `<main className="workspace__editor"> … </main>` block with:

```tsx
<main className="workspace__editor">
  {notes.openIds.length > 0 ? (
    <>
      <TabBar
        tabs={tabs}
        activeId={notes.activeId}
        onActivate={notes.activate}
        onClose={(id) => void notes.close(id)}
      />
      {activeConflict ? (
        <div className="workspace__conflict">
          <ConflictBanner
            deleted={activeConflict.deleted}
            onReload={() => void notes.reloadDisk()}
            onKeepMine={() => void notes.keepMine()}
            onSaveAsCopy={() => void notes.saveAsCopy()}
            onDiscard={notes.discard}
          />
        </div>
      ) : null}
      <div className="workspace__panes">
        {notes.openIds.map((id) => {
          const note = notes.openNotes.get(id);
          if (!note) return null;
          const isActive = id === notes.activeId;
          return (
            <div key={id} className="workspace__pane" hidden={!isActive}>
              <EditorPane
                ref={isActive ? editorRef : undefined}
                key={`${id}:${note.updatedAt}`}
                note={note}
                active={isActive}
                onChange={(markup) => notes.edit(id, markup)}
              />
            </div>
          );
        })}
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
```

- [ ] **Step 4: Update Workspace styles**

In `src/components/Workspace.css`, replace the `.workspace__editor` rule (keep the padding variable added earlier) and add the pane rules:

```css
.workspace__editor {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Give the editing area breathing room from the toolbar and edges. The
       markdown editor reads this for both the WYSIWYG and markup panes. */
  --g-md-editor-padding: 8px 16px;
}

.workspace__panes {
  flex: 1;
  min-height: 0;
  position: relative;
}

.workspace__pane {
  height: 100%;
}

.workspace__pane[hidden] {
  display: none;
}
```

- [ ] **Step 5: Run the integration test, then the full suite**

Run: `npm test -- src/components/Workspace.test.tsx`
Expected: PASS.

Run: `npm test`
Expected: PASS (whole suite).

- [ ] **Step 6: Run the full build (typecheck restored)**

Run: `npm run build`
Expected: PASS — tsc reports no errors and Vite produces a bundle.

- [ ] **Step 7: Commit**

```bash
git add src/components/Workspace.tsx src/components/Workspace.css src/components/Workspace.test.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): render open notes as switchable editor tabs

Adds the TabBar and a mounted editor stack (inactive panes hidden), opens
sidebar notes into tabs, and drives the conflict banner + save state from
the active tab.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Verify end-to-end + update the roadmap

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-06-20-multi-tab-editing-design.md` (status)

- [ ] **Step 1: Lint, format, and build**

Run: `npm run lint && npm run format:check && npm run build && npm test`
Expected: all PASS. Fix any lint/format issues with `npm run lint:fix && npm run format`, then re-run.

- [ ] **Step 2: Manual verification (Chromium)**

Run: `npm run dev`, open the printed URL in Chrome, pick a folder with ≥2 notes, and confirm:

- Clicking notes opens tabs; clicking an open note re-activates its tab (no duplicate).
- Typing in one tab, switching to another and back, preserves cursor/scroll in each.
- An unsaved dot appears while typing and clears after autosave (~0.5 s).
- Closing the active tab activates a neighbor; closing the last tab shows the placeholder.
- Reload the page (re-grant folder permission): the same tabs reopen with the same active tab.
- Edit one open note's file in an external editor, refocus the app: that tab shows the conflict marker + banner; "Reload" loads the disk version fresh.

- [ ] **Step 3: Update the roadmap and spec status**

In `CLAUDE.md`, under "Roadmap & active work", add a completed entry after item 3 (renumber is not needed — append as a sibling bullet):

```markdown
- ✅ **Multi-tab editing** — open notes as switchable editor tabs, persisted in
  `.gravity-notes.json` (`open`/`active`) and restored on reload; per-tab autosave +
  conflict detection. Spec: `docs/superpowers/specs/2026-06-20-multi-tab-editing-design.md`.
```

In `docs/superpowers/specs/2026-06-20-multi-tab-editing-design.md`, change the status line to:

```markdown
- **Status:** Implemented
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-20-multi-tab-editing-design.md
git commit -m "$(cat <<'EOF'
docs: mark Multi-tab Editing implemented in the roadmap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

- **Spec coverage:** success criteria map to tasks — accumulate/activate tabs (T4 `open`, T5 sidebar), lossless switching (T2 mounted panes + `active`), persist+restore (T1 fields, T4 restore effect + test), per-tab autosave incl. switched-away tab (T4 `flush` per id + hide-flush-all test), per-tab conflict (T4 focus-scan + conflict tests, T5 banner), no-regression to sort/pin/rename/remove (T1 helper extensions, T4 preserved flows). Deferred keyboard shortcuts are explicitly out of scope.
- **Type consistency:** `NoteConflict`, `SaveState`, `TabDescriptor`, and the `UseNotes` map types (`ReadonlyMap`) are used consistently across tasks; `edit(id, content)` and `EditorPane`'s `active` prop line up between T2/T4/T5.
- **Known transient:** `tsc` is red only between T4 and T5 (documented at the top); every task's stated gate is green at its own commit.
