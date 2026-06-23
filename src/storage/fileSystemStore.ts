import {METADATA_FILENAME, parseMetadata} from './metadata';
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

/**
 * Write text to a file handle, aborting the writable on failure so a half-written stream isn't
 * left dangling. The File System Access API commits a writable atomically only on close(), so the
 * original file is untouched if write() throws before then.
 */
async function writeFile(handle: FileSystemFileHandle, text: string): Promise<void> {
    const writable = await handle.createWritable();
    try {
        await writable.write(text);
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

/**
 * Notes stored as individual `.md` files in a user-picked directory, accessed
 * through the File System Access API. The file name (with extension) is the note
 * id; the file name without `.md` is the title.
 */
export class FileSystemNoteStore implements NoteStore {
    /** False until the FSA list()/getAll() walk descends into subdirectories (phase 11). */
    readonly listsRecursively = false;

    constructor(private readonly dir: FileSystemDirectoryHandle) {}

    async list(): Promise<NoteMeta[]> {
        const metas: NoteMeta[] = [];
        for await (const handle of this.dir.values()) {
            if (handle.kind !== 'file' || !handle.name.toLowerCase().endsWith(MD_EXT)) {
                continue;
            }
            const file = await (handle as FileSystemFileHandle).getFile();
            // Read only the head of each file — enough for a one-line list preview.
            const head = await file.slice(0, PREVIEW_SCAN_BYTES).text();
            metas.push({
                id: handle.name,
                title: titleFromFileName(handle.name),
                updatedAt: file.lastModified,
                preview: previewFromContent(head),
            });
        }
        metas.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        return metas;
    }

    async getAll(): Promise<Note[]> {
        const notes: Note[] = [];
        for await (const handle of this.dir.values()) {
            if (handle.kind !== 'file' || !handle.name.toLowerCase().endsWith(MD_EXT)) {
                continue;
            }
            const file = await (handle as FileSystemFileHandle).getFile();
            notes.push({
                id: handle.name,
                title: titleFromFileName(handle.name),
                updatedAt: file.lastModified,
                // Stripped to match get()/the editor's serialized shape (parity for the search corpus).
                content: stripTrailingNewlines(await file.text()),
            });
        }
        return notes;
    }

    async get(id: string): Promise<Note> {
        const handle = await this.dir.getFileHandle(id);
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

    async create(title: string): Promise<NoteMeta> {
        const fileName = await uniqueName(sanitizeTitle(title), (name) => this.exists(name));
        const handle = await this.dir.getFileHandle(fileName, {create: true});
        // Write the canonical "blank line at EOF" shape save() produces, so a brand-new note has a
        // consistent on-disk shape for external tools rather than a zero-byte file. get() strips it
        // back to an empty body, so the editor still opens to a blank note with no spurious save.
        await writeFile(handle, canonicalBody(''));
        const updatedAt = (await handle.getFile()).lastModified;
        return {id: fileName, title: titleFromFileName(fileName), updatedAt};
    }

    async save(id: string, content: string, baseUpdatedAt: number): Promise<NoteMeta> {
        const handle = await this.dir.getFileHandle(id);
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
        try {
            const handle = await this.dir.getFileHandle(id);
            return (await handle.getFile()).lastModified;
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotFoundError') {
                return null;
            }
            throw err;
        }
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
        const nextName = base + MD_EXT;
        if (nextName === id) {
            return {id, title: titleFromFileName(id)};
        }
        // A case-only rename (note.md → Note.md) is the SAME file on a case-insensitive
        // filesystem (macOS/Windows default): the collision check below would see the source as a
        // collision, and a naive copy-then-delete would delete the file we just wrote.
        const caseOnlyRename = nextName.toLowerCase() === id.toLowerCase();
        // Renaming onto another note's name is rejected (no auto-numbered copy); the caller
        // surfaces it to the user. Skipped for a case-only rename (the only "match" is itself).
        if (!caseOnlyRename && (await this.exists(nextName))) {
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
            const tempName = `${nextName}.rename-tmp`;
            const tempHandle = await this.dir.getFileHandle(tempName, {create: true});
            await writeFile(tempHandle, canonicalBody(content));
            await this.dir.removeEntry(id);
            const renamed = await this.dir.getFileHandle(nextName, {create: true});
            await writeFile(renamed, canonicalBody(content));
            await this.dir.removeEntry(tempName);
            const updatedAt = (await renamed.getFile()).lastModified;
            return {id: nextName, title: titleFromFileName(nextName), updatedAt};
        }
        const handle = await this.dir.getFileHandle(nextName, {create: true});
        await writeFile(handle, canonicalBody(content));
        await this.dir.removeEntry(id);
        // Read the real on-disk mtime so the caller can seed an accurate conflict baseline.
        const updatedAt = (await handle.getFile()).lastModified;
        return {id: nextName, title: titleFromFileName(nextName), updatedAt};
    }

    async remove(id: string): Promise<void> {
        await this.dir.removeEntry(id);
    }

    private async exists(fileName: string): Promise<boolean> {
        try {
            await this.dir.getFileHandle(fileName);
            return true;
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotFoundError') {
                return false;
            }
            throw err;
        }
    }
}
