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
        expect((await store.readMetadata()).created['Note (conflicted copy).md']).toBeGreaterThan(
            0,
        );
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
        await waitFor(async () =>
            expect((await store.readMetadata()).open).toEqual(['A.md', 'B.md']),
        );

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

    it('renames an open tab in place', async () => {
        const {hook, store} = await setup((dir) => dir.seedFile('Old.md', 'x', 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('Old.md');
        });
        await act(async () => {
            await hook.result.current.rename('Old.md', 'New');
        });
        expect(hook.result.current.openIds).toEqual(['New.md']);
        expect(hook.result.current.activeId).toBe('New.md');
        expect(hook.result.current.openNotes.has('Old.md')).toBe(false);
        expect(hook.result.current.openNotes.get('New.md')?.content).toBe('x');
        expect((await store.readMetadata()).open).toEqual(['New.md']);
    });

    it('closes a tab when its note is removed', async () => {
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
            await hook.result.current.remove('B.md');
        });
        expect(hook.result.current.openIds).toEqual(['A.md']);
        expect(hook.result.current.openNotes.has('B.md')).toBe(false);
        expect(hook.result.current.saveStates.has('B.md')).toBe(false);
    });

    it('detects a conflict on a background (non-active) tab', async () => {
        const {hook, dir} = await setup((seedDir) => {
            seedDir.seedFile('A.md', 'a', 100);
            seedDir.seedFile('B.md', 'b', 200);
        });
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        await act(async () => {
            await hook.result.current.open('B.md');
        });
        // B is active; an external edit to the background tab A bumps its mtime.
        dir.seedFile('A.md', 'a2', 999);
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });
        await waitFor(() => expect(hook.result.current.conflicts.has('A.md')).toBe(true));
        expect(hook.result.current.conflicts.has('B.md')).toBe(false);
        expect(hook.result.current.activeId).toBe('B.md');
    });
});
