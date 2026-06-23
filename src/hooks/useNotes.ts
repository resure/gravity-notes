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
    NameCollisionError,
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
    /**
     * Bumps when fresh content is loaded into the editor (open / disk-reload / restore). The
     * body editor keys off this so a rename — which changes the id in place — never remounts it.
     */
    sessionId: number;
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
    /** Create a new note (titled, or "Untitled"), open it, and return its id (null on failure). */
    create(title?: string): Promise<string | null>;
    /** Rename a note; returns the resulting id (unchanged on a no-op/collision, null on error). */
    rename(id: string, nextTitle: string): Promise<string | null>;
    remove(id: string): Promise<void>;
    /** Queue a debounced autosave for the open note. */
    edit(content: string): void;
    /** Force-write any pending edit now (used before tearing the workspace down, e.g. folder change). */
    flushPending(): Promise<void>;
    /** Re-read the note list from the store (e.g. after importing notes). */
    refresh(): Promise<void>;
    /** Conflict resolvers (act on the open note). */
    reloadDisk(): Promise<void>;
    keepMine(): Promise<void>;
    saveAsCopy(): Promise<string | null>;
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
    const [sessionId, setSessionId] = useState(0);
    const sessionRef = useRef(0);
    const bumpSession = useCallback(() => {
        sessionRef.current += 1;
        setSessionId(sessionRef.current);
    }, []);

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
    /** Bumped per open() so a slow earlier load can't overwrite a newer one (wrong-note race). */
    const openGenerationRef = useRef(0);

    const refresh = useCallback(async () => {
        const list = await store.list();
        setNotes(list);
        applyMetadata(
            reconcile(
                metadataRef.current,
                list.map((n) => n.id),
                {recursive: store.listsRecursively},
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
            // Restore the snapshot only if no newer keystroke landed during the await — otherwise
            // the newer edit (already in pendingRef, with its own timer) must win, not be clobbered.
            if (pendingRef.current === null) pendingRef.current = pending;
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
            // Already the open note: don't reload — that would remount the editor (losing caret,
            // scroll, undo) and rewrite metadata.active on every re-click or ⌘J/⌘K at a list end.
            if (metadataRef.current.active === id) return;
            // Flush the outgoing note before swapping. Note: if that note has an unresolved
            // external conflict, flush() re-queues its content but the setConflict(null) below
            // discards it — navigating away from a conflict abandons its unsaved edits, the same
            // behavior as before tabs existed (see the design spec's conflict-on-navigate edge).
            const generation = ++openGenerationRef.current;
            await flush();
            try {
                const loaded = await store.get(id);
                // A newer open() superseded this one while we awaited — drop the stale result so a
                // slow earlier load can't land the editor on the wrong note.
                if (generation !== openGenerationRef.current) return;
                baselineRef.current = loaded.updatedAt ?? null;
                setNote(loaded);
                bumpSession();
                setConflict(null);
                setSaveState('idle');
                await persistMetadata(withActive(metadataRef.current, id));
            } catch (err) {
                if (generation !== openGenerationRef.current) return;
                onError(err instanceof Error ? err.message : 'Failed to open note');
            }
        },
        [flush, store, persistMetadata, onError, bumpSession],
    );

    const close = useCallback(async () => {
        await flush();
        // flush() restores pendingRef when it fails (save error / conflict). Don't blow that away:
        // keep the note open so the user can resolve it instead of silently dropping their content.
        if (pendingRef.current) return;
        setNote(null);
        setConflict(null);
        setSaveState('idle');
        await persistMetadata(withActive(metadataRef.current, null));
    }, [flush, persistMetadata]);

    const create = useCallback(
        async (title?: string): Promise<string | null> => {
            await flush();
            try {
                const meta = await store.create(title?.trim() || 'Untitled');
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
        },
        [flush, store, persistMetadata, refresh, open, onError],
    );

    const rename = useCallback(
        async (id: string, nextTitle: string): Promise<string | null> => {
            if (conflict?.id === id) {
                onError('Resolve the conflict before renaming this note.');
                return null;
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
                    // Update the open note's identity in place — same content, same editor
                    // instance (no sessionId bump), so the caret/focus survives the rename.
                    baselineRef.current = meta.updatedAt ?? null;
                    setNote((prev) =>
                        prev && prev.id === id
                            ? {...prev, id: meta.id, title: meta.title, updatedAt: meta.updatedAt}
                            : prev,
                    );
                    // The guard at the top blocks renaming the open note while it's conflicted;
                    // clear defensively so a successful rename always lands in a clean state.
                    setConflict(null);
                    setSaveState('idle');
                }
                return meta.id;
            } catch (err) {
                if (err instanceof NameCollisionError) {
                    onError(err.message);
                    return null;
                }
                onError(err instanceof Error ? err.message : 'Failed to rename note');
                return null;
            }
        },
        [conflict, flush, store, persistMetadata, refresh, onError],
    );

    const remove = useCallback(
        async (id: string) => {
            // Flush first so a pending edit to a *different* note isn't stranded by the refresh()
            // below re-reading stale bytes (and to match open/create/rename/close, which all flush).
            await flush();
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
        [flush, store, persistMetadata, refresh, clearTimer, onError],
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
            setNote(loaded); // new content remounts the editor with disk content
            bumpSession();
            setConflict(null);
            setSaveState('idle');
            bumpInList(id, loaded.updatedAt);
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to reload note');
        }
    }, [conflict, store, onError, bumpInList, clearTimer, bumpSession]);

    const keepMine = useCallback(async () => {
        if (!conflict) return;
        const content = pendingRef.current?.content ?? note?.content ?? '';
        pendingRef.current = null;
        try {
            if (conflict.deleted) {
                // The file was deleted on disk — recreate it with our content rather than abandoning
                // the user to "Save as copy". create() reuses the same name when it's free, so the
                // id usually survives; adopt the resulting id in place if it differs.
                const recreated = await store.create(note?.title ?? 'Note');
                const meta = await store.save(recreated.id, content, recreated.updatedAt ?? 0);
                baselineRef.current = meta.updatedAt ?? null;
                if (recreated.id !== conflict.id) {
                    await persistMetadata(
                        withRenamed(
                            withCreatedStamp(
                                metadataRef.current,
                                recreated.id,
                                recreated.updatedAt ?? 0,
                            ),
                            conflict.id,
                            recreated.id,
                        ),
                    );
                    setNote((prev) =>
                        prev && prev.id === conflict.id
                            ? {...prev, id: recreated.id, title: recreated.title}
                            : prev,
                    );
                }
                setConflict(null);
                setSaveState('saved');
                await refresh();
                return;
            }
            const meta = await store.save(conflict.id, content, conflict.diskUpdatedAt);
            baselineRef.current = meta.updatedAt ?? null;
            setConflict(null);
            setSaveState('saved');
            bumpInList(conflict.id, meta.updatedAt);
        } catch (err) {
            pendingRef.current = {id: conflict.id, content};
            onError(err instanceof Error ? err.message : 'Failed to save note');
        }
    }, [conflict, note, store, onError, bumpInList, persistMetadata, refresh]);

    const saveAsCopy = useCallback(async (): Promise<string | null> => {
        if (!conflict) return null;
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
            return copy.id;
        } catch (err) {
            pendingRef.current = {id: conflict.id, content};
            onError(err instanceof Error ? err.message : 'Failed to save a copy');
            return null;
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
            try {
                const [list, raw] = await Promise.all([store.list(), store.readMetadata()]);
                if (cancelled) return;
                const meta = reconcile(
                    raw,
                    list.map((n) => n.id),
                    {recursive: store.listsRecursively},
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
                    bumpSession();
                }
                if (reconciled.active !== meta.active) {
                    void store.writeMetadata(reconciled); // heal the dotfile if active vanished
                }
            } catch (err) {
                // Listing or reading metadata failed (stale handle, permission loss, read error) —
                // surface it instead of silently showing an empty "No notes yet" workspace.
                if (cancelled) return;
                onError(err instanceof Error ? err.message : 'Failed to load notes');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [store, applyMetadata, bumpSession, onError]);

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
            // Capture intent BEFORE flushing: flush() nulls pendingRef synchronously (an async fn
            // runs to its first await), so checking it after would always read null and the prompt
            // would never fire for a normal pending edit.
            const hasUnsaved = Boolean(pendingRef.current || conflict);
            void flush();
            if (hasUnsaved) {
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
            let diskMtime: number | null;
            try {
                diskMtime = await store.stat(id);
            } catch {
                // stat() can throw on permission loss / unexpected FS errors; don't let the
                // fire-and-forget check surface as an unhandled rejection.
                return;
            }
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
        sessionId,
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
        flushPending: flush,
        refresh,
        reloadDisk,
        keepMine,
        saveAsCopy,
        discard,
    };
}
