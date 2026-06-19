import {useCallback, useEffect, useRef, useState} from 'react';

import {ConflictError, type Note, type NoteMeta, type NoteStore} from '../storage/types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

const AUTOSAVE_DELAY = 500;

/** A detected external change to the currently-open note. */
export interface NoteConflict {
    id: string;
    /** On-disk `lastModified` at detection (0 when the file was deleted). */
    diskUpdatedAt: number;
    /** True when the file was deleted on disk rather than modified. */
    deleted: boolean;
}

export interface UseNotes {
    notes: NoteMeta[];
    selectedId: string | null;
    /** Full content of the selected note (the editor's initial markup). */
    selectedNote: Note | null;
    saveState: SaveState;
    /** Set when the open note changed on disk underneath us; null otherwise. */
    conflict: NoteConflict | null;
    select(id: string): Promise<void>;
    create(): Promise<void>;
    rename(id: string, nextTitle: string): Promise<void>;
    remove(id: string): Promise<void>;
    /** Queue a debounced autosave for the currently selected note. */
    edit(content: string): void;
    /** Conflict resolvers. */
    reloadDisk(): Promise<void>;
    keepMine(): Promise<void>;
    saveAsCopy(): Promise<void>;
    discard(): void;
}

/**
 * Owns the note list, the current selection, and debounced autosave for a given
 * `NoteStore`. Editing is decoupled from React state on purpose: keystrokes only
 * flow into a ref + debounce timer (not `setState`), so the markdown editor
 * instance is never re-created mid-typing.
 *
 * Saves use optimistic concurrency: `baselineRef` tracks the on-disk `lastModified`
 * we last saw; a save whose baseline no longer matches disk raises a `conflict`
 * instead of overwriting, and autosave pauses until it is resolved.
 */
export function useNotes(store: NoteStore, onError: (message: string) => void): UseNotes {
    const [notes, setNotes] = useState<NoteMeta[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedNote, setSelectedNote] = useState<Note | null>(null);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [conflict, setConflict] = useState<NoteConflict | null>(null);

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Latest unsaved edit, tagged with the note it belongs to. */
    const pendingRef = useRef<{id: string; content: string} | null>(null);
    /** Last on-disk `lastModified` we've seen for the selected note. */
    const baselineRef = useRef<number | null>(null);

    const refresh = useCallback(async () => {
        setNotes(await store.list());
    }, [store]);

    const bumpInList = useCallback((id: string, updatedAt: number | undefined) => {
        setNotes((prev) =>
            [...prev]
                .map((n) => (n.id === id ? {...n, updatedAt} : n))
                .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
        );
    }, []);

    const flush = useCallback(async () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
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
    }, [store, onError, bumpInList]);

    const select = useCallback(
        async (id: string) => {
            await flush();
            try {
                const note = await store.get(id);
                baselineRef.current = note.updatedAt ?? null;
                setSelectedNote(note);
                setSelectedId(id);
                setConflict(null);
                setSaveState('idle');
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to open note');
            }
        },
        [flush, store, onError],
    );

    const create = useCallback(async () => {
        await flush();
        try {
            const meta = await store.create('Untitled');
            await refresh();
            await select(meta.id);
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to create note');
        }
    }, [flush, store, refresh, select, onError]);

    const rename = useCallback(
        async (id: string, nextTitle: string) => {
            await flush();
            try {
                const meta = await store.rename(id, nextTitle);
                await refresh();
                if (selectedId === id) {
                    await select(meta.id);
                }
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to rename note');
            }
        },
        [flush, store, refresh, select, selectedId, onError],
    );

    const remove = useCallback(
        async (id: string) => {
            try {
                await store.remove(id);
                if (pendingRef.current?.id === id) {
                    pendingRef.current = null;
                }
                if (selectedId === id) {
                    setSelectedId(null);
                    setSelectedNote(null);
                    setConflict(null);
                }
                await refresh();
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to delete note');
            }
        },
        [store, refresh, selectedId, onError],
    );

    const edit = useCallback(
        (content: string) => {
            if (!selectedId) return;
            pendingRef.current = {id: selectedId, content};
            if (conflict) return; // autosave is paused until the conflict is resolved
            setSaveState('saving');
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                void flush();
            }, AUTOSAVE_DELAY);
        },
        [selectedId, conflict, flush],
    );

    const reloadDisk = useCallback(async () => {
        const id = conflict?.id;
        if (!id) return;
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        pendingRef.current = null;
        try {
            const note = await store.get(id);
            baselineRef.current = note.updatedAt ?? null;
            setSelectedNote(note); // new updatedAt remounts the editor with disk content
            setSelectedId(id);
            setConflict(null);
            setSaveState('idle');
            bumpInList(id, note.updatedAt);
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to reload note');
        }
    }, [conflict, store, onError, bumpInList]);

    const keepMine = useCallback(async () => {
        if (!conflict || conflict.deleted) return;
        const content = pendingRef.current?.content ?? selectedNote?.content ?? '';
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
    }, [conflict, selectedNote, store, onError, bumpInList]);

    const saveAsCopy = useCallback(async () => {
        if (!conflict) return;
        const content = pendingRef.current?.content ?? selectedNote?.content ?? '';
        const title = selectedNote?.title ?? 'Note';
        pendingRef.current = null;
        try {
            const copy = await store.create(`${title} (conflicted copy)`);
            await store.save(copy.id, content, copy.updatedAt ?? 0);
            setConflict(null);
            await refresh();
            await select(copy.id);
        } catch (err) {
            pendingRef.current = {id: conflict.id, content};
            onError(err instanceof Error ? err.message : 'Failed to save a copy');
        }
    }, [conflict, selectedNote, store, refresh, select, onError]);

    const discard = useCallback(() => {
        pendingRef.current = null;
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        setConflict(null);
        setSelectedId(null);
        setSelectedNote(null);
        setSaveState('idle');
        void refresh();
    }, [refresh]);

    // Initial load.
    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Best-effort save when hidden; warn before unload if edits are unsaved.
    useEffect(() => {
        const onHide = () => {
            void flush();
        };
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

    // Detect external changes when returning to the tab/window.
    useEffect(() => {
        const check = async () => {
            if (document.visibilityState !== 'visible') return;
            const id = selectedId;
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
        const onFocus = () => {
            void check();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
        };
    }, [selectedId, conflict, store]);

    return {
        notes,
        selectedId,
        selectedNote,
        saveState,
        conflict,
        select,
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
