import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';

import {
    ATTACHMENTS_DIR,
    FOLDER_MARKER,
    MD_EXT,
    canonicalBody,
    dirname,
    isAttachmentRef,
    joinPath,
    sanitizeDir,
    sanitizeSegment,
    titleFromFileName,
} from './noteText';
import type {NoteStore} from './types';

/** Last path segment of a (possibly nested) zip entry / file name. */
function baseName(path: string): string {
    return path.split('/').pop() ?? path;
}

/**
 * The minimal set of folders worth an empty-folder marker in an export: folders that hold no notes
 * anywhere beneath them, pruned to the deepest such folders (a kept folder's ancestors get rebuilt
 * automatically when its marker is imported, so one marker per empty branch suffices). A folder that
 * contains notes needs no marker — its nested note paths already imply it. Pure, so it's
 * unit-testable without a store.
 */
export function emptyFolderMarkers(folders: string[], noteIds: string[]): string[] {
    const hasNotes = (folder: string) => noteIds.some((id) => id.startsWith(`${folder}/`));
    const empty = folders.filter((folder) => folder && !hasNotes(folder));
    return empty.filter((folder) => !empty.some((other) => other.startsWith(`${folder}/`)));
}

function downloadBlob(bytes: Uint8Array, filename: string, type: string): void {
    // Cast to BlobPart: fflate types its output as Uint8Array<ArrayBufferLike>, which the strict
    // typed-array lib won't narrow to BufferSource, but it's a valid Blob part at runtime.
    const blob = new Blob([bytes as BlobPart], {type});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Defer the revoke past the current task: revoking synchronously after click() can cancel a
    // large download mid-flight in some browsers (the URL is freed before the fetch starts).
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Bundle every note as a `.md` file into a zip (pure — no DOM), returning the bytes and count.
 * Split out from {@link exportNotes} so it's testable without a browser download.
 */
export async function buildExportZip(store: NoteStore): Promise<{zip: Uint8Array; count: number}> {
    const metas = await store.list();
    const files: Record<string, Uint8Array> = {};
    const noteIds: string[] = [];
    for (const meta of metas) {
        const note = await store.get(meta.id);
        const name = note.id.toLowerCase().endsWith(MD_EXT) ? note.id : note.id + MD_EXT;
        files[name] = strToU8(canonicalBody(note.content));
        noteIds.push(name);
    }
    // Preserve deliberately-empty folders: a `.gnkeep` marker per empty branch, so an
    // export → import roundtrip rebuilds the same tree. Folders that hold notes are already implied
    // by those notes' nested paths and need no marker.
    const folders = await store.listFolders();
    for (const folder of emptyFolderMarkers(folders, noteIds)) {
        files[`${folder}/${FOLDER_MARKER}`] = new Uint8Array();
    }
    // Bundle media attachments under `Attachments/` (at their exact refs), so images survive the
    // roundtrip — essential for the IndexedDB backend, whose attachments live in the DB, not on disk.
    for (const att of await store.listAttachments()) {
        const blob = await store.readAttachment(att.ref);
        files[att.ref] = new Uint8Array(await blob.arrayBuffer());
    }
    return {zip: zipSync(files), count: metas.length};
}

/**
 * Export every note as a `.md` file in a single downloaded zip. Works for any backend, and is the
 * way to get plain files out of in-browser storage. Returns the number of notes exported.
 */
export async function exportNotes(
    store: NoteStore,
    filename = 'gravity-notes.zip',
): Promise<number> {
    const {zip, count} = await buildExportZip(store);
    downloadBlob(zip, filename, 'application/zip');
    return count;
}

async function importOne(
    store: NoteStore,
    filename: string,
    content: string,
    parentPath = '',
): Promise<void> {
    const title = titleFromFileName(baseName(filename));
    // create() sanitizes the title + folder path, creates the folder if needed, and resolves
    // collisions; save() writes the body. Note: the zip carries no per-note `created` stamp, so
    // import doesn't preserve creation time/ordering — `create()` stamps each note "now". A
    // 'created'-sorted list of imported notes reflects import order, not the original order.
    const meta = await store.create(title, parentPath || undefined);
    await store.save(meta.id, content, meta.updatedAt ?? 0);
}

/**
 * Import `.md` files (and/or `.zip` archives of them) into the given store as new notes. Title is
 * derived from each file name; collisions are auto-numbered by the store. Returns the number
 * imported. Callers should refresh the note list afterward.
 */
export async function importNotes(store: NoteStore, files: FileList | File[]): Promise<number> {
    let count = 0;
    // Don't clobber attachments already in the target: a ref present here is left as-is (an imported
    // note then resolves to the existing file). Restoring into a fresh store writes them all. The
    // comparison is by EXACT ref — case-insensitive matching would, on the case-sensitive IndexedDB
    // backend, drop a genuinely-distinct `Attachments/Cat.png` when `Attachments/cat.png` exists,
    // breaking the imported note's link. (On a case-insensitive folder backend an exact-case variant
    // from a foreign zip can still overwrite an existing file, but an export→import round-trip always
    // uses the exact stored name, so that's a rare, foreign-zip-only edge.)
    const existingAttachments = new Set((await store.listAttachments()).map((a) => a.ref));
    for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.zip')) {
            const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
            for (const [path, bytes] of Object.entries(entries)) {
                if (baseName(path) === FOLDER_MARKER) {
                    // An empty-folder marker (see buildExportZip): recreate the folder so the tree
                    // survives the roundtrip. It's not a note, so it doesn't count toward the total.
                    const dir = sanitizeDir(dirname(path));
                    if (dir) await store.createFolder(dirname(dir), baseName(dir));
                    continue;
                }
                if (isAttachmentRef(path)) {
                    // A media attachment: restore it so the importing notes' `![](Attachments/<name>)`
                    // links keep resolving. `isAttachmentRef` only checks the `Attachments/` prefix, so
                    // rebuild the ref as a flat, sanitized `Attachments/<name>` — a crafted zip path
                    // like `Attachments/../x` can't then traverse out of the attachments folder.
                    const ref = joinPath(ATTACHMENTS_DIR, sanitizeSegment(baseName(path)));
                    if (!existingAttachments.has(ref)) {
                        await store.writeAttachmentAt(ref, new Blob([bytes as BlobPart]));
                        existingAttachments.add(ref);
                    }
                    continue;
                }
                if (!path.toLowerCase().endsWith(MD_EXT)) continue; // skip dir entries / non-md
                // Preserve the entry's subfolder path (sanitized: drops `.`/`..`), so a zip exported
                // with nested folders re-imports into the same structure instead of flattening.
                await importOne(store, path, strFromU8(bytes), sanitizeDir(dirname(path)));
                count += 1;
            }
        } else if (lower.endsWith(MD_EXT)) {
            await importOne(store, file.name, await file.text());
            count += 1;
        }
    }
    return count;
}
