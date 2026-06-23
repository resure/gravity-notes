import {parseMetadata} from './metadata';
import {
    MD_EXT,
    PREVIEW_SCAN_BYTES,
    basename,
    canonicalBody,
    dirname,
    joinPath,
    previewFromContent,
    sanitizeDir,
    sanitizeSegment,
    sanitizeTitle,
    stripTrailingNewlines,
    titleFromFileName,
    uniqueName,
} from './noteText';
import {
    ConflictError,
    NameCollisionError,
    type Note,
    type NoteMeta,
    type NoteStore,
    type NotesMetadata,
} from './types';

const DB_NAME = 'gravity-notes-data';
const DB_VERSION = 1;
const NOTES_STORE = 'notes';
const KV_STORE = 'kv';
const METADATA_KEY = 'metadata';
/** KV key holding the list of deliberately-empty folder paths (no real directories in-browser). */
const FOLDERS_KEY = 'folders';

/** One note row. `content` is stored in the canonical "blank line at EOF" shape, like the FS store. */
interface NoteRecord {
    id: string;
    content: string;
    updatedAt: number;
}

function notFound(id: string): DOMException {
    return new DOMException(`"${id}" not found`, 'NotFoundError');
}

/** Strictly-increasing timestamp, so two saves in the same millisecond still bump the baseline. */
function nextTimestamp(previous: number): number {
    const now = Date.now();
    return now > previous ? now : previous + 1;
}

/**
 * In-browser `NoteStore` backed by IndexedDB, for browsers without the File System Access API
 * (Firefox/Safari) and for users who choose in-browser storage. Mirrors `FileSystemNoteStore`'s
 * semantics — `<Title>.md` ids, canonical body shape, `updatedAt`-based optimistic concurrency
 * (`ConflictError`), and `NotFoundError` on a missing note — so the rest of the app is identical
 * regardless of backend. Notes are opaque here; use export/import (transfer.ts) to get plain `.md`.
 */
export class IndexedDbNoteStore implements NoteStore {
    /** getAll()/list() read every record by key, so nested (slash-bearing) ids are always seen. */
    readonly listsRecursively = true;

    private dbPromise: Promise<IDBDatabase> | null = null;

    async list(): Promise<NoteMeta[]> {
        const records = await this.run<NoteRecord[]>(
            NOTES_STORE,
            'readonly',
            (store) => store.getAll() as IDBRequest<NoteRecord[]>,
        );
        const metas: NoteMeta[] = records.map((record) => ({
            id: record.id,
            title: titleFromFileName(record.id),
            updatedAt: record.updatedAt,
            preview: previewFromContent(
                stripTrailingNewlines(record.content).slice(0, PREVIEW_SCAN_BYTES),
            ),
        }));
        metas.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        return metas;
    }

    async getAll(): Promise<Note[]> {
        const records = await this.run<NoteRecord[]>(
            NOTES_STORE,
            'readonly',
            (store) => store.getAll() as IDBRequest<NoteRecord[]>,
        );
        return records.map((record) => ({
            id: record.id,
            title: titleFromFileName(record.id),
            updatedAt: record.updatedAt,
            // Stripped to match get()/the editor's serialized shape (parity for the search corpus).
            content: stripTrailingNewlines(record.content),
        }));
    }

    async get(id: string): Promise<Note> {
        const record = await this.getRecord(id);
        if (!record) throw notFound(id);
        return {
            id,
            title: titleFromFileName(id),
            updatedAt: record.updatedAt,
            // Strip so the in-memory body matches what the editor serializes (parity with FS get()).
            content: stripTrailingNewlines(record.content),
        };
    }

    async create(title: string, parentPath = ''): Promise<NoteMeta> {
        const dir = sanitizeDir(parentPath);
        // Scope the collision probe to the target folder, so the same leaf title is free elsewhere.
        const leaf = await uniqueName(sanitizeTitle(title), (name) =>
            this.exists(joinPath(dir, name)),
        );
        const id = joinPath(dir, leaf);
        const updatedAt = Date.now();
        await this.run(NOTES_STORE, 'readwrite', (store) =>
            store.add({id, content: canonicalBody(''), updatedAt} satisfies NoteRecord),
        );
        return {id, title: titleFromFileName(id), updatedAt};
    }

    async save(id: string, content: string, baseUpdatedAt: number): Promise<NoteMeta> {
        const record = await this.getRecord(id);
        if (!record) throw notFound(id);
        if (record.updatedAt !== baseUpdatedAt) {
            throw new ConflictError(id, record.updatedAt);
        }
        const updatedAt = nextTimestamp(record.updatedAt);
        await this.run(NOTES_STORE, 'readwrite', (store) =>
            store.put({id, content: canonicalBody(content), updatedAt} satisfies NoteRecord),
        );
        return {id, title: titleFromFileName(id), updatedAt};
    }

    async stat(id: string): Promise<number | null> {
        const record = await this.getRecord(id);
        return record ? record.updatedAt : null;
    }

    async rename(id: string, nextTitle: string): Promise<NoteMeta> {
        const base = sanitizeTitle(nextTitle);
        // Rename is leaf-only: re-join the new leaf onto the note's own folder so it stays put.
        const nextId = joinPath(dirname(id), base + MD_EXT);
        if (nextId === id) {
            return {id, title: titleFromFileName(id)};
        }
        // IndexedDB keys are case-sensitive and exact, so a case-only rename is just a key change —
        // no temp-file dance is needed (unlike the case-insensitive filesystem store).
        if (await this.exists(nextId)) {
            throw new NameCollisionError(id, base);
        }
        const record = await this.getRecord(id);
        if (!record) throw notFound(id);
        const updatedAt = nextTimestamp(record.updatedAt);
        // Write the new key and delete the old one in a single transaction (atomic rename).
        await this.run(NOTES_STORE, 'readwrite', (store) => {
            store.put({id: nextId, content: record.content, updatedAt} satisfies NoteRecord);
            return store.delete(id);
        });
        return {id: nextId, title: titleFromFileName(nextId), updatedAt};
    }

    async move(id: string, destFolder: string): Promise<NoteMeta> {
        const newId = joinPath(sanitizeDir(destFolder), basename(id));
        const record = await this.getRecord(id);
        if (!record) throw notFound(id);
        // Already in the target folder: a pure no-op, preserving the current mtime.
        if (newId === id) {
            return {id, title: titleFromFileName(id), updatedAt: record.updatedAt};
        }
        if (await this.exists(newId)) {
            throw new NameCollisionError(id, titleFromFileName(id));
        }
        // Pure relocation: content and mtime are unchanged, so the re-seeded conflict baseline still
        // matches the moved record. Write the new key and delete the old one in one transaction.
        const updatedAt = record.updatedAt;
        await this.run(NOTES_STORE, 'readwrite', (store) => {
            store.put({id: newId, content: record.content, updatedAt} satisfies NoteRecord);
            return store.delete(id);
        });
        return {id: newId, title: titleFromFileName(newId), updatedAt};
    }

    async remove(id: string): Promise<void> {
        await this.run(NOTES_STORE, 'readwrite', (store) => store.delete(id));
    }

    async createFolder(parentPath: string, name: string): Promise<string> {
        const path = joinPath(sanitizeDir(parentPath), sanitizeSegment(name));
        const folders = await this.readFolders();
        if (!folders.includes(path)) {
            await this.run(KV_STORE, 'readwrite', (store) =>
                store.put([...folders, path], FOLDERS_KEY),
            );
        }
        return path;
    }

    async removeFolder(path: string): Promise<void> {
        const folders = await this.readFolders();
        if (folders.includes(path)) {
            await this.run(KV_STORE, 'readwrite', (store) =>
                store.put(
                    folders.filter((f) => f !== path),
                    FOLDERS_KEY,
                ),
            );
        }
    }

    async listFolders(): Promise<string[]> {
        const records = await this.run<NoteRecord[]>(
            NOTES_STORE,
            'readonly',
            (store) => store.getAll() as IDBRequest<NoteRecord[]>,
        );
        // Folders implied by a note's path, plus the deliberately-empty (marker) folders.
        const folders = new Set<string>(await this.readFolders());
        for (const record of records) {
            for (let dir = dirname(record.id); dir; dir = dirname(dir)) {
                folders.add(dir);
            }
        }
        return [...folders].sort();
    }

    async readMetadata(): Promise<NotesMetadata> {
        const raw = await this.run<unknown>(KV_STORE, 'readonly', (store) =>
            store.get(METADATA_KEY),
        );
        return raw === undefined ? parseMetadata({}) : parseMetadata(raw);
    }

    async writeMetadata(meta: NotesMetadata): Promise<void> {
        await this.run(KV_STORE, 'readwrite', (store) => store.put(meta, METADATA_KEY));
    }

    private async readFolders(): Promise<string[]> {
        const raw = await this.run<unknown>(KV_STORE, 'readonly', (store) =>
            store.get(FOLDERS_KEY),
        );
        return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    }

    private openDb(): Promise<IDBDatabase> {
        if (!this.dbPromise) {
            this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(NOTES_STORE)) {
                        db.createObjectStore(NOTES_STORE, {keyPath: 'id'});
                    }
                    if (!db.objectStoreNames.contains(KV_STORE)) {
                        db.createObjectStore(KV_STORE);
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        return this.dbPromise;
    }

    /** Run a single object-store operation in its own transaction; resolves once it commits. */
    private async run<T>(
        storeName: string,
        mode: IDBTransactionMode,
        op: (store: IDBObjectStore) => IDBRequest<T>,
    ): Promise<T> {
        const db = await this.openDb();
        return new Promise<T>((resolve, reject) => {
            const transaction = db.transaction(storeName, mode);
            const request = op(transaction.objectStore(storeName));
            let result: T;
            request.onsuccess = () => {
                result = request.result;
            };
            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error ?? request.error);
            transaction.onabort = () =>
                reject(
                    transaction.error ??
                        new DOMException('IndexedDB transaction aborted', 'AbortError'),
                );
        });
    }

    private getRecord(id: string): Promise<NoteRecord | undefined> {
        return this.run<NoteRecord | undefined>(
            NOTES_STORE,
            'readonly',
            (store) => store.get(id) as IDBRequest<NoteRecord | undefined>,
        );
    }

    private async exists(id: string): Promise<boolean> {
        const key = await this.run<IDBValidKey | undefined>(
            NOTES_STORE,
            'readonly',
            (store) => store.getKey(id) as IDBRequest<IDBValidKey | undefined>,
        );
        return key !== undefined;
    }
}
