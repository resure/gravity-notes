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
        // The copy is a new note created in-app, so it gets a created stamp.
        expect((await store.readMetadata()).created['Note (conflicted copy).md']).toBeGreaterThan(
            0,
        );
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
        // Seed a note so we can wait for the initial load (notes + metadata) to settle
        // before mutating — otherwise the mount effect could reset state after setSortMode.
        const {hook, store} = await setup((dir) => dir.seedFile('Note.md', 'x', 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
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
