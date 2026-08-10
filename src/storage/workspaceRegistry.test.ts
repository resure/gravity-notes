import {IDBFactory} from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
    type WorkspaceEntry,
    clearLastActive,
    findFsaEntry,
    folderNameFromPath,
    loadLastActiveId,
    loadWorkspaces,
    removeWorkspace,
    touchWorkspace,
    workspaceIdForPath,
} from './workspaceRegistry';

function entry(over: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
    return {
        id: 'tauri:/Users/me/Notes',
        backend: 'tauri-fs',
        name: 'Notes',
        lastOpenedAt: 0,
        path: '/Users/me/Notes',
        ...over,
    };
}

beforeEach(() => {
    // Fresh in-memory IndexedDB per test so registries don't leak between cases.
    vi.stubGlobal('indexedDB', new IDBFactory());
    // Deterministic, strictly-increasing timestamps so recency ordering is stable.
    let clock = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => ++clock);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('workspaceRegistry — an empty registry', () => {
    it('yields nothing, with no launch pointer', async () => {
        expect(await loadWorkspaces()).toEqual([]);
        expect(await loadLastActiveId()).toBeUndefined();
    });
});

describe('workspaceRegistry — recency and removal', () => {
    it('touchWorkspace upserts, bumps lastOpenedAt, and orders most-recent-first', async () => {
        await touchWorkspace(entry({id: 'tauri:/A', path: '/A', name: 'A'}));
        await touchWorkspace(entry({id: 'tauri:/B', path: '/B', name: 'B'}));

        expect((await loadWorkspaces()).map((w) => w.id)).toEqual(['tauri:/B', 'tauri:/A']);
        expect(await loadLastActiveId()).toBe('tauri:/B');

        // Re-touching A moves it back to the front — an upsert, not a duplicate.
        await touchWorkspace(entry({id: 'tauri:/A', path: '/A', name: 'A'}));
        const workspaces = await loadWorkspaces();
        expect(workspaces.map((w) => w.id)).toEqual(['tauri:/A', 'tauri:/B']);
        expect(await loadLastActiveId()).toBe('tauri:/A');
    });

    it('removeWorkspace drops the entry and clears last-active only when it pointed there', async () => {
        await touchWorkspace(entry({id: 'tauri:/A', path: '/A', name: 'A'}));
        await touchWorkspace(entry({id: 'tauri:/B', path: '/B', name: 'B'}));

        // B is last-active; removing A keeps the pointer.
        await removeWorkspace('tauri:/A');
        expect((await loadWorkspaces()).map((w) => w.id)).toEqual(['tauri:/B']);
        expect(await loadLastActiveId()).toBe('tauri:/B');

        // Removing B (the pointer target) clears it.
        await removeWorkspace('tauri:/B');
        expect(await loadWorkspaces()).toEqual([]);
        expect(await loadLastActiveId()).toBeUndefined();
    });

    it('clearLastActive forgets the launch pointer but keeps the registry', async () => {
        await touchWorkspace(entry());

        await clearLastActive();

        expect(await loadLastActiveId()).toBeUndefined();
        expect(await loadWorkspaces()).toHaveLength(1);
    });
});

describe('workspaceRegistry — helpers', () => {
    it('workspaceIdForPath strips trailing separators so re-picks dedupe', () => {
        expect(workspaceIdForPath('/Users/me/Notes')).toBe('tauri:/Users/me/Notes');
        expect(workspaceIdForPath('/Users/me/Notes/')).toBe('tauri:/Users/me/Notes');
        expect(workspaceIdForPath('/Users/me/Notes//')).toBe('tauri:/Users/me/Notes');
    });

    it('folderNameFromPath returns the leaf segment', () => {
        expect(folderNameFromPath('/Users/me/Notes')).toBe('Notes');
        expect(folderNameFromPath('/Users/me/Notes/')).toBe('Notes');
        expect(folderNameFromPath('C:\\Notes\\Vault')).toBe('Vault');
    });

    it('findFsaEntry matches via isSameEntry and survives a comparison that throws', async () => {
        // Stored handles are opaque objects; the PROBE's isSameEntry is asked about each one.
        const broken = {name: 'broken'} as unknown as FileSystemDirectoryHandle;
        const other = {name: 'other'} as unknown as FileSystemDirectoryHandle;
        const target = {name: 'target'} as unknown as FileSystemDirectoryHandle;
        const entries: WorkspaceEntry[] = [
            entry({id: 'fsa:1', backend: 'filesystem', path: undefined, handle: broken}),
            entry({id: 'fsa:2', backend: 'filesystem', path: undefined, handle: other}),
            entry({id: 'fsa:3', backend: 'filesystem', path: undefined, handle: target}),
            entry({id: 'tauri:/A'}), // non-FSA entries are ignored
        ];
        const probe = {
            isSameEntry: async (candidate: unknown) => {
                if (candidate === broken) throw new Error('dead handle'); // caught → not a match
                return candidate === target;
            },
        } as unknown as FileSystemDirectoryHandle;

        const found = await findFsaEntry(probe, entries);

        expect(found?.id).toBe('fsa:3');
    });
});
