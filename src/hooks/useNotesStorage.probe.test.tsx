import {act, renderHook, waitFor} from '@testing-library/react';
import {afterAll, beforeEach, describe, expect, it, vi} from 'vitest';

// Make the module read as the Tauri desktop shell. `isTauri` is computed once at module-eval time
// (`'__TAURI_INTERNALS__' in window`), so the flag must be set *before* useNotesStorage is imported —
// `vi.hoisted` runs during the hoist phase, ahead of the static imports below.
vi.hoisted(() => {
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

const listMock = vi.fn();
const invokeMock = vi.fn();

vi.mock('../storage/workspaceRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../storage/workspaceRegistry')>();
    return {
        ...actual,
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

vi.mock('../storage/tauriStore', () => ({
    // Each instance probes through the shared spy WITH its folder path, so per-folder behavior
    // (workspace A reads fine, workspace B hangs) is scriptable from a test.
    TauriNoteStore: vi.fn().mockImplementation((dir: string) => ({list: () => listMock(dir)})),
}));

// The hook loads Tauri APIs via dynamic import; vitest intercepts those too.
vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({setTitle: vi.fn(async () => {})}),
}));

import {
    type WorkspaceEntry,
    clearLastActive,
    loadLastActiveId,
    loadWorkspaces,
    touchWorkspace,
} from '../storage/workspaceRegistry';

import {useNotesStorage} from './useNotesStorage';

const PROBE_TIMEOUT_MS = 10_000;

const HUGE: WorkspaceEntry = {
    id: 'tauri:/Users/me/Huge',
    backend: 'tauri-fs',
    name: 'Huge',
    lastOpenedAt: 2,
    path: '/Users/me/Huge',
};
const OTHER: WorkspaceEntry = {
    id: 'tauri:/Users/me/Other',
    backend: 'tauri-fs',
    name: 'Other',
    lastOpenedAt: 1,
    path: '/Users/me/Other',
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadWorkspaces).mockResolvedValue([HUGE, OTHER]);
    vi.mocked(loadLastActiveId).mockResolvedValue(HUGE.id);
    vi.mocked(touchWorkspace).mockResolvedValue();
    vi.mocked(clearLastActive).mockResolvedValue();
    invokeMock.mockImplementation(async (cmd: unknown) => {
        if (cmd === 'window_workspace') return null; // the main window has no assignment
        if (cmd === 'focus_workspace_window') return false;
        return undefined;
    });
});

afterAll(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('useNotesStorage — Tauri folder probe', () => {
    it('lands ready when the last-active folder reads quickly', async () => {
        listMock.mockResolvedValue([]);
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        expect(result.current.backend).toBe('tauri-fs');
        expect(result.current.storageLabel).toBe('Huge');
        expect(vi.mocked(clearLastActive)).not.toHaveBeenCalled();
        // The window registers its workspace with the shell (drives focus-if-open).
        await waitFor(() =>
            expect(invokeMock).toHaveBeenCalledWith('set_window_workspace', {wsId: HUGE.id}),
        );
    });

    it('times out a hanging probe → forgets the launch pointer and returns to the picker', async () => {
        vi.useFakeTimers();
        listMock.mockReturnValue(new Promise(() => {})); // never settles (huge/strange folder)
        try {
            const {result} = renderHook(() => useNotesStorage());
            await act(async () => {
                await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
            });
            expect(result.current.state).toBe('choosing');
            expect(result.current.error).toContain('took too long');
            // Only the launch POINTER is forgotten (next launch won't re-hang); the registry
            // entry survives, so the folder is still reachable from recents.
            expect(vi.mocked(clearLastActive)).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the launch pointer on a plain read error (may be a transient unplugged drive)', async () => {
        listMock.mockRejectedValue(new Error('No such file or directory'));
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('choosing'));
        expect(result.current.error).toBe('No such file or directory');
        expect(vi.mocked(clearLastActive)).not.toHaveBeenCalled();
    });
});

describe('useNotesStorage — desktop window/workspace wiring', () => {
    it('a window assignment from the shell beats the last-active pointer', async () => {
        listMock.mockResolvedValue([]);
        invokeMock.mockImplementation(async (cmd: unknown) => {
            if (cmd === 'window_workspace') return OTHER.id; // a freshly-created ws-window
            if (cmd === 'focus_workspace_window') return false;
            return undefined;
        });
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        expect(result.current.activeWorkspaceId).toBe(OTHER.id);
        expect(result.current.storageLabel).toBe('Other');
    });

    it('openWorkspace() focuses the other window instead of switching when one already shows it', async () => {
        listMock.mockResolvedValue([]);
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));
        invokeMock.mockImplementation(async (cmd: unknown) => {
            if (cmd === 'focus_workspace_window') return true; // another window has it
            return undefined;
        });

        let opened = false;
        await act(async () => {
            opened = await result.current.openWorkspace(OTHER.id);
        });

        expect(opened).toBe(true);
        // This window stays on its own workspace — the other window was focused instead.
        expect(result.current.activeWorkspaceId).toBe(HUGE.id);
        expect(invokeMock).toHaveBeenCalledWith('focus_workspace_window', {wsId: OTHER.id});
    });

    it('a failed switch probe leaves the current workspace mounted and resolves false', async () => {
        listMock.mockImplementation(async (dir: string) => {
            if (dir === OTHER.path) throw new Error('unreadable');
            return [];
        });
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));

        let opened = true;
        await act(async () => {
            opened = await result.current.openWorkspace(OTHER.id);
        });

        expect(opened).toBe(false);
        expect(result.current.state).toBe('ready');
        expect(result.current.activeWorkspaceId).toBe(HUGE.id);
        expect(result.current.storageLabel).toBe('Huge');
    });

    it('openInNewWindow() asks the shell to open (or focus) a workspace window', async () => {
        listMock.mockResolvedValue([]);
        const {result} = renderHook(() => useNotesStorage());
        await waitFor(() => expect(result.current.state).toBe('ready'));

        await act(async () => {
            await result.current.openInNewWindow(OTHER.id);
        });

        expect(invokeMock).toHaveBeenCalledWith('open_workspace_window', {
            wsId: OTHER.id,
            title: 'Other — Gravity Notes',
        });
    });
});
