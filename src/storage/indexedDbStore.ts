import {parseMetadata} from './metadata';
import {
    ATTACHMENTS_DIR,
    MD_EXT,
    PREVIEW_SCAN_BYTES,
    TRASH_DIR,
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
    uniqueAttachmentName,
    uniqueName,
} from './noteText';
import {
    type AttachmentMeta,
    ConflictError,
    NameCollisionError,
    type Note,
    type NoteMeta,
    type NoteStore,
    type NotesMetadata,
} from './types';

const DB_NAME = 'gravity-notes-data';
const DB_VERSION = 3;
const NOTES_STORE = 'notes';
const KV_STORE = 'kv';
/** Object store holding binary media attachments, keyed by their `Attachments/<name>` reference. */
const ATTACHMENTS_STORE = 'attachments';
/**
 * Object store holding trashed (soft-deleted) notes, keyed by their `.trash/<leaf>.md` id — isolated
 * from {@link NOTES_STORE} so trashed rows never surface in `list`/`getAll`/`listFolders` (the
 * filesystem backends get this isolation for free from the dot-folder skip).
 */
const TRASH_STORE = 'trash';
const METADATA_KEY = 'metadata';
/** KV key holding the list of deliberately-empty folder paths (no real directories in-browser). */
const FOLDERS_KEY = 'folders';

/** One note row. `content` is stored in the canonical "blank line at EOF" shape, like the FS store. */
interface NoteRecord {
    id: string;
    content: string;
    updatedAt: number;
}

/** One attachment row: the `Attachments/<name>` reference key, the raw bytes, and its write time. */
interface AttachmentRecord {
    id: string;
    blob: Blob;
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

    async trash(id: string): Promise<string> {
        const record = await this.getRecord(id);
        if (!record) throw notFound(id);
        // Uniquify within the trash keyspace so two same-named notes can both be trashed.
        const leaf = await uniqueName(titleFromFileName(id), (name) =>
            this.keyExists(TRASH_STORE, joinPath(TRASH_DIR, name)),
        );
        const trashId = joinPath(TRASH_DIR, leaf);
        // Move the row from notes → trash in one transaction (content + mtime preserved).
        await this.runAcross([NOTES_STORE, TRASH_STORE], 'readwrite', (tx) => {
            tx.objectStore(TRASH_STORE).put({
                id: trashId,
                content: record.content,
                updatedAt: record.updatedAt,
            } satisfies NoteRecord);
            return tx.objectStore(NOTES_STORE).delete(id);
        });
        return trashId;
    }

    async listTrash(): Promise<NoteMeta[]> {
        const records = await this.run<NoteRecord[]>(
            TRASH_STORE,
            'readonly',
            (store) => store.getAll() as IDBRequest<NoteRecord[]>,
        );
        // The trash view shows only title + folder + age, so don't derive a body preview here.
        const metas: NoteMeta[] = records.map((record) => ({
            id: record.id,
            title: titleFromFileName(record.id),
            updatedAt: record.updatedAt,
        }));
        metas.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        return metas;
    }

    async restore(trashId: string, destFolder: string): Promise<NoteMeta> {
        const record = await this.run<NoteRecord | undefined>(
            TRASH_STORE,
            'readonly',
            (store) => store.get(trashId) as IDBRequest<NoteRecord | undefined>,
        );
        if (!record) throw notFound(trashId);
        const dir = sanitizeDir(destFolder);
        // The original leaf may be taken now — uniquify against the live notes in that folder.
        const leaf = await uniqueName(titleFromFileName(trashId), (name) =>
            this.exists(joinPath(dir, name)),
        );
        const newId = joinPath(dir, leaf);
        const updatedAt = record.updatedAt;
        await this.runAcross([NOTES_STORE, TRASH_STORE], 'readwrite', (tx) => {
            tx.objectStore(NOTES_STORE).put({
                id: newId,
                content: record.content,
                updatedAt,
            } satisfies NoteRecord);
            return tx.objectStore(TRASH_STORE).delete(trashId);
        });
        return {id: newId, title: titleFromFileName(newId), updatedAt};
    }

    async purge(trashId: string): Promise<void> {
        await this.run(TRASH_STORE, 'readwrite', (store) => store.delete(trashId));
    }

    async emptyTrash(): Promise<void> {
        await this.run(TRASH_STORE, 'readwrite', (store) => store.clear());
    }

    async writeAttachment(file: File): Promise<string> {
        const leaf = await uniqueAttachmentName(file.name, (name) =>
            this.attachmentExists(joinPath(ATTACHMENTS_DIR, name)),
        );
        const id = joinPath(ATTACHMENTS_DIR, leaf);
        // Store the File directly — IndexedDB structured-clones Blobs, preserving its MIME type.
        await this.run(ATTACHMENTS_STORE, 'readwrite', (store) =>
            store.add({id, blob: file, updatedAt: Date.now()} satisfies AttachmentRecord),
        );
        return id;
    }

    async writeAttachmentAt(ref: string, blob: Blob): Promise<void> {
        await this.run(ATTACHMENTS_STORE, 'readwrite', (store) =>
            store.put({id: ref, blob, updatedAt: Date.now()} satisfies AttachmentRecord),
        );
    }

    async readAttachment(ref: string): Promise<Blob> {
        const record = await this.run<AttachmentRecord | undefined>(
            ATTACHMENTS_STORE,
            'readonly',
            (store) => store.get(ref) as IDBRequest<AttachmentRecord | undefined>,
        );
        if (!record) throw notFound(ref);
        return record.blob;
    }

    async listAttachments(): Promise<AttachmentMeta[]> {
        const records = await this.run<AttachmentRecord[]>(
            ATTACHMENTS_STORE,
            'readonly',
            (store) => store.getAll() as IDBRequest<AttachmentRecord[]>,
        );
        return records.map((record) => ({
            ref: record.id,
            name: basename(record.id),
            size: record.blob.size,
            updatedAt: record.updatedAt,
        }));
    }

    async removeAttachment(ref: string): Promise<void> {
        await this.run(ATTACHMENTS_STORE, 'readwrite', (store) => store.delete(ref));
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

    async moveFolder(fromPath: string, toPath: string): Promise<void> {
        const from = sanitizeDir(fromPath);
        const to = sanitizeDir(toPath);
        if (!from || from === to) return;
        if (to === from || to.startsWith(`${from}/`)) {
            throw new Error('Cannot move a folder into itself');
        }
        const prefix = `${from}/`;
        const toPrefix = `${to}/`;
        const [records, folders] = await Promise.all([
            this.run<NoteRecord[]>(
                NOTES_STORE,
                'readonly',
                (store) => store.getAll() as IDBRequest<NoteRecord[]>,
            ),
            this.readFolders(),
        ]);
        // Collision: a folder or note already lives at `to` (or under it) and isn't part of the move.
        const occupied =
            records.some((r) => r.id === to || r.id.startsWith(toPrefix)) ||
            folders.some((f) => f === to || f.startsWith(toPrefix));
        if (occupied) throw new NameCollisionError(from, basename(to));
        const rekey = (id: string) => to + id.slice(from.length);
        // Re-key every note under the moved folder (content + mtime preserved — a pure relocation).
        const moved = records.filter((r) => r.id === from || r.id.startsWith(prefix));
        if (moved.length > 0) {
            await this.run(NOTES_STORE, 'readwrite', (store) => {
                for (const record of moved) {
                    store.put({...record, id: rekey(record.id)} satisfies NoteRecord);
                }
                let last = store.delete(moved[0].id);
                for (let i = 1; i < moved.length; i++) last = store.delete(moved[i].id);
                return last;
            });
        }
        // Re-prefix any deliberately-empty folder markers in the moved subtree.
        if (folders.some((f) => f === from || f.startsWith(prefix))) {
            const next = folders.map((f) => (f === from || f.startsWith(prefix) ? rekey(f) : f));
            await this.run(KV_STORE, 'readwrite', (store) => store.put(next, FOLDERS_KEY));
        }
    }

    async listFolders(): Promise<string[]> {
        const records = await this.run<NoteRecord[]>(
            NOTES_STORE,
            'readonly',
            (store) => store.getAll() as IDBRequest<NoteRecord[]>,
        );
        // Every folder implied by a note's path or a deliberately-empty marker, with all ancestors
        // synthesized (so a nested marker like `Archive/Empty` also surfaces `Archive`) — matching
        // the FS/Tauri backends, which enumerate every real directory.
        const folders = new Set<string>();
        const addWithAncestors = (path: string) => {
            for (let dir = path; dir; dir = dirname(dir)) folders.add(dir);
        };
        for (const marker of await this.readFolders()) addWithAncestors(marker);
        for (const record of records) addWithAncestors(dirname(record.id));
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
                    // v2: media attachments, keyed by their `Attachments/<name>` reference.
                    if (!db.objectStoreNames.contains(ATTACHMENTS_STORE)) {
                        db.createObjectStore(ATTACHMENTS_STORE, {keyPath: 'id'});
                    }
                    // v3: trashed notes, keyed by their `.trash/<leaf>.md` id.
                    if (!db.objectStoreNames.contains(TRASH_STORE)) {
                        db.createObjectStore(TRASH_STORE, {keyPath: 'id'});
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
        return this.runAcross([storeName], mode, (tx) => op(tx.objectStore(storeName)));
    }

    /**
     * Run an operation across several object stores in one transaction (so a cross-store move — e.g.
     * notes ↔ trash — commits atomically); resolves once it commits. The op's returned request is the
     * one whose result is surfaced (let the last write be the one whose value the caller wants).
     */
    private async runAcross<T>(
        storeNames: string[],
        mode: IDBTransactionMode,
        op: (transaction: IDBTransaction) => IDBRequest<T>,
    ): Promise<T> {
        const db = await this.openDb();
        return new Promise<T>((resolve, reject) => {
            const transaction = db.transaction(storeNames, mode);
            const request = op(transaction);
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

    private async attachmentExists(id: string): Promise<boolean> {
        return this.keyExists(ATTACHMENTS_STORE, id);
    }

    private async keyExists(storeName: string, id: string): Promise<boolean> {
        const key = await this.run<IDBValidKey | undefined>(
            storeName,
            'readonly',
            (store) => store.getKey(id) as IDBRequest<IDBValidKey | undefined>,
        );
        return key !== undefined;
    }
}
