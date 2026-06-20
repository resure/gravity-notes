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
