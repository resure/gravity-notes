import {METADATA_FILENAME, parseMetadata} from './metadata';
import {
    ATTACHMENTS_DIR,
    FOLDER_MARKER,
    MD_EXT,
    PREVIEW_SCAN_BYTES,
    TRASH_DIR,
    basename,
    canonicalBody,
    dirname,
    isReservedSegment,
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

/**
 * Write text to a file handle, aborting the writable on failure so a half-written stream isn't
 * left dangling. The File System Access API commits a writable atomically only on close(), so the
 * original file is untouched if write() throws before then.
 */
async function writeFile(handle: FileSystemFileHandle, data: string | Blob): Promise<void> {
    const writable = await handle.createWritable();
    try {
        await writable.write(data);
        await writable.close();
    } catch (err) {
        try {
            await writable.abort();
        } catch {
            // The stream may already be errored/closed; nothing more to clean up.
        }
        throw err;
    }
}

/** Mirror the other backends' deleted-note signal so `useNotes` maps it to a "deleted" conflict. */
function notFound(id: string): DOMException {
    return new DOMException(`"${id}" not found`, 'NotFoundError');
}

/**
 * Notes stored as individual `.md` files in a user-picked directory, accessed through the File
 * System Access API. A note id is its POSIX-relative path from the picked folder (`Work/Sub/Title.md`
 * for a nested note, `Title.md` at the root); the leaf without `.md` is the title. Folders are real
 * directories — created empty with a `.gnkeep` marker, listed recursively, and auto-pruned when a
 * move/delete empties them (a marked folder survives). Semantics match `IndexedDbNoteStore` and
 * `TauriNoteStore`, so everything above the `NoteStore` seam is backend-agnostic.
 */
export class FileSystemNoteStore implements NoteStore {
    /** list()/getAll() descend every subdirectory, so nested (slash-bearing) ids are always seen. */
    readonly listsRecursively = true;

    constructor(private readonly dir: FileSystemDirectoryHandle) {}

    async list(): Promise<NoteMeta[]> {
        const metas: NoteMeta[] = [];
        for await (const {id, handle} of this.walkNotes()) {
            try {
                const file = await handle.getFile();
                // Read only the head of each file — enough for a one-line list preview.
                const head = await file.slice(0, PREVIEW_SCAN_BYTES).text();
                metas.push({
                    id,
                    title: titleFromFileName(id),
                    updatedAt: file.lastModified,
                    preview: previewFromContent(head),
                });
            } catch (err) {
                // One unreadable file (deleted mid-scan, permission glitch) must not blank the whole
                // list — skip it so every other note still loads.
                console.warn(`Skipping unreadable note "${id}":`, err);
            }
        }
        metas.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        return metas;
    }

    async getAll(): Promise<Note[]> {
        const notes: Note[] = [];
        for await (const {id, handle} of this.walkNotes()) {
            try {
                const file = await handle.getFile();
                notes.push({
                    id,
                    title: titleFromFileName(id),
                    updatedAt: file.lastModified,
                    // Stripped to match get()/the editor's serialized shape (search-corpus parity).
                    content: stripTrailingNewlines(await file.text()),
                });
            } catch (err) {
                // Skip an unreadable file so the search corpus still gets every readable note.
                console.warn(`Skipping unreadable note "${id}":`, err);
            }
        }
        return notes;
    }

    async get(id: string): Promise<Note> {
        const handle = await this.fileHandle(id);
        if (!handle) throw notFound(id);
        const file = await handle.getFile();
        return {
            id,
            title: titleFromFileName(id),
            updatedAt: file.lastModified,
            // Stripped so the in-memory body matches what the editor serializes (it emits no
            // trailing newline); save() re-adds a trailing blank line. Without this the editor
            // sees a diff on open and re-saves the note every time it's opened.
            content: stripTrailingNewlines(await file.text()),
        };
    }

    async create(title: string, parentPath = ''): Promise<NoteMeta> {
        const folder = sanitizeDir(parentPath);
        const dir = await this.resolveDir(folder, true);
        if (!dir) throw new Error(`Could not open folder "${folder}"`);
        // Scope the collision probe to the target folder, so the same leaf title is free elsewhere.
        // The probe-then-create is not atomic, but the FSA gives no atomic create-if-absent; this is
        // a single-user, single-tab store, so the window for a racing create is effectively nil.
        const leaf = await uniqueName(sanitizeTitle(title), (name) => this.existsIn(dir, name));
        const handle = await dir.getFileHandle(leaf, {create: true});
        // Write the canonical "blank line at EOF" shape save() produces, so a brand-new note has a
        // consistent on-disk shape for external tools rather than a zero-byte file. get() strips it
        // back to an empty body, so the editor still opens to a blank note with no spurious save.
        await writeFile(handle, canonicalBody(''));
        const id = joinPath(folder, leaf);
        const updatedAt = (await handle.getFile()).lastModified;
        return {id, title: titleFromFileName(id), updatedAt};
    }

    async save(id: string, content: string, baseUpdatedAt: number): Promise<NoteMeta> {
        const handle = await this.fileHandle(id);
        if (!handle) throw notFound(id);
        const current = (await handle.getFile()).lastModified;
        if (current !== baseUpdatedAt) {
            throw new ConflictError(id, current);
        }
        // End the file with a blank line at EOF (the editor serializes no trailing newline).
        await writeFile(handle, canonicalBody(content));
        const updatedAt = (await handle.getFile()).lastModified;
        return {id, title: titleFromFileName(id), updatedAt};
    }

    async stat(id: string): Promise<number | null> {
        const handle = await this.fileHandle(id);
        if (!handle) return null;
        return (await handle.getFile()).lastModified;
    }

    async readMetadata(): Promise<NotesMetadata> {
        let text: string;
        try {
            const handle = await this.dir.getFileHandle(METADATA_FILENAME);
            text = await (await handle.getFile()).text();
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotFoundError') {
                return parseMetadata({}); // no dotfile yet → fresh defaults
            }
            throw err;
        }
        try {
            return parseMetadata(JSON.parse(text));
        } catch {
            return parseMetadata({}); // corrupt JSON → fresh defaults rather than crashing
        }
    }

    async writeMetadata(meta: NotesMetadata): Promise<void> {
        const handle = await this.dir.getFileHandle(METADATA_FILENAME, {create: true});
        await writeFile(handle, JSON.stringify(meta, null, 2));
    }

    async rename(id: string, nextTitle: string): Promise<NoteMeta> {
        const base = sanitizeTitle(nextTitle);
        const folder = dirname(id);
        // Rename is leaf-only: re-join the new leaf onto the note's own folder so it stays put.
        const nextName = joinPath(folder, base + MD_EXT);
        if (nextName === id) {
            return {id, title: titleFromFileName(id)};
        }
        // A case-only rename (note.md → Note.md) is the SAME file on a case-insensitive filesystem
        // (macOS/Windows default) but two DISTINCT files on a case-sensitive one — handled separately
        // below, keyed off the actually-stored leaf so the right path is taken on either FS.
        const caseOnlyRename = nextName.toLowerCase() === id.toLowerCase();
        const dir = await this.resolveDir(folder);
        if (!dir) throw notFound(id);
        const oldLeaf = basename(id);
        const nextLeaf = base + MD_EXT;
        const srcHandle = await this.existingFileHandle(dir, oldLeaf);
        if (!srcHandle) throw notFound(id);
        // The leaf `nextLeaf` resolves to on disk: `null` when the name is free, the source's own
        // `oldLeaf` when it resolves back to the source (a case-only rename on a case-INSENSITIVE
        // FS), or a different name when a DISTINCT note already owns it.
        const existingLeaf = await this.storedLeafName(dir, nextLeaf);
        // Renaming onto another note's name is rejected (no auto-numbered copy); the caller surfaces
        // it to the user. This now also catches a case-only rename onto a DISTINCT existing file on a
        // case-SENSITIVE FS (`note.md`→`Note.md` where a separate `Note.md` exists) — the original
        // guard skipped that path entirely, risking an overwrite.
        if (existingLeaf !== null && existingLeaf !== oldLeaf) {
            throw new NameCollisionError(id, base);
        }
        // The File System Access API has no atomic rename: this is a raw-byte copy-then-delete
        // (mirroring move()/trash()), so a note carrying non-UTF-8 content survives byte-for-byte
        // and the body isn't needlessly re-canonicalized through a UTF-8 round-trip.
        if (caseOnlyRename && existingLeaf === oldLeaf) {
            // Case-only rename on a case-INSENSITIVE FS: `nextLeaf` and `oldLeaf` are the SAME entry,
            // so getFileHandle(nextLeaf) would just hand back the source — the case would never
            // change. Stage through a distinct temp (which doesn't end in `.md`, so list() ignores it
            // even transiently), remove the source so the new-cased name is free, then write it. The
            // bytes live safely in the temp across the (necessary, unavoidable on this FS) window
            // between dropping `oldLeaf` and committing `nextLeaf`.
            const tempLeaf = `${nextLeaf}.rename-tmp`;
            await this.copyFileBytes(srcHandle, dir, tempLeaf);
            const tempHandle = await this.existingFileHandle(dir, tempLeaf);
            if (!tempHandle) throw notFound(id);
            await dir.removeEntry(oldLeaf);
            const renamed = await this.copyFileBytes(tempHandle, dir, nextLeaf);
            await dir.removeEntry(tempLeaf);
            const updatedAt = (await renamed.getFile()).lastModified;
            return {id: nextName, title: titleFromFileName(nextName), updatedAt};
        }
        // `nextLeaf` is a distinct entry (a normal rename, or a case-only rename on a case-SENSITIVE
        // FS): commit it BEFORE deleting the source, so a crash mid-rename leaves the readable note
        // under one name or both — never lost. No temp, no window.
        const handle = await this.copyFileBytes(srcHandle, dir, nextLeaf);
        await dir.removeEntry(oldLeaf);
        // Read the real on-disk mtime so the caller can seed an accurate conflict baseline.
        const updatedAt = (await handle.getFile()).lastModified;
        return {id: nextName, title: titleFromFileName(nextName), updatedAt};
    }

    async move(id: string, destFolder: string): Promise<NoteMeta> {
        const folder = sanitizeDir(destFolder);
        const newId = joinPath(folder, basename(id));
        if (newId === id) {
            // Already in that folder: a no-op; just report the current mtime.
            const updatedAt = await this.stat(id);
            if (updatedAt === null) throw notFound(id);
            return {id, title: titleFromFileName(id), updatedAt};
        }
        // Read the source's raw bytes first, so a missing note maps to a deleted-conflict before any
        // writes (matches IndexedDb/Tauri and leaves a colliding move with no side effects), and a
        // note carrying non-UTF-8 content is copied byte-for-byte (a text round-trip would mangle it).
        const srcHandle = await this.fileHandle(id);
        if (!srcHandle) throw notFound(id);
        const dest = await this.resolveDir(folder, true);
        if (!dest) throw new Error(`Could not open folder "${folder}"`);
        const leaf = basename(id);
        if (await this.existsIn(dest, leaf)) {
            throw new NameCollisionError(id, titleFromFileName(id));
        }
        // No atomic cross-folder rename in the FSA: copy the bytes into the destination, then delete
        // the source (the write bumps mtime — we return the real new one so the baseline re-seeds).
        const destHandle = await this.copyFileBytes(srcHandle, dest, leaf);
        const srcDir = await this.resolveDir(dirname(id));
        if (srcDir) await srcDir.removeEntry(leaf);
        // Moving the last note out of a folder leaves it empty: prune the source's now-empty
        // ancestors (a folder kept alive by a .gnkeep marker survives).
        await this.pruneEmptyAncestors(dirname(id));
        const updatedAt = (await destHandle.getFile()).lastModified;
        return {id: newId, title: titleFromFileName(newId), updatedAt};
    }

    async remove(id: string): Promise<void> {
        const dir = await this.resolveDir(dirname(id));
        if (!dir) return;
        await dir.removeEntry(basename(id));
        await this.pruneEmptyAncestors(dirname(id));
    }

    async trash(id: string): Promise<string> {
        // Read the source's raw bytes so a missing note maps to a deleted-conflict before any writes,
        // and the note's content survives byte-for-byte (no UTF-8 round-trip).
        const srcHandle = await this.fileHandle(id);
        if (!srcHandle) throw notFound(id);
        const dest = await this.resolveDir(TRASH_DIR, true);
        if (!dest) throw new Error('Could not open the trash folder');
        // Uniquify within `.trash/` so two same-named notes from different folders can coexist there.
        const leaf = await uniqueName(titleFromFileName(id), (name) => this.existsIn(dest, name));
        await this.copyFileBytes(srcHandle, dest, leaf);
        const srcDir = await this.resolveDir(dirname(id));
        if (srcDir) await srcDir.removeEntry(basename(id));
        await this.pruneEmptyAncestors(dirname(id));
        return joinPath(TRASH_DIR, leaf);
    }

    async listTrash(): Promise<NoteMeta[]> {
        const dir = await this.resolveDir(TRASH_DIR);
        if (!dir) return [];
        const out: NoteMeta[] = [];
        for await (const handle of dir.values()) {
            if (handle.kind !== 'file' || !handle.name.toLowerCase().endsWith(MD_EXT)) continue;
            // The trash view shows only title + folder + age, so don't read each file's body.
            const file = await (handle as FileSystemFileHandle).getFile();
            out.push({
                id: joinPath(TRASH_DIR, handle.name),
                title: titleFromFileName(handle.name),
                updatedAt: file.lastModified,
            });
        }
        out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        return out;
    }

    async restore(trashId: string, destFolder: string): Promise<NoteMeta> {
        const srcHandle = await this.fileHandle(trashId);
        if (!srcHandle) throw notFound(trashId);
        const folder = sanitizeDir(destFolder);
        const dest = await this.resolveDir(folder, true); // re-create the folder if it was removed
        if (!dest) throw new Error(`Could not open folder "${folder}"`);
        // The original name may be taken now (another note, or a second restore) — uniquify it.
        const leaf = await uniqueName(titleFromFileName(trashId), (name) =>
            this.existsIn(dest, name),
        );
        const handle = await this.copyFileBytes(srcHandle, dest, leaf);
        // The FSA has no atomic rename, so this is a copy: the write bumps mtime to "now" (the Tauri /
        // IndexedDB backends preserve it). A restored note therefore surfaces at the top of the
        // "updated" sort on the web backend — the same mtime caveat the copy-then-delete move() carries.
        // Inherent to the FSA: there is no API to set a file's lastModified, so the original mtime
        // can't be reinstated here. Left as-is by design.
        await this.removeFromTrash(trashId);
        const newId = joinPath(folder, leaf);
        const updatedAt = (await handle.getFile()).lastModified;
        return {id: newId, title: titleFromFileName(newId), updatedAt};
    }

    async purge(trashId: string): Promise<void> {
        await this.removeFromTrash(trashId);
    }

    async emptyTrash(): Promise<void> {
        try {
            await this.dir.removeEntry(TRASH_DIR, {recursive: true});
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotFoundError') return;
            throw err;
        }
    }

    async writeAttachment(file: File): Promise<string> {
        const dir = await this.resolveDir(ATTACHMENTS_DIR, true);
        if (!dir) throw new Error('Could not open the Attachments folder');
        // Probe-then-create is not atomic (the FSA has no atomic create-if-absent), but this is a
        // single-user, single-tab store so the race window is effectively nil.
        const leaf = await uniqueAttachmentName(file.name, (name) => this.existsIn(dir, name));
        const handle = await dir.getFileHandle(leaf, {create: true});
        await writeFile(handle, file);
        return joinPath(ATTACHMENTS_DIR, leaf);
    }

    async writeAttachmentAt(ref: string, blob: Blob): Promise<void> {
        const dir = await this.resolveDir(dirname(ref), true);
        if (!dir) throw new Error('Could not open the Attachments folder');
        const handle = await dir.getFileHandle(basename(ref), {create: true});
        await writeFile(handle, blob);
    }

    async readAttachment(ref: string): Promise<Blob> {
        const handle = await this.fileHandle(ref);
        if (!handle) throw notFound(ref);
        return handle.getFile(); // a File is already a Blob
    }

    async listAttachments(): Promise<AttachmentMeta[]> {
        const dir = await this.resolveDir(ATTACHMENTS_DIR);
        if (!dir) return [];
        const out: AttachmentMeta[] = [];
        for await (const handle of dir.values()) {
            // Skip dotfiles (markers/temps); only real files are attachments.
            if (handle.kind !== 'file' || handle.name.startsWith('.')) continue;
            const file = await (handle as FileSystemFileHandle).getFile();
            out.push({
                ref: joinPath(ATTACHMENTS_DIR, handle.name),
                name: handle.name,
                size: file.size,
                updatedAt: file.lastModified,
            });
        }
        return out;
    }

    async removeAttachment(ref: string): Promise<void> {
        // Resolve the ref's own folder + leaf (like readAttachment/writeAttachmentAt) rather than
        // hard-coding ATTACHMENTS_DIR, so all three treat a `ref` consistently (a nested ref removes
        // the right file instead of a same-named one at the Attachments root).
        const dir = await this.resolveDir(dirname(ref));
        if (!dir) return;
        try {
            await dir.removeEntry(basename(ref));
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotFoundError') return;
            throw err;
        }
    }

    async createFolder(parentPath: string, name: string): Promise<string> {
        const leaf = sanitizeSegment(name);
        const path = joinPath(sanitizeDir(parentPath), leaf);
        // Refuse a name the note/folder walk hides (`Attachments`, any dot-name): such a folder would
        // exist on disk yet vanish from the tree, silently swallowing any notes a user put inside it.
        if (isReservedSegment(leaf)) {
            throw new NameCollisionError(path, leaf);
        }
        const dir = await this.resolveDir(path, true);
        if (!dir) throw new Error(`Could not create folder "${path}"`);
        // A `.gnkeep` marker keeps the (otherwise empty) folder alive past the auto-prune.
        const marker = await dir.getFileHandle(FOLDER_MARKER, {create: true});
        await writeFile(marker, '');
        return path;
    }

    async removeFolder(path: string): Promise<void> {
        const dir = await this.resolveDir(path);
        if (!dir) return; // already gone
        try {
            await dir.removeEntry(FOLDER_MARKER);
        } catch {
            // An implicit folder (no marker) — nothing to drop.
        }
        const parent = await this.resolveDir(dirname(path));
        // Non-recursive: only an empty directory is removed (the caller ensures it holds no notes).
        if (parent) await parent.removeEntry(basename(path));
    }

    async moveFolder(fromPath: string, toPath: string): Promise<void> {
        const from = sanitizeDir(fromPath);
        const to = sanitizeDir(toPath);
        if (!from || from === to) return;
        if (to === from || to.startsWith(`${from}/`)) {
            throw new Error('Cannot move a folder into itself');
        }
        // Refuse a destination leaf the walk hides (`Attachments`, any dot-name) — the moved subtree
        // and its notes would vanish from the tree (same reason createFolder rejects these).
        const destLeaf = basename(to);
        if (isReservedSegment(destLeaf)) {
            throw new NameCollisionError(from, destLeaf);
        }
        const src = await this.resolveDir(from);
        if (!src) return; // nothing to move
        if (await this.resolveDir(to)) {
            throw new NameCollisionError(from, basename(to));
        }
        // No atomic directory rename in the FSA, so this is copy-then-delete — made failure-atomic:
        // (1) copy the whole subtree to the destination; if anything fails mid-copy, delete the
        // partial destination so a failed move never leaves an orphaned half-tree (which would also
        // block a retry by tripping the collision guard above); (2) verify the copy is complete
        // before destroying the source — only then drop `from` and prune its now-empty ancestors
        // (a marked sibling survives). The source is untouched until the copy is proven complete, so
        // an in-process failure can never lose notes. (A hard crash mid-copy can still leave a
        // partial destination — harmless orphan data, source intact — which the FSA can't prevent
        // without an atomic rename.)
        try {
            await this.copyTree(from, to);
        } catch (err) {
            await this.discardDir(to);
            throw err;
        }
        if (!(await this.treesMatch(from, to))) {
            await this.discardDir(to);
            throw new Error(`Folder move verification failed for "${from}"`);
        }
        const parent = await this.resolveDir(dirname(from));
        if (parent) await parent.removeEntry(basename(from), {recursive: true});
        await this.pruneEmptyAncestors(dirname(from));
    }

    async listFolders(): Promise<string[]> {
        const out: string[] = [];
        const recurse = async (dir: FileSystemDirectoryHandle, prefix: string) => {
            for await (const handle of dir.values()) {
                // Skip non-directories and dot-folders (.git, .obsidian, …).
                if (handle.kind !== 'directory' || handle.name.startsWith('.')) continue;
                // The root Attachments/ folder is media storage, not a user folder — hide it.
                if (prefix === '' && handle.name === ATTACHMENTS_DIR) continue;
                const path = `${prefix}${handle.name}`;
                out.push(path);
                await recurse(handle, `${path}/`);
            }
        };
        await recurse(this.dir, '');
        return out.sort();
    }

    /**
     * Every `.md` file in the tree (recursively), with its POSIX path id and file handle.
     * @yields each note file as `{id, handle}`.
     */
    private async *walkNotes(): AsyncGenerator<{id: string; handle: FileSystemFileHandle}> {
        const recurse = async function* (
            dir: FileSystemDirectoryHandle,
            prefix: string,
        ): AsyncGenerator<{id: string; handle: FileSystemFileHandle}> {
            for await (const handle of dir.values()) {
                if (handle.kind === 'directory') {
                    if (handle.name.startsWith('.')) continue; // skip dot-dirs (.git, .obsidian, …)
                    // Don't descend the root Attachments/ folder — its files aren't notes.
                    if (prefix === '' && handle.name === ATTACHMENTS_DIR) continue;
                    yield* recurse(handle, `${prefix}${handle.name}/`);
                } else if (handle.name.toLowerCase().endsWith(MD_EXT)) {
                    yield {id: `${prefix}${handle.name}`, handle};
                }
            }
        };
        yield* recurse(this.dir, '');
    }

    /** Best-effort recursive delete of a folder by path; a missing folder is a no-op (rollback aid). */
    private async discardDir(path: string): Promise<void> {
        const parent = await this.resolveDir(dirname(path));
        if (!parent) return;
        try {
            await parent.removeEntry(basename(path), {recursive: true});
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotFoundError') return;
            throw err;
        }
    }

    /** Total number of files (any kind, recursively) under a folder path; `0` for a missing folder. */
    private async countFiles(path: string): Promise<number> {
        const dir = await this.resolveDir(path);
        if (!dir) return 0;
        let count = 0;
        const recurse = async (handle: FileSystemDirectoryHandle): Promise<void> => {
            for await (const child of handle.values()) {
                if (child.kind === 'directory') await recurse(child);
                else count += 1;
            }
        };
        await recurse(dir);
        return count;
    }

    /** Whether `to` holds at least as many files as `from` — a cheap "copy looks complete" check. */
    private async treesMatch(from: string, to: string): Promise<boolean> {
        const [a, b] = await Promise.all([this.countFiles(from), this.countFiles(to)]);
        return b >= a;
    }

    /**
     * Copy `src`'s raw bytes into `dest/leaf` (creating the file), returning the new handle. Bytes —
     * not text — so a move/trash/restore of a note carrying non-UTF-8 content (or a binary file moved
     * with its folder via `copyTree`) survives intact instead of being mangled by a UTF-8
     * decode/encode round-trip.
     */
    private async copyFileBytes(
        src: FileSystemFileHandle,
        dest: FileSystemDirectoryHandle,
        leaf: string,
    ): Promise<FileSystemFileHandle> {
        const out = await dest.getFileHandle(leaf, {create: true});
        await writeFile(out, await src.getFile());
        return out;
    }

    /** Recursively copy every file under `from` into `to` (creating dirs), `.gnkeep` markers included. */
    private async copyTree(from: string, to: string): Promise<void> {
        const src = await this.resolveDir(from);
        const dest = await this.resolveDir(to, true);
        if (!src || !dest) return;
        for await (const handle of src.values()) {
            if (handle.kind === 'directory') {
                await this.copyTree(`${from}/${handle.name}`, `${to}/${handle.name}`);
            } else {
                // Copy raw bytes: a UTF-8 text round-trip would corrupt any binary file (a PDF/image a
                // user keeps beside their notes) or any non-UTF-8 note moved along with its folder.
                const out = await dest.getFileHandle(handle.name, {create: true});
                await writeFile(out, await (handle as FileSystemFileHandle).getFile());
            }
        }
    }

    /**
     * Walk per segment to the directory at `path` (`''` = root). With `create`, missing segments are
     * made; otherwise a missing segment yields `null` (so callers can map it to a not-found).
     */
    private async resolveDir(
        path: string,
        create = false,
    ): Promise<FileSystemDirectoryHandle | null> {
        let dir: FileSystemDirectoryHandle = this.dir;
        for (const segment of path.split('/')) {
            if (!segment) continue;
            try {
                dir = await dir.getDirectoryHandle(segment, {create});
            } catch (err) {
                if (!create && err instanceof DOMException && err.name === 'NotFoundError') {
                    return null;
                }
                throw err;
            }
        }
        return dir;
    }

    /** The file handle for note id `id`, or `null` if its folder or file is missing (`create=false`). */
    private async fileHandle(id: string, create = false): Promise<FileSystemFileHandle | null> {
        const dir = await this.resolveDir(dirname(id), create);
        if (!dir) return null;
        try {
            return await dir.getFileHandle(basename(id), {create});
        } catch (err) {
            if (!create && err instanceof DOMException && err.name === 'NotFoundError') {
                return null;
            }
            throw err;
        }
    }

    /** The handle for `leaf` directly inside `dir`, or `null` when no such file exists. */
    private async existingFileHandle(
        dir: FileSystemDirectoryHandle,
        leaf: string,
    ): Promise<FileSystemFileHandle | null> {
        try {
            return await dir.getFileHandle(leaf);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotFoundError') {
                return null;
            }
            throw err;
        }
    }

    /**
     * The actually-stored leaf name of the file `getFileHandle(leaf)` resolves to inside `dir`, or
     * `null` when none exists. Defers to the filesystem's OWN case rules (a real FSA / the fake both
     * hand back the existing entry's stored name): on a case-INSENSITIVE FS, `Note.md` resolves to a
     * stored `note.md`; on a case-SENSITIVE one it doesn't resolve at all. That lets rename() tell a
     * case-only rename's own source (stored name === source leaf) apart from a distinct collision
     * (stored name differs, or, on a case-sensitive FS, a separate file under the exact target name).
     * A directory occupying the name reports back as a taken (distinct) leaf, so rename() collides.
     */
    private async storedLeafName(
        dir: FileSystemDirectoryHandle,
        leaf: string,
    ): Promise<string | null> {
        try {
            const handle = await dir.getFileHandle(leaf);
            return handle.name;
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotFoundError') {
                return null;
            }
            // A directory occupies the name (TypeMismatchError): report it as a distinct "taken" leaf
            // so rename() rejects with a collision rather than surfacing a raw FSA error.
            if (err instanceof DOMException && err.name === 'TypeMismatchError') {
                return leaf;
            }
            throw err;
        }
    }

    private async existsIn(dir: FileSystemDirectoryHandle, leaf: string): Promise<boolean> {
        try {
            await dir.getFileHandle(leaf);
            return true;
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotFoundError') {
                return false;
            }
            // A directory (or other non-file entry) occupying the name throws TypeMismatchError;
            // treat it as "taken" so callers never try to create a file over it.
            if (err instanceof DOMException && err.name === 'TypeMismatchError') {
                return true;
            }
            throw err;
        }
    }

    /** Delete a single file out of `.trash/` (a missing one is a no-op), then prune the empty folder. */
    private async removeFromTrash(trashId: string): Promise<void> {
        const dir = await this.resolveDir(TRASH_DIR);
        if (!dir) return;
        try {
            await dir.removeEntry(basename(trashId));
        } catch (err) {
            if (!(err instanceof DOMException && err.name === 'NotFoundError')) throw err;
        }
        await this.pruneEmptyAncestors(TRASH_DIR);
    }

    /** Remove now-empty folders from `start` up toward (never including) the root. */
    private async pruneEmptyAncestors(start: string): Promise<void> {
        let folder = start;
        while (folder) {
            const dir = await this.resolveDir(folder);
            if (!dir || !(await this.isPrunable(dir))) break;
            const parent = await this.resolveDir(dirname(folder));
            if (!parent) break;
            try {
                await parent.removeEntry(basename(folder)); // non-recursive: only an empty dir
            } catch {
                break; // not empty (raced) or already gone — stop
            }
            folder = dirname(folder);
        }
    }

    /** Whether `dir` holds nothing worth keeping: no note, no `.gnkeep`, no subdir, no temp. */
    private async isPrunable(dir: FileSystemDirectoryHandle): Promise<boolean> {
        for await (const handle of dir.values()) {
            // The metadata sidecar only ever lives at the root (never pruned); ignore it defensively.
            if (handle.kind === 'file' && handle.name === METADATA_FILENAME) continue;
            return false; // a note, a .gnkeep marker, a subdir, or an in-flight temp keeps it
        }
        return true;
    }
}
