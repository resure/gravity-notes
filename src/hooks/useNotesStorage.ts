import {useCallback, useEffect, useRef, useState} from 'react';

import {FileSystemNoteStore} from '../storage/fileSystemStore';
import {
    type StorageBackend,
    clearStorageChoice,
    loadBackend,
    loadDirHandle,
    queryPermission,
    requestPermission,
    saveBackend,
    saveDirHandle,
} from '../storage/handlePersistence';
import {IndexedDbNoteStore} from '../storage/indexedDbStore';
import type {NoteStore} from '../storage/types';

export type StorageState =
    | 'loading' // checking for a previously-chosen backend
    | 'choosing' // no backend chosen yet — show the first-run choice
    | 'needs-permission' // a folder was remembered, but permission must be re-granted
    | 'ready';

const supportsFileSystem = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

const BROWSER_LABEL = 'In this browser';

export interface NotesStorage {
    state: StorageState;
    /** The ready note store (file-system or in-browser), or null until `ready`. */
    store: NoteStore | null;
    backend: StorageBackend | null;
    /** Human label for the active storage (folder name, or "In this browser"). */
    storageLabel: string | null;
    error: string | null;
    /** Whether the File System Access API is available (drives showing the "open folder" option). */
    supportsFileSystem: boolean;
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
                if (kind === 'filesystem' && savedHandle) {
                    setStorageLabel(savedHandle.name);
                    const permission = await queryPermission(savedHandle);
                    if (cancelled || interactedRef.current) return;
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
        supportsFileSystem,
        pickFolder,
        useBrowserStorage,
        grantPermission,
        reset,
    };
}
