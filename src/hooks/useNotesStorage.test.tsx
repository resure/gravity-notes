import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../storage/workspaceRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../storage/workspaceRegistry')>();
    return {
        ...actual, // keep the pure helpers (workspaceIdForPath, folderNameFromPath) real
        loadWorkspaces: vi.fn(),
        loadLastActiveId: vi.fn(),
        touchWorkspace: vi.fn(),
        removeWorkspace: vi.fn(),
        clearLastActive: vi.fn(),
        findFsaEntry: vi.fn(),
        queryPermission: vi.fn(),
        requestPermission: vi.fn(),
    };
});

import {
    type WorkspaceEntry,
    clearLastActive,
    findFsaEntry,
    loadLastActiveId,
    loadWorkspaces,
    queryPermission,
    removeWorkspace,
    requestPermission,
    touchWorkspace,
} from '../storage/workspaceRegistry';

import {useNotesStorage} from './useNotesStorage';

const fakeHandle = {name: 'notes'} as unknown as FileSystemDirectoryHandle;

const fsaEntry: WorkspaceEntry = {
    id: 'fsa:legacy',
    backend: 'filesystem',
    name: 'notes',
    lastOpenedAt: 2,
    handle: fakeHandle,
};
const browserEntry: WorkspaceEntry = {
    id: 'indexeddb',
    backend: 'indexeddb',
    name: 'Browser storage',
    lastOpenedAt: 1,
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadWorkspaces).mockResolvedValue([]);
    vi.mocked(loadLastActiveId).mockResolvedValue(undefined);
    vi.mocked(touchWorkspace).mockResolvedValue();
    vi.mocked(removeWorkspace).mockResolvedValue();
    vi.mocked(clearLastActive).mockResolvedValue();
    vi.mocked(findFsaEntry).mockResolvedValue(undefined);
    vi.mocked(queryPermission).mockResolvedValue('granted');
    vi.mocked(requestPermission).mockResolvedValue(true);
});

describe('useNotesStorage — bootstrap', () => {
    it('shows the choice screen when the registry is empty', async () => {
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('choosing'));
        expect(result.current.store).toBeNull();
        expect(result.current.workspaces).toEqual([]);
    });

    it('restores the last-active in-browser workspace', async () => {
        vi.mocked(loadWorkspaces).mockResolvedValue([browserEntry]);
        vi.mocked(loadLastActiveId).mockResolvedValue('indexeddb');
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        expect(result.current.backend).toBe('indexeddb');
        expect(result.current.storageLabel).toBe('In this browser');
        expect(result.current.activeWorkspaceId).toBe('indexeddb');
        expect(result.current.store).not.toBeNull();
        expect(vi.mocked(touchWorkspace)).toHaveBeenCalledWith(
            expect.objectContaining({id: 'indexeddb'}),
        );
    });

    it('restores a granted file-system workspace', async () => {
        vi.mocked(loadWorkspaces).mockResolvedValue([fsaEntry, browserEntry]);
        vi.mocked(loadLastActiveId).mockResolvedValue('fsa:legacy');
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        expect(result.current.backend).toBe('filesystem');
        expect(result.current.storageLabel).toBe('notes');
        expect(result.current.workspaces.map((ws) => ws.id)).toEqual(['fsa:legacy', 'indexeddb']);
    });

    it('asks to re-grant permission on bootstrap without prompting (no user gesture yet)', async () => {
        vi.mocked(loadWorkspaces).mockResolvedValue([fsaEntry]);
        vi.mocked(loadLastActiveId).mockResolvedValue('fsa:legacy');
        vi.mocked(queryPermission).mockResolvedValue('prompt');
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('needs-permission'));
        expect(result.current.storageLabel).toBe('notes');
        expect(vi.mocked(requestPermission)).not.toHaveBeenCalled();
    });

    it('falls back to the choice screen when last-active points at a removed entry', async () => {
        vi.mocked(loadWorkspaces).mockResolvedValue([browserEntry]);
        vi.mocked(loadLastActiveId).mockResolvedValue('tauri:/gone');
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('choosing'));
        // The recents list still shows what exists, so the gate isn't a dead end.
        expect(result.current.workspaces.map((ws) => ws.id)).toEqual(['indexeddb']);
    });

    it('falls back to the choice screen with an error when restore throws', async () => {
        vi.mocked(loadWorkspaces).mockRejectedValue(new Error('IDB blocked'));
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('choosing'));
        expect(result.current.error).toBe('IDB blocked');
    });
});

describe('useNotesStorage — actions', () => {
    it('useBrowserStorage() becomes ready and registers the workspace', async () => {
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('choosing'));
        await act(async () => {
            await result.current.useBrowserStorage();
        });
        expect(result.current.state).toBe('ready');
        expect(result.current.backend).toBe('indexeddb');
        await waitFor(() =>
            expect(vi.mocked(touchWorkspace)).toHaveBeenCalledWith(
                expect.objectContaining({id: 'indexeddb', backend: 'indexeddb'}),
            ),
        );
    });

    it('pickFolder() opens a folder, minting a new registry entry', async () => {
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
        await waitFor(() =>
            expect(vi.mocked(touchWorkspace)).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: expect.stringMatching(/^fsa:/),
                    backend: 'filesystem',
                    name: 'notes',
                }),
            ),
        );
    });

    it('pickFolder() dedupes a re-picked folder onto its existing entry', async () => {
        Object.defineProperty(window, 'showDirectoryPicker', {
            configurable: true,
            value: vi.fn().mockResolvedValue(fakeHandle),
        });
        vi.mocked(findFsaEntry).mockResolvedValue(fsaEntry);
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('choosing'));
        await act(async () => {
            await result.current.pickFolder();
        });
        expect(result.current.activeWorkspaceId).toBe('fsa:legacy');
        await waitFor(() =>
            expect(vi.mocked(touchWorkspace)).toHaveBeenCalledWith(
                expect.objectContaining({id: 'fsa:legacy'}),
            ),
        );
    });

    it('reset() returns to the choice screen, forgets last-active, but keeps the registry', async () => {
        vi.mocked(loadWorkspaces).mockResolvedValue([browserEntry]);
        vi.mocked(loadLastActiveId).mockResolvedValue('indexeddb');
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        await act(async () => {
            await result.current.reset();
        });
        expect(result.current.state).toBe('choosing');
        expect(result.current.store).toBeNull();
        expect(result.current.activeWorkspaceId).toBeNull();
        // The registry (recents) is kept — nothing is removed…
        expect(vi.mocked(removeWorkspace)).not.toHaveBeenCalled();
        // …but the launch pointer is cleared, so the next relaunch lands on the choice screen
        // instead of re-restoring (and re-gating) the folder the user stepped away from.
        expect(vi.mocked(clearLastActive)).toHaveBeenCalledTimes(1);
    });
});

describe('useNotesStorage — workspace switching', () => {
    it('openWorkspace() swaps to another known workspace in place', async () => {
        vi.mocked(loadWorkspaces).mockResolvedValue([browserEntry, fsaEntry]);
        vi.mocked(loadLastActiveId).mockResolvedValue('indexeddb');
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        const before = result.current.store;

        let opened = false;
        await act(async () => {
            opened = await result.current.openWorkspace('fsa:legacy');
        });

        expect(opened).toBe(true);
        expect(result.current.state).toBe('ready');
        expect(result.current.activeWorkspaceId).toBe('fsa:legacy');
        expect(result.current.backend).toBe('filesystem');
        expect(result.current.store).not.toBe(before);
    });

    it('openWorkspace() to the current workspace is a no-op success', async () => {
        vi.mocked(loadWorkspaces).mockResolvedValue([browserEntry]);
        vi.mocked(loadLastActiveId).mockResolvedValue('indexeddb');
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        const before = result.current.store;
        vi.mocked(touchWorkspace).mockClear();

        let opened = false;
        await act(async () => {
            opened = await result.current.openWorkspace('indexeddb');
        });

        expect(opened).toBe(true);
        expect(result.current.store).toBe(before); // same instance — no remount churn
        expect(vi.mocked(touchWorkspace)).not.toHaveBeenCalled();
    });

    it('openWorkspace("indexeddb") works even before the entry exists (synthesized row)', async () => {
        vi.mocked(loadWorkspaces).mockResolvedValue([fsaEntry]);
        vi.mocked(loadLastActiveId).mockResolvedValue('fsa:legacy');
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));

        let opened = false;
        await act(async () => {
            opened = await result.current.openWorkspace('indexeddb');
        });

        expect(opened).toBe(true);
        expect(result.current.backend).toBe('indexeddb');
        await waitFor(() =>
            expect(vi.mocked(touchWorkspace)).toHaveBeenCalledWith(
                expect.objectContaining({id: 'indexeddb'}),
            ),
        );
    });

    it('openWorkspace() resolves false for an unknown id, leaving the current workspace mounted', async () => {
        vi.mocked(loadWorkspaces).mockResolvedValue([browserEntry]);
        vi.mocked(loadLastActiveId).mockResolvedValue('indexeddb');
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));

        let opened = true;
        await act(async () => {
            opened = await result.current.openWorkspace('tauri:/nope');
        });

        expect(opened).toBe(false);
        expect(result.current.state).toBe('ready');
        expect(result.current.activeWorkspaceId).toBe('indexeddb');
    });

    it('switching to an ungranted FSA workspace tries the prompt inline (user gesture)', async () => {
        vi.mocked(loadWorkspaces).mockResolvedValue([browserEntry, fsaEntry]);
        vi.mocked(loadLastActiveId).mockResolvedValue('indexeddb');
        vi.mocked(queryPermission).mockResolvedValue('prompt');
        vi.mocked(requestPermission).mockResolvedValue(true);
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));

        await act(async () => {
            await result.current.openWorkspace('fsa:legacy');
        });

        expect(vi.mocked(requestPermission)).toHaveBeenCalledWith(fakeHandle);
        expect(result.current.state).toBe('ready');
        expect(result.current.backend).toBe('filesystem');
    });

    it('routes to the permission gate when the inline prompt is denied, then grants from it', async () => {
        vi.mocked(loadWorkspaces).mockResolvedValue([browserEntry, fsaEntry]);
        vi.mocked(loadLastActiveId).mockResolvedValue('indexeddb');
        vi.mocked(queryPermission).mockResolvedValue('prompt');
        vi.mocked(requestPermission).mockResolvedValue(false);
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));

        await act(async () => {
            await result.current.openWorkspace('fsa:legacy');
        });
        expect(result.current.state).toBe('needs-permission');
        expect(result.current.storageLabel).toBe('notes');

        // The user clicks "Grant access" — this time the browser grants it.
        vi.mocked(requestPermission).mockResolvedValue(true);
        await act(async () => {
            await result.current.grantPermission();
        });
        expect(result.current.state).toBe('ready');
        expect(result.current.activeWorkspaceId).toBe('fsa:legacy');
    });

    it('removeWorkspace() forgets the entry and refreshes the list', async () => {
        vi.mocked(loadWorkspaces).mockResolvedValue([browserEntry, fsaEntry]);
        vi.mocked(loadLastActiveId).mockResolvedValue('indexeddb');
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));

        vi.mocked(loadWorkspaces).mockResolvedValue([browserEntry]);
        await act(async () => {
            await result.current.removeWorkspace('fsa:legacy');
        });

        expect(vi.mocked(removeWorkspace)).toHaveBeenCalledWith('fsa:legacy');
        expect(result.current.workspaces.map((ws) => ws.id)).toEqual(['indexeddb']);
    });
});
