import {parseMetadata} from './metadata';
import {
    MD_EXT,
    PREVIEW_SCAN_BYTES,
    canonicalBody,
    previewFromContent,
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

    async create(title: string): Promise<NoteMeta> {
        const id = await uniqueName(sanitizeTitle(title), (name) => this.exists(name));
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
        const nextId = base + MD_EXT;
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

    async remove(id: string): Promise<void> {
        await this.run(NOTES_STORE, 'readwrite', (store) => store.delete(id));
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
