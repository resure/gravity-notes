/**
 * Storage abstraction for notes.
 *
 * v1 is backed by the File System Access API (`FileSystemNoteStore`), where each
 * note is a single `.md` file on disk. Later phases can provide alternative
 * implementations of this same interface — an Electron `fs`-backed store, or an
 * HTTP `ApiStore` for backend sync — without touching the UI.
 *
 * The interface is intentionally free of any File-System-specific types so those
 * swaps stay drop-in.
 */

/** Lightweight descriptor for the notes list (no body loaded). */
export interface NoteMeta {
    /** Stable identifier. For the FS store this is the file name (e.g. `Ideas.md`). */
    id: string;
    /** Human-readable title (file name without the `.md` extension). */
    title: string;
    /** Last-modified time in epoch milliseconds, when the backend can provide it. */
    updatedAt?: number;
    /** Short plain-text snippet of the body, for the list preview (Apple-Notes style). */
    preview?: string;
}

/** A full note, including its markdown body. */
export interface Note extends NoteMeta {
    /** Markdown source. */
    content: string;
}

/**
 * A trashed note for the trash view: the backend's trash-location meta (`listTrash()`) enriched with
 * the original folder + deletion time from the {@link NotesMetadata.trashed} registry.
 */
export interface TrashedNote extends NoteMeta {
    /** Original folder the note was deleted from (`''` = root). */
    originalPath: string;
    /** Deletion time (epoch ms). */
    trashedAt: number;
}

/** Descriptor for one stored media attachment (for the management view). */
export interface AttachmentMeta {
    /** Stable `Attachments/<name>` reference — the string a note's Markdown carries as the img src. */
    ref: string;
    /** File name leaf (e.g. `photo.png`). */
    name: string;
    /** Size in bytes. */
    size: number;
    /** Last-modified epoch ms, when the backend can provide it. */
    updatedAt?: number;
}

/** How the note list is ordered. */
export type SortMode = 'updated' | 'title' | 'title-desc' | 'created';

/**
 * Registry entry for one trashed note. The bytes live in the backend's `.trash/` area (keyed by the
 * entry's `id`); this records what the backend can't infer — where the note came from and when it was
 * deleted — so the trash view can show "deleted X ago" and restore it to its original folder.
 */
export interface TrashEntry {
    /** Trash-location id (`.trash/<leaf>.md`) — the handle passed to `restore`/`purge`. */
    id: string;
    /** Display title at deletion time (the original leaf, sans `.md`). */
    title: string;
    /** Original folder the note was deleted from (`''` = root), where `restore` sends it back. */
    originalPath: string;
    /** Deletion time (epoch ms). */
    trashedAt: number;
    /** The note's original creation stamp, preserved so a restore can reinstate it (undefined if none). */
    created?: number;
    /** The note's icon (component name or emoji), preserved so a restore can reinstate it (undefined if none). */
    icon?: string;
}

/** Per-folder notes metadata, persisted alongside the notes (not in any note body). */
export interface NotesMetadata {
    /** Schema version for forward-compatibility. */
    version: 1;
    /** Active sort mode. */
    sort: SortMode;
    /** Pinned note ids. Treated as a membership set; array order is not significant. */
    pinned: readonly string[];
    /** Note id → creation time (epoch ms), stamped on create. */
    created: Readonly<Record<string, number>>;
    /**
     * Note id → icon: a Gravity component name (e.g. `"Star"`) or a literal emoji character
     * (e.g. `"⭐"`). Absent id = default File icon.
     */
    icons: Readonly<Record<string, string>>;
    /** The single open / last-open note id, or null when none is open. Restored on reload. */
    active: string | null;
    /**
     * Trashed-note registry: original folder + deletion time per trashed note. The backend owns the
     * trashed bytes (under `.trash/`); this supplies the metadata it can't derive. The displayed
     * trash list comes from `listTrash()` (authoritative for existence) enriched by these entries.
     */
    trashed: readonly TrashEntry[];
}

export interface NoteStore {
    /** List all notes, typically sorted by most-recently-updated. */
    list(): Promise<NoteMeta[]>;
    /**
     * Load every note with its full content, in a single pass (one IndexedDB read / one directory
     * scan). Feeds the in-memory full-text search index, which lives above the storage seam so
     * ranking stays backend-agnostic. Order is not significant (results are ranked by relevance).
     */
    getAll(): Promise<Note[]>;
    /** Load a single note's full content. */
    get(id: string): Promise<Note>;
    /**
     * Create a new, empty note with a unique title and return its meta.
     * @param title preferred title; the store resolves collisions (e.g. "Untitled 2").
     * @param parentPath POSIX-relative folder to create the note in; omitted or `''` means the
     *   root. The collision probe is scoped to that folder, so the same title is free in different
     *   folders.
     */
    create(title: string, parentPath?: string): Promise<NoteMeta>;
    /**
     * Persist the body of an existing note using optimistic concurrency, where
     * `baseUpdatedAt` is the `updatedAt` the caller last saw for this note.
     * Returns the note's new meta (with the post-write `updatedAt`); throws
     * `ConflictError` if the file's on-disk `lastModified` differs from `baseUpdatedAt`.
     */
    save(id: string, content: string, baseUpdatedAt: number): Promise<NoteMeta>;
    /**
     * Rename a note. Returns the new meta (the id may change, e.g. for file-backed
     * stores where the id is derived from the file name). Throws {@link NameCollisionError}
     * when the target name is already taken by another note.
     */
    rename(id: string, nextTitle: string): Promise<NoteMeta>;
    /**
     * Relocate a note into `destFolder` (a POSIX-relative folder; `''` means the root), keeping its
     * leaf title — so its id changes from the old path to `<destFolder>/<Title>.md`. A move into the
     * folder it already lives in is a no-op. Returns the new meta with the post-move `updatedAt`, so
     * the caller can re-seed its conflict baseline. Throws {@link NameCollisionError} when a note
     * with that leaf already exists in `destFolder`, and a `NotFoundError` `DOMException` when the
     * source is gone (mapped to a deleted-conflict, exactly like `get`).
     */
    move(id: string, destFolder: string): Promise<NoteMeta>;
    /** Permanently delete a note. (The UI routes deletes through `trash` instead.) */
    remove(id: string): Promise<void>;
    /**
     * Soft-delete a note: move its file into the backend's `.trash/` area, resolving name collisions
     * there, and return its new trash-location id (`.trash/<leaf>.md`). The note leaves the listing,
     * the folder tree, and the search corpus (`.trash/` is excluded everywhere). The original folder
     * and deletion time are recorded by the caller in {@link NotesMetadata.trashed}, not on disk.
     */
    trash(id: string): Promise<string>;
    /**
     * List every trashed note (its `.trash/<leaf>.md` id, title, mtime, and a preview snippet). The
     * authoritative source for what is in the trash; the caller enriches each with the original folder
     * and deletion time from {@link NotesMetadata.trashed}. Empty when the trash is empty.
     */
    listTrash(): Promise<NoteMeta[]>;
    /**
     * Restore a trashed note (by its trash-location id) into `destFolder` (`''` = root), re-creating
     * that folder if it was removed meanwhile and resolving a name collision by uniquifying the leaf.
     * Returns the restored note's new live meta (with its post-restore `updatedAt`). Throws a
     * `NotFoundError` `DOMException` when the trashed file is already gone.
     */
    restore(trashId: string, destFolder: string): Promise<NoteMeta>;
    /** Permanently delete one trashed note by its trash-location id; a missing one is a no-op. */
    purge(trashId: string): Promise<void>;
    /** Permanently delete every trashed note (empty the trash). */
    emptyTrash(): Promise<void>;
    /**
     * Store a binary media attachment under the root `Attachments/` folder, resolving name
     * collisions (`foo.png` → `foo 2.png`). Returns its stable, root-relative reference
     * (`Attachments/foo.png`) — the exact string written into a note's Markdown as the image `src`.
     */
    writeAttachment(file: File): Promise<string>;
    /**
     * Write an attachment at an *exact* `Attachments/<name>` reference, overwriting any existing file
     * there (no unique-name resolution). Used by import/restore, where renaming would orphan the
     * `![](Attachments/<name>)` references in the notes being imported alongside it.
     */
    writeAttachmentAt(ref: string, blob: Blob): Promise<void>;
    /**
     * Read an attachment's bytes for display, by its `Attachments/<name>` reference. Throws a
     * `NotFoundError` `DOMException` when the attachment is gone. The caller turns the `Blob` into a
     * displayable object URL.
     */
    readAttachment(ref: string): Promise<Blob>;
    /** List every stored attachment (for the management view); empty when there are none. */
    listAttachments(): Promise<AttachmentMeta[]>;
    /** Delete an attachment by its `Attachments/<name>` reference; a missing attachment is a no-op. */
    removeAttachment(ref: string): Promise<void>;
    /**
     * Create an (initially empty) folder at `parentPath`/`name` and return its POSIX path. A
     * deliberately-empty folder persists — a `.gnkeep` marker on disk, or a marker entry in-browser
     * — so the auto-prune of emptied folders never destroys one the user created on purpose.
     * Returns the existing path if it already exists.
     */
    createFolder(parentPath: string, name: string): Promise<string>;
    /** Remove an empty folder's marker (the caller ensures it holds no notes). */
    removeFolder(path: string): Promise<void>;
    /**
     * Move (or rename) a folder: re-home every note and marker under `fromPath` so it lives under
     * `toPath` instead (`fromPath/Sub/Note.md` → `toPath/Sub/Note.md`). A rename is the same op with
     * `toPath` keeping `fromPath`'s parent; a reparent changes the parent. Throws
     * {@link NameCollisionError} when `toPath` already exists, and is a no-op when `fromPath === toPath`.
     * The caller re-prefixes the metadata (pins / created / active) via `withReprefixed`.
     */
    moveFolder(fromPath: string, toPath: string): Promise<void>;
    /**
     * Every folder path (POSIX), including deliberately-empty ones, for rendering the tree. Folders
     * implied by a note's path are included alongside explicitly-created empty ones.
     */
    listFolders(): Promise<string[]>;
    /**
     * Reveal a note, folder, or attachment in the OS file manager (macOS Finder), by its store id,
     * folder path, or `Attachments/<name>` ref. Present only on the native desktop backend, where
     * notes are real files on disk — callers feature-detect it (`store.reveal`) and hide the
     * affordance on the web / in-browser backends, which have no file to reveal.
     */
    reveal?(relPath: string): Promise<void>;
    /** Current `lastModified` for a note, or `null` if it no longer exists. */
    stat(id: string): Promise<number | null>;
    /** Read the folder's notes metadata (sort, pins, created times); defaults if absent or corrupt. */
    readMetadata(): Promise<NotesMetadata>;
    /** Persist the folder's notes metadata. */
    writeMetadata(meta: NotesMetadata): Promise<void>;
    /**
     * Whether `list`/`getAll` enumerate notes in *every* subdirectory (true), or only the top level
     * (false). Consumed by metadata reconciliation: a backend that cannot yet see nested notes must
     * never let `reconcile` prune their metadata from the shared sidecar. Flips to true on a backend
     * once its listing recurses.
     */
    readonly listsRecursively: boolean;
}

/** Thrown by {@link NoteStore.save} when the file changed on disk since the baseline. */
export class ConflictError extends Error {
    constructor(
        readonly id: string,
        readonly diskUpdatedAt: number,
    ) {
        super(`"${id}" changed on disk`);
        this.name = 'ConflictError';
    }
}

/** Thrown by {@link NoteStore.rename} when the target name is already taken by another note. */
export class NameCollisionError extends Error {
    constructor(
        readonly id: string,
        readonly name: string,
    ) {
        super(`A note named "${name}" already exists`);
        this.name = 'NameCollisionError';
    }
}
