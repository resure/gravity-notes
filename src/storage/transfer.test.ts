import {IDBFactory} from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import {strFromU8, unzipSync, zipSync} from 'fflate';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {IndexedDbNoteStore} from './indexedDbStore';
import {buildExportZip, emptyFolderMarkers, importNotes} from './transfer';

function seedStore() {
    return new IndexedDbNoteStore();
}

async function withContent(store: IndexedDbNoteStore, title: string, body: string) {
    const meta = await store.create(title);
    await store.save(meta.id, body, meta.updatedAt ?? 0);
}

beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    // Base in 2023 (not the epoch) so fflate's zip date stamping stays in its valid 1980-2099 range,
    // while still strictly increasing for the store's updatedAt baseline.
    let clock = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => ++clock);
});

describe('transfer — export', () => {
    it('zips every note as a canonical .md file', async () => {
        const store = seedStore();
        await withContent(store, 'Alpha', 'hello alpha');
        await withContent(store, 'Beta', 'hello beta');

        const {zip, count} = await buildExportZip(store);
        expect(count).toBe(2);

        const entries = unzipSync(zip);
        expect(Object.keys(entries).sort()).toEqual(['Alpha.md', 'Beta.md']);
        // Canonical "blank line at EOF" shape, like the file-system store writes.
        expect(strFromU8(entries['Alpha.md'])).toBe('hello alpha\n\n');
    });

    it('nests a note under its folder path in the zip', async () => {
        const store = seedStore();
        const meta = await store.create('Plan', 'Work/Projects');
        await store.save(meta.id, 'plan body', meta.updatedAt ?? 0);

        const {zip} = await buildExportZip(store);
        const entries = unzipSync(zip);
        expect(Object.keys(entries)).toEqual(['Work/Projects/Plan.md']);
    });

    it('emits a .gnkeep marker only for empty folders, deepest per branch', async () => {
        const store = seedStore();
        // Work holds a note (implied by its path); Archive and Archive/2023 are empty.
        const meta = await store.create('Note', 'Work');
        await store.save(meta.id, 'work note', meta.updatedAt ?? 0);
        await store.createFolder('', 'Archive');
        await store.createFolder('Archive', '2023');

        const {zip} = await buildExportZip(store);
        const keys = Object.keys(unzipSync(zip)).sort();
        // Work is implied by its note; only the deepest empty folder gets a marker (Archive is
        // rebuilt from Archive/2023's marker on import).
        expect(keys).toEqual(['Archive/2023/.gnkeep', 'Work/Note.md']);
    });
});

describe('emptyFolderMarkers', () => {
    it('keeps empty folders and drops ones that contain notes', () => {
        expect(emptyFolderMarkers(['Work', 'Archive'], ['Work/Note.md'])).toEqual(['Archive']);
    });

    it('prunes an empty ancestor when an empty descendant carries the marker', () => {
        expect(emptyFolderMarkers(['Archive', 'Archive/2023'], [])).toEqual(['Archive/2023']);
    });
});

describe('transfer — import', () => {
    it('imports loose .md files as new notes', async () => {
        const store = seedStore();
        const files = [
            new File(['# Groceries\n\nmilk'], 'Groceries.md', {type: 'text/markdown'}),
            new File(['ideas here'], 'Ideas.md', {type: 'text/markdown'}),
        ];

        const count = await importNotes(store, files);
        expect(count).toBe(2);

        const titles = (await store.list()).map((m) => m.title).sort();
        expect(titles).toEqual(['Groceries', 'Ideas']);
        expect((await store.get('Groceries.md')).content).toBe('# Groceries\n\nmilk');
    });

    it('imports .md entries out of a .zip', async () => {
        const store = seedStore();
        const zip = zipSync({
            'export/One.md': new TextEncoder().encode('one body'),
            'export/Two.md': new TextEncoder().encode('two body'),
            'export/': new Uint8Array(), // directory entry — must be ignored
        });
        const zipFile = new File([zip as BlobPart], 'gravity-notes.zip', {type: 'application/zip'});

        const count = await importNotes(store, [zipFile]);
        expect(count).toBe(2);
        expect((await store.list()).map((m) => m.title).sort()).toEqual(['One', 'Two']);
    });

    it('preserves nested zip subfolders on import (phase 12)', async () => {
        const store = seedStore();
        const zip = zipSync({
            'Work/Projects/Plan.md': new TextEncoder().encode('plan body'),
            'Work/Note.md': new TextEncoder().encode('work note'),
            'Top.md': new TextEncoder().encode('top body'),
        });
        const count = await importNotes(store, [
            new File([zip as BlobPart], 'notes.zip', {type: 'application/zip'}),
        ]);
        expect(count).toBe(3);
        const ids = (await store.list()).map((m) => m.id).sort();
        expect(ids).toEqual(['Top.md', 'Work/Note.md', 'Work/Projects/Plan.md']);
        expect((await store.get('Work/Projects/Plan.md')).content).toBe('plan body');
    });

    it('recreates an empty folder from its .gnkeep marker without counting it', async () => {
        const store = seedStore();
        const zip = zipSync({
            'Top.md': new TextEncoder().encode('top body'),
            'Archive/2023/.gnkeep': new Uint8Array(),
        });
        const count = await importNotes(store, [
            new File([zip as BlobPart], 'notes.zip', {type: 'application/zip'}),
        ]);
        // The marker is not a note.
        expect(count).toBe(1);
        // But its (and its ancestor's) folder is rebuilt.
        expect((await store.listFolders()).sort()).toEqual(['Archive', 'Archive/2023']);
    });

    it('round-trips export → import preserving content', async () => {
        const source = seedStore();
        await withContent(source, 'Roundtrip', 'keep me exactly');
        const {zip} = await buildExportZip(source);

        vi.stubGlobal('indexedDB', new IDBFactory()); // a fresh, empty target store
        const target = new IndexedDbNoteStore();
        await importNotes(target, [new File([zip as BlobPart], 'gravity-notes.zip')]);

        expect((await target.get('Roundtrip.md')).content).toBe('keep me exactly');
    });

    it('round-trips an empty folder through export → import', async () => {
        const source = seedStore();
        await withContent(source, 'Kept', 'note body');
        await source.createFolder('', 'EmptyOnPurpose');
        const {zip} = await buildExportZip(source);

        vi.stubGlobal('indexedDB', new IDBFactory());
        const target = new IndexedDbNoteStore();
        await importNotes(target, [new File([zip as BlobPart], 'gravity-notes.zip')]);

        expect((await target.listFolders()).sort()).toEqual(['EmptyOnPurpose']);
        expect((await target.get('Kept.md')).content).toBe('note body');
    });
});

describe('transfer — attachments', () => {
    it('bundles attachments into the export zip at their exact refs', async () => {
        const store = seedStore();
        await withContent(store, 'Note', '![c](Attachments/cat.png)');
        await store.writeAttachmentAt('Attachments/cat.png', new Blob(['PNGBYTES']));

        const {zip} = await buildExportZip(store);
        const entries = unzipSync(zip);

        expect(Object.keys(entries)).toContain('Attachments/cat.png');
        expect(strFromU8(entries['Attachments/cat.png'])).toBe('PNGBYTES');
    });

    it('restores attachments (bytes + exact ref) on import into a fresh store', async () => {
        const store = seedStore();
        await withContent(store, 'Note', '![c](Attachments/cat.png)');
        await store.writeAttachmentAt('Attachments/cat.png', new Blob(['PNGBYTES']));
        const {zip} = await buildExportZip(store);

        vi.stubGlobal('indexedDB', new IDBFactory());
        const target = new IndexedDbNoteStore();
        await importNotes(target, [new File([zip as BlobPart], 'gravity-notes.zip')]);

        expect((await target.listAttachments()).map((a) => a.ref)).toEqual(['Attachments/cat.png']);
        expect(await (await target.readAttachment('Attachments/cat.png')).text()).toBe('PNGBYTES');
        // The imported note still references the same path, so the image still resolves.
        expect((await target.get('Note.md')).content).toContain('Attachments/cat.png');
    });

    it('does not clobber an attachment that already exists in the target', async () => {
        const store = seedStore();
        await withContent(store, 'Note', '![c](Attachments/cat.png)');
        await store.writeAttachmentAt('Attachments/cat.png', new Blob(['IMPORTED']));
        const {zip} = await buildExportZip(store);

        vi.stubGlobal('indexedDB', new IDBFactory());
        const target = new IndexedDbNoteStore();
        await target.writeAttachmentAt('Attachments/cat.png', new Blob(['ORIGINAL']));
        await importNotes(target, [new File([zip as BlobPart], 'gravity-notes.zip')]);

        // The pre-existing file wins (skip-if-exists), so it isn't overwritten by the import.
        expect(await (await target.readAttachment('Attachments/cat.png')).text()).toBe('ORIGINAL');
    });

    it('imports a case-variant attachment as a distinct file on the case-sensitive backend', async () => {
        // On IndexedDB (case-sensitive keys), `Attachments/Cat.png` and `Attachments/cat.png` are
        // genuinely different files. The skip-check is by EXACT ref, so the imported Cat.png is kept
        // as its own entry (a case-insensitive skip would wrongly drop it and break the note's link),
        // and the pre-existing cat.png is left untouched.
        const zip = zipSync({'Attachments/Cat.png': new TextEncoder().encode('IMPORTED')});
        const target = new IndexedDbNoteStore();
        await target.writeAttachmentAt('Attachments/cat.png', new Blob(['ORIGINAL']));
        await importNotes(target, [new File([zip as BlobPart], 'gravity-notes.zip')]);

        expect(await (await target.readAttachment('Attachments/cat.png')).text()).toBe('ORIGINAL');
        expect(await (await target.readAttachment('Attachments/Cat.png')).text()).toBe('IMPORTED');
    });

    it('sanitizes a traversal attachment ref to a flat Attachments/<name>', async () => {
        // A crafted `Attachments/../evil.png` must not escape the attachments folder: it's rebuilt as
        // the flat, sanitized `Attachments/evil.png` before writing.
        const zip = zipSync({'Attachments/../evil.png': new TextEncoder().encode('PWNED')});
        const target = new IndexedDbNoteStore();
        await importNotes(target, [new File([zip as BlobPart], 'gravity-notes.zip')]);

        expect((await target.listAttachments()).map((a) => a.ref)).toEqual([
            'Attachments/evil.png',
        ]);
        expect(await (await target.readAttachment('Attachments/evil.png')).text()).toBe('PWNED');
    });
});
