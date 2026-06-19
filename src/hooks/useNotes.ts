import {useCallback, useEffect, useRef, useState} from 'react';

import type {Note, NoteMeta, NoteStore} from '../storage/types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY = 500;

export interface UseNotes {
    notes: NoteMeta[];
    selectedId: string | null;
    /** Full content of the selected note (the editor's initial markup). */
    selectedNote: Note | null;
    saveState: SaveState;
    select(id: string): Promise<void>;
    create(): Promise<void>;
    rename(id: string, nextTitle: string): Promise<void>;
    remove(id: string): Promise<void>;
    /** Queue a debounced autosave for the currently selected note. */
    edit(content: string): void;
}

/**
 * Owns the note list, the current selection, and debounced autosave for a given
 * `NoteStore`. Editing is decoupled from React state on purpose: keystrokes only
 * flow into a ref + debounce timer (not `setState`), so the markdown editor
 * instance is never re-created mid-typing.
 */
export function useNotes(store: NoteStore, onError: (message: string) => void): UseNotes {
    const [notes, setNotes] = useState<NoteMeta[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedNote, setSelectedNote] = useState<Note | null>(null);
    const [saveState, setSaveState] = useState<SaveState>('idle');

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Latest unsaved edit, tagged with the note it belongs to. */
    const pendingRef = useRef<{id: string; content: string} | null>(null);

    const refresh = useCallback(async () => {
        setNotes(await store.list());
    }, [store]);

    const flush = useCallback(async () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        const pending = pendingRef.current;
        if (!pending) return;
        pendingRef.current = null;
        try {
            await store.save(pending.id, pending.content);
            setSaveState('saved');
            setNotes((prev) =>
                [...prev]
                    .map((n) => (n.id === pending.id ? {...n, updatedAt: Date.now()} : n))
                    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
            );
        } catch (err) {
            setSaveState('error');
            onError(err instanceof Error ? err.message : 'Failed to save note');
        }
    }, [store, onError]);

    const select = useCallback(
        async (id: string) => {
            await flush();
            try {
                const note = await store.get(id);
                setSelectedNote(note);
                setSelectedId(id);
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
            setSaveState('saving');
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                void flush();
            }, AUTOSAVE_DELAY);
        },
        [selectedId, flush],
    );

    // Initial load.
    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Persist any pending edit when the tab is hidden or closed.
    useEffect(() => {
        const onHide = () => {
            void flush();
        };
        window.addEventListener('beforeunload', onHide);
        document.addEventListener('visibilitychange', onHide);
        return () => {
            window.removeEventListener('beforeunload', onHide);
            document.removeEventListener('visibilitychange', onHide);
        };
    }, [flush]);

    return {notes, selectedId, selectedNote, saveState, select, create, rename, remove, edit};
}
