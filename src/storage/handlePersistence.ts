/**
 * Persistence + permission helpers for the chosen notes folder.
 *
 * `FileSystemDirectoryHandle` is structured-cloneable, so we can stash it in
 * IndexedDB and recover the same folder on the next visit. Browsers still
 * require a fresh permission grant per session, so on load we re-query and (on a
 * user gesture) re-request permission.
 */

const DB_NAME = 'gravity-notes';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'notes-dir';
const BACKEND_KEY = 'backend';
const FOLDER_PATH_KEY = 'notes-folder-path';

/**
 * Which storage backend the user chose:
 * - `filesystem` — a folder picked via the browser File System Access API (Chromium web build);
 * - `tauri-fs` — a folder on disk via native Rust commands (the desktop app, where the FSA API is
 *   unavailable in WKWebView); the chosen folder is remembered as a plain path string;
 * - `indexeddb` — in-browser / in-app IndexedDB.
 */
export type StorageBackend = 'filesystem' | 'tauri-fs' | 'indexeddb';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE_NAME);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function tx<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
    return openDb().then(
        (db) =>
            new Promise<T>((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, mode);
                const request = run(transaction.objectStore(STORE_NAME));
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

export function saveDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    return tx('readwrite', (store) => store.put(handle, HANDLE_KEY)).then(() => undefined);
}

export function loadDirHandle(): Promise<FileSystemDirectoryHandle | undefined> {
    return tx<FileSystemDirectoryHandle | undefined>('readonly', (store) => store.get(HANDLE_KEY));
}

/** Remember which backend the user chose, so reloads restore it without re-asking. */
export function saveBackend(kind: StorageBackend): Promise<void> {
    return tx('readwrite', (store) => store.put(kind, BACKEND_KEY)).then(() => undefined);
}

export function loadBackend(): Promise<StorageBackend | undefined> {
    return tx<StorageBackend | undefined>('readonly', (store) => store.get(BACKEND_KEY));
}

/**
 * Remember the desktop app's chosen folder as a plain path string. Unlike the web backend's
 * structured-cloned `FileSystemDirectoryHandle`, the native (`tauri-fs`) backend just needs the
 * path — and the OS, not the browser, governs access, so there's no per-session re-grant.
 */
export function saveFolderPath(path: string): Promise<void> {
    return tx('readwrite', (store) => store.put(path, FOLDER_PATH_KEY)).then(() => undefined);
}

export function loadFolderPath(): Promise<string | undefined> {
    return tx<string | undefined>('readonly', (store) => store.get(FOLDER_PATH_KEY));
}

/** Forget the chosen backend and any stored folder handle/path (back to the first-run choice). */
export function clearStorageChoice(): Promise<void> {
    return tx('readwrite', (store) => store.delete(HANDLE_KEY))
        .then(() => tx('readwrite', (store) => store.delete(FOLDER_PATH_KEY)))
        .then(() => tx('readwrite', (store) => store.delete(BACKEND_KEY)))
        .then(() => undefined);
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
