import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../storage/handlePersistence', () => ({
    loadBackend: vi.fn(),
    loadDirHandle: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn(),
    saveDirHandle: vi.fn(),
    saveBackend: vi.fn(),
    clearStorageChoice: vi.fn(),
}));

import {
    clearStorageChoice,
    loadBackend,
    loadDirHandle,
    queryPermission,
    requestPermission,
    saveBackend,
    saveDirHandle,
} from '../storage/handlePersistence';

import {useNotesStorage} from './useNotesStorage';

const fakeHandle = {name: 'notes'} as unknown as FileSystemDirectoryHandle;

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadBackend).mockResolvedValue(undefined);
    vi.mocked(loadDirHandle).mockResolvedValue(undefined);
    vi.mocked(queryPermission).mockResolvedValue('granted');
    vi.mocked(requestPermission).mockResolvedValue(true);
    vi.mocked(saveDirHandle).mockResolvedValue();
    vi.mocked(saveBackend).mockResolvedValue();
    vi.mocked(clearStorageChoice).mockResolvedValue();
});

describe('useNotesStorage — bootstrap', () => {
    it('shows the choice screen when nothing is stored', async () => {
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('choosing'));
        expect(result.current.store).toBeNull();
    });

    it('restores the in-browser backend', async () => {
        vi.mocked(loadBackend).mockResolvedValue('indexeddb');
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        expect(result.current.backend).toBe('indexeddb');
        expect(result.current.storageLabel).toBe('In this browser');
        expect(result.current.store).not.toBeNull();
    });

    it('restores a granted file-system folder', async () => {
        vi.mocked(loadBackend).mockResolvedValue('filesystem');
        vi.mocked(loadDirHandle).mockResolvedValue(fakeHandle);
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        expect(result.current.backend).toBe('filesystem');
        expect(result.current.storageLabel).toBe('notes');
        expect(result.current.store).not.toBeNull();
    });

    it('asks to re-grant permission when the folder is remembered but not granted', async () => {
        vi.mocked(loadBackend).mockResolvedValue('filesystem');
        vi.mocked(loadDirHandle).mockResolvedValue(fakeHandle);
        vi.mocked(queryPermission).mockResolvedValue('prompt');
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('needs-permission'));
    });

    it('treats a stored handle with no backend flag as a file-system user (back-compat)', async () => {
        vi.mocked(loadBackend).mockResolvedValue(undefined);
        vi.mocked(loadDirHandle).mockResolvedValue(fakeHandle);
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        expect(result.current.backend).toBe('filesystem');
    });

    it('falls back to the choice screen with an error when restore throws', async () => {
        vi.mocked(loadBackend).mockRejectedValue(new Error('IDB blocked'));
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('choosing'));
        expect(result.current.error).toBe('IDB blocked');
    });
});

describe('useNotesStorage — actions', () => {
    it('useBrowserStorage() switches to a ready in-browser store', async () => {
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('choosing'));
        await act(async () => {
            await result.current.useBrowserStorage();
        });
        expect(result.current.state).toBe('ready');
        expect(result.current.backend).toBe('indexeddb');
        expect(vi.mocked(saveBackend)).toHaveBeenCalledWith('indexeddb');
    });

    it('pickFolder() opens a folder and becomes ready', async () => {
        Object.defineProperty(window, 'showDirectoryPicker', {
            configurable: true,
            value: vi.fn().mockResolvedValue(fakeHandle),
        });
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('choosing'));
        await act(async () => {
            await result.current.pickFolder();
        });
        expect(result.current.state).toBe('ready');
        expect(result.current.backend).toBe('filesystem');
        expect(vi.mocked(saveBackend)).toHaveBeenCalledWith('filesystem');
        expect(vi.mocked(saveDirHandle)).toHaveBeenCalledTimes(1);
    });

    it('reset() clears the choice and returns to the choice screen', async () => {
        vi.mocked(loadBackend).mockResolvedValue('indexeddb');
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        await act(async () => {
            await result.current.reset();
        });
        expect(result.current.state).toBe('choosing');
        expect(result.current.store).toBeNull();
        expect(vi.mocked(clearStorageChoice)).toHaveBeenCalledTimes(1);
    });
});
