import {useCallback, useEffect, useRef, useState} from 'react';

import {
    DEFAULT_METADATA,
    reconcile,
    withActive,
    withCreatedStamp,
    withPinToggled,
    withRemoved,
    withRenamed,
    withReprefixed,
    withSortMode,
    withTrashEmptied,
    withTrashed,
    withoutTrashEntry,
} from '../storage/metadata';
import {dirname, previewFromContent, titleFromFileName} from '../storage/noteText';
import {
    ConflictError,
    NameCollisionError,
    type Note,
    type NoteMeta,
    type NoteStore,
    type NotesMetadata,
    type SortMode,
    type TrashEntry,
    type TrashedNote,
} from '../storage/types';

/**
 * Reconcile the persisted trash registry against the backend's actual trash list (from `listTrash`):
 * drop entries whose file is gone, synthesize entries for orphan files (present on disk but missing
 * from the registry — they restore to the root, dated by their mtime), and build the
 * newest-deleted-first display list. Keeps `metadata.trashed` mirroring the backend, so `trashCount`
 * (its length) always matches what the trash view lists.
 */
function buildTrashView(
    stored: readonly TrashEntry[],
    list: NoteMeta[],
): {trashed: TrashEntry[]; display: TrashedNote[]; changed: boolean} {
    const liveIds = new Set(list.map((m) => m.id));
    const kept = stored.filter((t) => liveIds.has(t.id)); // drop ghosts, preserving order
    const knownIds = new Set(kept.map((t) => t.id));
    const orphans: TrashEntry[] = list
        .filter((m) => !knownIds.has(m.id))
        .map((m) => ({id: m.id, title: m.title, originalPath: '', trashedAt: m.updatedAt ?? 0}));
    const trashed = [...kept, ...orphans];
    const mtimeById = new Map(list.map((m) => [m.id, m.updatedAt]));
    const display: TrashedNote[] = trashed
        .map((t) => ({
            id: t.id,
            title: t.title || titleFromFileName(t.id),
            updatedAt: mtimeById.get(t.id),
            originalPath: t.originalPath,
            trashedAt: t.trashedAt,
        }))
        .sort((a, b) => b.trashedAt - a.trashedAt);
    return {trashed, display, changed: orphans.length > 0 || kept.length !== stored.length};
}

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
    /** Every folder path (POSIX), including deliberately-empty ones — for rendering the tree. */
    folders: string[];
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
    /**
     * Create a new note (titled, or "Untitled") inside `parentPath` (omitted = root), open it, and
     * return its id (null on failure).
     */
    create(title?: string, parentPath?: string): Promise<string | null>;
    /**
     * Duplicate a note: copy its body verbatim into a new "<Title> copy" in the same folder, open it,
     * and return its id (null on error). Attachments are *shared* — the copy keeps the same
     * `Attachments/…` references, so no image bytes are duplicated.
     */
    duplicate(id: string): Promise<string | null>;
    /** Rename a note; returns the resulting id (unchanged on a no-op/collision, null on error). */
    rename(id: string, nextTitle: string): Promise<string | null>;
    /** Move a note into another folder (`destFolder`, `''` = root); returns the resulting id (null on error). */
    move(id: string, destFolder: string): Promise<string | null>;
    /** Permanently delete a note (no trash). The UI deletes via `trash` instead. */
    remove(id: string): Promise<void>;
    /**
     * Soft-delete: move a note to the Trash, recoverable from the trash view. Returns false on failure
     * (incl. an unresolved conflict on the note), so the caller can skip its success toast.
     */
    trash(id: string): Promise<boolean>;
    /** The trash view's display list (title, original folder, deletion time); loaded by `refreshTrash`. */
    trashedNotes: TrashedNote[];
    /** Count of trashed notes, from the persisted registry — cheap (no I/O), for a menu badge. */
    trashCount: number;
    /** Reload the trash display list from the store and reconcile the registry (drops vanished files). */
    refreshTrash(): Promise<void>;
    /** Restore a trashed note to its original folder (`''` if gone); returns its new id (null on error). */
    restoreFromTrash(trashId: string): Promise<string | null>;
    /** Permanently delete one trashed note. */
    purgeFromTrash(trashId: string): Promise<void>;
    /** Permanently delete every trashed note. */
    emptyTrash(): Promise<void>;
    /** Create an (initially empty) folder and refresh the tree. */
    createFolder(parentPath: string, name: string): Promise<void>;
    /** Remove an empty folder (its marker) and refresh; unpins it if it was pinned. */
    removeFolder(path: string): Promise<void>;
    /**
     * Move/rename a folder, re-keying its whole subtree; re-points the open note if it's inside.
     * Resolves `true` when the move actually happened, `false` when it was rejected or a no-op — so
     * a caller that optimistically followed the move (e.g. the rail's selection) can revert.
     */
    moveFolder(fromPath: string, toPath: string): Promise<boolean>;
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
    const [folders, setFolders] = useState<string[]>([]);
    const [trashedNotes, setTrashedNotes] = useState<TrashedNote[]>([]);
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
    /**
     * True while a move() is reconciling the open note's id, so the focus conflict-check can't stat
     * a half-moved (old, now-gone) id and raise a spurious deleted-conflict.
     */
    const moveInProgressRef = useRef(false);

    const refresh = useCallback(async () => {
        const [list, folderList] = await Promise.all([store.list(), store.listFolders()]);
        setNotes(list);
        setFolders(folderList);
        // Reconcile against notes AND folders, so a pinned empty folder isn't pruned.
        applyMetadata(
            reconcile(metadataRef.current, [...list.map((n) => n.id), ...folderList], {
                recursive: store.listsRecursively,
            }),
        );
    }, [store, applyMetadata]);

    const bumpInList = useCallback(
        (id: string, updatedAt: number | undefined, content?: string) => {
            setNotes((prev) =>
                prev.map((n) => {
                    if (n.id !== id) return n;
                    const next = {...n, updatedAt};
                    // Refresh the list snippet from the just-saved body, so an edit shows in the list.
                    if (content !== undefined) next.preview = previewFromContent(content);
                    return next;
                }),
            );
        },
        [],
    );

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
            bumpInList(pending.id, meta.updatedAt, pending.content);
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
        async (title?: string, parentPath?: string): Promise<string | null> => {
            await flush();
            try {
                const meta = await store.create(title?.trim() || 'Untitled', parentPath);
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

    const duplicate = useCallback(
        async (id: string): Promise<string | null> => {
            await flush();
            try {
                // Copy the body verbatim so the copy shares the original's attachment refs.
                const source = await store.get(id);
                const meta = await store.create(`${titleFromFileName(id)} copy`, dirname(id));
                const saved = await store.save(meta.id, source.content, meta.updatedAt ?? 0);
                await persistMetadata(
                    withCreatedStamp(metadataRef.current, meta.id, saved.updatedAt ?? 0),
                );
                await refresh();
                await open(meta.id); // open after the body is written, so the editor shows the copy
                return meta.id;
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to duplicate note');
                return null;
            }
        },
        [flush, store, persistMetadata, refresh, open, onError],
    );

    const createFolder = useCallback(
        async (parentPath: string, name: string): Promise<void> => {
            try {
                await store.createFolder(parentPath, name);
                await refresh();
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to create folder');
            }
        },
        [store, refresh, onError],
    );

    const removeFolder = useCallback(
        async (path: string): Promise<void> => {
            // Only empty folders may be deleted — refuse if any note lives under it (directly or in a
            // subfolder) or it still has a subfolder. Enforced here at the seam so every backend
            // behaves the same (the rail also disables the action; this is the authoritative guard).
            const hasNotes = notes.some((n) => n.id.startsWith(`${path}/`));
            const hasSubfolder = folders.some((f) => f.startsWith(`${path}/`));
            if (hasNotes || hasSubfolder) {
                onError('Only empty folders can be deleted.');
                return;
            }
            try {
                await store.removeFolder(path);
                // refresh() reconciles against the new folder set, which drops a pin on the gone folder.
                await refresh();
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to remove folder');
            }
        },
        [store, refresh, onError, notes, folders],
    );

    const moveFolder = useCallback(
        async (fromPath: string, toPath: string): Promise<boolean> => {
            if (!fromPath || fromPath === toPath) return false;
            if (toPath === fromPath || toPath.startsWith(`${fromPath}/`)) {
                onError('Cannot move a folder into itself.');
                return false;
            }
            const activeId = metadataRef.current.active;
            const activeInside =
                activeId !== null && (activeId === fromPath || activeId.startsWith(`${fromPath}/`));
            if (activeInside && conflict) {
                onError('Resolve the conflict before moving this folder.');
                return false;
            }
            // Flush any pending edit (against the OLD ids) before the subtree is re-keyed.
            await flush();
            // Guard the focus conflict-check from stat-ing the open note's old (now-gone) id.
            moveInProgressRef.current = activeInside;
            // Re-point the open note in place (no remount), re-seeding its baseline and carrying any
            // edit a keystroke re-queued for it during the move's await window.
            const repointOpenNote = async (oldId: string, newId: string) => {
                const carryPending = pendingRef.current?.id === oldId;
                if (carryPending) clearTimer();
                setNote((prev) =>
                    prev && prev.id === oldId
                        ? {...prev, id: newId, title: titleFromFileName(newId)}
                        : prev,
                );
                baselineRef.current = await store.stat(newId); // FSA copy bumps mtime; others keep it
                setConflict(null);
                setSaveState('idle');
                if (carryPending) {
                    pendingRef.current = {id: newId, content: pendingRef.current?.content ?? ''};
                    setSaveState('saving');
                    timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DELAY);
                }
            };
            try {
                await store.moveFolder(fromPath, toPath);
                // Re-prefix metadata (note + folder pins, created stamps, active) in one write; this
                // sets metadataRef.active synchronously, so a racing edit() already sees the new id.
                await persistMetadata(withReprefixed(metadataRef.current, fromPath, toPath));
                if (activeInside && activeId) {
                    await repointOpenNote(activeId, toPath + activeId.slice(fromPath.length));
                }
                await refresh();
                return true;
            } catch (err) {
                if (err instanceof NameCollisionError) {
                    onError(err.message);
                } else {
                    onError(err instanceof Error ? err.message : 'Failed to move folder');
                }
                return false;
            } finally {
                moveInProgressRef.current = false;
            }
        },
        [conflict, flush, store, persistMetadata, refresh, clearTimer, onError],
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

    const move = useCallback(
        async (id: string, destFolder: string): Promise<string | null> => {
            if (conflict?.id === id) {
                onError('Resolve the conflict before moving this note.');
                return null;
            }
            // Flush the outgoing pending edit first (against the OLD id), so no save races the move.
            await flush();
            moveInProgressRef.current = true;
            try {
                const meta = await store.move(id, destFolder);
                // No-op move (already in that folder): nothing to reconcile.
                if (meta.id === id) return meta.id;

                const wasActive = metadataRef.current.active === id;
                // A keystroke during the flush/move awaits may have re-queued an edit for the moved
                // note (the editor stays live — no remount). Kill its timer now so it can't flush
                // against the old, now-gone id while we reconcile; we carry it over and re-arm below.
                const pendingForMoved = pendingRef.current?.id === id;
                if (pendingForMoved) clearTimer();

                // Reconcile identity in a fixed order so any edit() racing the persist below reads a
                // consistent (new) id. The editor instance is kept (no sessionId bump), so the
                // caret/focus survive the move — exactly like rename, but keeping the in-memory body.
                if (wasActive) {
                    setNote((prev) =>
                        prev && prev.id === id
                            ? {...prev, id: meta.id, title: meta.title, updatedAt: meta.updatedAt}
                            : prev,
                    );
                }
                // persistMetadata sets metadataRef.current.active synchronously, so by the time it
                // awaits the write a racing edit() already sees the NEW id (never re-tags the dead one).
                await persistMetadata(withRenamed(metadataRef.current, id, meta.id));
                if (wasActive) {
                    baselineRef.current = meta.updatedAt ?? null; // re-seed the conflict baseline
                    setConflict(null);
                    setSaveState('idle');
                }
                if (pendingForMoved) {
                    // Carry the in-flight keystrokes to the new id (do NOT drop them) and re-arm a
                    // fresh autosave so they still get written — against the new id.
                    pendingRef.current = {id: meta.id, content: pendingRef.current?.content ?? ''};
                    clearTimer();
                    setSaveState('saving');
                    timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DELAY);
                }
                await refresh();
                return meta.id;
            } catch (err) {
                if (err instanceof NameCollisionError) {
                    onError(err.message);
                    return null;
                }
                onError(err instanceof Error ? err.message : 'Failed to move note');
                return null;
            } finally {
                moveInProgressRef.current = false;
            }
        },
        [conflict, flush, store, persistMetadata, refresh, clearTimer, onError],
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

    // Reload the trash from the store and reconcile the registry to mirror it (drop vanished entries,
    // adopt orphan files), then publish the display list. Called when the trash view opens (and on
    // initial load); the mutations below keep the registry + display in sync in-memory without re-I/O.
    const refreshTrash = useCallback(async () => {
        let list: NoteMeta[];
        try {
            list = await store.listTrash();
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to read the Trash');
            return;
        }
        const {trashed, display, changed} = buildTrashView(metadataRef.current.trashed, list);
        setTrashedNotes(display);
        if (changed) await persistMetadata({...metadataRef.current, trashed});
    }, [store, onError, persistMetadata]);

    const trash = useCallback(
        async (id: string): Promise<boolean> => {
            // Refuse while the note has an unresolved conflict (matches move/rename) — trashing it
            // would silently discard the conflicting disk edits with no way to recover them.
            if (conflict?.id === id) {
                onError('Resolve the conflict before deleting this note.');
                return false;
            }
            // Flush first (a pending edit to a *different* note mustn't be stranded), matching remove().
            await flush();
            try {
                const originalPath = dirname(id);
                const title = titleFromFileName(id);
                // Preserve the original creation stamp on the entry so restore can reinstate it.
                const created = metadataRef.current.created[id];
                const trashId = await store.trash(id);
                if (pendingRef.current?.id === id) pendingRef.current = null;
                const wasActive = metadataRef.current.active === id;
                await persistMetadata(
                    withTrashed(metadataRef.current, id, {
                        id: trashId,
                        title,
                        originalPath,
                        trashedAt: Date.now(),
                        created,
                    }),
                );
                if (wasActive) {
                    clearTimer();
                    setNote(null);
                    setConflict(null);
                    setSaveState('idle');
                }
                // No refreshTrash(): the trash view is closed during a delete (it's modal), and the
                // badge reads metadata.trashed.length which withTrashed just updated. The view reloads
                // from the store when it next opens.
                await refresh();
                return true;
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to move note to Trash');
                return false;
            }
        },
        [conflict, flush, store, persistMetadata, refresh, clearTimer, onError],
    );

    const restoreFromTrash = useCallback(
        async (trashId: string): Promise<string | null> => {
            const entry = metadataRef.current.trashed.find((t) => t.id === trashId);
            try {
                const meta = await store.restore(trashId, entry?.originalPath ?? '');
                // Reinstate the original creation stamp (truthy chain dodges a 0/undefined mtime).
                await persistMetadata(
                    withCreatedStamp(
                        withoutTrashEntry(metadataRef.current, trashId),
                        meta.id,
                        entry?.created || meta.updatedAt || Date.now(),
                    ),
                );
                setTrashedNotes((prev) => prev.filter((n) => n.id !== trashId));
                await refresh();
                return meta.id;
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to restore note');
                return null;
            }
        },
        [store, persistMetadata, refresh, onError],
    );

    const purgeFromTrash = useCallback(
        async (trashId: string) => {
            try {
                await store.purge(trashId);
                await persistMetadata(withoutTrashEntry(metadataRef.current, trashId));
                setTrashedNotes((prev) => prev.filter((n) => n.id !== trashId));
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to delete note');
            }
        },
        [store, persistMetadata, onError],
    );

    const emptyTrash = useCallback(async () => {
        try {
            await store.emptyTrash();
            await persistMetadata(withTrashEmptied(metadataRef.current));
            setTrashedNotes([]);
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to empty the Trash');
        }
    }, [store, persistMetadata, onError]);

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
            bumpInList(id, loaded.updatedAt, loaded.content);
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
            bumpInList(conflict.id, meta.updatedAt, content);
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
                const [list, folderList, raw, trashList] = await Promise.all([
                    store.list(),
                    store.listFolders(),
                    store.readMetadata(),
                    store.listTrash(),
                ]);
                if (cancelled) return;
                const meta = reconcile(raw, [...list.map((n) => n.id), ...folderList], {
                    recursive: store.listsRecursively,
                });
                let loaded: Note | null = null;
                if (meta.active) {
                    try {
                        loaded = await store.get(meta.active);
                    } catch {
                        loaded = null;
                    }
                }
                if (cancelled) return;
                // Reconcile the trash registry against the actual `.trash/` so the badge count is right
                // from the first render (drop vanished entries, adopt orphan files) + publish the list.
                const {trashed, display} = buildTrashView(meta.trashed, trashList);
                const reconciled: NotesMetadata = {
                    ...meta,
                    active: loaded ? meta.active : null,
                    trashed,
                };
                setNotes(list);
                setFolders(folderList);
                setTrashedNotes(display);
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
            if (!id || conflict || pendingRef.current || moveInProgressRef.current) return;
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
        folders,
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
        duplicate,
        rename,
        move,
        remove,
        trash,
        trashedNotes,
        trashCount: metadata.trashed.length,
        refreshTrash,
        restoreFromTrash,
        purgeFromTrash,
        emptyTrash,
        createFolder,
        removeFolder,
        moveFolder,
        edit,
        flushPending: flush,
        refresh,
        reloadDisk,
        keepMine,
        saveAsCopy,
        discard,
    };
}
