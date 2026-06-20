import {useCallback, useEffect, useRef, useState} from 'react';

import {
    DEFAULT_METADATA,
    reconcile,
    withActive,
    withClosed,
    withCreatedStamp,
    withOpened,
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

/** A detected external change to an open note. */
export interface NoteConflict {
    id: string;
    /** On-disk `lastModified` at detection (0 when the file was deleted). */
    diskUpdatedAt: number;
    /** True when the file was deleted on disk rather than modified. */
    deleted: boolean;
}

export interface UseNotes {
    notes: NoteMeta[];
    /** Folder metadata: active sort, pinned ids, created stamps, open tabs. */
    metadata: NotesMetadata;
    setSortMode(sort: SortMode): void;
    togglePin(id: string): void;
    /** Open tab ids, in tab order (mirrors metadata.open). */
    openIds: readonly string[];
    /** Active tab id (mirrors metadata.active). */
    activeId: string | null;
    /** Loaded content for each open tab, keyed by id. */
    openNotes: ReadonlyMap<string, Note>;
    /** Save state per open tab. */
    saveStates: ReadonlyMap<string, SaveState>;
    /** Detected external change per open tab. */
    conflicts: ReadonlyMap<string, NoteConflict>;
    /** Open a note in a tab, or activate it if already open. */
    open(id: string): Promise<void>;
    /** Make an already-open tab active. */
    activate(id: string): void;
    /** Close a tab, flushing any pending edit first. */
    close(id: string): Promise<void>;
    create(): Promise<void>;
    rename(id: string, nextTitle: string): Promise<void>;
    remove(id: string): Promise<void>;
    /** Queue a debounced autosave for a specific open note. */
    edit(id: string, content: string): void;
    /** Conflict resolvers — act on the active tab's conflict. */
    reloadDisk(): Promise<void>;
    keepMine(): Promise<void>;
    saveAsCopy(): Promise<void>;
    discard(): void;
}

/**
 * Owns the note list, the open tabs + active tab, and debounced autosave for a
 * given `NoteStore` (Approach A: per-tab state centralized here). Editing is
 * decoupled from React state on purpose: keystrokes only flow into per-id refs +
 * debounce timers (not `setState`), so a mounted editor is never re-created
 * mid-typing.
 *
 * Each open note carries its own pending edit, baseline `lastModified`, autosave
 * timer, save state, and conflict — so a tab switched away from still saves
 * itself, `beforeunload` flushes every dirty tab, and external-edit detection
 * scans every open tab. Open tabs + the active tab persist in the folder metadata.
 */
export function useNotes(store: NoteStore, onError: (message: string) => void): UseNotes {
    const [notes, setNotes] = useState<NoteMeta[]>([]);
    const [metadata, setMetadata] = useState<NotesMetadata>(DEFAULT_METADATA);
    const metadataRef = useRef<NotesMetadata>(DEFAULT_METADATA);

    const [openNotes, setOpenNotes] = useState<Map<string, Note>>(new Map());
    const openNotesRef = useRef<Map<string, Note>>(openNotes);
    const [saveStates, setSaveStates] = useState<Map<string, SaveState>>(new Map());
    const [conflicts, setConflicts] = useState<Map<string, NoteConflict>>(new Map());
    const conflictsRef = useRef<Map<string, NoteConflict>>(conflicts);

    // Per-id working state (non-render): pending edit, last-seen mtime, autosave timer.
    const pendingRef = useRef<Map<string, string>>(new Map());
    const baselineRef = useRef<Map<string, number | null>>(new Map());
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

    // --- map mutators that keep refs in sync for reads inside callbacks ---
    const putOpenNote = useCallback((id: string, note: Note) => {
        setOpenNotes((prev) => {
            const next = new Map(prev).set(id, note);
            openNotesRef.current = next;
            return next;
        });
    }, []);
    const dropFromMaps = useCallback((id: string) => {
        setOpenNotes((prev) => {
            const next = new Map(prev);
            next.delete(id);
            openNotesRef.current = next;
            return next;
        });
        setSaveStates((prev) => {
            const next = new Map(prev);
            next.delete(id);
            return next;
        });
        setConflicts((prev) => {
            const next = new Map(prev);
            next.delete(id);
            conflictsRef.current = next;
            return next;
        });
    }, []);
    const setSaveStateFor = useCallback((id: string, state: SaveState) => {
        setSaveStates((prev) => new Map(prev).set(id, state));
    }, []);
    const setConflictFor = useCallback((id: string, conflict: NoteConflict) => {
        setConflicts((prev) => {
            const next = new Map(prev).set(id, conflict);
            conflictsRef.current = next;
            return next;
        });
    }, []);
    const clearConflictFor = useCallback((id: string) => {
        setConflicts((prev) => {
            const next = new Map(prev);
            next.delete(id);
            conflictsRef.current = next;
            return next;
        });
    }, []);

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

    const clearTimer = useCallback((id: string) => {
        const t = timersRef.current.get(id);
        if (t) {
            clearTimeout(t);
            timersRef.current.delete(id);
        }
    }, []);

    const flush = useCallback(
        async (id: string) => {
            clearTimer(id);
            const content = pendingRef.current.get(id);
            if (content === undefined) return;
            pendingRef.current.delete(id);
            try {
                const meta = await store.save(id, content, baselineRef.current.get(id) ?? 0);
                baselineRef.current.set(id, meta.updatedAt ?? null);
                setSaveStateFor(id, 'saved');
                bumpInList(id, meta.updatedAt);
            } catch (err) {
                pendingRef.current.set(id, content); // never drop the user's content
                if (err instanceof ConflictError) {
                    setConflictFor(id, {id, diskUpdatedAt: err.diskUpdatedAt, deleted: false});
                    setSaveStateFor(id, 'conflict');
                } else if (err instanceof DOMException && err.name === 'NotFoundError') {
                    setConflictFor(id, {id, diskUpdatedAt: 0, deleted: true});
                    setSaveStateFor(id, 'conflict');
                } else {
                    setSaveStateFor(id, 'error');
                    onError(err instanceof Error ? err.message : 'Failed to save note');
                }
            }
        },
        [store, onError, bumpInList, clearTimer, setSaveStateFor, setConflictFor],
    );

    const open = useCallback(
        async (id: string) => {
            if (metadataRef.current.open.includes(id)) {
                await persistMetadata(withActive(metadataRef.current, id));
            } else {
                try {
                    const note = await store.get(id);
                    baselineRef.current.set(id, note.updatedAt ?? null);
                    putOpenNote(id, note);
                    setSaveStateFor(id, 'idle');
                } catch (err) {
                    onError(err instanceof Error ? err.message : 'Failed to open note');
                    return;
                }
                await persistMetadata(withOpened(metadataRef.current, id));
            }
        },
        [store, onError, persistMetadata, putOpenNote, setSaveStateFor],
    );

    const activate = useCallback(
        (id: string) => void persistMetadata(withActive(metadataRef.current, id)),
        [persistMetadata],
    );

    const close = useCallback(
        async (id: string) => {
            await flush(id);
            clearTimer(id);
            pendingRef.current.delete(id);
            baselineRef.current.delete(id);
            dropFromMaps(id);
            await persistMetadata(withClosed(metadataRef.current, id));
        },
        [flush, clearTimer, dropFromMaps, persistMetadata],
    );

    const create = useCallback(async () => {
        try {
            const meta = await store.create('Untitled');
            await refresh();
            await persistMetadata(
                withCreatedStamp(metadataRef.current, meta.id, meta.updatedAt ?? 0),
            );
            await open(meta.id);
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to create note');
        }
    }, [store, refresh, persistMetadata, open, onError]);

    const rename = useCallback(
        async (id: string, nextTitle: string) => {
            await flush(id);
            try {
                const meta = await store.rename(id, nextTitle);
                const wasOpen = metadataRef.current.open.includes(id);
                if (meta.id !== id) {
                    await persistMetadata(withRenamed(metadataRef.current, id, meta.id));
                    const base = baselineRef.current.get(id);
                    if (base !== undefined) baselineRef.current.set(meta.id, base);
                    baselineRef.current.delete(id);
                    clearTimer(id);
                    pendingRef.current.delete(id);
                }
                await refresh();
                if (wasOpen && meta.id !== id) {
                    // Reload under the new id so the editor remounts cleanly (new key).
                    const note = await store.get(meta.id);
                    baselineRef.current.set(meta.id, note.updatedAt ?? null);
                    setOpenNotes((prev) => {
                        const next = new Map(prev);
                        next.delete(id);
                        next.set(meta.id, note);
                        openNotesRef.current = next;
                        return next;
                    });
                    setSaveStates((prev) => {
                        const next = new Map(prev);
                        const prior = next.get(id) ?? 'idle';
                        next.delete(id);
                        next.set(meta.id, prior);
                        return next;
                    });
                    clearConflictFor(id);
                }
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to rename note');
            }
        },
        [flush, store, persistMetadata, refresh, clearTimer, clearConflictFor, onError],
    );

    const remove = useCallback(
        async (id: string) => {
            try {
                await store.remove(id);
                clearTimer(id);
                pendingRef.current.delete(id);
                baselineRef.current.delete(id);
                dropFromMaps(id);
                await persistMetadata(withRemoved(metadataRef.current, id));
                await refresh();
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to delete note');
            }
        },
        [store, clearTimer, dropFromMaps, persistMetadata, refresh, onError],
    );

    const edit = useCallback(
        (id: string, content: string) => {
            pendingRef.current.set(id, content);
            if (conflictsRef.current.has(id)) return; // autosave paused until resolved
            setSaveStateFor(id, 'saving');
            clearTimer(id);
            timersRef.current.set(
                id,
                setTimeout(() => void flush(id), AUTOSAVE_DELAY),
            );
        },
        [flush, clearTimer, setSaveStateFor],
    );

    const reloadDisk = useCallback(async () => {
        const id = metadataRef.current.active;
        if (!id || !conflictsRef.current.has(id)) return;
        clearTimer(id);
        pendingRef.current.delete(id);
        try {
            const note = await store.get(id);
            baselineRef.current.set(id, note.updatedAt ?? null);
            putOpenNote(id, note); // new updatedAt remounts the editor with disk content
            clearConflictFor(id);
            setSaveStateFor(id, 'idle');
            bumpInList(id, note.updatedAt);
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to reload note');
        }
    }, [store, onError, bumpInList, clearTimer, putOpenNote, clearConflictFor, setSaveStateFor]);

    const keepMine = useCallback(async () => {
        const id = metadataRef.current.active;
        const conflict = id ? conflictsRef.current.get(id) : undefined;
        if (!id || !conflict || conflict.deleted) return;
        const content = pendingRef.current.get(id) ?? openNotesRef.current.get(id)?.content ?? '';
        pendingRef.current.delete(id);
        try {
            const meta = await store.save(id, content, conflict.diskUpdatedAt);
            baselineRef.current.set(id, meta.updatedAt ?? null);
            clearConflictFor(id);
            setSaveStateFor(id, 'saved');
            bumpInList(id, meta.updatedAt);
        } catch (err) {
            pendingRef.current.set(id, content);
            onError(err instanceof Error ? err.message : 'Failed to save note');
        }
    }, [store, onError, bumpInList, clearConflictFor, setSaveStateFor]);

    const saveAsCopy = useCallback(async () => {
        const id = metadataRef.current.active;
        const conflict = id ? conflictsRef.current.get(id) : undefined;
        if (!id || !conflict) return;
        const current = openNotesRef.current.get(id);
        const content = pendingRef.current.get(id) ?? current?.content ?? '';
        const title = current?.title ?? 'Note';
        pendingRef.current.delete(id);
        try {
            const copy = await store.create(`${title} (conflicted copy)`);
            await store.save(copy.id, content, copy.updatedAt ?? 0);
            await refresh();
            await persistMetadata(
                withCreatedStamp(metadataRef.current, copy.id, copy.updatedAt ?? 0),
            );
            clearConflictFor(id);
            await open(copy.id);
        } catch (err) {
            pendingRef.current.set(id, content);
            onError(err instanceof Error ? err.message : 'Failed to save a copy');
        }
    }, [store, refresh, persistMetadata, open, clearConflictFor, onError]);

    const discard = useCallback(() => {
        const id = metadataRef.current.active;
        if (!id) return;
        clearTimer(id);
        pendingRef.current.delete(id);
        baselineRef.current.delete(id);
        dropFromMaps(id);
        void persistMetadata(withClosed(metadataRef.current, id));
        void refresh();
    }, [clearTimer, dropFromMaps, persistMetadata, refresh]);

    // Initial load: notes + metadata, reconcile, then load content for every open tab.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const [list, raw] = await Promise.all([store.list(), store.readMetadata()]);
            if (cancelled) return;
            const meta = reconcile(
                raw,
                list.map((n) => n.id),
            );
            const loaded = await Promise.all(
                meta.open.map(async (id) => {
                    try {
                        return await store.get(id);
                    } catch {
                        return null;
                    }
                }),
            );
            if (cancelled) return;
            const okNotes = loaded.filter((n): n is Note => n !== null);
            const okIds = new Set(okNotes.map((n) => n.id));
            const nextOpen = meta.open.filter((id) => okIds.has(id));
            const nextActive =
                meta.active && okIds.has(meta.active) ? meta.active : (nextOpen[0] ?? null);
            const reconciled: NotesMetadata = {...meta, open: nextOpen, active: nextActive};

            const openMap = new Map<string, Note>();
            const stateMap = new Map<string, SaveState>();
            for (const n of okNotes) {
                openMap.set(n.id, n);
                stateMap.set(n.id, 'idle');
                baselineRef.current.set(n.id, n.updatedAt ?? null);
            }
            setNotes(list);
            applyMetadata(reconciled);
            openNotesRef.current = openMap;
            setOpenNotes(openMap);
            setSaveStates(stateMap);
            // Heal the dotfile if we had to drop any open tabs.
            if (nextOpen.length !== meta.open.length || nextActive !== meta.active) {
                void store.writeMetadata(reconciled);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [store, applyMetadata]);

    // Best-effort save when hidden; warn before unload if any tab has unsaved edits.
    useEffect(() => {
        const flushAll = () => {
            for (const id of [...pendingRef.current.keys()]) void flush(id);
        };
        const onHide = () => flushAll();
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            flushAll();
            if (pendingRef.current.size > 0 || conflictsRef.current.size > 0) {
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
    }, [flush]);

    // Detect external changes for every open tab when returning to the tab/window.
    useEffect(() => {
        const check = async () => {
            if (document.visibilityState !== 'visible') return;
            for (const id of metadataRef.current.open) {
                if (conflictsRef.current.has(id) || pendingRef.current.has(id)) continue;
                const diskMtime = await store.stat(id);
                if (diskMtime === null) {
                    setConflictFor(id, {id, diskUpdatedAt: 0, deleted: true});
                    setSaveStateFor(id, 'conflict');
                } else {
                    const base = baselineRef.current.get(id);
                    if (base !== undefined && base !== null && diskMtime !== base) {
                        setConflictFor(id, {id, diskUpdatedAt: diskMtime, deleted: false});
                        setSaveStateFor(id, 'conflict');
                    }
                }
            }
        };
        const onFocus = () => void check();
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
        };
    }, [store, setConflictFor, setSaveStateFor]);

    return {
        notes,
        metadata,
        setSortMode,
        togglePin,
        openIds: metadata.open,
        activeId: metadata.active,
        openNotes,
        saveStates,
        conflicts,
        open,
        activate,
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
