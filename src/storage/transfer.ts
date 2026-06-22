import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';

import {MD_EXT, canonicalBody, titleFromFileName} from './noteText';
import type {NoteStore} from './types';

/** Last path segment of a (possibly nested) zip entry / file name. */
function baseName(path: string): string {
    return path.split('/').pop() ?? path;
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
    URL.revokeObjectURL(url);
}

/**
 * Bundle every note as a `.md` file into a zip (pure — no DOM), returning the bytes and count.
 * Split out from {@link exportNotes} so it's testable without a browser download.
 */
export async function buildExportZip(store: NoteStore): Promise<{zip: Uint8Array; count: number}> {
    const metas = await store.list();
    const files: Record<string, Uint8Array> = {};
    for (const meta of metas) {
        const note = await store.get(meta.id);
        const name = note.id.toLowerCase().endsWith(MD_EXT) ? note.id : note.id + MD_EXT;
        files[name] = strToU8(canonicalBody(note.content));
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

async function importOne(store: NoteStore, filename: string, content: string): Promise<void> {
    const title = titleFromFileName(baseName(filename));
    // create() sanitizes the title and resolves collisions; save() writes the body.
    const meta = await store.create(title);
    await store.save(meta.id, content, meta.updatedAt ?? 0);
}

/**
 * Import `.md` files (and/or `.zip` archives of them) into the given store as new notes. Title is
 * derived from each file name; collisions are auto-numbered by the store. Returns the number
 * imported. Callers should refresh the note list afterward.
 */
export async function importNotes(store: NoteStore, files: FileList | File[]): Promise<number> {
    let count = 0;
    for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.zip')) {
            const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
            for (const [path, bytes] of Object.entries(entries)) {
                if (!path.toLowerCase().endsWith(MD_EXT)) continue; // skip dir entries / non-md
                await importOne(store, path, strFromU8(bytes));
                count += 1;
            }
        } else if (lower.endsWith(MD_EXT)) {
            await importOne(store, file.name, await file.text());
            count += 1;
        }
    }
    return count;
}
