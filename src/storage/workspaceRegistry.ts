/**
 * The workspace registry: every folder (or in-browser store) the user has opened, with recency,
 * plus permission helpers for the web (FSA) backend.
 *
 * `FileSystemDirectoryHandle` is structured-cloneable, so web folder workspaces stash their handle
 * in IndexedDB and recover the same folder on the next visit (browsers still require a fresh
 * permission grant per session). Desktop (`tauri-fs`) workspaces are plain path strings.
 *
 * ⚠️ This is deliberately the ONLY module that opens the `sol` IndexedDB database. Anything else
 * opening the same name at a lower version would throw `VersionError` after an upgrade.
 * Connections are opened per operation and always closed (see `tx`), which keeps the window for a
 * cross-window upgrade block small — but not zero, so `openDb` still handles `blocked` (reject,
 * don't hang) and `versionchange` (step aside).
 *
 * The `handles` store keeps the last-active pointer; `workspaces` keeps one entry per known
 * workspace. The database name is new with Sol, so there is no earlier version to migrate from —
 * the app's data lives in the vault, and a vault is re-picked at the gate (see PLAN.md D8).
 */

const DB_NAME = 'sol';
const DB_VERSION = 1;
const HANDLES_STORE = 'handles';
const WORKSPACES_STORE = 'workspaces';

/** Which workspace the main window restores on launch (the most recently opened anywhere). */
const LAST_ACTIVE_KEY = 'last-active-workspace';

/**
 * Which storage backend a workspace uses:
 * - `filesystem` — a folder picked via the browser File System Access API (Chromium web build);
 * - `tauri-fs` — a folder on disk via native Rust commands (the desktop app, where the FSA API is
 *   unavailable in WKWebView); the folder is remembered as a plain path string;
 * - `indexeddb` — in-browser / in-app IndexedDB (a single special workspace).
 */
export type StorageBackend = 'filesystem' | 'tauri-fs' | 'indexeddb';

export interface WorkspaceEntry {
    /** `'indexeddb'` (singleton), `tauri:<path>`, or `fsa:<uuid>`. */
    id: string;
    backend: StorageBackend;
    /** Display name: the folder's leaf name (UI supplies its own label for `indexeddb`). */
    name: string;
    lastOpenedAt: number;
    /**
     * The folder path (`tauri-fs`). On iOS this is the LAST-known path — the live one comes from
     * re-resolving the bookmark, since the provider may move an iCloud folder between launches.
     */
    path?: string;
    /**
     * iOS only: a base64 security-scoped bookmark for the picked folder (see `icloud-fs` plugin).
     * Its presence on a `tauri-fs` entry marks it as an iOS folder that must be re-resolved (to
     * re-grant sandbox access + get the current path) before the store is opened. A plain string,
     * so it structured-clones into IndexedDB like the rest of the entry.
     */
    bookmark?: string;
    /** The folder handle (`filesystem` only; structured-clones into IndexedDB). */
    handle?: FileSystemDirectoryHandle;
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(HANDLES_STORE)) {
                db.createObjectStore(HANDLES_STORE);
            }
            if (!db.objectStoreNames.contains(WORKSPACES_STORE)) {
                db.createObjectStore(WORKSPACES_STORE, {keyPath: 'id'});
            }
        };
        req.onsuccess = () => {
            const db = req.result;
            // Step aside for another window's version upgrade (v2 → future v3): close this
            // short-lived connection so its `versionchange` transaction can proceed rather than
            // blocking it. Connections are per-op and closed by `tx` anyway; this covers the rare
            // window where an upgrade lands mid-connection.
            db.onversionchange = () => db.close();
            resolve(db);
        };
        req.onerror = () => reject(req.error);
        // An upgrade blocked by another window/tab's open connection fires `blocked` and would
        // otherwise leave this promise unsettled forever (hanging every tx → the loading spinner).
        // Reject so the caller surfaces it, mirroring `indexedDbStore.ts`.
        req.onblocked = () =>
            reject(
                new DOMException('IndexedDB open blocked by another connection', 'BlockedError'),
            );
    });
}

function tx<T>(
    storeNames: string[],
    mode: IDBTransactionMode,
    run: (transaction: IDBTransaction) => IDBRequest<T>,
): Promise<T> {
    return openDb().then(
        (db) =>
            new Promise<T>((resolve, reject) => {
                const transaction = db.transaction(storeNames, mode);
                const request = run(transaction);
                let result: T;
                request.onsuccess = () => {
                    result = request.result;
                };
                // Resolve once the transaction commits (so writes are durable), and always close
                // the connection — on complete, error, or abort — so it can never leak or hang.
                transaction.oncomplete = () => {
                    db.close();
                    resolve(result);
                };
                transaction.onerror = () => {
                    db.close();
                    reject(transaction.error ?? request.error);
                };
                transaction.onabort = () => {
                    db.close();
                    reject(
                        transaction.error ??
                            new DOMException('IndexedDB transaction aborted', 'AbortError'),
                    );
                };
            }),
    );
}

function byRecency(entries: WorkspaceEntry[]): WorkspaceEntry[] {
    return [...entries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

/** A folder path's stable workspace id (trailing separators stripped so re-picks dedupe). */
export function workspaceIdForPath(path: string): string {
    const normalized = path.replace(/[/\\]+$/, '') || path;
    return `tauri:${normalized}`;
}

/** Display label for a folder path: its last segment (e.g. `/Users/me/Notes` → `Notes`). */
export function folderNameFromPath(path: string): string {
    const parts = path.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] ?? path;
}

/**
 * Find the registry entry for an already-picked FSA folder, if any — handles aren't comparable by
 * value, so each stored handle is asked whether it points at the same directory.
 */
export async function findFsaEntry(
    handle: FileSystemDirectoryHandle,
    entries: WorkspaceEntry[],
): Promise<WorkspaceEntry | undefined> {
    for (const entry of entries) {
        if (entry.backend !== 'filesystem' || !entry.handle) continue;
        try {
            if (await handle.isSameEntry(entry.handle)) return entry;
        } catch {
            // A dead/foreign handle that can't be compared just isn't a match.
        }
    }
    return undefined;
}

/**
 * All known workspaces, most recently opened first.
 */
export async function loadWorkspaces(): Promise<WorkspaceEntry[]> {
    const entries = await tx<WorkspaceEntry[]>([WORKSPACES_STORE], 'readonly', (t) =>
        t.objectStore(WORKSPACES_STORE).getAll(),
    );
    return byRecency(entries);
}

/** Upsert a workspace with a fresh `lastOpenedAt` and point last-active at it (one atomic commit). */
export function touchWorkspace(entry: WorkspaceEntry): Promise<void> {
    return tx([WORKSPACES_STORE, HANDLES_STORE], 'readwrite', (t) => {
        t.objectStore(WORKSPACES_STORE).put({...entry, lastOpenedAt: Date.now()});
        return t.objectStore(HANDLES_STORE).put(entry.id, LAST_ACTIVE_KEY);
    }).then(() => undefined);
}

/** Forget a workspace (its notes are untouched); clears last-active if it pointed there. */
export function removeWorkspace(id: string): Promise<void> {
    return tx([WORKSPACES_STORE, HANDLES_STORE], 'readwrite', (t) => {
        t.objectStore(WORKSPACES_STORE).delete(id);
        const handles = t.objectStore(HANDLES_STORE);
        const pointer = handles.get(LAST_ACTIVE_KEY);
        // addEventListener, NOT .onsuccess — `tx` assigns .onsuccess on the returned request to
        // collect its result, which would silently replace a property handler set here.
        pointer.addEventListener('success', () => {
            if (pointer.result === id) handles.delete(LAST_ACTIVE_KEY);
        });
        return pointer;
    }).then(() => undefined);
}

export function loadLastActiveId(): Promise<string | undefined> {
    return tx<string | undefined>([HANDLES_STORE], 'readonly', (t) =>
        t.objectStore(HANDLES_STORE).get(LAST_ACTIVE_KEY),
    );
}

/**
 * Forget which workspace to restore on launch (the registry itself is kept). Used when the
 * remembered folder is effectively unusable (e.g. the startup probe timed out), so the next launch
 * lands on the choice screen instead of re-hanging on the same path.
 */
export function clearLastActive(): Promise<void> {
    return tx([HANDLES_STORE], 'readwrite', (t) =>
        t.objectStore(HANDLES_STORE).delete(LAST_ACTIVE_KEY),
    ).then(() => undefined);
}

/** Check the current permission state without prompting. */
export async function queryPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
    return handle.queryPermission({mode: 'readwrite'});
}

/** Request read-write permission. MUST be called from a user gesture. */
export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    if ((await handle.queryPermission({mode: 'readwrite'})) === 'granted') {
        return true;
    }
    return (await handle.requestPermission({mode: 'readwrite'})) === 'granted';
}
