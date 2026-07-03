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

/** Write the pre-workspace (v1) database shape: a bare `handles` store with the legacy keys. */
function seedLegacyDb(entries: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('gravity-notes', 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore('handles');
        };
        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('handles', 'readwrite');
            const store = tx.objectStore('handles');
            for (const [key, value] of Object.entries(entries)) store.put(value, key);
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error);
            };
        };
        req.onerror = () => reject(req.error);
    });
}

/** Raw read of a `handles` key at the CURRENT db version (v2), for post-migration assertions. */
function readHandlesKey(key: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('gravity-notes', 2);
        req.onsuccess = () => {
            const db = req.result;
            const get = db.transaction('handles', 'readonly').objectStore('handles').get(key);
            get.onsuccess = () => {
                db.close();
                resolve(get.result);
            };
            get.onerror = () => {
                db.close();
                reject(get.error);
            };
        };
        req.onerror = () => reject(req.error);
    });
}

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

describe('workspaceRegistry — migration from the v1 single choice', () => {
    it('seeds a tauri-fs entry from the legacy backend + path and points last-active at it', async () => {
        await seedLegacyDb({backend: 'tauri-fs', 'notes-folder-path': '/Users/me/Notes'});

        const workspaces = await loadWorkspaces();

        expect(workspaces).toHaveLength(1);
        expect(workspaces[0]).toMatchObject({
            id: 'tauri:/Users/me/Notes',
            backend: 'tauri-fs',
            name: 'Notes',
            path: '/Users/me/Notes',
        });
        expect(await loadLastActiveId()).toBe('tauri:/Users/me/Notes');
        // The legacy keys are left in place (harmless), just never maintained again.
        expect(await readHandlesKey('backend')).toBe('tauri-fs');
    });

    it('seeds a filesystem entry (deterministic fsa:legacy id) from a stored handle', async () => {
        // A real FSA handle can't exist under Node; any structured-cloneable object stands in.
        const handle = {name: 'notes'};
        await seedLegacyDb({backend: 'filesystem', 'notes-dir': handle});

        const workspaces = await loadWorkspaces();

        expect(workspaces).toHaveLength(1);
        expect(workspaces[0]).toMatchObject({
            id: 'fsa:legacy',
            backend: 'filesystem',
            name: 'notes',
        });
        expect(workspaces[0].handle).toEqual(handle);
        expect(await loadLastActiveId()).toBe('fsa:legacy');
    });

    it('treats a stored handle with no backend flag as a filesystem user (v1 back-compat)', async () => {
        await seedLegacyDb({'notes-dir': {name: 'old-notes'}});

        const workspaces = await loadWorkspaces();

        expect(workspaces).toHaveLength(1);
        expect(workspaces[0]).toMatchObject({id: 'fsa:legacy', backend: 'filesystem'});
    });

    it('seeds the in-browser entry from an indexeddb choice', async () => {
        await seedLegacyDb({backend: 'indexeddb'});

        const workspaces = await loadWorkspaces();

        expect(workspaces).toHaveLength(1);
        expect(workspaces[0]).toMatchObject({id: 'indexeddb', backend: 'indexeddb'});
        expect(await loadLastActiveId()).toBe('indexeddb');
    });

    it('yields an empty registry when there is nothing to migrate', async () => {
        expect(await loadWorkspaces()).toEqual([]);
        expect(await loadLastActiveId()).toBeUndefined();
    });

    it('is idempotent under a concurrent double-run (StrictMode / two windows)', async () => {
        await seedLegacyDb({backend: 'tauri-fs', 'notes-folder-path': '/Users/me/Notes'});

        const [first, second] = await Promise.all([loadWorkspaces(), loadWorkspaces()]);

        expect(first).toHaveLength(1);
        expect(second).toHaveLength(1);
        // The deterministic id makes the double-seed an overwrite, never a duplicate.
        expect(await loadWorkspaces()).toHaveLength(1);
    });

    it('does not re-seed once real entries exist (legacy keys still present)', async () => {
        await seedLegacyDb({backend: 'tauri-fs', 'notes-folder-path': '/Users/me/Notes'});
        await loadWorkspaces(); // migrate
        await touchWorkspace(entry({id: 'tauri:/Other', path: '/Other', name: 'Other'}));
        await removeWorkspace('tauri:/Users/me/Notes');

        const workspaces = await loadWorkspaces();

        // The removed migrated entry must NOT resurrect from the (still present) legacy keys.
        expect(workspaces.map((w) => w.id)).toEqual(['tauri:/Other']);
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
