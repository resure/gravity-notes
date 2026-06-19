import {beforeEach, describe, expect, it} from 'vitest';

import {FakeDirectoryHandle, asDirectoryHandle} from './fakeFileSystem';
import {FileSystemNoteStore} from './fileSystemStore';

describe('FileSystemNoteStore', () => {
    let dir: FakeDirectoryHandle;
    let store: FileSystemNoteStore;

    beforeEach(() => {
        dir = new FakeDirectoryHandle();
        store = new FileSystemNoteStore(asDirectoryHandle(dir));
    });

    describe('list', () => {
        it('returns .md files newest-first with derived titles', async () => {
            dir.seedFile('Alpha.md', '# Alpha', 100);
            dir.seedFile('Beta.md', '# Beta', 300);
            dir.seedFile('Gamma.md', '# Gamma', 200);

            const metas = await store.list();

            expect(metas.map((m) => m.title)).toEqual(['Beta', 'Gamma', 'Alpha']);
            expect(metas[0]).toMatchObject({id: 'Beta.md', title: 'Beta', updatedAt: 300});
        });

        it('ignores non-markdown files and directories', async () => {
            dir.seedFile('note.md', 'hi', 1);
            dir.seedFile('image.png', 'x', 2);
            dir.seedFile('README.txt', 'x', 3);
            dir.seedSubdir('attachments');

            const metas = await store.list();

            expect(metas.map((m) => m.id)).toEqual(['note.md']);
        });
    });

    describe('get and save', () => {
        it('reads a note body and title', async () => {
            dir.seedFile('Ideas.md', 'first line', 10);

            const note = await store.get('Ideas.md');

            expect(note).toMatchObject({id: 'Ideas.md', title: 'Ideas', content: 'first line'});
        });

        it('round-trips content through save', async () => {
            dir.seedFile('Ideas.md', 'old', 10);

            await store.save('Ideas.md', 'new body');

            expect((await store.get('Ideas.md')).content).toBe('new body');
        });
    });

    describe('create', () => {
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

        it('replaces filename-illegal characters with spaces', async () => {
            const meta = await store.create('a/b:c*d?');

            expect(meta.id).toBe('a b c d.md');
        });

        it('strips control characters', async () => {
            const meta = await store.create('tab\tnote');

            expect(meta.id).toBe('tab note.md');
        });

        it('falls back to Untitled for an empty title', async () => {
            const meta = await store.create('   ');

            expect(meta.id).toBe('Untitled.md');
        });
    });

    describe('rename', () => {
        it('is a no-op when the title is unchanged', async () => {
            dir.seedFile('Note.md', 'body', 5);

            const meta = await store.rename('Note.md', 'Note');

            expect(meta.id).toBe('Note.md');
            expect((await store.get('Note.md')).content).toBe('body');
        });

        it('moves content to the new file and removes the old one', async () => {
            dir.seedFile('Old.md', 'keep me', 5);

            const meta = await store.rename('Old.md', 'New');

            expect(meta.id).toBe('New.md');
            expect((await store.get('New.md')).content).toBe('keep me');
            await expect(store.get('Old.md')).rejects.toThrow();
        });

        it('resolves collisions when renaming onto an existing title', async () => {
            dir.seedFile('Old.md', 'a', 5);
            dir.seedFile('Taken.md', 'b', 6);

            const meta = await store.rename('Old.md', 'Taken');

            expect(meta.id).toBe('Taken 2.md');
        });
    });

    describe('remove', () => {
        it('deletes the note file', async () => {
            dir.seedFile('Gone.md', 'x', 1);

            await store.remove('Gone.md');

            await expect(store.get('Gone.md')).rejects.toThrow();
        });
    });
});
