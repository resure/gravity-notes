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
            JSON.stringify({
                version: 1,
                sort: 'updated',
                pinned: [],
                created: {},
                active: 'Ghost.md',
            }),
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
        let copyId: string | null = null;
        await act(async () => {
            copyId = await hook.result.current.saveAsCopy();
        });
        expect(copyId).toBe('Note (conflicted copy).md');
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
