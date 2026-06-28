import {invoke} from '@tauri-apps/api/core';

import {METADATA_FILENAME, parseMetadata} from './metadata';
import {
    ATTACHMENTS_DIR,
    MD_EXT,
    basename,
    canonicalBody,
    dirname,
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
        const entry = await invoke<NoteFull | null>('notes_read_opt', {dir: this.dir, name: id});
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

    async writeAttachment(file: File): Promise<string> {
        const leaf = await uniqueAttachmentName(file.name, (name) =>
            this.exists(joinPath(ATTACHMENTS_DIR, name)),
        );
        const path = joinPath(ATTACHMENTS_DIR, leaf);
        const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
        await invoke('attachment_write', {dir: this.dir, path, bytes});
        return path;
    }

    async writeAttachmentAt(ref: string, blob: Blob): Promise<void> {
        // attachment_write already writes at an exact path (creating parent folders), so reuse it.
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        await invoke('attachment_write', {dir: this.dir, path: ref, bytes});
    }

    async readAttachment(ref: string): Promise<Blob> {
        const bytes = await invoke<number[] | null>('attachment_read', {dir: this.dir, name: ref});
        if (bytes === null) throw notFound(ref);
        // The Rust side returns raw bytes without a MIME type; tag the Blob from the extension so
        // SVGs (which need an explicit type to render in <img>) and the like display correctly.
        return new Blob([new Uint8Array(bytes)], {type: mimeFromName(ref)});
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
        const path = joinPath(sanitizeDir(parentPath), sanitizeSegment(name));
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

    async readMetadata(): Promise<NotesMetadata> {
        const entry = await invoke<NoteFull | null>('notes_read_opt', {
            dir: this.dir,
            name: METADATA_FILENAME,
        });
        if (!entry) return parseMetadata({}); // no dotfile yet → fresh defaults
        try {
            return parseMetadata(JSON.parse(entry.content));
        } catch {
            return parseMetadata({}); // corrupt JSON → fresh defaults rather than crashing
        }
    }

    async writeMetadata(meta: NotesMetadata): Promise<void> {
        await this.write(METADATA_FILENAME, JSON.stringify(meta, null, 2));
    }

    /** Atomic write (temp + rename, Rust side); returns the file's new mtime in epoch ms. */
    private write(name: string, content: string): Promise<number> {
        return invoke<number>('notes_write', {dir: this.dir, name, content});
    }

    private exists(name: string): Promise<boolean> {
        return invoke<boolean>('notes_exists', {dir: this.dir, name});
    }
}
