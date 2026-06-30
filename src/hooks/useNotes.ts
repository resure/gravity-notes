import {useCallback, useEffect, useRef, useState} from 'react';

import {isTauri} from '../isTauri';
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
import {TimeoutError, withTimeout} from '../timeout';

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
/**
 * Coalesce the metadata sidecar's disk-write for active-pointer changes. Browsing previews a note on
 * every arrow key, each of which would otherwise rewrite the whole sidecar (a JSON that grows with the
 * collection — a `created` stamp per note + pins). The in-memory state still updates immediately; only
 * the disk write is throttled, and it's flushed on teardown so the last-previewed note is remembered.
 */
const ACTIVE_PERSIST_DELAY = 400;
/** Ceil a single backend write so a hung save can't block every note op indefinitely. */
const SAVE_TIMEOUT_MS = 15_000;
/** Retry a transient save failure a few times (capped backoff) before leaving it to the user. */
const MAX_SAVE_RETRIES = 5;
const RETRY_MAX_DELAY = 30_000;

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
    /**
     * Force-write any pending edit now (used before tearing the workspace down, e.g. folder change).
     * Resolves to `true` when an unresolved conflict still holds the unsaved content (so a teardown
     * caller can confirm the loss first), `false` when nothing remains in conflict.
     */
    flushPending(): Promise<boolean>;
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

    // Throttle for the active-pointer sidecar write (see ACTIVE_PERSIST_DELAY). `dirty` marks a
    // deferred write owed; `timer` is the in-flight throttle window.
    const metaWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const metaWriteDirtyRef = useRef(false);

    /** Write the latest in-memory metadata to disk now, clearing any pending throttled write. */
    const writeMetadataNow = useCallback(async () => {
        metaWriteDirtyRef.current = false;
        if (metaWriteTimerRef.current) {
            clearTimeout(metaWriteTimerRef.current);
            metaWriteTimerRef.current = null;
        }
        try {
            await store.writeMetadata(metadataRef.current);
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to save notes metadata');
        }
    }, [store, onError]);

    const persistMetadata = useCallback(
        async (next: NotesMetadata, options?: {defer?: boolean}) => {
            applyMetadata(next); // always update in-memory state immediately
            if (options?.defer) {
                // Hot path (active-pointer change on every browse): debounce the disk write. TRAILING
                // debounce — reset the window on each browse, so a continuous scroll through a big
                // folder writes the sidecar ONCE after it settles, not once per ACTIVE_PERSIST_DELAY
                // for the whole burst. Each write re-serializes the entire sidecar (a `created` stamp
                // per note), so on a large collection the old fixed-interval firing was real write
                // amplification. In-memory state still updates immediately above; a teardown flush
                // (flushMetadata) still persists the last-previewed note if you leave mid-window.
                metaWriteDirtyRef.current = true;
                if (metaWriteTimerRef.current) clearTimeout(metaWriteTimerRef.current);
                metaWriteTimerRef.current = setTimeout(() => {
                    metaWriteTimerRef.current = null;
                    if (metaWriteDirtyRef.current) void writeMetadataNow();
                }, ACTIVE_PERSIST_DELAY);
                return;
            }
            // A deliberate mutation writes the whole (latest) metadata now — which also satisfies and
            // cancels any pending deferred active-write (writeMetadataNow clears the throttle timer).
            await writeMetadataNow();
        },
        [applyMetadata, writeMetadataNow],
    );

    /** Force any deferred metadata write to disk now — for teardown / before a storage switch. */
    const flushMetadata = useCallback((): Promise<void> => {
        return metaWriteDirtyRef.current ? writeMetadataNow() : Promise.resolve();
    }, [writeMetadataNow]);

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
    /** Backoff retry counter for a transient save failure; reset on success and on a fresh edit. */
    const retryRef = useRef(0);
    /** Latest `flush`, so it can re-arm its own retry timer without a circular `useCallback` dep. */
    const flushRef = useRef<() => Promise<boolean>>(async () => false);
    /** Latest `conflict`, read inside the long-lived window listeners so they needn't re-subscribe. */
    const conflictRef = useRef<NoteConflict | null>(null);

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
        // NOTE: refresh() deliberately does NOT re-stat `.trash/`. The trash registry (and thus the
        // `trashCount` badge) is kept in sync in-memory by the trash mutations (withTrashed /
        // withoutTrashEntry / …), and refresh() runs after every note/folder op — folding a
        // listTrash() in here would add a full trash walk to each of those. An *external* `.trash/`
        // change (e.g. files removed on disk) is reconciled lazily by refreshTrash() when the trash
        // view next opens, not on every refresh.
    }, [store, applyMetadata]);

    // Re-read just the folder list after an incremental note patch. On the folder backends this is a
    // cheap directory walk (no per-file reads, unlike the full list() in refresh()), so an emptied
    // folder pruned on disk drops out of the tree and a newly-created one appears — without paying to
    // re-read every note. Metadata stays consistent via the with* helpers the mutation already applied,
    // so no reconcile is needed here (an orphaned implicit-folder pin, rare, self-heals on reload).
    const relistFolders = useCallback(async () => {
        setFolders(await store.listFolders());
    }, [store]);

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

    // Incremental list patches: a single-note mutation already knows exactly what changed, so patch
    // the in-memory list directly instead of re-reading the whole folder from disk via refresh()
    // (which on a big folder re-reads the head of every `.md` file on every create/rename/move/delete).
    // Folders need no patch — the tree synthesizes a folder from its notes' paths, so a moved/created
    // note's folder appears/disappears automatically, and explicit (`.gnkeep`) folders are unaffected
    // by note moves. Metadata stays consistent via the with* helpers each handler already applies.
    /** Append a freshly-created note to the list (preview derived from its initial body). */
    const addNote = useCallback((meta: NoteMeta, content = '') => {
        setNotes((prev) => [...prev, {...meta, preview: previewFromContent(content)}]);
    }, []);
    /** Re-key a note after a rename/move (id + title + mtime change; body/preview unchanged). */
    const rekeyNote = useCallback((oldId: string, meta: NoteMeta) => {
        setNotes((prev) =>
            prev.map((n) =>
                n.id === oldId
                    ? {...n, id: meta.id, title: meta.title, updatedAt: meta.updatedAt}
                    : n,
            ),
        );
    }, []);
    /** Drop a note from the list after a delete/trash. */
    const dropNote = useCallback((id: string) => {
        setNotes((prev) => prev.filter((n) => n.id !== id));
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
        // Resolves to whether an UNRESOLVED CONFLICT still holds unsaved content after the flush, so a
        // teardown caller (e.g. change-storage) can confirm before discarding it. Returning the value
        // from each branch avoids the stale-closure trap of reading `conflict` state right after await.
        if (!pending) return conflictRef.current !== null;
        pendingRef.current = null;
        // Hold the raw save promise so a timeout below can still reconcile our baseline if it later
        // succeeds in the background (the underlying write can't be cancelled — it keeps running).
        const savePromise = store.save(pending.id, pending.content, baselineRef.current ?? 0);
        try {
            // Ceil the write so a hung backend (a stuck FSA permission prompt, a wedged IPC call)
            // can't freeze every lifecycle transition that awaits flush().
            const meta = await withTimeout(savePromise, SAVE_TIMEOUT_MS, 'Save');
            baselineRef.current = meta.updatedAt ?? null;
            retryRef.current = 0;
            setSaveState('saved');
            bumpInList(pending.id, meta.updatedAt, pending.content);
            return false; // saved cleanly — no conflict
        } catch (err) {
            // A timed-out save still settles in the background: if it eventually succeeds, the disk
            // mtime advanced but baselineRef didn't, so the focus/visibility check (or the re-armed
            // retry below, racing the same file) would raise a phantom conflict. Reconcile the
            // baseline when the original promise resolves — guarded to the still-open note, only
            // advancing it (never downgrading a fresher baseline a newer save already set).
            if (err instanceof TimeoutError) {
                void savePromise.then(
                    (meta) => {
                        const next = meta.updatedAt ?? null;
                        if (
                            metadataRef.current.active === pending.id &&
                            conflictRef.current === null &&
                            next !== null &&
                            (baselineRef.current === null || next > baselineRef.current)
                        ) {
                            baselineRef.current = next;
                        }
                    },
                    () => {}, // a true failure is left to the retry path below
                );
            }
            // Restore the snapshot only if no newer keystroke landed during the await — otherwise
            // the newer edit (already in pendingRef, with its own timer) must win, not be clobbered.
            if (pendingRef.current === null) pendingRef.current = pending;
            if (err instanceof ConflictError) {
                setConflict({id: err.id, diskUpdatedAt: err.diskUpdatedAt, deleted: false});
                setSaveState('conflict');
                return true; // unresolved conflict still holds the unsaved edit
            } else if (err instanceof DOMException && err.name === 'NotFoundError') {
                setConflict({id: pending.id, diskUpdatedAt: 0, deleted: true});
                setSaveState('conflict');
                return true; // note deleted out from under us; the edit is unsaved
            } else {
                setSaveState('error');
                // Surface the failure once per burst; then retry with capped backoff so a transient
                // write error self-heals instead of stranding the edit until the next keystroke.
                if (retryRef.current === 0) {
                    onError(err instanceof Error ? err.message : 'Failed to save note');
                }
                if (pendingRef.current && retryRef.current < MAX_SAVE_RETRIES) {
                    retryRef.current += 1;
                    const delay = Math.min(AUTOSAVE_DELAY * 2 ** retryRef.current, RETRY_MAX_DELAY);
                    timerRef.current = setTimeout(() => void flushRef.current(), delay);
                }
            }
            // A non-conflict error re-queues + retries the edit; there's no conflict to confirm here.
            return false;
        }
    }, [store, onError, bumpInList, clearTimer]);

    // Keep the schedule target current so flush can re-arm its own retry without a circular dep.
    useEffect(() => {
        flushRef.current = flush;
    }, [flush]);

    // Teardown flush (exposed): force out any pending content edit AND the deferred active-pointer
    // write, so switching storage / exporting / closing never drops the last edit or open-note pointer.
    const flushPending = useCallback(async (): Promise<boolean> => {
        await flushMetadata();
        return flush();
    }, [flush, flushMetadata]);

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
                // Drop an edit re-queued for the outgoing note during the load gap (or restored by a
                // failed flush): it would otherwise flush later against this note's baseline and raise
                // a spurious conflict. Matches the conflict-on-navigate abandon behavior.
                if (pendingRef.current && pendingRef.current.id !== id) {
                    pendingRef.current = null;
                    clearTimer();
                }
                setNote(loaded);
                bumpSession();
                setConflict(null);
                setSaveState('idle');
                // Defer the sidecar write: open() fires on every browse/preview, and the active
                // pointer is pure UI-restoration state — coalesce its disk write (flushed on teardown).
                await persistMetadata(withActive(metadataRef.current, id), {defer: true});
            } catch (err) {
                if (generation !== openGenerationRef.current) return;
                onError(err instanceof Error ? err.message : 'Failed to open note');
            }
        },
        [flush, store, persistMetadata, onError, bumpSession, clearTimer],
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
                addNote(meta); // brand-new note → empty preview
                await relistFolders(); // a new note may introduce a new (implicit) folder
                await open(meta.id);
                return meta.id;
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to create note');
                return null;
            }
        },
        [flush, store, persistMetadata, addNote, relistFolders, open, onError],
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
                // Preview the copied body; carry the post-save mtime so the list date is right.
                addNote({...meta, updatedAt: saved.updatedAt}, source.content);
                await relistFolders(); // the copy lands in the same folder, but stay consistent
                await open(meta.id); // open after the body is written, so the editor shows the copy
                return meta.id;
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to duplicate note');
                return null;
            }
        },
        [flush, store, persistMetadata, addNote, relistFolders, open, onError],
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
                // A no-op rename (same leaf): nothing re-keys on disk, so just report the id.
                if (meta.id === id) return meta.id;
                const wasActive = metadataRef.current.active === id;
                // A keystroke during the flush/rename await may have re-queued an edit for the renamed
                // note (the editor stays live — no remount). Kill its timer so it can't flush against
                // the old, now-gone id; we carry it over and re-arm below — exactly like move().
                const pendingForRenamed = pendingRef.current?.id === id;
                if (pendingForRenamed) clearTimer();
                // Reconcile identity in a fixed order so any edit() racing the persist below reads a
                // consistent (new) id. The editor instance is kept (no sessionId bump), so the
                // caret/focus survive the rename — like move(), keeping the in-memory body.
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
                if (pendingForRenamed) {
                    // Carry the in-flight keystrokes to the new id (do NOT drop them, even if the
                    // preceding flush failed) and re-arm a fresh autosave so they still get written.
                    pendingRef.current = {id: meta.id, content: pendingRef.current?.content ?? ''};
                    clearTimer();
                    setSaveState('saving');
                    timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DELAY);
                }
                rekeyNote(id, meta); // re-key the list row in place (body/preview unchanged)
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
        [conflict, flush, store, persistMetadata, rekeyNote, clearTimer, onError],
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
                rekeyNote(id, meta); // re-key the list row in place; folder synthesizes from the path
                await relistFolders(); // dest folder may be new; emptied source folder may be pruned
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
        [conflict, flush, store, persistMetadata, rekeyNote, relistFolders, clearTimer, onError],
    );

    const remove = useCallback(
        async (id: string) => {
            // Flush first so a pending edit to a *different* note isn't stranded (and to match
            // open/create/rename/close, which all flush).
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
                dropNote(id); // drop the list row
                await relistFolders(); // an emptied implicit folder is pruned on disk → drop it too
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to delete note');
            }
        },
        [flush, store, persistMetadata, dropNote, relistFolders, clearTimer, onError],
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
                dropNote(id); // drop the list row
                await relistFolders(); // an emptied implicit folder is pruned on disk → drop it too
                return true;
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to move note to Trash');
                return false;
            }
        },
        [conflict, flush, store, persistMetadata, dropNote, relistFolders, clearTimer, onError],
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
            retryRef.current = 0; // a fresh edit is a fresh save attempt
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
                const recreated = await store.create(note?.title ?? 'Note', dirname(conflict.id));
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
            const copy = await store.create(`${title} (conflicted copy)`, dirname(conflict.id));
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

    // Clear pending timers (autosave + the throttled metadata write) when the hook unmounts.
    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            if (metaWriteTimerRef.current) clearTimeout(metaWriteTimerRef.current);
        };
    }, []);

    // Mirror `conflict` into a ref so the long-lived window listeners below read the latest value
    // without re-subscribing (and churning the beforeunload handler) on every conflict change.
    useEffect(() => {
        conflictRef.current = conflict;
    }, [conflict]);

    // Best-effort save when hidden; warn before unload if edits are unsaved.
    useEffect(() => {
        const onHide = () => {
            void flushMetadata(); // persist the last-previewed note pointer too
            void flush();
        };
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            // Capture intent BEFORE flushing: flush() nulls pendingRef synchronously (an async fn
            // runs to its first await), so checking it after would always read null and the prompt
            // would never fire for a normal pending edit.
            const hasUnsaved = Boolean(pendingRef.current || conflictRef.current);
            void flushMetadata();
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
    }, [flush, flushMetadata]);

    // Desktop (Tauri) only: hiding/closing the native window doesn't fire a reliable
    // `beforeunload`, so flush the last debounced edit on the window's close request. Feature-detect
    // the shell and load the API via dynamic import() so neither enters the web bundle.
    useEffect(() => {
        if (!isTauri) return undefined;
        let unlisten: (() => void) | undefined;
        let disposed = false;
        void import('@tauri-apps/api/window').then(({getCurrentWindow}) => {
            void getCurrentWindow()
                .onCloseRequested(async () => {
                    await flushMetadata();
                    await flush();
                })
                .then((fn) => {
                    if (disposed) fn();
                    else unlisten = fn;
                });
        });
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, [flush, flushMetadata]);

    // Detect an external change to the open note when returning to the tab/window.
    useEffect(() => {
        const check = async () => {
            if (document.visibilityState !== 'visible') return;
            const id = metadataRef.current.active;
            if (!id || conflictRef.current || pendingRef.current || moveInProgressRef.current)
                return;
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
    }, [store]);

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
        flushPending,
        refresh,
        reloadDisk,
        keepMine,
        saveAsCopy,
        discard,
    };
}
