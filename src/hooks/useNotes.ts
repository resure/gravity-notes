import {useCallback, useEffect, useRef, useState} from 'react';

import {
    DEFAULT_METADATA,
    reconcile,
    withActive,
    withCreatedStamp,
    withPinToggled,
    withRemoved,
    withRenamed,
    withSortMode,
} from '../storage/metadata';
import {
    ConflictError,
    type Note,
    type NoteMeta,
    type NoteStore,
    type NotesMetadata,
    type SortMode,
} from '../storage/types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

const AUTOSAVE_DELAY = 500;

/** A detected external change to the open note. */
export interface NoteConflict {
    id: string;
    /** On-disk `lastModified` at detection (0 when the file was deleted). */
    diskUpdatedAt: number;
    /** True when the file was deleted on disk rather than modified. */
    deleted: boolean;
}

export interface UseNotes {
    notes: NoteMeta[];
    /** Folder metadata: active sort, pinned ids, created stamps, the open note. */
    metadata: NotesMetadata;
    setSortMode(sort: SortMode): void;
    togglePin(id: string): void;
    /** The single open note's id (mirrors `metadata.active`), or null. */
    activeId: string | null;
    /** Full content of the open note (the editor's initial markup), or null. */
    note: Note | null;
    saveState: SaveState;
    /** Set when the open note changed on disk underneath us; null otherwise. */
    conflict: NoteConflict | null;
    /** Load a note into the single editor pane and make it active (persisted). Flushes the outgoing note first. */
    open(id: string): Promise<void>;
    /** Close the open note (placeholder). */
    close(): Promise<void>;
    /** Create a new empty note, open it, and return its id (null on failure). */
    create(): Promise<string | null>;
    rename(id: string, nextTitle: string): Promise<void>;
    remove(id: string): Promise<void>;
    /** Queue a debounced autosave for the open note. */
    edit(content: string): void;
    /** Conflict resolvers (act on the open note). */
    reloadDisk(): Promise<void>;
    keepMine(): Promise<void>;
    saveAsCopy(): Promise<void>;
    discard(): void;
}

/**
 * Owns the note list, the single open note (`metadata.active`), and debounced
 * autosave for a given `NoteStore`. Editing is decoupled from React state: keystrokes
 * flow into a ref + timer (not `setState`), so the editor is never re-created mid-typing.
 * Switching notes (`open`) flushes the outgoing note's pending edit first.
 */
export function useNotes(store: NoteStore, onError: (message: string) => void): UseNotes {
    const [notes, setNotes] = useState<NoteMeta[]>([]);
    const [note, setNote] = useState<Note | null>(null);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [conflict, setConflict] = useState<NoteConflict | null>(null);
    const [metadata, setMetadata] = useState<NotesMetadata>(DEFAULT_METADATA);
    const metadataRef = useRef<NotesMetadata>(DEFAULT_METADATA);

    const applyMetadata = useCallback((next: NotesMetadata) => {
        metadataRef.current = next;
        setMetadata(next);
    }, []);

    const persistMetadata = useCallback(
        async (next: NotesMetadata) => {
            applyMetadata(next);
            try {
                await store.writeMetadata(next);
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to save notes metadata');
            }
        },
        [applyMetadata, store, onError],
    );

    const setSortMode = useCallback(
        (sort: SortMode) => void persistMetadata(withSortMode(metadataRef.current, sort)),
        [persistMetadata],
    );
    const togglePin = useCallback(
        (id: string) => void persistMetadata(withPinToggled(metadataRef.current, id)),
        [persistMetadata],
    );

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Latest unsaved edit, tagged with the note it belongs to. */
    const pendingRef = useRef<{id: string; content: string} | null>(null);
    /** Last on-disk `lastModified` we've seen for the open note. */
    const baselineRef = useRef<number | null>(null);

    const refresh = useCallback(async () => {
        const list = await store.list();
        setNotes(list);
        applyMetadata(
            reconcile(
                metadataRef.current,
                list.map((n) => n.id),
            ),
        );
    }, [store, applyMetadata]);

    const bumpInList = useCallback((id: string, updatedAt: number | undefined) => {
        setNotes((prev) => prev.map((n) => (n.id === id ? {...n, updatedAt} : n)));
    }, []);

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const flush = useCallback(async () => {
        clearTimer();
        const pending = pendingRef.current;
        if (!pending) return;
        pendingRef.current = null;
        try {
            const meta = await store.save(pending.id, pending.content, baselineRef.current ?? 0);
            baselineRef.current = meta.updatedAt ?? null;
            setSaveState('saved');
            bumpInList(pending.id, meta.updatedAt);
        } catch (err) {
            pendingRef.current = pending; // never drop the user's content
            if (err instanceof ConflictError) {
                setConflict({id: err.id, diskUpdatedAt: err.diskUpdatedAt, deleted: false});
                setSaveState('conflict');
            } else if (err instanceof DOMException && err.name === 'NotFoundError') {
                setConflict({id: pending.id, diskUpdatedAt: 0, deleted: true});
                setSaveState('conflict');
            } else {
                setSaveState('error');
                onError(err instanceof Error ? err.message : 'Failed to save note');
            }
        }
    }, [store, onError, bumpInList, clearTimer]);

    const open = useCallback(
        async (id: string) => {
            await flush();
            try {
                const loaded = await store.get(id);
                baselineRef.current = loaded.updatedAt ?? null;
                setNote(loaded);
                setConflict(null);
                setSaveState('idle');
                await persistMetadata(withActive(metadataRef.current, id));
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to open note');
            }
        },
        [flush, store, persistMetadata, onError],
    );

    const close = useCallback(async () => {
        await flush();
        pendingRef.current = null;
        clearTimer();
        setNote(null);
        setConflict(null);
        setSaveState('idle');
        await persistMetadata(withActive(metadataRef.current, null));
    }, [flush, clearTimer, persistMetadata]);

    const create = useCallback(async (): Promise<string | null> => {
        await flush();
        try {
            const meta = await store.create('Untitled');
            await persistMetadata(
                withCreatedStamp(metadataRef.current, meta.id, meta.updatedAt ?? 0),
            );
            await refresh();
            await open(meta.id);
            return meta.id;
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to create note');
            return null;
        }
    }, [flush, store, persistMetadata, refresh, open, onError]);

    const rename = useCallback(
        async (id: string, nextTitle: string) => {
            if (conflict?.id === id) {
                onError('Resolve the conflict before renaming this note.');
                return;
            }
            await flush();
            try {
                const meta = await store.rename(id, nextTitle);
                const wasActive = metadataRef.current.active === id;
                if (meta.id !== id) {
                    await persistMetadata(withRenamed(metadataRef.current, id, meta.id));
                    if (pendingRef.current?.id === id) pendingRef.current = null;
                }
                await refresh();
                if (wasActive && meta.id !== id) {
                    // Reload under the new id so the editor remounts cleanly (new key).
                    const reloaded = await store.get(meta.id);
                    baselineRef.current = reloaded.updatedAt ?? null;
                    setNote(reloaded);
                    setConflict(null);
                    setSaveState('idle');
                }
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to rename note');
            }
        },
        [conflict, flush, store, persistMetadata, refresh, onError],
    );

    const remove = useCallback(
        async (id: string) => {
            try {
                await store.remove(id);
                if (pendingRef.current?.id === id) pendingRef.current = null;
                const wasActive = metadataRef.current.active === id;
                await persistMetadata(withRemoved(metadataRef.current, id));
                if (wasActive) {
                    clearTimer();
                    setNote(null);
                    setConflict(null);
                    setSaveState('idle');
                }
                await refresh();
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to delete note');
            }
        },
        [store, persistMetadata, refresh, clearTimer, onError],
    );

    const edit = useCallback(
        (content: string) => {
            const id = metadataRef.current.active;
            if (!id) return;
            pendingRef.current = {id, content};
            if (conflict) return; // autosave is paused until the conflict is resolved
            setSaveState('saving');
            clearTimer();
            timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DELAY);
        },
        [conflict, flush, clearTimer],
    );

    const reloadDisk = useCallback(async () => {
        const id = conflict?.id;
        if (!id) return;
        clearTimer();
        pendingRef.current = null;
        try {
            const loaded = await store.get(id);
            baselineRef.current = loaded.updatedAt ?? null;
            setNote(loaded); // new updatedAt remounts the editor with disk content
            setConflict(null);
            setSaveState('idle');
            bumpInList(id, loaded.updatedAt);
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to reload note');
        }
    }, [conflict, store, onError, bumpInList, clearTimer]);

    const keepMine = useCallback(async () => {
        if (!conflict || conflict.deleted) return;
        const content = pendingRef.current?.content ?? note?.content ?? '';
        pendingRef.current = null;
        try {
            const meta = await store.save(conflict.id, content, conflict.diskUpdatedAt);
            baselineRef.current = meta.updatedAt ?? null;
            setConflict(null);
            setSaveState('saved');
            bumpInList(conflict.id, meta.updatedAt);
        } catch (err) {
            pendingRef.current = {id: conflict.id, content};
            onError(err instanceof Error ? err.message : 'Failed to save note');
        }
    }, [conflict, note, store, onError, bumpInList]);

    const saveAsCopy = useCallback(async () => {
        if (!conflict) return;
        const content = pendingRef.current?.content ?? note?.content ?? '';
        const title = note?.title ?? 'Note';
        pendingRef.current = null;
        try {
            const copy = await store.create(`${title} (conflicted copy)`);
            await store.save(copy.id, content, copy.updatedAt ?? 0);
            await persistMetadata(
                withCreatedStamp(metadataRef.current, copy.id, copy.updatedAt ?? 0),
            );
            setConflict(null);
            await refresh();
            await open(copy.id);
        } catch (err) {
            pendingRef.current = {id: conflict.id, content};
            onError(err instanceof Error ? err.message : 'Failed to save a copy');
        }
    }, [conflict, note, store, refresh, open, persistMetadata, onError]);

    const discard = useCallback(() => {
        pendingRef.current = null;
        clearTimer();
        setConflict(null);
        setNote(null);
        setSaveState('idle');
        void persistMetadata(withActive(metadataRef.current, null));
        void refresh();
    }, [clearTimer, persistMetadata, refresh]);

    // Initial load: notes + metadata, reconcile, then restore the open note (if any).
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const [list, raw] = await Promise.all([store.list(), store.readMetadata()]);
            if (cancelled) return;
            const meta = reconcile(
                raw,
                list.map((n) => n.id),
            );
            let loaded: Note | null = null;
            if (meta.active) {
                try {
                    loaded = await store.get(meta.active);
                } catch {
                    loaded = null;
                }
            }
            if (cancelled) return;
            const reconciled: NotesMetadata = loaded ? meta : {...meta, active: null};
            setNotes(list);
            applyMetadata(reconciled);
            if (loaded) {
                baselineRef.current = loaded.updatedAt ?? null;
                setNote(loaded);
            }
            if (reconciled.active !== meta.active) {
                void store.writeMetadata(reconciled); // heal the dotfile if active vanished
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [store, applyMetadata]);

    // Clear any pending autosave timer when the hook unmounts.
    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    // Best-effort save when hidden; warn before unload if edits are unsaved.
    useEffect(() => {
        const onHide = () => void flush();
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            void flush();
            if (pendingRef.current || conflict) {
                event.preventDefault();
                // eslint-disable-next-line no-param-reassign -- standard beforeunload idiom to trigger the browser's unsaved-changes prompt
                event.returnValue = '';
            }
        };
        document.addEventListener('visibilitychange', onHide);
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => {
            document.removeEventListener('visibilitychange', onHide);
            window.removeEventListener('beforeunload', onBeforeUnload);
        };
    }, [flush, conflict]);

    // Detect an external change to the open note when returning to the tab/window.
    useEffect(() => {
        const check = async () => {
            if (document.visibilityState !== 'visible') return;
            const id = metadataRef.current.active;
            if (!id || conflict || pendingRef.current) return;
            const diskMtime = await store.stat(id);
            if (diskMtime === null) {
                setConflict({id, diskUpdatedAt: 0, deleted: true});
                setSaveState('conflict');
            } else if (baselineRef.current !== null && diskMtime !== baselineRef.current) {
                setConflict({id, diskUpdatedAt: diskMtime, deleted: false});
                setSaveState('conflict');
            }
        };
        const onFocus = () => void check();
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
        };
    }, [conflict, store]);

    return {
        notes,
        metadata,
        setSortMode,
        togglePin,
        activeId: metadata.active,
        note,
        saveState,
        conflict,
        open,
        close,
        create,
        rename,
        remove,
        edit,
        reloadDisk,
        keepMine,
        saveAsCopy,
        discard,
    };
}
