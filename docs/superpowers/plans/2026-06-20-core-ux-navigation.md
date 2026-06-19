# Core UX & Navigation (slice 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the note list fast to navigate — inline title search, keyboard shortcuts, in-place rename, and real list keyboard a11y — and stand up jsdom + Testing Library component/hook testing (backfilling slice 2's untested conflict logic).

**Architecture:** All work is in hooks and components; the `NoteStore` interface and `FileSystemNoteStore` are untouched (sort + pin, the only storage-touching feature, is deferred to slice 3b). Search is a pure derivation (`useNoteSearch`); shortcuts are one document-level keydown hook (`useShortcuts`); arrow navigation lives inside the `NoteList` listbox (roving tabindex); the editor mode toggle is reached through an imperative ref on `EditorPane`. `Workspace` wires these together.

**Tech Stack:** React 18 + TypeScript (strict), Gravity UI (`@gravity-ui/uikit`, `@gravity-ui/icons`), `@gravity-ui/markdown-editor`, Vitest 3 (`projects`: node + jsdom), `@testing-library/react` + `user-event` + `jest-dom`.

---

## File Structure

**Create:**
- `src/test/setup.ts` — jsdom test setup (jest-dom matchers + `afterEach(cleanup)`).
- `src/test/render.tsx` — `renderWithProviders` helper wrapping components in Gravity providers.
- `src/test/environment.test.tsx` — smoke test proving the jsdom project works.
- `src/hooks/useNoteSearch.ts` + `src/hooks/useNoteSearch.test.tsx` — query state + filtered list.
- `src/hooks/useShortcuts.ts` + `src/hooks/useShortcuts.test.tsx` — global keyboard shortcuts.
- `src/hooks/useNotes.test.tsx` — backfill tests for slice 2's conflict resolvers.
- `src/components/ShortcutsDialog.tsx` + `.css` + `src/components/ShortcutsDialog.test.tsx` — `?` help dialog.
- `src/components/ConflictBanner.test.tsx` — backfill test for slice 2's banner.
- `src/components/EditorPane.test.tsx` — `toggleMode` ref handle test (editor mocked).
- `src/components/NoteList.test.tsx` — list/search/rename/a11y tests.

**Modify:**
- `vite.config.ts` — Vitest `projects` (node `*.test.ts` + jsdom `*.test.tsx`).
- `package.json` — add dev dependencies (via `npm install`).
- `src/components/EditorPane.tsx` — `forwardRef` + `useImperativeHandle({toggleMode})`.
- `src/components/NoteList.tsx` + `src/components/NoteList.css` — search field, match highlight, inline rename, listbox a11y nav; remove the two slice-1 eslint-disables.
- `src/components/Workspace.tsx` — wire `useNoteSearch`, `useShortcuts`, `searchInputRef`, `editorRef`, the `?` header button, and `ShortcutsDialog`.
- `CLAUDE.md` — roadmap: split slice 3 into 3a (this) + 3b (sort/pin).

---

## Before you start

Create the feature branch from an up-to-date `main` (the spec + this plan are already committed there):
```bash
git switch -c core-ux-navigation
```
All task commits below land on this branch; Task 10 pushes it and opens the PR.

---

## Task 1: Stand up jsdom + Testing Library

**Files:**
- Modify: `package.json` (via npm)
- Modify: `vite.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/test/render.tsx`
- Create: `src/test/environment.test.tsx`

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
npm install -D jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```
Expected: installs without peer-dependency errors (React 18 is already present).

- [ ] **Step 2: Convert `vite.config.ts` to Vitest projects**

Replace the whole file with:
```ts
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vitest/config';

export default defineConfig({
    plugins: [react()],
    test: {
        projects: [
            {
                extends: true,
                test: {
                    name: 'node',
                    environment: 'node',
                    include: ['src/**/*.test.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'dom',
                    environment: 'jsdom',
                    include: ['src/**/*.test.tsx'],
                    setupFiles: ['./src/test/setup.ts'],
                },
            },
        ],
    },
});
```

- [ ] **Step 3: Create the jsdom setup file**

Create `src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';

import {cleanup} from '@testing-library/react';
import {afterEach} from 'vitest';

afterEach(() => {
    cleanup();
});
```

- [ ] **Step 4: Create the providers render helper**

Create `src/test/render.tsx`:
```tsx
import type {ReactElement, ReactNode} from 'react';

import {MobileProvider, ThemeProvider, Toaster, ToasterProvider} from '@gravity-ui/uikit';
import {render, type RenderOptions, type RenderResult} from '@testing-library/react';

const toaster = new Toaster();

function Providers({children}: {children: ReactNode}) {
    return (
        <ThemeProvider theme="light">
            <MobileProvider>
                <ToasterProvider toaster={toaster}>{children}</ToasterProvider>
            </MobileProvider>
        </ThemeProvider>
    );
}

export function renderWithProviders(
    ui: ReactElement,
    options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
    return render(ui, {wrapper: Providers, ...options});
}
```

- [ ] **Step 5: Create the smoke test**

Create `src/test/environment.test.tsx`:
```tsx
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

describe('test environment', () => {
    it('renders into a jsdom document with jest-dom matchers wired', () => {
        render(<div>hello</div>);
        expect(screen.getByText('hello')).toBeInTheDocument();
    });
});
```

- [ ] **Step 6: Run the full suite (both projects)**

Run: `npm test`
Expected: PASS — the existing 19 store tests run under the `node` project and the new smoke test runs under the `dom` project. (Vitest prints both project names.)

- [ ] **Step 7: Verify lint/typecheck still pass**

Run: `npm run typecheck && npm run lint`
Expected: PASS (no unused imports; `src/test/*` is included by `tsconfig`).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/test/
git commit -m "test: stand up jsdom + Testing Library (Vitest projects)"
```

---

## Task 2: Backfill — ConflictBanner test

**Files:**
- Create: `src/components/ConflictBanner.test.tsx`

- [ ] **Step 1: Write the test**

Create `src/components/ConflictBanner.test.tsx`:
```tsx
import {screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {renderWithProviders} from '../test/render';
import {ConflictBanner} from './ConflictBanner';

const handlers = () => ({
    onReload: vi.fn(),
    onKeepMine: vi.fn(),
    onSaveAsCopy: vi.fn(),
    onDiscard: vi.fn(),
});

describe('ConflictBanner', () => {
    it('offers reload / keep mine / save as copy when the file was modified', () => {
        renderWithProviders(<ConflictBanner deleted={false} {...handlers()} />);
        expect(screen.getByText('Changed on disk')).toBeInTheDocument();
        expect(screen.getByText('Reload')).toBeInTheDocument();
        expect(screen.getByText('Keep mine')).toBeInTheDocument();
        expect(screen.getByText('Save as copy')).toBeInTheDocument();
    });

    it('offers save as copy / discard when the file was deleted', () => {
        renderWithProviders(<ConflictBanner deleted={true} {...handlers()} />);
        expect(screen.getByText('Deleted on disk')).toBeInTheDocument();
        expect(screen.getByText('Save as copy')).toBeInTheDocument();
        expect(screen.getByText('Discard')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- ConflictBanner`
Expected: PASS (the component already exists; this locks its behavior in).

- [ ] **Step 3: Commit**

```bash
git add src/components/ConflictBanner.test.tsx
git commit -m "test: backfill ConflictBanner rendering (slice 2)"
```

---

## Task 3: Backfill — useNotes conflict resolvers

**Files:**
- Create: `src/hooks/useNotes.test.tsx`

- [ ] **Step 1: Write the tests**

Create `src/hooks/useNotes.test.tsx`:
```tsx
import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {FakeDirectoryHandle, asDirectoryHandle} from '../storage/fakeFileSystem';
import {FileSystemNoteStore} from '../storage/fileSystemStore';
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
        await hook.result.current.select('Note.md');
    });

    // An external edit bumps the mtime past the baseline (100).
    dir.seedFile('Note.md', 'disk v2', 200);

    // Returning to the tab detects the change.
    await act(async () => {
        window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(hook.result.current.conflict).not.toBeNull());

    return {hook, dir, store, onError};
}

describe('useNotes conflict resolvers', () => {
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
        expect(hook.result.current.selectedNote?.content).toBe('disk v2');
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
        expect(hook.result.current.selectedId).toBe('Note (conflicted copy).md');
        expect((await store.get('Note (conflicted copy).md')).content).toBe('my edits');
        expect((await store.get('Note.md')).content).toBe('disk v2');
    });

    it('discard clears the conflict and the selection', async () => {
        const {hook} = await setupConflict();
        act(() => {
            hook.result.current.discard();
        });
        expect(hook.result.current.conflict).toBeNull();
        expect(hook.result.current.selectedId).toBeNull();
    });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test -- useNotes`
Expected: PASS. If any test logs an `act(...)` warning, it is non-fatal; the assertions are what matter. (These tests run against the existing hook — they document and protect slice 2's behavior before the NoteList rework.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useNotes.test.tsx
git commit -m "test: backfill useNotes conflict resolvers (slice 2)"
```

---

## Task 4: useNoteSearch hook

**Files:**
- Create: `src/hooks/useNoteSearch.test.tsx`
- Create: `src/hooks/useNoteSearch.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useNoteSearch.test.tsx`:
```tsx
import {act, renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import type {NoteMeta} from '../storage/types';
import {noteMatches, useNoteSearch} from './useNoteSearch';

const NOTES: NoteMeta[] = [
    {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
    {id: 'Beta.md', title: 'Beta', updatedAt: 2},
    {id: 'Gamma beta.md', title: 'Gamma beta', updatedAt: 1},
];

describe('noteMatches', () => {
    it('matches case-insensitively on the title', () => {
        expect(noteMatches(NOTES[0], 'alp')).toBe(true);
        expect(noteMatches(NOTES[0], 'xyz')).toBe(false);
    });
});

describe('useNoteSearch', () => {
    it('returns all notes for an empty query', () => {
        const {result} = renderHook(() => useNoteSearch(NOTES));
        expect(result.current.filteredNotes).toEqual(NOTES);
    });

    it('filters by case-insensitive title substring, preserving order', () => {
        const {result} = renderHook(() => useNoteSearch(NOTES));
        act(() => result.current.setQuery('beta'));
        expect(result.current.filteredNotes.map((n) => n.id)).toEqual([
            'Beta.md',
            'Gamma beta.md',
        ]);
    });

    it('returns an empty list when nothing matches', () => {
        const {result} = renderHook(() => useNoteSearch(NOTES));
        act(() => result.current.setQuery('zzz'));
        expect(result.current.filteredNotes).toEqual([]);
    });

    it('treats a whitespace-only query as empty', () => {
        const {result} = renderHook(() => useNoteSearch(NOTES));
        act(() => result.current.setQuery('   '));
        expect(result.current.filteredNotes).toEqual(NOTES);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- useNoteSearch`
Expected: FAIL — cannot resolve `./useNoteSearch`.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useNoteSearch.ts`:
```ts
import {useMemo, useState} from 'react';

import type {NoteMeta} from '../storage/types';

/**
 * Single match predicate — title-only today. A future body matcher slots in
 * here without touching the hook or the UI.
 */
export function noteMatches(note: NoteMeta, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return note.title.toLowerCase().includes(q);
}

export interface UseNoteSearch {
    query: string;
    setQuery: (query: string) => void;
    /** `notes` filtered by `query`, original order preserved. */
    filteredNotes: NoteMeta[];
}

/** Owns the search query and derives the filtered note list (pure, no I/O). */
export function useNoteSearch(notes: NoteMeta[]): UseNoteSearch {
    const [query, setQuery] = useState('');
    const filteredNotes = useMemo(() => {
        if (!query.trim()) return notes;
        return notes.filter((note) => noteMatches(note, query));
    }, [notes, query]);
    return {query, setQuery, filteredNotes};
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- useNoteSearch`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useNoteSearch.ts src/hooks/useNoteSearch.test.tsx
git commit -m "feat: add useNoteSearch (title filter)"
```

---

## Task 5: useShortcuts hook

**Files:**
- Create: `src/hooks/useShortcuts.test.tsx`
- Create: `src/hooks/useShortcuts.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useShortcuts.test.tsx`:
```tsx
import {renderHook} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {type ShortcutActions, useShortcuts} from './useShortcuts';

function makeActions(): ShortcutActions {
    return {
        focusSearch: vi.fn(),
        createNote: vi.fn(),
        toggleEditorMode: vi.fn(),
        openHelp: vi.fn(),
    };
}

function press(init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {bubbles: true, cancelable: true, ...init});
    document.dispatchEvent(event);
    return event;
}

describe('useShortcuts', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('focuses search on mod+k and prevents default', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const event = press({key: 'k', metaKey: true});
        expect(actions.focusSearch).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('creates a note on ctrl+j', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: 'j', ctrlKey: true});
        expect(actions.createNote).toHaveBeenCalledTimes(1);
    });

    it('toggles editor mode on mod+/', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: '/', metaKey: true});
        expect(actions.toggleEditorMode).toHaveBeenCalledTimes(1);
    });

    it('opens help on ? when focus is outside inputs', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const event = press({key: '?'});
        expect(actions.openHelp).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('does not open help on ? while typing in an input', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        press({key: '?'});
        expect(actions.openHelp).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- useShortcuts`
Expected: FAIL — cannot resolve `./useShortcuts`.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useShortcuts.ts`:
```ts
import {useEffect, useRef} from 'react';

export interface ShortcutActions {
    focusSearch: () => void;
    createNote: () => void;
    toggleEditorMode: () => void;
    openHelp: () => void;
}

/** True when keystrokes should be left to the focused text surface. */
function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

/**
 * Global keyboard shortcuts. Command-modifier combos (⌘/Ctrl) act regardless of
 * focus and preventDefault; the `?` help key is gated so it never steals a typed
 * "?" inside the editor or an input. List ↑/↓ navigation lives in NoteList.
 *
 * Actions are read through a ref so the listener binds once and always calls the
 * latest callbacks, even though `Workspace` passes a fresh object each render.
 */
export function useShortcuts(actions: ShortcutActions): void {
    const actionsRef = useRef(actions);
    actionsRef.current = actions;

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const mod = event.metaKey || event.ctrlKey;
            if (mod && !event.shiftKey && !event.altKey) {
                const key = event.key.toLowerCase();
                if (key === 'k') {
                    event.preventDefault();
                    actionsRef.current.focusSearch();
                    return;
                }
                if (key === 'j') {
                    event.preventDefault();
                    actionsRef.current.createNote();
                    return;
                }
                if (key === '/') {
                    event.preventDefault();
                    actionsRef.current.toggleEditorMode();
                    return;
                }
            }
            if (event.key === '?' && !isTypingTarget(document.activeElement)) {
                event.preventDefault();
                actionsRef.current.openHelp();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- useShortcuts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useShortcuts.ts src/hooks/useShortcuts.test.tsx
git commit -m "feat: add useShortcuts (global keyboard shortcuts)"
```

---

## Task 6: ShortcutsDialog component

**Files:**
- Create: `src/components/ShortcutsDialog.test.tsx`
- Create: `src/components/ShortcutsDialog.tsx`
- Create: `src/components/ShortcutsDialog.css`

- [ ] **Step 1: Write the failing tests**

Create `src/components/ShortcutsDialog.test.tsx`:
```tsx
import {screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {renderWithProviders} from '../test/render';
import {ShortcutsDialog} from './ShortcutsDialog';

describe('ShortcutsDialog', () => {
    it('lists the documented shortcuts when open', () => {
        renderWithProviders(<ShortcutsDialog open onClose={vi.fn()} />);
        expect(screen.getByText('Focus search')).toBeInTheDocument();
        expect(screen.getByText('New note')).toBeInTheDocument();
        expect(screen.getByText('Toggle WYSIWYG / Markup')).toBeInTheDocument();
        expect(screen.getByText('Show this help')).toBeInTheDocument();
    });

    it('renders nothing when closed', () => {
        renderWithProviders(<ShortcutsDialog open={false} onClose={vi.fn()} />);
        expect(screen.queryByText('Focus search')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- ShortcutsDialog`
Expected: FAIL — cannot resolve `./ShortcutsDialog`.

- [ ] **Step 3: Implement the component**

Create `src/components/ShortcutsDialog.tsx`:
```tsx
import {Dialog, Hotkey, Text} from '@gravity-ui/uikit';

import './ShortcutsDialog.css';

interface ShortcutsDialogProps {
    open: boolean;
    onClose: () => void;
}

interface Shortcut {
    keys: string;
    description: string;
}

const GROUPS: {title: string; shortcuts: Shortcut[]}[] = [
    {
        title: 'Navigation',
        shortcuts: [
            {keys: 'mod+k', description: 'Focus search'},
            {keys: 'up', description: 'Previous note'},
            {keys: 'down', description: 'Next note'},
        ],
    },
    {
        title: 'Editing',
        shortcuts: [
            {keys: 'mod+j', description: 'New note'},
            {keys: 'mod+/', description: 'Toggle WYSIWYG / Markup'},
            {keys: 'f2', description: 'Rename selected note'},
        ],
    },
    {
        title: 'General',
        shortcuts: [{keys: 'shift+/', description: 'Show this help'}],
    },
];

/** Read-only help sheet listing the app's keyboard shortcuts. */
export function ShortcutsDialog({open, onClose}: ShortcutsDialogProps) {
    return (
        <Dialog open={open} onClose={onClose} size="s">
            <Dialog.Header caption="Keyboard shortcuts" />
            <Dialog.Body>
                <div className="shortcuts-dialog">
                    {GROUPS.map((group) => (
                        <div key={group.title} className="shortcuts-dialog__group">
                            <Text variant="subheader-1" color="secondary">
                                {group.title}
                            </Text>
                            {group.shortcuts.map((shortcut) => (
                                <div key={shortcut.keys} className="shortcuts-dialog__row">
                                    <Text>{shortcut.description}</Text>
                                    <Hotkey value={shortcut.keys} />
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </Dialog.Body>
        </Dialog>
    );
}
```

Create `src/components/ShortcutsDialog.css`:
```css
.shortcuts-dialog {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.shortcuts-dialog__group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.shortcuts-dialog__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- ShortcutsDialog`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ShortcutsDialog.tsx src/components/ShortcutsDialog.css src/components/ShortcutsDialog.test.tsx
git commit -m "feat: add ShortcutsDialog help sheet"
```

---

## Task 7: EditorPane toggleMode ref handle

**Files:**
- Create: `src/components/EditorPane.test.tsx`
- Modify: `src/components/EditorPane.tsx`

- [ ] **Step 1: Write the failing test (editor mocked)**

Create `src/components/EditorPane.test.tsx`:
```tsx
import {createRef} from 'react';

import {render} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {fakeEditor, setEditorMode} = vi.hoisted(() => {
    const setEditorMode = vi.fn();
    return {
        setEditorMode,
        fakeEditor: {
            currentMode: 'wysiwyg' as 'wysiwyg' | 'markup',
            setEditorMode,
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

describe('EditorPane.toggleMode', () => {
    beforeEach(() => {
        fakeEditor.currentMode = 'wysiwyg';
        setEditorMode.mockClear();
    });

    it('switches to markup when currently in wysiwyg', () => {
        const ref = createRef<EditorPaneHandle>();
        render(<EditorPane ref={ref} note={NOTE} onChange={() => {}} />);
        ref.current?.toggleMode();
        expect(setEditorMode).toHaveBeenCalledWith('markup');
    });

    it('switches to wysiwyg when currently in markup', () => {
        fakeEditor.currentMode = 'markup';
        const ref = createRef<EditorPaneHandle>();
        render(<EditorPane ref={ref} note={NOTE} onChange={() => {}} />);
        ref.current?.toggleMode();
        expect(setEditorMode).toHaveBeenCalledWith('wysiwyg');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- EditorPane`
Expected: FAIL — `EditorPaneHandle` is not exported and `EditorPane` accepts no `ref`.

- [ ] **Step 3: Add the ref handle**

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
    onChange: (markup: string) => void;
}

/**
 * Wraps the Gravity markdown editor for a single note.
 *
 * The editor instance is re-created whenever the note id changes (the `deps`
 * argument), loading that note's markup as the initial value. Content edits are
 * reported back via the `change` event, serialized with `getValue()`. The parent
 * can flip editing modes through the imperative `toggleMode` handle.
 */
export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane(
    {note, onChange},
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

    return <MarkdownEditorView stickyToolbar autofocus editor={editor} />;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- EditorPane`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify the app still type-checks (Workspace renders EditorPane without a ref — still valid)**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/EditorPane.tsx src/components/EditorPane.test.tsx
git commit -m "feat: expose EditorPane.toggleMode via ref handle"
```

---

## Task 8: NoteList internal rework — inline rename + listbox a11y

This task reworks `NoteList` **without changing its props**, so `Workspace` keeps compiling. It replaces the rename dialog with inline editing, adds `listbox`/`option` roles with roving-tabindex arrow navigation, and removes both slice-1 eslint-disables (the stop-propagation wrapper becomes a real `<button>` `stopPropagation`; the dialog `autoFocus` is replaced by ref focus).

**Files:**
- Create: `src/components/NoteList.test.tsx`
- Modify: `src/components/NoteList.tsx`
- Modify: `src/components/NoteList.css`

- [ ] **Step 1: Write the failing tests**

Create `src/components/NoteList.test.tsx`:
```tsx
import {screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import type {NoteMeta} from '../storage/types';
import {renderWithProviders} from '../test/render';
import {NoteList} from './NoteList';

const NOTES: NoteMeta[] = [
    {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
    {id: 'Beta.md', title: 'Beta', updatedAt: 2},
];

function setup(overrides: Record<string, unknown> = {}) {
    const props = {
        notes: NOTES,
        selectedId: 'Alpha.md',
        onSelect: vi.fn(),
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        ...overrides,
    };
    renderWithProviders(<NoteList {...(props as never)} />);
    return props;
}

describe('NoteList — list & a11y', () => {
    it('renders notes as a listbox of options', () => {
        setup();
        expect(screen.getByRole('listbox', {name: 'Notes'})).toBeInTheDocument();
        expect(screen.getAllByRole('option')).toHaveLength(2);
    });

    it('selects a note on click', async () => {
        const user = userEvent.setup();
        const props = setup();
        await user.click(screen.getByText('Beta'));
        expect(props.onSelect).toHaveBeenCalledWith('Beta.md');
    });

    it('moves selection to the neighbor on ArrowDown', async () => {
        const user = userEvent.setup();
        const props = setup({selectedId: 'Alpha.md'});
        screen.getByRole('option', {name: /Alpha/}).focus();
        await user.keyboard('{ArrowDown}');
        expect(props.onSelect).toHaveBeenCalledWith('Beta.md');
    });

    it('shows the empty state when there are no notes', () => {
        setup({notes: []});
        expect(screen.getByText(/No notes yet/)).toBeInTheDocument();
    });
});

describe('NoteList — inline rename', () => {
    it('renames via F2 and commits on Enter', async () => {
        const user = userEvent.setup();
        const props = setup({selectedId: 'Alpha.md'});
        screen.getByRole('option', {name: /Alpha/}).focus();
        await user.keyboard('{F2}');
        const input = screen.getByDisplayValue('Alpha');
        await user.clear(input);
        await user.type(input, 'Renamed{Enter}');
        expect(props.onRename).toHaveBeenCalledWith('Alpha.md', 'Renamed');
    });

    it('commits a rename on blur', async () => {
        const user = userEvent.setup();
        const props = setup();
        await user.dblClick(screen.getByText('Beta'));
        const input = screen.getByDisplayValue('Beta');
        await user.clear(input);
        await user.type(input, 'Beta 2');
        await user.tab(); // blur
        expect(props.onRename).toHaveBeenCalledWith('Beta.md', 'Beta 2');
    });

    it('cancels a rename on Escape', async () => {
        const user = userEvent.setup();
        const props = setup();
        await user.dblClick(screen.getByText('Beta'));
        const input = screen.getByDisplayValue('Beta');
        await user.clear(input);
        await user.type(input, 'Nope{Escape}');
        expect(props.onRename).not.toHaveBeenCalled();
        expect(screen.getByText('Beta')).toBeInTheDocument();
    });

    it('is a no-op when the title is unchanged', async () => {
        const user = userEvent.setup();
        const props = setup();
        await user.dblClick(screen.getByText('Beta'));
        await user.type(screen.getByDisplayValue('Beta'), '{Enter}');
        expect(props.onRename).not.toHaveBeenCalled();
    });

    it('is a no-op when the title is emptied', async () => {
        const user = userEvent.setup();
        const props = setup();
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
        const props = setup();
        const beta = screen.getByRole('option', {name: /Beta/});
        await user.click(within(beta).getByRole('button'));
        await user.click(await screen.findByRole('menuitem', {name: /Delete/}));
        await user.click(screen.getByRole('button', {name: 'Delete'}));
        expect(props.onDelete).toHaveBeenCalledWith('Beta.md');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- NoteList`
Expected: FAIL — no `listbox` role / no inline rename yet (the current NoteList uses a dialog).

- [ ] **Step 3: Rework the component**

Replace `src/components/NoteList.tsx` with:
```tsx
import {useEffect, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent} from 'react';

import {Ellipsis, Pencil, Plus, TrashBin} from '@gravity-ui/icons';
import {Button, Dialog, DropdownMenu, Icon, Text, TextInput} from '@gravity-ui/uikit';

import type {NoteMeta} from '../storage/types';

import './NoteList.css';

interface NoteListProps {
    notes: NoteMeta[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onCreate: () => void;
    onRename: (id: string, nextTitle: string) => void;
    onDelete: (id: string) => void;
}

export function NoteList({
    notes,
    selectedId,
    onSelect,
    onCreate,
    onRename,
    onDelete,
}: NoteListProps) {
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
        selectedId && notes.some((n) => n.id === selectedId)
            ? selectedId
            : (notes[0]?.id ?? null);

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

    const moveSelection = (fromId: string, delta: number) => {
        const index = notes.findIndex((n) => n.id === fromId);
        if (index === -1) return;
        const next = notes[Math.min(Math.max(index + delta, 0), notes.length - 1)];
        if (next && next.id !== fromId) {
            onSelect(next.id);
            itemRefs.current.get(next.id)?.focus();
        }
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
            case ' ':
                event.preventDefault();
                onSelect(note.id);
                break;
            case 'F2':
                event.preventDefault();
                startRename(note);
                break;
        }
    };

    return (
        <div className="note-list">
            <div className="note-list__header">
                <Text variant="subheader-2">Notes</Text>
                <Button view="action" size="m" onClick={onCreate}>
                    <Icon data={Plus} />
                    New
                </Button>
            </div>

            <div className="note-list__items" role="listbox" aria-label="Notes">
                {notes.length === 0 ? (
                    <div className="note-list__empty">
                        <Text color="secondary">No notes yet. Create your first one.</Text>
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
                                className={
                                    'note-list__item' +
                                    (selected ? ' note-list__item_selected' : '')
                                }
                                role="option"
                                aria-selected={selected}
                                tabIndex={tabbable ? 0 : -1}
                                onClick={() => onSelect(note.id)}
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
                                        <Text className="note-list__title" ellipsis>
                                            {note.title}
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
                        Delete “{deleting?.title}”? This permanently removes the file from your
                        folder.
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
}
```

- [ ] **Step 4: Add the focus-ring and inline-edit styles**

Append to `src/components/NoteList.css`:
```css
.note-list__item:focus-visible {
    outline: 2px solid var(--g-color-line-focus);
    outline-offset: -2px;
}

.note-list__edit {
    flex: 1;
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- NoteList`
Expected: PASS. If the delete test cannot find the menu item, confirm the DropdownMenu popup renders (it portals to `document.body`); `findByRole('menuitem', …)` awaits it.

- [ ] **Step 6: Verify nothing else broke (props unchanged, app compiles)**

Run: `npm run typecheck && npm run lint`
Expected: PASS — and the two prior `eslint-disable` comments are gone from `NoteList.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/components/NoteList.tsx src/components/NoteList.css src/components/NoteList.test.tsx
git commit -m "feat: inline rename + listbox keyboard a11y in NoteList"
```

---

## Task 9: NoteList search field + Workspace wiring

Adds the search field, match highlighting, no-results state, and Enter/Esc handling to `NoteList` (new required props), and wires everything in `Workspace`. The prop change and its consumer land together so the build stays green.

**Files:**
- Modify: `src/components/NoteList.tsx`
- Modify: `src/components/NoteList.css`
- Modify: `src/components/NoteList.test.tsx`
- Modify: `src/components/Workspace.tsx`

- [ ] **Step 1: Extend the NoteList tests (search)**

In `src/components/NoteList.test.tsx`, update the imports and the `setup()` helper, then add a new describe block.

Change the import line `import type {NoteMeta} ...` region to also import `createRef`:
```tsx
import {createRef} from 'react';

import {screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import type {NoteMeta} from '../storage/types';
import {renderWithProviders} from '../test/render';
import {NoteList} from './NoteList';
```

Replace the `setup()` helper with one that supplies the new props:
```tsx
function setup(overrides: Record<string, unknown> = {}) {
    const props = {
        notes: NOTES,
        selectedId: 'Alpha.md',
        query: '',
        onQueryChange: vi.fn(),
        searchInputRef: createRef<HTMLInputElement>(),
        onSelect: vi.fn(),
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        ...overrides,
    };
    renderWithProviders(<NoteList {...(props as never)} />);
    return props;
}
```

Add this describe block to the file:
```tsx
describe('NoteList — search', () => {
    it('calls onQueryChange when typing in the search field', async () => {
        const user = userEvent.setup();
        const props = setup();
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

    it('opens the top match on Enter in the search field', async () => {
        const user = userEvent.setup();
        const props = setup({query: 'a'});
        screen.getByPlaceholderText('Search').focus();
        await user.keyboard('{Enter}');
        expect(props.onSelect).toHaveBeenCalledWith('Alpha.md');
    });

    it('clears the query on Escape in the search field', async () => {
        const user = userEvent.setup();
        const props = setup({query: 'beta'});
        screen.getByPlaceholderText('Search').focus();
        await user.keyboard('{Escape}');
        expect(props.onQueryChange).toHaveBeenCalledWith('');
    });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npm test -- NoteList`
Expected: FAIL — no search field / `onQueryChange` prop yet.

- [ ] **Step 3: Add search to NoteList**

In `src/components/NoteList.tsx`, make these edits:

(a) Add `ReactNode` to the type import:
```tsx
import type {KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject} from 'react';
```

(b) Add the new props to `NoteListProps` (after `selectedId`):
```tsx
    selectedId: string | null;
    query: string;
    onQueryChange: (query: string) => void;
    searchInputRef: RefObject<HTMLInputElement>;
    onSelect: (id: string) => void;
```

(c) Destructure the new props in the function signature:
```tsx
export function NoteList({
    notes,
    selectedId,
    query,
    onQueryChange,
    searchInputRef,
    onSelect,
    onCreate,
    onRename,
    onDelete,
}: NoteListProps) {
```

(d) Add the highlight helper above the component (after the imports, before `interface NoteListProps`):
```tsx
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
```

(e) Add a search-field keydown handler inside the component (next to `onItemKeyDown`):
```tsx
    const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && notes.length > 0) {
            event.preventDefault();
            onSelect(notes[0].id);
        } else if (event.key === 'Escape' && query) {
            event.preventDefault();
            onQueryChange('');
        }
    };
```

(f) Render the search field between the header `</div>` and the `note-list__items` div:
```tsx
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
```

(g) Use the highlight helper for the title:
```tsx
                                        <Text className="note-list__title" ellipsis>
                                            {highlightMatch(note.title, query)}
                                        </Text>
```

(h) Make the empty state query-aware:
```tsx
                    <div className="note-list__empty">
                        <Text color="secondary">
                            {query
                                ? `No notes match “${query}”.`
                                : 'No notes yet. Create your first one.'}
                        </Text>
                    </div>
```

- [ ] **Step 4: Add search styles**

Append to `src/components/NoteList.css`:
```css
.note-list__search {
    padding: 8px 8px 0;
}

.note-list__match {
    background-color: var(--g-color-base-warning-medium, rgba(255, 219, 77, 0.45));
    border-radius: 2px;
    padding: 0 1px;
}
```

- [ ] **Step 5: Run the NoteList tests**

Run: `npm test -- NoteList`
Expected: PASS (list/a11y, rename, delete, and search blocks all green).

- [ ] **Step 6: Wire Workspace**

Replace `src/components/Workspace.tsx` with:
```tsx
import {useCallback, useMemo, useRef, useState} from 'react';

import {CircleQuestion, Folder, Moon, Sun} from '@gravity-ui/icons';
import {Button, Icon, Label, Text, type Theme, useToaster} from '@gravity-ui/uikit';

import {type SaveState, useNotes} from '../hooks/useNotes';
import {useNoteSearch} from '../hooks/useNoteSearch';
import {useShortcuts} from '../hooks/useShortcuts';
import {FileSystemNoteStore} from '../storage/fileSystemStore';

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
    const {query, setQuery, filteredNotes} = useNoteSearch(notes.notes);

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
                        selectedId={notes.selectedId}
                        query={query}
                        onQueryChange={setQuery}
                        searchInputRef={searchInputRef}
                        onSelect={(id) => void notes.select(id)}
                        onCreate={() => void notes.create()}
                        onRename={(id, title) => void notes.rename(id, title)}
                        onDelete={(id) => void notes.remove(id)}
                    />
                </aside>

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
                                ref={editorRef}
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
            </div>

            <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
        </div>
    );
}
```

- [ ] **Step 7: Full verification**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS — `Workspace` now passes the new `NoteList` props, the editor ref is typed via `EditorPaneHandle`, and all tests are green.

- [ ] **Step 8: Commit**

```bash
git add src/components/NoteList.tsx src/components/NoteList.css src/components/NoteList.test.tsx src/components/Workspace.tsx
git commit -m "feat: wire note search + keyboard shortcuts into the workspace"
```

---

## Task 10: Final verification + roadmap docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the roadmap**

In `CLAUDE.md`, replace this list item:
```markdown
3. ⬜ **Core UX & navigation** (next) — search/filter, keyboard shortcuts, sort/pin, inline rename; also
   stands up component testing. Kickoff: `docs/superpowers/handoffs/2026-06-19-core-ux-kickoff.md`.
```
with:
```markdown
3. ⬜ **Core UX & navigation (3a)** — search/filter, keyboard shortcuts, inline rename, list a11y
   rework; stands up component/hook testing.
   Spec: `docs/superpowers/specs/2026-06-20-core-ux-navigation-design.md`.
3b. ⬜ **Sort & pinning** — sort modes + pinned notes; introduces the metadata-persistence layer
   (the architectural decision deferred from 3a). Touches the `NoteStore` interface.
```

- [ ] **Step 2: Run the complete verification gate**

Run: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`
Expected: ALL PASS. If `format:check` flags files, run `npm run format` and re-stage.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, open the app in Chrome, pick a folder with a few notes, and verify:
- Typing in the search box filters the list and highlights matches; ⌘/Ctrl+K focuses it; Esc clears it.
- ⌘/Ctrl+J creates a note; ⌘/Ctrl+/ toggles the editor between WYSIWYG and markup.
- `?` opens the shortcuts dialog (and the header `?` button does too); typing `?` inside the editor does **not** open it.
- Double-click / F2 / ⋯-menu "Rename" all start inline rename; Enter and click-away commit; Esc cancels.
- ↑/↓ move the selection when the list has focus; opening the ⋯ menu does not select the note.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark Core UX slice as 3a, split out sort/pin as 3b"
```

- [ ] **Step 5: Push and open a PR**

```bash
git push -u origin core-ux-navigation
gh pr create --fill --base main
```
Then confirm CI is green and proceed with the finishing-a-development-branch skill.

---

## Self-Review Notes

- **Spec coverage:** search (Tasks 4, 9), ⌘K focus (5, 9), shortcuts + `?` help (5, 6, 9), inline rename (8), list a11y / eslint-disable removal (8), title match-highlighting (9), Vitest projects + jsdom (1), backfill conflict hook/UI (2, 3), EditorPane toggle (7) — all mapped.
- **Type consistency:** `EditorPaneHandle.toggleMode()`, `ShortcutActions` ({focusSearch, createNote, toggleEditorMode, openHelp}), `UseNoteSearch` ({query, setQuery, filteredNotes}), and `NoteList`'s new props (`query`, `onQueryChange`, `searchInputRef`) match across producer and consumer tasks.
- **Green build between commits:** every task either adds isolated code or lands a prop change together with its consumer (Task 9). EditorPane's `forwardRef` (Task 7) keeps working with the old, ref-less `Workspace` because refs are optional.
- **Known risk:** Gravity `DropdownMenu`/`Dialog` render through portals in jsdom; the delete test uses `findByRole` to await the popup. If a Gravity component proves unrenderable under jsdom, narrow that test rather than dropping coverage, and note it.
