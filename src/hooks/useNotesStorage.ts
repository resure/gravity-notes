import {useCallback, useEffect, useRef, useState} from 'react';

import {isTauri} from '../isTauri';
import {FileSystemNoteStore} from '../storage/fileSystemStore';
import {
    type StorageBackend,
    clearStorageChoice,
    loadBackend,
    loadDirHandle,
    loadFolderPath,
    queryPermission,
    requestPermission,
    saveBackend,
    saveDirHandle,
    saveFolderPath,
} from '../storage/handlePersistence';
import {IndexedDbNoteStore} from '../storage/indexedDbStore';
import {TauriNoteStore} from '../storage/tauriStore';
import type {NoteStore} from '../storage/types';
import {TimeoutError, withTimeout} from '../timeout';

export type StorageState =
    | 'loading' // checking for a previously-chosen backend
    | 'choosing' // no backend chosen yet — show the first-run choice
    | 'needs-permission' // a folder was remembered, but permission must be re-granted
    | 'ready';

/** Browser File System Access API (Chromium web build). Absent in the WKWebView desktop shell. */
const supportsFileSystem = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
/** Whether folder-on-disk storage is offered at all: native in the app, or FSA in the browser. */
const supportsFolders = isTauri || supportsFileSystem;

const BROWSER_LABEL = isTauri ? 'In this app' : 'In this browser';

/** Display label for a folder path: its last segment (e.g. `/Users/me/Notes` → `Notes`). */
function folderName(path: string): string {
    const parts = path.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] ?? path;
}

/**
 * How long the startup folder probe may run before we give up and route back to the picker. The
 *  underlying walk can't be cancelled (a Tauri `invoke`), so it keeps running, but the UI moves on.
 */
const PROBE_TIMEOUT_MS = 10_000;

export interface NotesStorage {
    state: StorageState;
    /** The ready note store (file-system or in-browser), or null until `ready`. */
    store: NoteStore | null;
    backend: StorageBackend | null;
    /** Human label for the active storage (folder name, or "In this browser"). */
    storageLabel: string | null;
    error: string | null;
    /** Running inside the desktop app (native folder access) rather than a plain browser. */
    isTauri: boolean;
    /** Whether the File System Access API is available (Chromium web build). */
    supportsFileSystem: boolean;
    /** Whether a folder-on-disk option is offered at all (native app, or FSA in the browser). */
    supportsFolders: boolean;
    /** Open the system folder picker (must be triggered by a user gesture). */
    pickFolder(): Promise<void>;
    /** Use in-browser (IndexedDB) storage. */
    useBrowserStorage(): Promise<void>;
    /** Re-request permission for the remembered folder (user gesture). */
    grantPermission(): Promise<void>;
    /** Forget the chosen backend and return to the choice screen. */
    reset(): Promise<void>;
}

/**
 * Folder picking, in-browser storage, and the permission lifecycle, as a backend-agnostic state
 * machine that hands `Workspace` a ready {@link NoteStore}. The chosen backend is remembered in
 * IndexedDB so reloads restore it without re-asking.
 */
export function useNotesStorage(): NotesStorage {
    const [state, setState] = useState<StorageState>('loading');
    const [store, setStore] = useState<NoteStore | null>(null);
    const [backend, setBackend] = useState<StorageBackend | null>(null);
    const [storageLabel, setStorageLabel] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Set once the user takes a storage action. The bootstrap effect bails if this is set, so a slow
    // IndexedDB read can't clobber a state the user just chose.
    const interactedRef = useRef(false);

    // On load, restore the previously-chosen backend.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [chosen, savedHandle] = await Promise.all([loadBackend(), loadDirHandle()]);
                if (cancelled || interactedRef.current) return;
                // Back-compat: a stored handle with no backend flag is an old file-system user.
                const kind = chosen ?? (savedHandle ? 'filesystem' : undefined);
                if (kind === 'indexeddb') {
                    setStore(new IndexedDbNoteStore());
                    setBackend('indexeddb');
                    setStorageLabel(BROWSER_LABEL);
                    setState('ready');
                    return;
                }
                if (kind === 'tauri-fs') {
                    // Native desktop folder: access is governed by the OS, not a per-session browser
                    // grant, so the remembered path opens straight to ready (no needs-permission).
                    const path = await loadFolderPath();
                    if (cancelled || interactedRef.current) return;
                    if (!path) {
                        setState('choosing');
                        return;
                    }
                    const tauriStore = new TauriNoteStore(path);
                    // Probe that the remembered folder still exists/reads before landing in the
                    // workspace: if it was moved/deleted/unmounted, every fs call there would fail.
                    // A failed probe surfaces the error and routes back to the choice screen so the
                    // user can re-pick, rather than stranding them on a broken workspace. The probe
                    // is time-bounded: a huge/strange folder (home dir, a network mount) makes the
                    // recursive walk hang instead of throw, which would otherwise leave the app stuck
                    // on the loading spinner — where the choice buttons are disabled — forever.
                    try {
                        await withTimeout(tauriStore.list(), PROBE_TIMEOUT_MS, 'Folder probe');
                    } catch (err) {
                        if (cancelled || interactedRef.current) return;
                        const timedOut = err instanceof TimeoutError;
                        // A timeout means the folder is effectively unusable (too large / too slow),
                        // so forget it — otherwise the next launch re-hangs on the same path. A plain
                        // read error may be transient (an unplugged drive that comes back), so keep
                        // the choice and only route back to the picker.
                        if (timedOut) await clearStorageChoice().catch(() => {});
                        if (cancelled || interactedRef.current) return;
                        setError(
                            timedOut
                                ? 'That folder took too long to open — it may be very large or on a ' +
                                      'disconnected drive. Choose a different folder.'
                                : err instanceof Error
                                  ? err.message
                                  : 'Your notes folder is no longer available.',
                        );
                        setState('choosing');
                        return;
                    }
                    if (cancelled || interactedRef.current) return;
                    setStore(tauriStore);
                    setBackend('tauri-fs');
                    setStorageLabel(folderName(path));
                    setState('ready');
                    return;
                }
                if (kind === 'filesystem' && savedHandle) {
                    const permission = await queryPermission(savedHandle);
                    if (cancelled || interactedRef.current) return;
                    // Set the label only after the post-await guard, so a cancelled/interacted
                    // bootstrap never writes state the user just superseded.
                    setStorageLabel(savedHandle.name);
                    if (permission === 'granted') {
                        setStore(new FileSystemNoteStore(savedHandle));
                        setBackend('filesystem');
                        setState('ready');
                    } else {
                        setState('needs-permission');
                    }
                    return;
                }
                setState('choosing');
            } catch (err) {
                // IndexedDB blocked (e.g. private mode) — don't hang on the spinner.
                if (cancelled || interactedRef.current) return;
                setError(err instanceof Error ? err.message : 'Could not restore your storage.');
                setState('choosing');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const pickFolder = useCallback(async () => {
        interactedRef.current = true;
        setError(null);
        if (isTauri) {
            try {
                // Native folder picker (the File System Access API is unavailable in WKWebView).
                const {open} = await import('@tauri-apps/plugin-dialog');
                const selected = await open({
                    directory: true,
                    multiple: false,
                    title: 'Choose your notes folder',
                });
                if (typeof selected !== 'string') return; // dismissed
                await saveFolderPath(selected);
                await saveBackend('tauri-fs');
                setStore(new TauriNoteStore(selected));
                setBackend('tauri-fs');
                setStorageLabel(folderName(selected));
                setState('ready');
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not open the folder.');
            }
            return;
        }
        try {
            const handle = await window.showDirectoryPicker({
                id: 'gravity-notes',
                mode: 'readwrite',
            });
            if (!(await requestPermission(handle))) {
                setError('Permission to access the folder was denied.');
                return;
            }
            await saveDirHandle(handle);
            await saveBackend('filesystem');
            setStore(new FileSystemNoteStore(handle));
            setBackend('filesystem');
            setStorageLabel(handle.name);
            setState('ready');
        } catch (err) {
            // The user dismissing the picker throws AbortError — not an error to show.
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : 'Could not open the folder.');
        }
    }, []);

    const useBrowserStorage = useCallback(async () => {
        interactedRef.current = true;
        setError(null);
        try {
            await saveBackend('indexeddb');
            setStore(new IndexedDbNoteStore());
            setBackend('indexeddb');
            setStorageLabel(BROWSER_LABEL);
            setState('ready');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not set up in-browser storage.');
        }
    }, []);

    const grantPermission = useCallback(async () => {
        interactedRef.current = true;
        setError(null);
        try {
            const savedHandle = await loadDirHandle();
            if (!savedHandle) {
                setState('choosing');
                return;
            }
            if (await requestPermission(savedHandle)) {
                await saveBackend('filesystem');
                setStore(new FileSystemNoteStore(savedHandle));
                setBackend('filesystem');
                setStorageLabel(savedHandle.name);
                setState('ready');
            } else {
                setError('Permission to access the folder was denied.');
            }
        } catch (err) {
            // Without this, a thrown requestPermission/loadDirHandle became a swallowed unhandled
            // rejection, stranding the user on the permission gate. The user dismissing the prompt
            // throws AbortError — not an error to show (mirrors pickFolder).
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : 'Could not grant access.');
        }
    }, []);

    const reset = useCallback(async () => {
        interactedRef.current = true;
        await clearStorageChoice();
        setStore(null);
        setBackend(null);
        setStorageLabel(null);
        setError(null);
        setState('choosing');
    }, []);

    return {
        state,
        store,
        backend,
        storageLabel,
        error,
        isTauri,
        supportsFileSystem,
        supportsFolders,
        pickFolder,
        useBrowserStorage,
        grantPermission,
        reset,
    };
}
