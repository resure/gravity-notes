# In-Editor Note Title Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editable title field at the top of the open-note surface (title = file name) so editing it renames the `.md` file, with native cursor handoff between the title and the body.

**Architecture:** The title lives inside `EditorPane` as a small `NoteTitle` input above the body. A rename commits on title blur / `Enter`. The body editor is keyed by a new, stable `useNotes.sessionId` (bumped only on open / disk-reload, **not** on rename), so a rename updates the note's id in place without recreating the ProseMirror editor — preserving the caret during the title→body handoff.

**Tech Stack:** React 18 + TypeScript (strict), `@gravity-ui/markdown-editor`, `@gravity-ui/uikit`, Vitest + Testing Library, File System Access API behind the `NoteStore` interface.

---

## File structure

- `src/storage/types.ts` — **modify**: add `NameCollisionError`.
- `src/storage/fileSystemStore.ts` — **modify**: `rename` throws on collision, returns the real new mtime.
- `src/storage/fileSystemStore.test.ts` — **modify**: update collision test, add mtime test.
- `src/hooks/useNotes.ts` — **modify**: `sessionId` (+ bump points), in-place rename, collision handling.
- `src/hooks/useNotes.test.tsx` — **modify**: session/rename/collision tests.
- `src/hooks/useNoteNavigation.ts` — **modify**: `autofocus: 'body' | 'title' | null`, `prepareCreate`.
- `src/hooks/useNoteNavigation.test.tsx` — **modify**: update autofocus tests.
- `src/components/NoteTitle.tsx` — **create**: the title input.
- `src/components/NoteTitle.css` — **create**: heading-styled input.
- `src/components/NoteTitle.test.tsx` — **create**.
- `src/components/editorCaret.ts` — **create**: first-visual-line detection (layout-based).
- `src/components/EditorPane.tsx` — **modify**: render `NoteTitle`, `[]` editor deps, cursor handoff, mount focus.
- `src/components/EditorPane.css` — **modify**: body wrapper layout.
- `src/components/EditorPane.test.tsx` — **modify**: enum autofocus, `onRename`, handoff tests.
- `src/components/Workspace.tsx` — **modify**: `sessionId` key, `onRename` wiring, `prepareCreate`, enum autofocus.
- `src/components/Workspace.test.tsx` — **modify**: title integration tests.
- `src/shortcuts.ts` + `src/components/ShortcutsDialog.tsx` — **modify**: help copy (Task 7).
- `CLAUDE.md`, `README.md` — **modify**: roadmap (Task 7).

---

## Task 1: Store — collision error + real rename mtime

**Files:**
- Modify: `src/storage/types.ts`
- Modify: `src/storage/fileSystemStore.ts:148-167` (the `rename` method)
- Test: `src/storage/fileSystemStore.test.ts:167-187` (the `rename — collisions` block)

- [ ] **Step 1: Update the failing tests**

In `src/storage/fileSystemStore.test.ts`, change the import line `import {ConflictError} from './types';` to:

```ts
import {ConflictError, NameCollisionError} from './types';
```

Replace the `rename — collisions` block (the `it('is a no-op when the target name is taken by another note', …)` test, currently at lines 176-186) with:

```ts
        it('throws NameCollisionError when the target name is taken by another note', async () => {
            dir.seedFile('Old.md', 'mine', 100);
            dir.seedFile('Taken.md', 'theirs', 200);
            await expect(store.rename('Old.md', 'Taken')).rejects.toBeInstanceOf(
                NameCollisionError,
            );
            // Both files are left intact; no auto-numbered "Taken 2.md".
            expect(await store.stat('Old.md')).not.toBeNull();
            expect(await store.stat('Taken 2.md')).toBeNull();
            expect((await store.get('Old.md')).content).toBe('mine');
            expect((await store.get('Taken.md')).content).toBe('theirs');
        });

        it('returns the new file mtime so the next save has a fresh baseline', async () => {
            dir.seedFile('Old.md', 'body', 100);
            const meta = await store.rename('Old.md', 'New');
            const disk = await store.stat('New.md');
            expect(meta.updatedAt).toBe(disk);
        });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/storage/fileSystemStore.test.ts`
Expected: FAIL — `NameCollisionError` is not exported; `rename` resolves instead of rejecting.

- [ ] **Step 3: Add `NameCollisionError`**

In `src/storage/types.ts`, after the `ConflictError` class (end of file), add:

```ts
/** Thrown by {@link NoteStore.rename} when the target name is already taken by another note. */
export class NameCollisionError extends Error {
    constructor(
        readonly id: string,
        readonly name: string,
    ) {
        super(`A note named "${name}" already exists`);
        this.name = 'NameCollisionError';
    }
}
```

Also update the `rename` doc comment in the `NoteStore` interface (currently around `types.ts:65-69`) to note the throw — replace it with:

```ts
    /**
     * Rename a note. Returns the new meta (the id may change, e.g. for file-backed
     * stores where the id is derived from the file name). Throws {@link NameCollisionError}
     * when the target name is already taken by another note.
     */
    rename(id: string, nextTitle: string): Promise<NoteMeta>;
```

- [ ] **Step 4: Update `FileSystemNoteStore.rename`**

In `src/storage/fileSystemStore.ts`, add `NameCollisionError` to the import from `./types`:

```ts
import {
    ConflictError,
    NameCollisionError,
    type Note,
    type NoteMeta,
    type NoteStore,
    type NotesMetadata,
} from './types';
```

Replace the whole `rename` method (currently `fileSystemStore.ts:148-167`) with:

```ts
    async rename(id: string, nextTitle: string): Promise<NoteMeta> {
        const base = sanitizeTitle(nextTitle);
        const nextName = base + MD_EXT;
        if (nextName === id) {
            return {id, title: titleFromFileName(id)};
        }
        // Renaming onto another note's name is rejected (no auto-numbered copy); the
        // caller surfaces it to the user.
        if (await this.exists(nextName)) {
            throw new NameCollisionError(id, base);
        }
        // The File System Access API has no atomic rename: copy to the new file,
        // then delete the old one.
        const content = (await this.get(id)).content;
        const handle = await this.dir.getFileHandle(nextName, {create: true});
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        await this.dir.removeEntry(id);
        // Read the real on-disk mtime so the caller can seed an accurate conflict baseline.
        const updatedAt = (await handle.getFile()).lastModified;
        return {id: nextName, title: titleFromFileName(nextName), updatedAt};
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/storage/fileSystemStore.test.ts`
Expected: PASS (all store tests green).

- [ ] **Step 6: Commit**

```bash
git add src/storage/types.ts src/storage/fileSystemStore.ts src/storage/fileSystemStore.test.ts
git commit -m "feat(storage): rename throws NameCollisionError + returns real mtime"
```

---

## Task 2: `useNotes` — stable `sessionId` + in-place rename + collision handling

**Files:**
- Modify: `src/hooks/useNotes.ts`
- Test: `src/hooks/useNotes.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/hooks/useNotes.test.tsx`, add these tests inside the `describe('useNotes — single note', …)` block (after the existing `'renames the active note in place'` test, around line 148):

```ts
    it('renaming the active note does not bump the editor session', async () => {
        const {hook} = await setup((dir) => dir.seedFile('Old.md', 'x', 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('Old.md');
        });
        const session = hook.result.current.sessionId;
        await act(async () => {
            await hook.result.current.rename('Old.md', 'New');
        });
        expect(hook.result.current.activeId).toBe('New.md');
        // Same session ⇒ the body editor is NOT remounted on a rename.
        expect(hook.result.current.sessionId).toBe(session);
    });

    it('opening a different note bumps the editor session', async () => {
        const {hook} = await setup((dir) => {
            dir.seedFile('A.md', 'a', 100);
            dir.seedFile('B.md', 'b', 200);
        });
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        const session = hook.result.current.sessionId;
        await act(async () => {
            await hook.result.current.open('B.md');
        });
        expect(hook.result.current.sessionId).not.toBe(session);
    });

    it('surfaces a rename collision and leaves the note unchanged', async () => {
        const onError = vi.fn();
        const dir = new FakeDirectoryHandle();
        dir.seedFile('A.md', 'a', 100);
        dir.seedFile('Taken.md', 't', 200);
        const store = new FileSystemNoteStore(asDirectoryHandle(dir));
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        let result: string | null = 'unset';
        await act(async () => {
            result = await hook.result.current.rename('A.md', 'Taken');
        });
        expect(result).toBeNull();
        expect(onError).toHaveBeenCalled();
        expect(hook.result.current.activeId).toBe('A.md');
    });
```

No new imports are needed — `renderHook`, `act`, `waitFor`, `vi`, `FakeDirectoryHandle`,
`asDirectoryHandle`, `FileSystemNoteStore`, and `useNotes` are all already imported at the top of
this test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/hooks/useNotes.test.tsx`
Expected: FAIL — `sessionId` is `undefined`; the collision test's `rename` rejects/throws instead of returning `null`.

- [ ] **Step 3: Add `sessionId` state + interface field**

In `src/hooks/useNotes.ts`, add `NameCollisionError` to the types import (currently lines 13-20):

```ts
import {
    ConflictError,
    NameCollisionError,
    type Note,
    type NoteMeta,
    type NoteStore,
    type NotesMetadata,
    type SortMode,
} from '../storage/types';
```

In the `UseNotes` interface, add the field right after `metadata: NotesMetadata;` (around line 37):

```ts
    /** Bumps when fresh content is loaded into the editor (open / disk-reload / restore). The
     *  body editor keys off this so a rename — which changes the id in place — never remounts it. */
    sessionId: number;
```

Inside the hook body, add state next to the other `useState`s (after the `metadataRef` line, around line 78):

```ts
    const [sessionId, setSessionId] = useState(0);
    const sessionRef = useRef(0);
    const bumpSession = useCallback(() => {
        sessionRef.current += 1;
        setSessionId(sessionRef.current);
    }, []);
```

- [ ] **Step 4: Bump the session on open / reloadDisk / restore**

In `open` (around line 169), add `bumpSession();` right after `setNote(loaded);`:

```ts
                const loaded = await store.get(id);
                baselineRef.current = loaded.updatedAt ?? null;
                setNote(loaded);
                bumpSession();
                setConflict(null);
                setSaveState('idle');
                await persistMetadata(withActive(metadataRef.current, id));
```

Add `bumpSession` to `open`'s dependency array (change `[flush, store, persistMetadata, onError]` to `[flush, store, persistMetadata, onError, bumpSession]`).

In `reloadDisk` (around line 282), add `bumpSession();` right after `setNote(loaded);`:

```ts
            const loaded = await store.get(id);
            baselineRef.current = loaded.updatedAt ?? null;
            setNote(loaded); // new content remounts the editor with disk content
            bumpSession();
            setConflict(null);
            setSaveState('idle');
            bumpInList(id, loaded.updatedAt);
```

Add `bumpSession` to `reloadDisk`'s dependency array (change `[conflict, store, onError, bumpInList, clearTimer]` to `[conflict, store, onError, bumpInList, clearTimer, bumpSession]`).

In the initial-load effect (around line 361-364), add `bumpSession();` after `setNote(loaded);`:

```ts
            if (loaded) {
                baselineRef.current = loaded.updatedAt ?? null;
                setNote(loaded);
                bumpSession();
            }
```

Add `bumpSession` to that effect's dependency array (change `[store, applyMetadata]` to `[store, applyMetadata, bumpSession]`).

- [ ] **Step 5: Rewrite `rename` for in-place update + collision handling**

Replace the whole `rename` callback (currently `useNotes.ts:208-238`) with:

```ts
    const rename = useCallback(
        async (id: string, nextTitle: string): Promise<string | null> => {
            if (conflict?.id === id) {
                onError('Resolve the conflict before renaming this note.');
                return null;
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
                    // Update the open note's identity in place — same content, same editor
                    // instance (no sessionId bump), so the caret/focus survives the rename.
                    baselineRef.current = meta.updatedAt ?? null;
                    setNote((prev) =>
                        prev && prev.id === id
                            ? {...prev, id: meta.id, title: meta.title, updatedAt: meta.updatedAt}
                            : prev,
                    );
                }
                return meta.id;
            } catch (err) {
                if (err instanceof NameCollisionError) {
                    onError(err.message);
                    return null;
                }
                onError(err instanceof Error ? err.message : 'Failed to rename note');
                return null;
            }
        },
        [conflict, flush, store, persistMetadata, refresh, onError],
    );
```

- [ ] **Step 6: Expose `sessionId` from the hook**

In the returned object (around line 424-443), add `sessionId,` right after `metadata,`:

```ts
    return {
        notes,
        metadata,
        sessionId,
        setSortMode,
        togglePin,
        activeId: metadata.active,
        note,
        // …rest unchanged…
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- src/hooks/useNotes.test.tsx`
Expected: PASS (including the pre-existing `'renames the active note in place'` test, which still sees `content: 'x'`).

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useNotes.ts src/hooks/useNotes.test.tsx
git commit -m "feat(notes): stable sessionId + in-place rename + collision toast"
```

---

## Task 3: `useNoteNavigation` — `autofocus` intent + `prepareCreate`

**Files:**
- Modify: `src/hooks/useNoteNavigation.ts`
- Test: `src/hooks/useNoteNavigation.test.tsx`

- [ ] **Step 1: Update the failing tests**

In `src/hooks/useNoteNavigation.test.tsx`, replace the four autofocus-related tests:

Replace `'commit on a not-yet-open note opens it with autofocus'` (lines 44-52) with:

```ts
    it('commit on a not-yet-open note opens it with body autofocus', () => {
        const deps = makeDeps({activeId: null});
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.commit('A.md');
        });
        expect(deps.open).toHaveBeenCalledWith('A.md');
        expect(result.current.autofocus).toBe('body');
    });
```

Replace `'prepareCommit arms editor autofocus for the next mount'` (lines 110-118) with:

```ts
    it('prepareCreate arms title autofocus for the next mount', () => {
        const deps = makeDeps();
        const {result} = renderHook(() => useNoteNavigation(deps));
        expect(result.current.autofocus).toBeNull();
        act(() => {
            result.current.prepareCreate();
        });
        expect(result.current.autofocus).toBe('title');
    });
```

Replace `'browse resets editorAutofocus (a preview must not steal focus)'` (lines 120-131) with:

```ts
    it('browse clears autofocus (a preview must not steal focus)', () => {
        const deps = makeDeps();
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.prepareCreate();
        });
        expect(result.current.autofocus).toBe('title');
        act(() => {
            result.current.browse('A.md');
        });
        expect(result.current.autofocus).toBeNull();
    });
```

Replace `'commit on the already-open note leaves editorAutofocus untouched'` (lines 133-141) with:

```ts
    it('commit on the already-open note leaves autofocus untouched', () => {
        const deps = makeDeps({activeId: 'A.md'});
        const {result} = renderHook(() => useNoteNavigation(deps));
        expect(result.current.autofocus).toBeNull();
        act(() => {
            result.current.commit('A.md');
        });
        expect(result.current.autofocus).toBeNull();
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/hooks/useNoteNavigation.test.tsx`
Expected: FAIL — `autofocus` / `prepareCreate` do not exist on the hook result.

- [ ] **Step 3: Update the hook interface**

In `src/hooks/useNoteNavigation.ts`, in the `UseNoteNavigation` interface, replace:

```ts
    /** Whether the next editor (re)mount should grab focus (true after a commit). */
    editorAutofocus: boolean;
```

with:

```ts
    /** Focus intent for the next editor (re)mount: the body (a commit), the title (a new note), or none. */
    autofocus: 'body' | 'title' | null;
```

and replace:

```ts
    /** Arm the editor to focus on its next mount (used before creating a note). */
    prepareCommit(): void;
```

with:

```ts
    /** Arm the title to focus + select on the next mount (used before creating a note). */
    prepareCreate(): void;
```

- [ ] **Step 4: Update the hook implementation**

Replace the state declaration (line 47):

```ts
    const [editorAutofocus, setEditorAutofocus] = useState(false);
```

with:

```ts
    const [autofocus, setAutofocus] = useState<'body' | 'title' | null>(null);
```

In `browse` (around line 64-71), replace `setEditorAutofocus(false);` with `setAutofocus(null);`.

In `commit` (around line 73-84), replace `setEditorAutofocus(true);` with `setAutofocus('body');`.

Replace the `prepareCommit` line (line 101):

```ts
    const prepareCommit = useCallback(() => setEditorAutofocus(true), []);
```

with:

```ts
    const prepareCreate = useCallback(() => setAutofocus('title'), []);
```

In the returned object (around line 111-121), replace `editorAutofocus,` with `autofocus,` and replace `prepareCommit,` with `prepareCreate,`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/hooks/useNoteNavigation.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useNoteNavigation.ts src/hooks/useNoteNavigation.test.tsx
git commit -m "feat(nav): autofocus intent (body/title/null) + prepareCreate"
```

---

## Task 4: `NoteTitle` component

**Files:**
- Create: `src/components/NoteTitle.tsx`
- Create: `src/components/NoteTitle.css`
- Test: `src/components/NoteTitle.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/NoteTitle.test.tsx`:

```tsx
import {createRef} from 'react';

import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {NoteTitle, type NoteTitleHandle} from './NoteTitle';

function noop() {}

describe('NoteTitle', () => {
    it('shows the title and an Untitled placeholder', () => {
        render(
            <NoteTitle title="Ideas" onCommit={noop} onLeaveToBody={noop} onEscape={noop} />,
        );
        const input = screen.getByLabelText('Note title') as HTMLInputElement;
        expect(input.value).toBe('Ideas');
        expect(input.placeholder).toBe('Untitled');
    });

    it('commits the draft on blur', async () => {
        const user = userEvent.setup();
        const onCommit = vi.fn();
        render(
            <NoteTitle title="Old" onCommit={onCommit} onLeaveToBody={noop} onEscape={noop} />,
        );
        const input = screen.getByLabelText('Note title');
        await user.clear(input);
        await user.type(input, 'New');
        await user.tab();
        expect(onCommit).toHaveBeenCalledWith('New');
    });

    it('Enter and ArrowDown leave for the body', async () => {
        const user = userEvent.setup();
        const onLeaveToBody = vi.fn();
        render(
            <NoteTitle
                title="X"
                onCommit={noop}
                onLeaveToBody={onLeaveToBody}
                onEscape={noop}
            />,
        );
        const input = screen.getByLabelText('Note title');
        input.focus();
        await user.keyboard('{Enter}');
        await user.keyboard('{ArrowDown}');
        expect(onLeaveToBody).toHaveBeenCalledTimes(2);
    });

    it('Escape reverts the draft and steps out', async () => {
        const user = userEvent.setup();
        const onEscape = vi.fn();
        const onCommit = vi.fn();
        render(
            <NoteTitle
                title="Keep"
                onCommit={onCommit}
                onLeaveToBody={noop}
                onEscape={onEscape}
            />,
        );
        const input = screen.getByLabelText('Note title') as HTMLInputElement;
        await user.clear(input);
        await user.type(input, 'Throwaway');
        await user.keyboard('{Escape}');
        expect(onEscape).toHaveBeenCalledTimes(1);
        expect(input.value).toBe('Keep'); // reverted
    });

    it('commits a dirty draft on unmount (programmatic switch safety net)', async () => {
        const user = userEvent.setup();
        const onCommit = vi.fn();
        const {unmount} = render(
            <NoteTitle title="Old" onCommit={onCommit} onLeaveToBody={noop} onEscape={noop} />,
        );
        const input = screen.getByLabelText('Note title');
        await user.clear(input);
        await user.type(input, 'Renamed');
        unmount();
        expect(onCommit).toHaveBeenCalledWith('Renamed');
    });

    it('syncs to a changed title prop only while unfocused', async () => {
        const user = userEvent.setup();
        const {rerender} = render(
            <NoteTitle title="First" onCommit={noop} onLeaveToBody={noop} onEscape={noop} />,
        );
        const input = screen.getByLabelText('Note title') as HTMLInputElement;
        // Unfocused: a prop change updates the field.
        rerender(
            <NoteTitle title="Second" onCommit={noop} onLeaveToBody={noop} onEscape={noop} />,
        );
        expect(input.value).toBe('Second');
        // Focused + edited: a prop change must NOT clobber the user's typing.
        await user.click(input);
        await user.clear(input);
        await user.type(input, 'Typing');
        rerender(
            <NoteTitle title="Third" onCommit={noop} onLeaveToBody={noop} onEscape={noop} />,
        );
        expect(input.value).toBe('Typing');
    });

    it('focusAtEnd focuses the input', () => {
        const ref = createRef<NoteTitleHandle>();
        render(
            <NoteTitle ref={ref} title="Hi" onCommit={noop} onLeaveToBody={noop} onEscape={noop} />,
        );
        ref.current?.focusAtEnd();
        expect(screen.getByLabelText('Note title')).toHaveFocus();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/NoteTitle.test.tsx`
Expected: FAIL — module `./NoteTitle` does not exist.

- [ ] **Step 3: Create the component**

Create `src/components/NoteTitle.tsx`:

```tsx
import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent} from 'react';

import './NoteTitle.css';

export interface NoteTitleHandle {
    /** Move keyboard focus to the title input. */
    focus(): void;
    /** Focus the title and place the caret at the end (used by ↑-from-body). */
    focusAtEnd(): void;
    /** Focus and select the whole title (used when a new note opens). */
    select(): void;
}

interface NoteTitleProps {
    /** The committed title (file name without `.md`). */
    title: string;
    /** Read-only in preview mode. */
    readOnly?: boolean;
    /** Commit a rename. Fired on blur (and on unmount if still dirty). */
    onCommit: (nextTitle: string) => void;
    /** Move the caret into the body (Enter / ↓). */
    onLeaveToBody: () => void;
    /** Step back out to the list (Esc). */
    onEscape: () => void;
}

/**
 * The editable note title — a single-line, heading-styled input whose value is the file
 * name (minus `.md`). Edits stay local until committed: `onBlur` fires `onCommit` (which
 * renames the file), so moving to the body / clicking away / switching notes all commit.
 * `Enter` and `↓` move the caret into the body; `Esc` reverts and steps out. As a safety
 * net for programmatic note switches that never blur, a dirty draft is also committed on
 * unmount.
 */
export const NoteTitle = forwardRef<NoteTitleHandle, NoteTitleProps>(function NoteTitle(
    {title, readOnly = false, onCommit, onLeaveToBody, onEscape},
    ref,
) {
    const [draft, setDraft] = useState(title);
    const inputRef = useRef<HTMLInputElement>(null);

    // Latest values via refs, so the unmount-commit reads fresh data without re-subscribing.
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const titleRef = useRef(title);
    titleRef.current = title;
    const onCommitRef = useRef(onCommit);
    onCommitRef.current = onCommit;

    // Sync the draft to a changed committed title (e.g. the sanitized result of a rename),
    // but only while unfocused — never clobber what the user is actively typing.
    useEffect(() => {
        if (document.activeElement !== inputRef.current) setDraft(title);
    }, [title]);

    useImperativeHandle(
        ref,
        () => ({
            focus() {
                inputRef.current?.focus();
            },
            focusAtEnd() {
                const el = inputRef.current;
                if (!el) return;
                el.focus();
                const end = el.value.length;
                el.setSelectionRange(end, end);
            },
            select() {
                inputRef.current?.select();
            },
        }),
        [],
    );

    // Commit a dirty draft on unmount (a programmatic switch may never blur the field).
    useEffect(() => {
        return () => {
            if (draftRef.current !== titleRef.current) onCommitRef.current(draftRef.current);
        };
    }, []);

    const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' || event.key === 'ArrowDown') {
            event.preventDefault();
            onLeaveToBody(); // focuses the body → blurs here → onBlur commits
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation(); // don't double-fire the editor pane's Esc handler
            setDraft(title); // revert
            onEscape();
        }
    };

    return (
        <input
            ref={inputRef}
            className="note-title"
            type="text"
            aria-label="Note title"
            placeholder="Untitled"
            spellCheck={false}
            value={draft}
            readOnly={readOnly}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => onCommit(draft)}
            onKeyDown={onKeyDown}
        />
    );
});
```

- [ ] **Step 4: Create the styles**

Create `src/components/NoteTitle.css`:

```css
/* The note title: a borderless, heading-styled input sitting between an h1 and an h2.
   Left/right padding is matched to the editor body in EditorPane.css so the title and the
   first body line align. */
.note-title {
    display: block;
    width: 100%;
    box-sizing: border-box;
    border: none;
    outline: none;
    background: transparent;
    margin: 0;
    padding: 4px 0 6px;
    color: var(--g-color-text-primary);
    font-family: inherit;
    font-size: 1.6rem;
    font-weight: 600;
    line-height: 1.25;
}

.note-title::placeholder {
    color: var(--g-color-text-secondary);
    font-weight: 600;
}

.note-title[readonly] {
    cursor: default;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/components/NoteTitle.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/NoteTitle.tsx src/components/NoteTitle.css src/components/NoteTitle.test.tsx
git commit -m "feat(editor): NoteTitle — editable, heading-styled title input"
```

---

## Task 5: `EditorPane` — mount the title, decouple the editor, cursor handoff

**Files:**
- Create: `src/components/editorCaret.ts`
- Modify: `src/components/EditorPane.tsx` (full rewrite)
- Modify: `src/components/EditorPane.css`
- Test: `src/components/EditorPane.test.tsx`

- [ ] **Step 1: Create the first-line caret helper**

Create `src/components/editorCaret.ts`:

```ts
/**
 * True when the current DOM selection's caret sits on the first visual line of `container`.
 * Decides whether ArrowUp in the body should hand off to the title. Works for both the
 * WYSIWYG (ProseMirror) and Markup (CodeMirror) contenteditables since it measures the live
 * DOM selection. Layout-based (getBoundingClientRect), so it's covered by manual/Chromium
 * testing rather than jsdom; EditorPane tests mock this module.
 */
export function isCaretOnFirstLine(container: HTMLElement): boolean {
    const win = container.ownerDocument.defaultView;
    const sel = win?.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rects = range.getClientRects();
    const caretRect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const lineHeight = parseFloat(win ? win.getComputedStyle(container).lineHeight : '') || 20;
    // Within ~¾ of a line of the content top counts as the first line.
    return caretRect.top - containerRect.top < lineHeight * 0.75;
}
```

- [ ] **Step 2: Update the failing tests**

Rewrite `src/components/EditorPane.test.tsx` to (a) add `moveCursor` + a mocked caret helper, (b) add `onRename` to every render, (c) switch `autofocus` to the enum, (d) add handoff tests. Full file:

```tsx
import {createRef, type ComponentPropsWithRef} from 'react';

import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {fakeEditor, setEditorMode, focus, moveCursor, isCaretOnFirstLine} = vi.hoisted(() => {
    const setEditorMode = vi.fn();
    const focus = vi.fn();
    const moveCursor = vi.fn();
    const isCaretOnFirstLine = vi.fn(() => true);
    return {
        setEditorMode,
        focus,
        moveCursor,
        isCaretOnFirstLine,
        fakeEditor: {
            currentMode: 'wysiwyg' as 'wysiwyg' | 'markup',
            setEditorMode,
            focus,
            moveCursor,
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

vi.mock('./editorCaret', () => ({isCaretOnFirstLine}));

import {EditorPane, type EditorPaneHandle} from './EditorPane';

const NOTE = {id: 'a.md', title: 'a', content: 'hello', updatedAt: 1};

function renderPane(props: Partial<ComponentPropsWithRef<typeof EditorPane>> = {}) {
    return render(
        <EditorPane
            note={NOTE}
            autofocus={null}
            onChange={() => {}}
            onRename={() => {}}
            onEscape={() => {}}
            {...props}
        />,
    );
}

describe('EditorPane — toggleMode', () => {
    beforeEach(() => {
        fakeEditor.currentMode = 'wysiwyg';
        setEditorMode.mockClear();
    });

    it('switches to markup when currently in wysiwyg', () => {
        const ref = createRef<EditorPaneHandle>();
        renderPane({ref});
        ref.current?.toggleMode();
        expect(setEditorMode).toHaveBeenCalledWith('markup');
    });
});

describe('EditorPane — focus', () => {
    beforeEach(() => focus.mockClear());

    it('focuses the body on mount when autofocus is "body"', () => {
        renderPane({autofocus: 'body'});
        expect(focus).toHaveBeenCalled();
    });

    it('does not focus the body on mount when autofocus is null (a preview open)', () => {
        renderPane({autofocus: null});
        expect(focus).not.toHaveBeenCalled();
    });

    it('focuses via the imperative handle', () => {
        const ref = createRef<EditorPaneHandle>();
        renderPane({ref});
        expect(focus).not.toHaveBeenCalled();
        ref.current?.focus();
        expect(focus).toHaveBeenCalledTimes(1);
    });

    it('focuses the title on mount when autofocus is "title"', () => {
        renderPane({autofocus: 'title'});
        expect(screen.getByLabelText('Note title')).toHaveFocus();
        expect(focus).not.toHaveBeenCalled();
    });
});

describe('EditorPane — escape', () => {
    it('fires onEscape when Escape bubbles out of the editor', () => {
        const onEscape = vi.fn();
        const {container} = renderPane({onEscape});
        const pane = container.querySelector('.editor-pane');
        if (!pane) throw new Error('editor-pane not rendered');
        fireEvent.keyDown(pane, {key: 'Escape'});
        expect(onEscape).toHaveBeenCalledTimes(1);
    });
});

describe('EditorPane — preview', () => {
    it('renders the read-only preview when preview is true', () => {
        const {container} = renderPane({preview: true});
        expect(container.querySelector('.note-preview')).toBeTruthy();
    });

    it('goes to the list (keeping preview) on Escape while previewing', () => {
        const onEscape = vi.fn();
        const {container} = renderPane({preview: true, onEscape});
        const pane = container.querySelector('.editor-pane');
        if (!pane) throw new Error('editor-pane not rendered');
        fireEvent.keyDown(pane, {key: 'Escape'});
        expect(onEscape).toHaveBeenCalledTimes(1);
    });
});

describe('EditorPane — title ↔ body handoff', () => {
    beforeEach(() => {
        focus.mockClear();
        moveCursor.mockClear();
        isCaretOnFirstLine.mockReturnValue(true);
    });

    it('Enter in the title moves the caret to the start of the body', () => {
        renderPane();
        fireEvent.keyDown(screen.getByLabelText('Note title'), {key: 'Enter'});
        expect(moveCursor).toHaveBeenCalledWith('start');
        expect(focus).toHaveBeenCalled();
    });

    it('ArrowDown in the title moves the caret to the body', () => {
        renderPane();
        fireEvent.keyDown(screen.getByLabelText('Note title'), {key: 'ArrowDown'});
        expect(moveCursor).toHaveBeenCalledWith('start');
    });

    it('ArrowUp on the first body line focuses the title', () => {
        isCaretOnFirstLine.mockReturnValue(true);
        const {container} = renderPane();
        const body = container.querySelector('.editor-pane__body');
        if (!body) throw new Error('body not rendered');
        fireEvent.keyDown(body, {key: 'ArrowUp'});
        expect(screen.getByLabelText('Note title')).toHaveFocus();
    });

    it('ArrowUp below the first body line does not focus the title', () => {
        isCaretOnFirstLine.mockReturnValue(false);
        const {container} = renderPane();
        const body = container.querySelector('.editor-pane__body');
        if (!body) throw new Error('body not rendered');
        fireEvent.keyDown(body, {key: 'ArrowUp'});
        expect(screen.getByLabelText('Note title')).not.toHaveFocus();
    });

    it('commits a title edit on blur, tagged with the note id', async () => {
        const user = userEvent.setup();
        const onRename = vi.fn();
        renderPane({onRename});
        const input = screen.getByLabelText('Note title');
        await user.clear(input);
        await user.type(input, 'Renamed');
        await user.tab();
        expect(onRename).toHaveBeenCalledWith('a.md', 'Renamed');
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/components/EditorPane.test.tsx`
Expected: FAIL — `EditorPane` has no `onRename` prop / no `.editor-pane__body` / `autofocus` is boolean.

- [ ] **Step 4: Rewrite `EditorPane`**

Replace the entire contents of `src/components/EditorPane.tsx` with:

```tsx
import {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';

import {MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';

import type {Note} from '../storage/types';

import {isCaretOnFirstLine} from './editorCaret';
import {NotePreview} from './NotePreview';
import {NoteTitle, type NoteTitleHandle} from './NoteTitle';

import './EditorPane.css';

export interface EditorPaneHandle {
    /** Flip between the WYSIWYG and Markup editing modes. */
    toggleMode(): void;
    /** Move keyboard focus into the editor body. */
    focus(): void;
}

interface EditorPaneProps {
    note: Note;
    /** Focus intent on (re)mount: the body (a commit), the title (a new note), or none (preview). */
    autofocus: 'body' | 'title' | null;
    /** Read-only preview mode. Owned by Workspace so it persists across note switches. */
    preview?: boolean;
    onChange: (markup: string) => void;
    /** Commit a title edit (renames the file). Carries the note id it applies to. */
    onRename: (id: string, nextTitle: string) => void;
    /** Fired when an otherwise-unhandled Escape bubbles out of the editor (exit to the list). */
    onEscape: () => void;
}

/**
 * The open-note surface: an editable title above the Gravity markdown editor body. The
 * editor instance is created once per mount; EditorPane is keyed by `useNotes.sessionId`,
 * so a real note switch / disk reload remounts it, but a rename — which changes `note.id`
 * in place — does not, keeping the caret during the title→body handoff. In `preview` mode
 * the body is a read-only render and the title is read-only.
 */
export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane(
    {note, autofocus, preview = false, onChange, onRename, onEscape},
    ref,
) {
    const editor = useMarkdownEditor(
        {
            md: {html: false},
            initial: {markup: note.content, mode: 'wysiwyg'},
        },
        [],
    );

    const previewRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<NoteTitleHandle>(null);
    const bodyRef = useRef<HTMLDivElement>(null);

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

    // Focus on (re)mount per the autofocus intent: the title for a new note, else the body
    // (the preview surface when previewing). `editor` changes per mount (sessionId key).
    useEffect(() => {
        if (autofocus === 'title') {
            titleRef.current?.focus();
            titleRef.current?.select();
        } else if (autofocus === 'body') {
            if (preview) previewRef.current?.focus();
            else editor.focus();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- focus only on (re)mount
    }, [editor]);

    // Move focus when preview is toggled within a note: onto the preview on enter, back to
    // the body on exit, so the Esc ladder keeps working.
    const prevPreviewRef = useRef(preview);
    useEffect(() => {
        if (preview === prevPreviewRef.current) return;
        prevPreviewRef.current = preview;
        if (preview) previewRef.current?.focus();
        else editor.focus();
    }, [preview, editor]);

    // Title → body: put the caret at the start of the body and focus it (the preview surface
    // when previewing). Blurring the title here also commits the rename via NoteTitle.onBlur.
    const goToBody = () => {
        if (preview) {
            previewRef.current?.focus();
            return;
        }
        editor.moveCursor('start');
        editor.focus();
    };

    return (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the wrapper captures Escape that bubbles out of the richtext editor; the editor itself is the interactive element
        <div
            className="editor-pane"
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                // Esc always steps out to the list; preview mode stays on (toggle it with ⌘⇧P).
                onEscape();
            }}
        >
            <NoteTitle
                ref={titleRef}
                title={note.title}
                readOnly={preview}
                onCommit={(nextTitle) => onRename(note.id, nextTitle)}
                onLeaveToBody={goToBody}
                onEscape={onEscape}
            />
            <div
                ref={bodyRef}
                className="editor-pane__body"
                onKeyDown={(event) => {
                    // Body → title: ArrowUp on the first visual line hands off to the title.
                    if (
                        preview ||
                        event.key !== 'ArrowUp' ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.altKey ||
                        event.shiftKey
                    ) {
                        return;
                    }
                    const body = bodyRef.current;
                    if (body && isCaretOnFirstLine(body)) {
                        event.preventDefault();
                        titleRef.current?.focusAtEnd();
                    }
                }}
            >
                {preview ? (
                    <NotePreview ref={previewRef} markup={editor.getValue()} />
                ) : (
                    <MarkdownEditorView
                        settingsVisible={false}
                        stickyToolbar={false}
                        autofocus={autofocus === 'body'}
                        editor={editor}
                    />
                )}
            </div>
        </div>
    );
});
```

- [ ] **Step 5: Add the body-wrapper style**

In `src/components/EditorPane.css`, append:

```css
/* The body sits under the title; it owns the editor's own scroll. The title (in NoteTitle.css)
   is pinned above it. Horizontal padding here matches the title so the two left edges align. */
.editor-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}

.editor-pane__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- src/components/EditorPane.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/editorCaret.ts src/components/EditorPane.tsx src/components/EditorPane.css src/components/EditorPane.test.tsx
git commit -m "feat(editor): mount NoteTitle in EditorPane + native title↔body cursor handoff"
```

---

## Task 6: `Workspace` — wire the title, key by `sessionId`, focus on create

**Files:**
- Modify: `src/components/Workspace.tsx`
- Test: `src/components/Workspace.test.tsx`

- [ ] **Step 1: Write the failing integration tests**

In `src/components/Workspace.test.tsx`, add `moveCursor: vi.fn()` to the mocked editor — change the mock block (lines 5-15) to:

```tsx
vi.mock('@gravity-ui/markdown-editor', () => ({
    useMarkdownEditor: () => ({
        currentMode: 'wysiwyg',
        setEditorMode: vi.fn(),
        focus: vi.fn(),
        moveCursor: vi.fn(),
        getValue: () => '',
        on: () => {},
        off: () => {},
    }),
    MarkdownEditorView: () => null,
}));
```

Add these tests at the end of the `describe('Workspace — nvALT navigation', …)` block (before its closing `});`):

```tsx
    it('shows the open note title in an editable field', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() =>
            expect(screen.getByLabelText('Note title')).toHaveValue('Beta'),
        );
    });

    it('renames the file when the title is edited and committed', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        const title = await screen.findByLabelText('Note title');
        await user.clear(title);
        await user.type(title, 'Beta Renamed');
        // Commit by blurring to the search box (no note switch).
        await user.click(screen.getByPlaceholderText(/Search/));
        await screen.findByRole('option', {name: /Beta Renamed/});
    });

    it('focuses the title when creating a note', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await user.click(screen.getByRole('button', {name: 'New'}));
        await waitFor(() => expect(screen.getByLabelText('Note title')).toHaveFocus());
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/Workspace.test.tsx`
Expected: FAIL — no `Note title` field is rendered (Workspace still passes the old props / key).

- [ ] **Step 3: Add the editor-rename handler**

In `src/components/Workspace.tsx`, add a handler next to `handleRename` (after it, around line 159). This is distinct from the list's `handleRename` (which restores list focus); the editor keeps focus in the body:

```tsx
    // Rename from the in-editor title. Unlike the list rename, focus stays in the editor, so
    // we only move the list cursor to the new id (and only when the renamed note is still the
    // open one — an unmount-time commit of a note we've since left must not hijack selection).
    const handleEditorRename = useCallback(
        (id: string, title: string) => {
            const wasActive = notes.activeId === id;
            void (async () => {
                const newId = await notes.rename(id, title);
                if (wasActive && newId && newId !== id) nav.setSelected(newId);
            })();
        },
        [notes, nav],
    );
```

- [ ] **Step 4: Use `prepareCreate` on create**

In `handleCreate` (around line 111), replace:

```tsx
            nav.prepareCommit(); // arm autofocus so the new note mounts focused
```

with:

```tsx
            nav.prepareCreate(); // arm the title to focus + select on the new note's mount
```

- [ ] **Step 5: Key the editor by `sessionId` and pass the new props**

In the `EditorPane` JSX (around line 242-250), replace:

```tsx
                                <EditorPane
                                    ref={editorRef}
                                    key={`${notes.note.id}:${notes.note.updatedAt}`}
                                    note={notes.note}
                                    autofocus={nav.editorAutofocus}
                                    preview={previewMode}
                                    onChange={notes.edit}
                                    onEscape={nav.escapeEditor}
                                />
```

with:

```tsx
                                <EditorPane
                                    ref={editorRef}
                                    key={notes.sessionId}
                                    note={notes.note}
                                    autofocus={nav.autofocus}
                                    preview={previewMode}
                                    onChange={notes.edit}
                                    onRename={handleEditorRename}
                                    onEscape={nav.escapeEditor}
                                />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- src/components/Workspace.test.tsx`
Expected: PASS (new title tests green; existing nvALT tests still green).

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — all suites green, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/Workspace.tsx src/components/Workspace.test.tsx
git commit -m "feat(editor): wire in-editor title rename + key the pane by sessionId"
```

---

## Task 7: Help copy, docs, and manual verification

**Files:**
- Modify: `src/shortcuts.ts`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update the `enter` shortcut help description**

In `src/shortcuts.ts`, in the `SHORTCUTS` array, replace the `enter` entry (line 39):

```ts
    {keys: 'enter', description: 'Edit the selected note', group: 'Navigation'},
```

with:

```ts
    {keys: 'enter', description: 'Edit the selected note (in the title → jump to the body)', group: 'Navigation'},
```

(Leave `up` / `down` / `esc` unchanged — they describe list navigation; the title handoff is editor-local and discoverable.)

- [ ] **Step 2: Update the matching test assertion and re-run**

`src/components/ShortcutsDialog.test.tsx:19` asserts the old exact string. Change:

```ts
        expect(screen.getByText('Edit the selected note')).toBeInTheDocument();
```

to:

```ts
        expect(
            screen.getByText('Edit the selected note (in the title → jump to the body)'),
        ).toBeInTheDocument();
```

Run: `npm test -- src/components/ShortcutsDialog.test.tsx src/hooks/useShortcuts.test.tsx`
Expected: PASS (the generic "renders every descriptor" loop adapts automatically; `useShortcuts` is keyed by action, not text).

- [ ] **Step 3: Update `CLAUDE.md` roadmap**

In `CLAUDE.md`, under "Roadmap & active work" → item 3, add a sub-bullet after the "Remove tabs + nvALT navigation" entry:

```markdown
   - ✅ **In-editor note title field** — editable title (= file name) atop the open note;
     rename-on-leave/Enter, native title↔body cursor handoff, body editor decoupled from the
     file-name id via `useNotes.sessionId`.
     Spec: `docs/superpowers/specs/2026-06-21-note-title-field-design.md`.
```

- [ ] **Step 4: Update `README.md`**

In `README.md`, under the `## Features (v1)` list, add a bullet right after the
`- Gravity Markdown editor (WYSIWYG + markup modes)` line:

```markdown
- Editable note title (the file name) atop the editor, with native cursor movement to/from the body
```

(If the README's working copy already lists a "note title" item under `### Backlog` / `### Next up`,
remove that stale entry in the same edit.)

- [ ] **Step 5: Full verification — tests, lint, build**

Run: `npm test && npm run lint && npm run build`
Expected: all green — Vitest passes, ESLint clean (Prettier included), `tsc` + Vite build succeed.

- [ ] **Step 6: Manual Chromium smoke test**

Run: `npm run dev`, open in Chrome, pick a folder, and verify:
- Opening a note shows its title atop the body; the title reads the file name.
- Editing the title and pressing `Enter` (or `↓`) jumps the caret to the body **and** renames the file + sidebar row (check the folder on disk).
- `↑` on the first line of the body jumps the caret to the end of the title; `↑` lower in the body does not.
- Clicking away / switching notes commits a pending title rename.
- Renaming onto an existing note's name reverts the title and shows an error toast.
- Creating a note (`⌘J` / New) lands the cursor in the title with "Untitled" selected.
- The title aligns with the body's left edge; styling sits between an h1 and h2. (Tune the px in `NoteTitle.css` / `EditorPane.css` if the alignment is off.)

- [ ] **Step 7: Commit**

```bash
git add src/shortcuts.ts CLAUDE.md README.md
git commit -m "docs(editor): help copy + roadmap for the in-editor title field"
```

---

## Self-review notes (for the implementer)

- **`note.content` after an in-place rename** stays the pre-rename string (the rename does not reload content). That's fine: it's only used to suppress the editor's initial no-op change, and it doesn't change across a rename, so the change-handler effect is undisturbed.
- **Double-commit on title blur + unmount** is harmless — `store.rename` short-circuits when the sanitized name already matches the current file name.
- **jsdom can't measure layout**, so `isCaretOnFirstLine` is mocked in `EditorPane.test.tsx`; its real behavior is validated in the Task 7 manual smoke test.
- If the existing `'creates a note and opens it'` Workspace test starts asserting body focus, it shouldn't — creation now focuses the **title**. Leave that test's existing assertions as-is (it only checks the row + placeholder).
```