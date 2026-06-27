import {METADATA_FILENAME, parseMetadata} from './metadata';
import {
    ATTACHMENTS_DIR,
    FOLDER_MARKER,
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
            const file = await handle.getFile();
            // Read only the head of each file — enough for a one-line list preview.
            const head = await file.slice(0, PREVIEW_SCAN_BYTES).text();
            metas.push({
                id,
                title: titleFromFileName(id),
                updatedAt: file.lastModified,
                preview: previewFromContent(head),
            });
        }
        metas.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        return metas;
    }

    async getAll(): Promise<Note[]> {
        const notes: Note[] = [];
        for await (const {id, handle} of this.walkNotes()) {
            const file = await handle.getFile();
            notes.push({
                id,
                title: titleFromFileName(id),
                updatedAt: file.lastModified,
                // Stripped to match get()/the editor's serialized shape (parity for the search corpus).
                content: stripTrailingNewlines(await file.text()),
            });
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
        // A case-only rename (note.md → Note.md) is the SAME file on a case-insensitive
        // filesystem (macOS/Windows default): the collision check below would see the source as a
        // collision, and a naive copy-then-delete would delete the file we just wrote.
        const caseOnlyRename = nextName.toLowerCase() === id.toLowerCase();
        const dir = await this.resolveDir(folder);
        if (!dir) throw notFound(id);
        const oldLeaf = basename(id);
        const nextLeaf = base + MD_EXT;
        // Renaming onto another note's name is rejected (no auto-numbered copy); the caller
        // surfaces it to the user. Skipped for a case-only rename (the only "match" is itself).
        if (!caseOnlyRename && (await this.existsIn(dir, nextLeaf))) {
            throw new NameCollisionError(id, base);
        }
        // The File System Access API has no atomic rename. Write the same canonical shape save()
        // produces (a blank line at EOF) so a rename doesn't change the file's trailing whitespace
        // (renames are frequent now that editing the title renames the file).
        const content = (await this.get(id)).content;
        if (caseOnlyRename) {
            // Go through a distinct temp name so the case actually changes on a case-insensitive
            // FS and the original is never the copy target. The temp doesn't end in `.md`, so
            // list() ignores it even transiently.
            const tempLeaf = `${nextLeaf}.rename-tmp`;
            const tempHandle = await dir.getFileHandle(tempLeaf, {create: true});
            await writeFile(tempHandle, canonicalBody(content));
            await dir.removeEntry(oldLeaf);
            const renamed = await dir.getFileHandle(nextLeaf, {create: true});
            await writeFile(renamed, canonicalBody(content));
            await dir.removeEntry(tempLeaf);
            const updatedAt = (await renamed.getFile()).lastModified;
            return {id: nextName, title: titleFromFileName(nextName), updatedAt};
        }
        const handle = await dir.getFileHandle(nextLeaf, {create: true});
        await writeFile(handle, canonicalBody(content));
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
        // Read the source first, so a missing note maps to a deleted-conflict before any writes
        // (matches IndexedDb/Tauri and leaves a colliding move with no side effects).
        const content = (await this.get(id)).content;
        const dest = await this.resolveDir(folder, true);
        if (!dest) throw new Error(`Could not open folder "${folder}"`);
        const leaf = basename(id);
        if (await this.existsIn(dest, leaf)) {
            throw new NameCollisionError(id, titleFromFileName(id));
        }
        // No atomic cross-folder rename in the FSA: copy into the destination, then delete the
        // source (the write bumps mtime — we return the real new one so the baseline re-seeds).
        const destHandle = await dest.getFileHandle(leaf, {create: true});
        await writeFile(destHandle, canonicalBody(content));
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

    async writeAttachment(file: File): Promise<string> {
        const dir = await this.resolveDir(ATTACHMENTS_DIR, true);
        if (!dir) throw new Error('Could not open the Attachments folder');
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
        const dir = await this.resolveDir(ATTACHMENTS_DIR);
        if (!dir) return;
        try {
            await dir.removeEntry(basename(ref));
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotFoundError') return;
            throw err;
        }
    }

    async createFolder(parentPath: string, name: string): Promise<string> {
        const path = joinPath(sanitizeDir(parentPath), sanitizeSegment(name));
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

    /** Recursively copy every file under `from` into `to` (creating dirs), `.gnkeep` markers included. */
    private async copyTree(from: string, to: string): Promise<void> {
        const src = await this.resolveDir(from);
        const dest = await this.resolveDir(to, true);
        if (!src || !dest) return;
        for await (const handle of src.values()) {
            if (handle.kind === 'directory') {
                await this.copyTree(`${from}/${handle.name}`, `${to}/${handle.name}`);
            } else {
                const text = await (await (handle as FileSystemFileHandle).getFile()).text();
                const out = await dest.getFileHandle(handle.name, {create: true});
                await writeFile(out, text);
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

    private async existsIn(dir: FileSystemDirectoryHandle, leaf: string): Promise<boolean> {
        try {
            await dir.getFileHandle(leaf);
            return true;
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotFoundError') {
                return false;
            }
            throw err;
        }
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
