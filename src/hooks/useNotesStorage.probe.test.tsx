import {act, renderHook, waitFor} from '@testing-library/react';
import {afterAll, beforeEach, describe, expect, it, vi} from 'vitest';

// Make the module read as the Tauri desktop shell. `isTauri` is computed once at module-eval time
// (`'__TAURI_INTERNALS__' in window`), so the flag must be set *before* useNotesStorage is imported —
// `vi.hoisted` runs during the hoist phase, ahead of the static imports below.
vi.hoisted(() => {
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

const listMock = vi.fn();

vi.mock('../storage/handlePersistence', () => ({
    loadBackend: vi.fn(),
    loadDirHandle: vi.fn(),
    loadFolderPath: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn(),
    saveDirHandle: vi.fn(),
    saveBackend: vi.fn(),
    saveFolderPath: vi.fn(),
    clearStorageChoice: vi.fn(),
}));

vi.mock('../storage/tauriStore', () => ({
    TauriNoteStore: vi.fn().mockImplementation(() => ({list: listMock})),
}));

import {
    clearStorageChoice,
    loadBackend,
    loadDirHandle,
    loadFolderPath,
} from '../storage/handlePersistence';

import {useNotesStorage} from './useNotesStorage';

const PROBE_TIMEOUT_MS = 10_000;

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadBackend).mockResolvedValue('tauri-fs');
    vi.mocked(loadDirHandle).mockResolvedValue(undefined);
    vi.mocked(loadFolderPath).mockResolvedValue('/Users/me/Huge');
    vi.mocked(clearStorageChoice).mockResolvedValue();
});

afterAll(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('useNotesStorage — Tauri folder probe', () => {
    it('lands ready when the remembered folder reads quickly', async () => {
        listMock.mockResolvedValue([]);
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        expect(result.current.backend).toBe('tauri-fs');
        expect(vi.mocked(clearStorageChoice)).not.toHaveBeenCalled();
    });

    it('times out a hanging probe → forgets the folder and returns to the picker', async () => {
        vi.useFakeTimers();
        listMock.mockReturnValue(new Promise(() => {})); // never settles (huge/strange folder)
        try {
            const {result} = renderHook(() => useNotesStorage());
            await act(async () => {
                await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
            });
            expect(result.current.state).toBe('choosing');
            expect(result.current.error).toContain('took too long');
            // The unusable folder is forgotten so the next launch doesn't re-hang on it.
            expect(vi.mocked(clearStorageChoice)).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the folder on a plain read error (may be a transient unplugged drive)', async () => {
        listMock.mockRejectedValue(new Error('No such file or directory'));
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('choosing'));
        expect(result.current.error).toBe('No such file or directory');
        expect(vi.mocked(clearStorageChoice)).not.toHaveBeenCalled();
    });
});
