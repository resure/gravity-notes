import {IDBFactory} from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import {strFromU8, unzipSync, zipSync} from 'fflate';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {IndexedDbNoteStore} from './indexedDbStore';
import {buildExportZip, importNotes} from './transfer';

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

    it('round-trips export → import preserving content', async () => {
        const source = seedStore();
        await withContent(source, 'Roundtrip', 'keep me exactly');
        const {zip} = await buildExportZip(source);

        vi.stubGlobal('indexedDB', new IDBFactory()); // a fresh, empty target store
        const target = new IndexedDbNoteStore();
        await importNotes(target, [new File([zip as BlobPart], 'gravity-notes.zip')]);

        expect((await target.get('Roundtrip.md')).content).toBe('keep me exactly');
    });
});
