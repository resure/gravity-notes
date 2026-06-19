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
                const request = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                request.transaction!.oncomplete = () => db.close();
            }),
    );
}

export function saveDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    return tx('readwrite', (store) => store.put(handle, HANDLE_KEY)).then(() => undefined);
}

export function loadDirHandle(): Promise<FileSystemDirectoryHandle | undefined> {
    return tx<FileSystemDirectoryHandle | undefined>('readonly', (store) => store.get(HANDLE_KEY));
}

export function clearDirHandle(): Promise<void> {
    return tx('readwrite', (store) => store.delete(HANDLE_KEY)).then(() => undefined);
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
