import {IDBFactory} from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {IndexedDbNoteStore} from './indexedDbStore';
import {ConflictError, NameCollisionError} from './types';

describe('IndexedDbNoteStore', () => {
    let store: IndexedDbNoteStore;

    beforeEach(() => {
        // Fresh in-memory IndexedDB per test so notes don't leak between cases.
        vi.stubGlobal('indexedDB', new IDBFactory());
        // Deterministic, strictly-increasing timestamps so ordering/baseline assertions don't
        // depend on real-clock millisecond granularity.
        let clock = 1000;
        vi.spyOn(Date, 'now').mockImplementation(() => ++clock);
        store = new IndexedDbNoteStore();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('create / get / list', () => {
        it('creates an empty note with the given title', async () => {
            const meta = await store.create('Shopping');

            expect(meta).toMatchObject({id: 'Shopping.md', title: 'Shopping'});
            expect((await store.get('Shopping.md')).content).toBe('');
        });

        it('resolves title collisions with a numeric suffix', async () => {
            await store.create('Untitled');
            const second = await store.create('Untitled');
            const third = await store.create('Untitled');

            expect(second.id).toBe('Untitled 2.md');
            expect(third.id).toBe('Untitled 3.md');
        });

        it('lists notes newest-first with derived titles and a stripped preview', async () => {
            const a = await store.create('Alpha');
            await store.save(a.id, '# Alpha\n\nbody', a.updatedAt ?? 0);
            await store.create('Beta');

            const metas = await store.list();
            // Beta was created last, so it sorts first by updatedAt.
            expect(metas.map((m) => m.title)).toEqual(['Beta', 'Alpha']);
            const alpha = metas.find((m) => m.id === 'Alpha.md');
            expect(alpha?.preview).toBe('Alpha body');
        });

        it('throws NotFoundError when getting a missing note', async () => {
            await expect(store.get('Ghost.md')).rejects.toMatchObject({name: 'NotFoundError'});
        });
    });

    describe('getAll', () => {
        it('returns every note with its full body (trailing newline stripped)', async () => {
            const a = await store.create('Alpha');
            await store.save(a.id, '# Alpha\n\nfull alpha body', a.updatedAt ?? 0);
            await store.create('Beta');

            const all = await store.getAll();

            expect(all.map((n) => n.id).sort()).toEqual(['Alpha.md', 'Beta.md']);
            expect(all.find((n) => n.id === 'Alpha.md')?.content).toBe(
                '# Alpha\n\nfull alpha body',
            );
            expect(all.find((n) => n.id === 'Beta.md')?.content).toBe('');
        });
    });

    describe('save', () => {
        it('round-trips content and ends the stored body with a blank line', async () => {
            const meta = await store.create('Note');

            await store.save('Note.md', 'no newline', meta.updatedAt ?? 0);

            expect((await store.get('Note.md')).content).toBe('no newline');
        });

        it('returns a strictly newer updatedAt so the next save has a fresh baseline', async () => {
            const created = await store.create('Note');
            const first = await store.save('Note.md', 'a', created.updatedAt ?? 0);
            const second = await store.save('Note.md', 'b', first.updatedAt ?? 0);

            expect(second.updatedAt).toBeGreaterThan(first.updatedAt ?? 0);
            expect((await store.get('Note.md')).content).toBe('b');
        });

        it('throws ConflictError when the baseline is stale', async () => {
            const created = await store.create('Note');
            await store.save('Note.md', 'a', created.updatedAt ?? 0); // bumps updatedAt

            // Saving again with the original (now stale) baseline is a conflict.
            await expect(store.save('Note.md', 'b', created.updatedAt ?? 0)).rejects.toBeInstanceOf(
                ConflictError,
            );
        });

        it('throws NotFoundError when saving a deleted note', async () => {
            const created = await store.create('Note');
            await store.remove('Note.md');

            await expect(store.save('Note.md', 'x', created.updatedAt ?? 0)).rejects.toMatchObject({
                name: 'NotFoundError',
            });
        });
    });

    describe('rename', () => {
        it('is a no-op when the title is unchanged', async () => {
            await store.create('Note');
            const meta = await store.rename('Note.md', 'Note');
            expect(meta.id).toBe('Note.md');
        });

        it('moves content to the new id and removes the old one', async () => {
            const created = await store.create('Old');
            await store.save('Old.md', 'keep me', created.updatedAt ?? 0);

            const meta = await store.rename('Old.md', 'New');

            expect(meta.id).toBe('New.md');
            expect((await store.get('New.md')).content).toBe('keep me');
            expect(await store.stat('Old.md')).toBeNull();
        });

        it('changes only the case of a title (case-sensitive keys)', async () => {
            await store.create('note');
            const meta = await store.rename('note.md', 'Note');

            expect(meta.id).toBe('Note.md');
            expect((await store.list()).map((m) => m.id)).toEqual(['Note.md']);
        });

        it('throws NameCollisionError when the target id is taken', async () => {
            await store.create('Old');
            await store.create('Taken');

            await expect(store.rename('Old.md', 'Taken')).rejects.toBeInstanceOf(
                NameCollisionError,
            );
            expect(await store.stat('Old.md')).not.toBeNull();
        });
    });

    describe('remove / stat', () => {
        it('deletes a note', async () => {
            await store.create('Gone');
            await store.remove('Gone.md');
            expect(await store.stat('Gone.md')).toBeNull();
        });

        it('returns null stat for a missing note', async () => {
            expect(await store.stat('Ghost.md')).toBeNull();
        });
    });

    describe('metadata', () => {
        it('returns defaults when nothing is stored', async () => {
            expect(await store.readMetadata()).toEqual({
                version: 1,
                sort: 'updated',
                pinned: [],
                created: {},
                active: null,
            });
        });

        it('round-trips metadata through write/read', async () => {
            await store.writeMetadata({
                version: 1,
                sort: 'title',
                pinned: ['Ideas.md'],
                created: {'Ideas.md': 123},
                active: 'Ideas.md',
            });
            const meta = await store.readMetadata();
            expect(meta.sort).toBe('title');
            expect(meta.pinned).toEqual(['Ideas.md']);
            expect(meta.active).toBe('Ideas.md');
        });

        it('persists across a fresh store instance on the same database', async () => {
            const created = await store.create('Persisted');
            await store.save('Persisted.md', 'survives', created.updatedAt ?? 0);

            const reopened = new IndexedDbNoteStore();
            expect((await reopened.get('Persisted.md')).content).toBe('survives');
        });
    });
});
