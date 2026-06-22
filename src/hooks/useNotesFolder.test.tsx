import {act, renderHook, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The hook reads `'showDirectoryPicker' in window` at module load to decide whether the File System
// Access API is supported. `vi.hoisted` runs this before the (also-hoisted) hook import, so the hook
// boots into the supported path.
vi.hoisted(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {configurable: true, value: () => {}});
});

import {
    clearDirHandle,
    loadDirHandle,
    queryPermission,
    requestPermission,
    saveDirHandle,
} from '../storage/handlePersistence';

import {useNotesFolder} from './useNotesFolder';

vi.mock('../storage/handlePersistence', () => ({
    loadDirHandle: vi.fn(),
    saveDirHandle: vi.fn(),
    clearDirHandle: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn(),
}));

const fakeHandle = {name: 'notes'} as unknown as FileSystemDirectoryHandle;

describe('useNotesFolder', () => {
    beforeEach(() => {
        vi.mocked(loadDirHandle).mockResolvedValue(undefined);
        vi.mocked(saveDirHandle).mockResolvedValue(undefined);
        vi.mocked(clearDirHandle).mockResolvedValue(undefined);
        vi.mocked(queryPermission).mockResolvedValue('granted');
        vi.mocked(requestPermission).mockResolvedValue(true);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('falls back to needs-folder when no folder was saved', async () => {
        vi.mocked(loadDirHandle).mockResolvedValue(undefined);
        const {result} = renderHook(() => useNotesFolder());
        await waitFor(() => expect(result.current.state).toBe('needs-folder'));
        expect(result.current.dir).toBeNull();
        expect(result.current.folderName).toBeNull();
    });

    it('restores a saved folder when permission is already granted', async () => {
        vi.mocked(loadDirHandle).mockResolvedValue(fakeHandle);
        vi.mocked(queryPermission).mockResolvedValue('granted');
        const {result} = renderHook(() => useNotesFolder());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        expect(result.current.dir).toBe(fakeHandle);
        expect(result.current.folderName).toBe('notes');
    });

    it('asks to re-grant permission when the saved folder is only prompt', async () => {
        vi.mocked(loadDirHandle).mockResolvedValue(fakeHandle);
        vi.mocked(queryPermission).mockResolvedValue('prompt');
        const {result} = renderHook(() => useNotesFolder());
        await waitFor(() => expect(result.current.state).toBe('needs-permission'));
        expect(result.current.folderName).toBe('notes');
        expect(result.current.dir).toBeNull();
    });

    it('surfaces the error and recovers when the saved folder cannot be loaded', async () => {
        vi.mocked(loadDirHandle).mockRejectedValue(new Error('IndexedDB blocked'));
        const {result} = renderHook(() => useNotesFolder());
        await waitFor(() => expect(result.current.state).toBe('needs-folder'));
        expect(result.current.error).toBe('IndexedDB blocked');
    });

    it('forgetFolder clears the saved handle and returns to needs-folder', async () => {
        vi.mocked(loadDirHandle).mockResolvedValue(fakeHandle);
        vi.mocked(queryPermission).mockResolvedValue('granted');
        const {result} = renderHook(() => useNotesFolder());
        await waitFor(() => expect(result.current.state).toBe('ready'));

        await act(async () => {
            await result.current.forgetFolder();
        });

        expect(clearDirHandle).toHaveBeenCalledTimes(1);
        expect(result.current.state).toBe('needs-folder');
        expect(result.current.dir).toBeNull();
        expect(result.current.folderName).toBeNull();
    });
});
