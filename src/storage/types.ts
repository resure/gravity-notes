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
}

/** A full note, including its markdown body. */
export interface Note extends NoteMeta {
    /** Markdown source. */
    content: string;
}

/** How the note list is ordered. */
export type SortMode = 'updated' | 'title' | 'created';

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
}

export interface NoteStore {
    /** List all notes, typically sorted by most-recently-updated. */
    list(): Promise<NoteMeta[]>;
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
     * stores where the id is derived from the file name).
     */
    rename(id: string, nextTitle: string): Promise<NoteMeta>;
    /** Delete a note. */
    remove(id: string): Promise<void>;
    /** Current `lastModified` for a note, or `null` if it no longer exists. */
    stat(id: string): Promise<number | null>;
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
