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

/** How the note list is ordered. */
export type SortMode = 'updated' | 'title' | 'title-desc' | 'created';

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
    /** The single open / last-open note id, or null when none is open. Restored on reload. */
    active: string | null;
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
     */
    create(title: string): Promise<NoteMeta>;
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
    /** Delete a note. */
    remove(id: string): Promise<void>;
    /** Current `lastModified` for a note, or `null` if it no longer exists. */
    stat(id: string): Promise<number | null>;
    /** Read the folder's notes metadata (sort, pins, created times); defaults if absent or corrupt. */
    readMetadata(): Promise<NotesMetadata>;
    /** Persist the folder's notes metadata. */
    writeMetadata(meta: NotesMetadata): Promise<void>;
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
