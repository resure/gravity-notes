import {invoke} from '@tauri-apps/api/core';

import {isIos} from '../isTauri';

import {LEGACY_METADATA_FILENAME, METADATA_FILENAME, parseMetadata} from './metadata';
import {
    ATTACHMENTS_DIR,
    MD_EXT,
    TRASH_DIR,
    basename,
    canonicalBody,
    dirname,
    isReservedSegment,
    joinPath,
    mimeFromName,
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

/** Shapes returned by the Rust `notes_*` commands (see `src-tauri/src/lib.rs`). */
interface NoteFull {
    name: string;
    modifiedMs: number;
    content: string;
}
interface NoteHead {
    name: string;
    modifiedMs: number;
    head: string;
}
/** One attachment as returned by the Rust `attachment_list` command. */
interface AttachmentEntry {
    name: string;
    size: number;
    modifiedMs: number;
}
/** Results of the icloud-fs plugin's coordinated per-note read/write (iOS only). */
interface ReadNoteResponse {
    exists: boolean;
    content: string;
    modifiedMs: number;
}
interface WriteNoteResponse {
    modifiedMs: number;
}
/** Coordinated per-attachment read (iOS only); `data` is base64 of the raw bytes, `exists:false`=absent. */
interface ReadAttachmentResponse {
    exists: boolean;
    data: string;
}

/** Rust `read_to_string`'s stable invalid-data message for a present non-UTF-8 sidecar. */
function isInvalidUtf8Read(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return message.toLowerCase().includes('valid utf-8');
}

/**
 * Base64 ⇄ bytes for the iOS attachment bridge (binary can't ride as a UTF-8 string like a note
 * body). Chunked so `String.fromCharCode(...bytes)` can't blow the call-stack arg limit on a large
 * image. `btoa`/`atob` are available in WKWebView.
 */
function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
/**
 * Payload of the Rust `notes:changed` watcher event. `dir` is the raw folder path (strict-equal
 * to this store's `dir`); empty `paths` means "many/unknown changes".
 */
interface NotesChangedPayload {
    dir: string;
    paths: string[];
}

/** Mirror the web backend's deleted-note signal so `useNotes` maps it to a "deleted" conflict. */
function notFound(id: string): DOMException {
    return new DOMException(`"${id}" not found`, 'NotFoundError');
}

/**
 * Notes stored as individual `.md` files in a user-picked directory, read and written through
 * native Rust commands (the File System Access API is unavailable in macOS WKWebView). The file
 * name (with extension) is the note id; the name without `.md` is the title.
 *
 * Semantics intentionally match `FileSystemNoteStore` — `<Title>.md` ids, canonical body
 * shape, `updatedAt`-based optimistic concurrency (`ConflictError`), `NotFoundError` on a missing
 * note, and case-only rename via a temp name — so `useNotes` is unaffected by which backend runs.
 * Real atomic `fs::rename` (Rust side) replaces the web backend's copy-then-delete rename; the
 * write helper is atomic there too, preserving the same crash-safety guarantee.
 */
export class TauriNoteStore implements NoteStore {
    /** The Rust `notes_list`/`notes_read_all` commands recurse subdirectories. */
    readonly listsRecursively = true;

    constructor(private readonly dir: string) {}

    async list(): Promise<NoteMeta[]> {
        const entries = await invoke<NoteHead[]>('notes_list', {dir: this.dir});
        const metas: NoteMeta[] = entries.map((entry) => ({
            id: entry.name,
            title: titleFromFileName(entry.name),
            updatedAt: entry.modifiedMs,
            preview: previewFromContent(entry.head),
        }));
        metas.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        return metas;
    }

    async getAll(): Promise<Note[]> {
        const entries = await invoke<NoteFull[]>('notes_read_all', {dir: this.dir});
        return entries.map((entry) => ({
            id: entry.name,
            title: titleFromFileName(entry.name),
            updatedAt: entry.modifiedMs,
            // Stripped to match get()/the editor's serialized shape (parity for the search corpus).
            content: stripTrailingNewlines(entry.content),
        }));
    }

    async get(id: string): Promise<Note> {
        const entry = await this.readNote(id);
        if (!entry) throw notFound(id);
        return {
            id,
            title: titleFromFileName(id),
            updatedAt: entry.modifiedMs,
            // Strip so the in-memory body matches what the editor serializes (parity with FS get()).
            content: stripTrailingNewlines(entry.content),
        };
    }

    async create(title: string, parentPath = ''): Promise<NoteMeta> {
        const dir = sanitizeDir(parentPath);
        // Scope the collision probe to the target folder; notes_write create_dir_all's the parent.
        const leaf = await uniqueName(sanitizeTitle(title), (name) =>
            this.exists(joinPath(dir, name)),
        );
        const id = joinPath(dir, leaf);
        // Write the canonical "blank line at EOF" shape save() produces (get() strips it back),
        // so a brand-new note has a consistent on-disk shape for external tools.
        const updatedAt = await this.write(id, canonicalBody(''));
        return {id, title: titleFromFileName(id), updatedAt};
    }

    async save(id: string, content: string, baseUpdatedAt: number): Promise<NoteMeta> {
        const current = await invoke<number | null>('notes_stat', {dir: this.dir, name: id});
        // A vanished file maps to a "deleted" conflict (matches FS getFileHandle throwing NotFound).
        if (current === null) throw notFound(id);
        if (current !== baseUpdatedAt) {
            throw new ConflictError(id, current);
        }
        const updatedAt = await this.write(id, canonicalBody(content));
        return {id, title: titleFromFileName(id), updatedAt};
    }

    async stat(id: string): Promise<number | null> {
        return invoke<number | null>('notes_stat', {dir: this.dir, name: id});
    }

    async rename(id: string, nextTitle: string): Promise<NoteMeta> {
        const base = sanitizeTitle(nextTitle);
        // Rename is leaf-only: re-join the new leaf onto the note's own folder so it stays put.
        const nextName = joinPath(dirname(id), base + MD_EXT);
        if (nextName === id) {
            return {id, title: titleFromFileName(id)};
        }
        // A case-only rename (note.md → Note.md) resolves to the SAME file on macOS's default
        // case-insensitive filesystem: a direct rename is a no-op there, and the collision check
        // would flag the source as a collision. Both are skipped/worked-around below.
        const caseOnlyRename = nextName.toLowerCase() === id.toLowerCase();
        // Renaming onto another note's name is rejected (no auto-numbered copy); the caller surfaces
        // it to the user. Skipped for a case-only rename (the only "match" is itself).
        if (!caseOnlyRename && (await this.exists(nextName))) {
            throw new NameCollisionError(id, base);
        }
        if (caseOnlyRename) {
            // Go through a distinct temp name so the case actually changes on a case-insensitive FS.
            // The temp doesn't end in `.md`, so list() ignores it even transiently.
            // On a case-SENSITIVE volume `nextName` could be a distinct existing file (the collision
            // probe above is skipped for case-only renames); the Rust `notes_rename` no-clobber guard
            // refuses to overwrite a different file, so this can't silently destroy data.
            // `.rename-tmp` mirrors RENAME_TMP_SUFFIX in src-tauri/src/lib.rs — the folder
            // watcher filters these; a changed suffix there would leak the temp's events.
            const tempName = `${nextName}.rename-tmp`;
            await invoke('notes_rename', {dir: this.dir, from: id, to: tempName});
            const updatedAt = await invoke<number>('notes_rename', {
                dir: this.dir,
                from: tempName,
                to: nextName,
            });
            return {id: nextName, title: titleFromFileName(nextName), updatedAt};
        }
        // Real atomic rename (no content re-read / copy-then-delete needed, unlike the FS backend).
        const updatedAt = await invoke<number>('notes_rename', {
            dir: this.dir,
            from: id,
            to: nextName,
        });
        return {id: nextName, title: titleFromFileName(nextName), updatedAt};
    }

    async move(id: string, destFolder: string): Promise<NoteMeta> {
        const newId = joinPath(sanitizeDir(destFolder), basename(id));
        if (newId === id) {
            // Already in that folder: a no-op; just report the current mtime.
            const updatedAt = await invoke<number | null>('notes_stat', {dir: this.dir, name: id});
            if (updatedAt === null) throw notFound(id);
            return {id, title: titleFromFileName(id), updatedAt};
        }
        // A vanished source maps to a "deleted" conflict, matching the FS/IDB backends.
        if ((await this.stat(id)) === null) throw notFound(id);
        if (await this.exists(newId)) {
            throw new NameCollisionError(id, titleFromFileName(id));
        }
        // notes_rename create_dir_all's the destination folder and moves the file (atomic, or an
        // EXDEV copy+delete fallback), returning the post-move mtime so the baseline re-seeds.
        const updatedAt = await invoke<number>('notes_rename', {
            dir: this.dir,
            from: id,
            to: newId,
        });
        return {id: newId, title: titleFromFileName(newId), updatedAt};
    }

    async remove(id: string): Promise<void> {
        await invoke('notes_remove', {dir: this.dir, name: id});
    }

    async trash(id: string): Promise<string> {
        // Uniquify within `.trash/`, then move the file there (notes_rename creates `.trash/` and
        // prunes the source's now-empty ancestors — a pure relocation, mtime preserved).
        const leaf = await uniqueName(titleFromFileName(id), (name) =>
            this.exists(joinPath(TRASH_DIR, name)),
        );
        const trashId = joinPath(TRASH_DIR, leaf);
        await invoke('notes_rename', {dir: this.dir, from: id, to: trashId});
        return trashId;
    }

    async listTrash(): Promise<NoteMeta[]> {
        // The recursive note walk skips dot-directories, so `.trash/` needs its own lister. The trash
        // view shows only title + folder + age, so notes_list_dir returns names + mtimes, no bodies.
        const entries = await invoke<NoteHead[]>('notes_list_dir', {dir: this.dir, sub: TRASH_DIR});
        const metas: NoteMeta[] = entries.map((entry) => ({
            id: entry.name,
            title: titleFromFileName(entry.name),
            updatedAt: entry.modifiedMs,
        }));
        metas.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        return metas;
    }

    async restore(trashId: string, destFolder: string): Promise<NoteMeta> {
        const dir = sanitizeDir(destFolder);
        // A vanished trash entry maps to a "deleted" conflict, matching the FS/IDB backends.
        if ((await this.stat(trashId)) === null) throw notFound(trashId);
        // The original leaf may be taken now — uniquify against the destination folder.
        const leaf = await uniqueName(titleFromFileName(trashId), (name) =>
            this.exists(joinPath(dir, name)),
        );
        const newId = joinPath(dir, leaf);
        // notes_rename create_dir_all's the destination (re-creating a removed folder) and prunes the
        // now-empty `.trash/`, returning the post-move mtime so the baseline re-seeds.
        const updatedAt = await invoke<number>('notes_rename', {
            dir: this.dir,
            from: trashId,
            to: newId,
        });
        return {id: newId, title: titleFromFileName(newId), updatedAt};
    }

    async purge(trashId: string): Promise<void> {
        await invoke('notes_remove', {dir: this.dir, name: trashId});
    }

    async emptyTrash(): Promise<void> {
        // One recursive remove of `.trash/` — atomic and one IPC, matching the FS backend's recursive
        // removeEntry (no half-emptied partial state, and it clears any non-`.md`/temp cruft too).
        await invoke('notes_remove_dir_all', {dir: this.dir, path: TRASH_DIR});
    }

    // Perf/memory ceiling: on the desktop path attachment bytes cross the IPC boundary as a JSON
    // `number[]` (one JS number per byte in `attachment_write`/`attachment_read`), so a large image
    // is briefly held several times over (typed array → number[] → serialized JSON) on each side.
    // Acceptable for typical note images; a raw-bytes transport (`tauri::ipc::Response`) would be
    // needed to lift the ceiling. The iOS path rides base64 through the coordinated plugin instead.
    async writeAttachment(file: File): Promise<string> {
        const leaf = await uniqueAttachmentName(file.name, (name) =>
            this.exists(joinPath(ATTACHMENTS_DIR, name)),
        );
        const path = joinPath(ATTACHMENTS_DIR, leaf);
        await this.writeAttachmentBytes(path, new Uint8Array(await file.arrayBuffer()));
        return path;
    }

    async writeAttachmentAt(ref: string, blob: Blob): Promise<void> {
        // writeAttachmentBytes writes at an exact path (creating parent folders), so reuse it.
        await this.writeAttachmentBytes(ref, new Uint8Array(await blob.arrayBuffer()));
    }

    async readAttachment(ref: string): Promise<Blob> {
        const bytes = await this.readAttachmentBytes(ref);
        if (bytes === null) throw notFound(ref);
        // The backend returns raw bytes without a MIME type; tag the Blob from the extension so SVGs
        // (which need an explicit type to render in <img>) and the like display correctly.
        return new Blob([bytes], {type: mimeFromName(ref)});
    }

    async listAttachments(): Promise<AttachmentMeta[]> {
        const entries = await invoke<AttachmentEntry[]>('attachment_list', {dir: this.dir});
        return entries.map((entry) => ({
            ref: joinPath(ATTACHMENTS_DIR, entry.name),
            name: entry.name,
            size: entry.size,
            updatedAt: entry.modifiedMs,
        }));
    }

    async removeAttachment(ref: string): Promise<void> {
        await invoke('attachment_remove', {dir: this.dir, name: ref});
    }

    async createFolder(parentPath: string, name: string): Promise<string> {
        const segment = sanitizeSegment(name);
        // Reject names the backend hides from the tree (`Attachments`, dot-prefixed): a folder there
        // would exist on disk but be invisible in the app.
        if (isReservedSegment(segment)) throw new NameCollisionError(parentPath, segment);
        const path = joinPath(sanitizeDir(parentPath), segment);
        await invoke('notes_create_folder', {dir: this.dir, path});
        return path;
    }

    async removeFolder(path: string): Promise<void> {
        await invoke('notes_remove_dir', {dir: this.dir, path});
    }

    async moveFolder(fromPath: string, toPath: string): Promise<void> {
        const from = sanitizeDir(fromPath);
        const to = sanitizeDir(toPath);
        if (!from || from === to) return;
        if (to === from || to.startsWith(`${from}/`)) {
            throw new Error('Cannot move a folder into itself');
        }
        // Reject a destination leaf the backend hides from the tree (`Attachments`, dot-prefixed):
        // the moved folder would exist on disk but be invisible in the app.
        if (isReservedSegment(basename(to))) throw new NameCollisionError(from, basename(to));
        // Collision: a folder/file already at `to` (the Rust side re-checks before renaming).
        if (await this.exists(to)) throw new NameCollisionError(from, basename(to));
        // notes_move_dir creates `to`'s parent, atomically renames the directory, and prunes `from`'s
        // now-empty ancestors (notes' mtimes are preserved — a pure relocation).
        await invoke('notes_move_dir', {dir: this.dir, from, to});
    }

    async listFolders(): Promise<string[]> {
        return invoke<string[]>('notes_list_folders', {dir: this.dir});
    }

    /** Reveal a note / folder / attachment in Finder (native desktop only). */
    async reveal(relPath: string): Promise<void> {
        await invoke('reveal_path', {dir: this.dir, name: relPath});
    }

    /**
     * Subscribe to external on-disk changes (see `NoteStore.watch`): one debounced native
     * watcher per folder, refcount-shared across windows Rust-side. Window-scoped `listen` —
     * the shell emits `notes:changed` per subscriber via `emit_to`.
     */
    async watch(onChange: (relPaths: string[]) => void): Promise<() => void> {
        // Dynamic import keeps the Tauri event API out of the web bundle (this class is only
        // constructed in the shell, but the module is imported unconditionally).
        const {getCurrentWebviewWindow} = await import('@tauri-apps/api/webviewWindow');
        // Listen BEFORE registering the native watcher, so no event can slip between the two.
        const unlisten = await getCurrentWebviewWindow().listen<NotesChangedPayload>(
            'notes:changed',
            (event) => {
                // During a workspace switch this window can briefly hold listeners for the
                // outgoing store too — deliver only this folder's events.
                if (event.payload.dir === this.dir) onChange(event.payload.paths);
            },
        );
        try {
            await invoke('notes_watch', {dir: this.dir});
        } catch (err) {
            unlisten();
            throw err;
        }
        let disposed = false;
        return () => {
            // Idempotent per handle: the Rust side decrements a per-window refcount on EVERY
            // unwatch (only a fully-gone label no-ops), so a double-dispose would tear the
            // count down under another live subscription of this same window.
            if (disposed) return;
            disposed = true;
            unlisten();
            // Fire-and-forget: the disposer runs in effect cleanups that can't await, and a
            // late unwatch after window destroy no-ops on the Rust side.
            void invoke('notes_unwatch', {dir: this.dir}).catch(() => {});
        };
    }

    async readMetadata(): Promise<NotesMetadata> {
        // The READ is deliberately OUTSIDE the try: a read *failure* must propagate, not degrade to
        // defaults. On iOS `readNote` goes through the coordinated plugin, whose transient
        // NSFileCoordinator/iCloud errors reject (vs. `exists:false` for a genuinely absent file) —
        // swallowing that into empty defaults would let a subsequent `writeMetadata` overwrite the
        // real sidecar and permanently lose pins / per-note appearance / the trash registry. A
        // genuinely missing file (`null`) still yields fresh defaults, which is safe (nothing to lose).
        let entry: {content: string; modifiedMs: number} | null;
        try {
            entry = await this.readNote(METADATA_FILENAME);
            if (!entry) {
                // No Sol sidecar: adopt a Gravity Notes one if the vault has it, copying it under
                // the new name so this runs exactly once per vault. The legacy file stays where it
                // is — an older install opening the same folder keeps working (PLAN.md D7). A
                // failed copy is survivable: we still parse the legacy bytes, and retry next launch.
                const legacy = await this.readNote(LEGACY_METADATA_FILENAME);
                if (legacy) {
                    entry = legacy;
                    await this.write(METADATA_FILENAME, legacy.content).catch(() => {});
                }
            }
        } catch (err) {
            // Preserve the desktop store's tolerant-corruption contract: Rust's strict
            // read_to_string rejects a present sidecar with invalid UTF-8 before JSON.parse can
            // classify it as corrupt. Treat ONLY that known invalid-data case as fresh defaults.
            // iOS coordinated-read failures (including its explicit invalid-UTF-8 rejection) still
            // propagate, so a transient iCloud error can never be mistaken for an absent sidecar and
            // overwritten by a later metadata write.
            if (!isIos && isInvalidUtf8Read(err)) return parseMetadata({});
            throw err;
        }
        if (!entry) return parseMetadata({}); // no dotfile yet → fresh defaults
        try {
            return parseMetadata(JSON.parse(entry.content));
        } catch {
            // Present but unparseable (corrupt JSON): degrade to fresh defaults, matching the FS/IDB
            // backends — the bytes were readable and are genuinely malformed, so resetting is correct.
            return parseMetadata({});
        }
    }

    async writeMetadata(meta: NotesMetadata): Promise<void> {
        await this.write(METADATA_FILENAME, JSON.stringify(meta, null, 2));
    }

    /**
     * Read one note's content + mtime. On iOS this goes through the icloud-fs plugin's coordinated
     * read (NSFileCoordinator + download-on-demand for an evicted iCloud file, so opening a not-yet-
     * synced note works and never reads a mid-sync partial); elsewhere it's the plain std::fs
     * notes_read_opt. `null` means the file is absent (→ a not-found/deleted conflict).
     */
    private async readNote(name: string): Promise<{content: string; modifiedMs: number} | null> {
        if (isIos) {
            const res = await invoke<ReadNoteResponse>('plugin:icloud-fs|read_note', {
                payload: {dir: this.dir, name},
            });
            return res.exists ? {content: res.content, modifiedMs: res.modifiedMs} : null;
        }
        const entry = await invoke<NoteFull | null>('notes_read_opt', {dir: this.dir, name});
        return entry ? {content: entry.content, modifiedMs: entry.modifiedMs} : null;
    }

    /**
     * Atomic write returning the file's new mtime in epoch ms. On iOS the icloud-fs plugin does an
     * NSFileCoordinator-coordinated atomic write (safe against iCloud sync racing the file); on the
     * desktop it's the Rust notes_write (temp + rename).
     */
    private write(name: string, content: string): Promise<number> {
        if (isIos) {
            return invoke<WriteNoteResponse>('plugin:icloud-fs|write_note', {
                payload: {dir: this.dir, name, contents: content},
            }).then((r) => r.modifiedMs);
        }
        return invoke<number>('notes_write', {dir: this.dir, name, content});
    }

    /**
     * Read one attachment's raw bytes (`null` if absent). On iOS this goes through the icloud-fs
     * plugin's coordinated read + download-on-demand — mirroring `readNote`, so an evicted iCloud
     * image materializes on open instead of reading a placeholder — carried as base64; elsewhere it's
     * the plain Rust `attachment_read` (`number[]`).
     */
    private async readAttachmentBytes(ref: string): Promise<Uint8Array<ArrayBuffer> | null> {
        if (isIos) {
            const res = await invoke<ReadAttachmentResponse>('plugin:icloud-fs|read_attachment', {
                payload: {dir: this.dir, name: ref},
            });
            return res.exists ? base64ToBytes(res.data) : null;
        }
        const bytes = await invoke<number[] | null>('attachment_read', {dir: this.dir, name: ref});
        return bytes === null ? null : new Uint8Array(bytes);
    }

    /**
     * Write one attachment's raw bytes (creating `Attachments/`). On iOS the icloud-fs plugin does an
     * NSFileCoordinator-coordinated atomic write (safe against iCloud sync) with base64 transport; on
     * the desktop it's the Rust `attachment_write` (`number[]`).
     */
    private async writeAttachmentBytes(ref: string, bytes: Uint8Array): Promise<void> {
        if (isIos) {
            await invoke('plugin:icloud-fs|write_attachment', {
                payload: {dir: this.dir, name: ref, data: bytesToBase64(bytes)},
            });
            return;
        }
        await invoke('attachment_write', {dir: this.dir, path: ref, bytes: Array.from(bytes)});
    }

    private exists(name: string): Promise<boolean> {
        return invoke<boolean>('notes_exists', {dir: this.dir, name});
    }
}
