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

    describe('folders: nested create / move', () => {
        it('creates a note inside a subfolder with a basename title', async () => {
            const meta = await store.create('Roadmap', 'Work');
            expect(meta).toMatchObject({id: 'Work/Roadmap.md', title: 'Roadmap'});
            expect((await store.get('Work/Roadmap.md')).content).toBe('');
            // list()/getAll() derive the leaf title, not the folder-prefixed path.
            expect((await store.list())[0].title).toBe('Roadmap');
        });

        it('creates in a deeply nested folder', async () => {
            const meta = await store.create('Deep', 'Work/Sub/Folder');
            expect(meta.id).toBe('Work/Sub/Folder/Deep.md');
        });

        it('sanitizes the parent path so it cannot escape the root', async () => {
            const meta = await store.create('X', '../../etc');
            expect(meta.id).toBe('etc/X.md');
        });

        it('scopes collision-numbering to the target folder', async () => {
            const inbox = await store.create('Notes', 'Inbox');
            const archive = await store.create('Notes', 'Archive');
            const inbox2 = await store.create('Notes', 'Inbox');
            expect(inbox.id).toBe('Inbox/Notes.md');
            expect(archive.id).toBe('Archive/Notes.md'); // same leaf, different folder → no suffix
            expect(inbox2.id).toBe('Inbox/Notes 2.md'); // same folder → numbered
        });

        it('moves a note into another folder, preserving content and mtime', async () => {
            const created = await store.create('Note', 'Inbox');
            const saved = await store.save('Inbox/Note.md', 'keep me', created.updatedAt ?? 0);

            const moved = await store.move('Inbox/Note.md', 'Archive');

            expect(moved).toMatchObject({id: 'Archive/Note.md', title: 'Note'});
            expect(moved.updatedAt).toBe(saved.updatedAt); // pure relocation: mtime unchanged
            expect((await store.get('Archive/Note.md')).content).toBe('keep me');
            expect(await store.stat('Inbox/Note.md')).toBeNull();
        });

        it('moves a nested note back to the root', async () => {
            await store.create('Note', 'Inbox');
            const moved = await store.move('Inbox/Note.md', '');
            expect(moved.id).toBe('Note.md');
            expect(await store.stat('Inbox/Note.md')).toBeNull();
        });

        it('is a no-op when moving into the folder the note already lives in', async () => {
            const created = await store.create('Note', 'Inbox');
            const moved = await store.move('Inbox/Note.md', 'Inbox');
            expect(moved.id).toBe('Inbox/Note.md');
            expect(moved.updatedAt).toBe(created.updatedAt);
        });

        it('hard-fails a move onto an existing same-leaf note, leaving the source intact', async () => {
            await store.create('Note', 'Inbox');
            await store.create('Note', 'Archive');

            await expect(store.move('Inbox/Note.md', 'Archive')).rejects.toBeInstanceOf(
                NameCollisionError,
            );
            expect(await store.stat('Inbox/Note.md')).not.toBeNull();
        });

        it('throws NotFoundError when moving a missing note', async () => {
            await expect(store.move('Ghost/Note.md', 'Archive')).rejects.toMatchObject({
                name: 'NotFoundError',
            });
        });

        it('renames a nested note within its own folder (leaf-only)', async () => {
            await store.create('Old', 'Work');
            const meta = await store.rename('Work/Old.md', 'New');
            expect(meta.id).toBe('Work/New.md');
            expect(await store.stat('Work/Old.md')).toBeNull();
            expect((await store.list()).map((m) => m.id)).toContain('Work/New.md');
        });
    });

    describe('empty folders', () => {
        it('lists folders implied by notes plus deliberately-created empty ones', async () => {
            await store.create('Note', 'Work/Sub');
            await store.createFolder('', 'Projects');
            expect(await store.listFolders()).toEqual(['Projects', 'Work', 'Work/Sub']);
        });

        it('createFolder is idempotent and returns the sanitized path', async () => {
            expect(await store.createFolder('Work', 'Plans')).toBe('Work/Plans');
            await store.createFolder('Work', 'Plans');
            expect((await store.listFolders()).filter((f) => f === 'Work/Plans')).toHaveLength(1);
        });

        it('keeps a marked folder after its last note leaves, but drops an implicit one', async () => {
            await store.create('Note', 'Implicit');
            await store.create('Note', 'Marked');
            await store.createFolder('', 'Marked');

            await store.remove('Implicit/Note.md');
            await store.remove('Marked/Note.md');

            // Implicit/ vanishes (only existed via its note); Marked/ survives via its marker.
            expect(await store.listFolders()).toEqual(['Marked']);
        });

        it('removeFolder drops an empty folder marker', async () => {
            await store.createFolder('', 'Temp');
            expect(await store.listFolders()).toContain('Temp');
            await store.removeFolder('Temp');
            expect(await store.listFolders()).not.toContain('Temp');
        });
    });

    describe('folders: moveFolder (rename + reparent)', () => {
        it('renames a folder, re-keying its notes and preserving mtime', async () => {
            const created = await store.create('Plan', 'Work');
            await store.moveFolder('Work', 'Archive');
            expect(await store.stat('Work/Plan.md')).toBeNull();
            const moved = await store.get('Archive/Plan.md');
            expect(moved.title).toBe('Plan');
            // Pure relocation: the record's mtime is unchanged.
            expect(moved.updatedAt).toBe(created.updatedAt);
        });

        it('reparents a folder, carrying its whole nested subtree', async () => {
            await store.create('A', 'Work/Sub');
            await store.create('B', 'Work');
            await store.moveFolder('Work', 'Done/Work');
            expect((await store.list()).map((m) => m.id).sort()).toEqual([
                'Done/Work/B.md',
                'Done/Work/Sub/A.md',
            ]);
        });

        it('carries a deliberately-empty (marked) subfolder', async () => {
            await store.createFolder('Work', 'Empty');
            await store.moveFolder('Work', 'Archive');
            expect(await store.listFolders()).toEqual(['Archive', 'Archive/Empty']);
        });

        it('hard-fails when the destination folder already exists', async () => {
            await store.create('A', 'Work');
            await store.create('B', 'Archive');
            await expect(store.moveFolder('Work', 'Archive')).rejects.toBeInstanceOf(
                NameCollisionError,
            );
            // Source intact.
            expect(await store.stat('Work/A.md')).not.toBeNull();
        });

        it('refuses to move a folder into its own descendant', async () => {
            await store.create('A', 'Work/Sub');
            await expect(store.moveFolder('Work', 'Work/Sub/Deep')).rejects.toThrow(/itself/i);
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

    describe('attachments', () => {
        const file = (name: string, body: string) => new File([body], name, {type: 'image/png'});

        it('stores a blob, returns a stable ref, and reads it back', async () => {
            const ref = await store.writeAttachment(file('cat.png', 'PNGBYTES'));

            expect(ref).toBe('Attachments/cat.png');
            expect(await (await store.readAttachment(ref)).text()).toBe('PNGBYTES');
        });

        it('resolves name collisions, keeping the extension', async () => {
            const first = await store.writeAttachment(file('cat.png', 'a'));
            const second = await store.writeAttachment(file('cat.png', 'b'));

            expect(first).toBe('Attachments/cat.png');
            expect(second).toBe('Attachments/cat-2.png');
            expect(await (await store.readAttachment(second)).text()).toBe('b');
        });

        it('does not surface attachments as notes or folders', async () => {
            await store.create('Real');
            await store.writeAttachment(file('cat.png', 'x'));

            expect((await store.list()).map((m) => m.id)).toEqual(['Real.md']);
            expect(await store.listFolders()).toEqual([]);
        });

        it('throws when reading a missing attachment', async () => {
            await expect(store.readAttachment('Attachments/missing.png')).rejects.toThrow();
        });

        it('lists stored attachments with name + size, and deletes by ref', async () => {
            await store.writeAttachment(file('cat.png', 'PNG'));
            await store.writeAttachment(file('dog.gif', 'GIFBYTES'));

            const listed = await store.listAttachments();
            expect(listed.map((a) => a.ref).sort()).toEqual([
                'Attachments/cat.png',
                'Attachments/dog.gif',
            ]);
            expect(listed.find((a) => a.name === 'dog.gif')?.size).toBe('GIFBYTES'.length);

            await store.removeAttachment('Attachments/cat.png');
            expect((await store.listAttachments()).map((a) => a.ref)).toEqual([
                'Attachments/dog.gif',
            ]);
            // Removing a missing attachment is a no-op.
            await expect(store.removeAttachment('Attachments/gone.png')).resolves.toBeUndefined();
        });

        it('lists nothing before any attachment exists', async () => {
            expect(await store.listAttachments()).toEqual([]);
        });

        it('writeAttachmentAt writes at the exact ref and overwrites', async () => {
            await store.writeAttachmentAt('Attachments/exact.png', new Blob(['v1']));
            expect(await (await store.readAttachment('Attachments/exact.png')).text()).toBe('v1');

            await store.writeAttachmentAt('Attachments/exact.png', new Blob(['v2']));
            expect(await (await store.readAttachment('Attachments/exact.png')).text()).toBe('v2');
            expect((await store.listAttachments()).map((a) => a.ref)).toEqual([
                'Attachments/exact.png',
            ]);
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
                trashed: [],
            });
        });

        it('round-trips metadata through write/read', async () => {
            await store.writeMetadata({
                version: 1,
                sort: 'title',
                pinned: ['Ideas.md'],
                created: {'Ideas.md': 123},
                active: 'Ideas.md',
                trashed: [],
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

    describe('trash', () => {
        it('moves a note to the trash (out of every listing) and restores it', async () => {
            await store.create('Plan', 'Work');
            await store.save('Work/Plan.md', 'body', (await store.stat('Work/Plan.md'))!);

            const trashId = await store.trash('Work/Plan.md');
            expect(trashId).toBe('.trash/Plan.md');
            // Isolated in its own object store: invisible to notes, corpus, and folder listings.
            expect((await store.list()).map((m) => m.id)).toEqual([]);
            expect((await store.getAll()).map((n) => n.id)).toEqual([]);
            expect(await store.listFolders()).toEqual([]);
            expect((await store.listTrash()).map((t) => t.id)).toEqual(['.trash/Plan.md']);

            const restored = await store.restore('.trash/Plan.md', 'Work');
            expect(restored.id).toBe('Work/Plan.md');
            expect((await store.get('Work/Plan.md')).content).toBe('body');
            expect(await store.listTrash()).toEqual([]);
        });

        it('uniquifies trashed names and resolves a restore collision', async () => {
            await store.create('Note', 'A');
            await store.create('Note', 'B');
            expect(await store.trash('A/Note.md')).toBe('.trash/Note.md');
            expect(await store.trash('B/Note.md')).toBe('.trash/Note 2.md');

            await store.create('Note'); // root Note.md now occupies the original name
            const restored = await store.restore('.trash/Note.md', '');
            expect(restored.id).toBe('Note 2.md');
        });

        it('purge removes one; emptyTrash clears the rest', async () => {
            await store.create('A');
            await store.create('B');
            const a = await store.trash('A.md');
            await store.trash('B.md');

            await store.purge(a);
            expect((await store.listTrash()).map((t) => t.id)).toEqual(['.trash/B.md']);
            await store.emptyTrash();
            expect(await store.listTrash()).toEqual([]);
        });

        it('upgrades a v2 database to v3, keeping notes and adding the trash store', async () => {
            // Build a pre-existing v2-shaped database by hand (no trash store), with one note.
            await new Promise<void>((resolve, reject) => {
                const req = indexedDB.open('gravity-notes-data', 2);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    db.createObjectStore('notes', {keyPath: 'id'});
                    db.createObjectStore('kv');
                    db.createObjectStore('attachments', {keyPath: 'id'});
                };
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction('notes', 'readwrite');
                    tx.objectStore('notes').put({id: 'Old.md', content: 'kept\n\n', updatedAt: 5});
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () => reject(tx.error);
                };
                req.onerror = () => reject(req.error);
            });

            // Opening the store runs the v2 → v3 upgrade: the old note survives and trashing works
            // (the new trash store was created without disturbing the existing object stores).
            const upgraded = new IndexedDbNoteStore();
            expect((await upgraded.get('Old.md')).content).toBe('kept');
            const trashId = await upgraded.trash('Old.md');
            expect((await upgraded.listTrash()).map((t) => t.id)).toEqual([trashId]);
            expect(await upgraded.list()).toEqual([]);
        });
    });
});
