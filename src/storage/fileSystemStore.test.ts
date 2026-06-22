import {beforeEach, describe, expect, it} from 'vitest';

import {FakeDirectoryHandle, asDirectoryHandle} from './fakeFileSystem';
import {FileSystemNoteStore} from './fileSystemStore';
import {DEFAULT_METADATA} from './metadata';
import {ConflictError, NameCollisionError} from './types';

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

        it('flows the body into one snippet with Markdown stripped', async () => {
            dir.seedFile('Note.md', '## My heading\n\nbody text', 100);

            const [meta] = await store.list();

            expect(meta.preview).toBe('My heading body text');
        });

        it('strips bullets and inline emphasis from the preview', async () => {
            dir.seedFile('Note.md', '- **Buy** milk and *eggs*', 100);

            const [meta] = await store.list();

            expect(meta.preview).toBe('Buy milk and eggs');
        });

        it('collapses newlines and drops hard-break backslashes', async () => {
            dir.seedFile('Note.md', 'first line\\\nsecond line', 100);

            const [meta] = await store.list();

            expect(meta.preview).toBe('first line second line');
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

            await store.save('Ideas.md', 'new body', 10);

            expect((await store.get('Ideas.md')).content).toBe('new body');
        });

        it('ends the saved file with a blank line and strips it back off on read', async () => {
            dir.seedFile('Ideas.md', 'x', 10);

            await store.save('Ideas.md', 'no newline', 10);

            // The file on disk ends with a real blank line (two newlines)...
            const onDisk = await (await dir.getFileHandle('Ideas.md')).getFile();
            expect(await onDisk.text()).toBe('no newline\n\n');
            // ...while get() returns the canonical body the editor round-trips (no trailing newline).
            expect((await store.get('Ideas.md')).content).toBe('no newline');
        });

        it('writes a blank line even for an empty body', async () => {
            dir.seedFile('Empty.md', 'x', 10);

            await store.save('Empty.md', '', 10);

            const onDisk = await (await dir.getFileHandle('Empty.md')).getFile();
            expect(await onDisk.text()).toBe('\n\n');
            expect((await store.get('Empty.md')).content).toBe('');
        });

        it('normalizes any trailing newlines to a single blank line on save', async () => {
            dir.seedFile('Ideas.md', 'x', 10);

            await store.save('Ideas.md', 'body\n\n\n', 10);

            const onDisk = await (await dir.getFileHandle('Ideas.md')).getFile();
            expect(await onDisk.text()).toBe('body\n\n');
        });

        it('strips trailing newlines from the body on read', async () => {
            dir.seedFile('Ideas.md', 'seeded\n\n', 10);

            expect((await store.get('Ideas.md')).content).toBe('seeded');
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

        it('writes the canonical trailing blank line to the renamed file', async () => {
            dir.seedFile('Old.md', 'body', 5);

            await store.rename('Old.md', 'New');

            // store.get() strips trailing newlines (so read the raw file): a rename must leave it
            // in the same canonical "blank line at EOF" shape save() produces.
            const handle = await dir.getFileHandle('New.md');
            const raw = await (await handle.getFile()).text();
            expect(raw).toBe('body\n\n');
        });
    });

    describe('rename — case-only (case-insensitive filesystem)', () => {
        it('changes a note title from lower to upper case', async () => {
            // macOS/Windows default: note.md and Note.md are the same file.
            const ciDir = new FakeDirectoryHandle('notes', true);
            ciDir.seedFile('note.md', 'keep me', 5);
            const ciStore = new FileSystemNoteStore(asDirectoryHandle(ciDir));

            const meta = await ciStore.rename('note.md', 'Note');

            expect(meta.id).toBe('Note.md');
            // The single file now lists under the new-cased name with content intact...
            const metas = await ciStore.list();
            expect(metas.map((m) => m.id)).toEqual(['Note.md']);
            expect((await ciStore.get('Note.md')).content).toBe('keep me');
            // ...and no rename temp file leaks into the listing.
            expect(metas).toHaveLength(1);
        });
    });

    describe('rename — collisions', () => {
        it('renames to a free name', async () => {
            dir.seedFile('Old.md', 'body', 100);
            const meta = await store.rename('Old.md', 'New');
            expect(meta.id).toBe('New.md');
            expect((await store.get('New.md')).content).toBe('body');
            expect(await store.stat('Old.md')).toBeNull();
        });

        it('throws NameCollisionError when the target name is taken by another note', async () => {
            dir.seedFile('Old.md', 'mine', 100);
            dir.seedFile('Taken.md', 'theirs', 200);
            await expect(store.rename('Old.md', 'Taken')).rejects.toBeInstanceOf(
                NameCollisionError,
            );
            // Both files are left intact; no auto-numbered "Taken 2.md".
            expect(await store.stat('Old.md')).not.toBeNull();
            expect(await store.stat('Taken 2.md')).toBeNull();
            expect((await store.get('Old.md')).content).toBe('mine');
            expect((await store.get('Taken.md')).content).toBe('theirs');
        });

        it('returns the new file mtime so the next save has a fresh baseline', async () => {
            dir.seedFile('Old.md', 'body', 100);
            const meta = await store.rename('Old.md', 'New');
            const disk = await store.stat('New.md');
            expect(meta.updatedAt).toBe(disk);
        });
    });

    describe('remove', () => {
        it('deletes the note file', async () => {
            dir.seedFile('Gone.md', 'x', 1);

            await store.remove('Gone.md');

            await expect(store.get('Gone.md')).rejects.toThrow();
        });
    });

    describe('save conflict detection', () => {
        it('throws ConflictError when the file changed on disk since the baseline', async () => {
            dir.seedFile('Note.md', 'original', 100);
            dir.seedFile('Note.md', 'edited elsewhere', 250); // external edit bumps mtime

            await expect(store.save('Note.md', 'my version', 100)).rejects.toBeInstanceOf(
                ConflictError,
            );
            // The rejected save must not have touched the on-disk content.
            expect((await store.get('Note.md')).content).toBe('edited elsewhere');
        });

        it('reports the current disk mtime on the conflict', async () => {
            dir.seedFile('Note.md', 'a', 100);
            dir.seedFile('Note.md', 'b', 250);

            await expect(store.save('Note.md', 'c', 100)).rejects.toMatchObject({
                name: 'ConflictError',
                diskUpdatedAt: 250,
            });
        });

        it('writes when the baseline matches the current disk mtime (keep-mine)', async () => {
            dir.seedFile('Note.md', 'a', 100);
            dir.seedFile('Note.md', 'b', 250);

            const meta = await store.save('Note.md', 'mine', 250);

            expect(meta.updatedAt).toBeGreaterThan(250);
            expect((await store.get('Note.md')).content).toBe('mine');
        });

        it('returns the new mtime so the next save uses a fresh baseline', async () => {
            dir.seedFile('Note.md', 'a', 100);

            const first = await store.save('Note.md', 'b', 100);
            const second = await store.save('Note.md', 'c', first.updatedAt ?? 0);

            expect((await store.get('Note.md')).content).toBe('c');
            expect(second.updatedAt).toBeGreaterThan(first.updatedAt ?? 0);
        });
    });

    describe('stat', () => {
        it('returns the current lastModified', async () => {
            dir.seedFile('Note.md', 'x', 77);

            expect(await store.stat('Note.md')).toBe(77);
        });

        it('returns null for a missing file', async () => {
            expect(await store.stat('Ghost.md')).toBeNull();
        });
    });

    describe('metadata', () => {
        it('returns defaults when the dotfile is absent', async () => {
            const meta = await store.readMetadata();
            expect(meta).toEqual({
                version: 1,
                sort: 'updated',
                pinned: [],
                created: {},
                active: null,
            });
            // A fresh object, never the shared DEFAULT_METADATA singleton.
            expect(meta).not.toBe(DEFAULT_METADATA);
        });

        it('round-trips metadata through write/read', async () => {
            await store.writeMetadata({
                version: 1,
                sort: 'title',
                pinned: ['Ideas.md'],
                created: {'Ideas.md': 123},
                active: null,
            });
            const meta = await store.readMetadata();
            expect(meta.sort).toBe('title');
            expect(meta.pinned).toEqual(['Ideas.md']);
            expect(meta.created).toEqual({'Ideas.md': 123});
        });

        it('returns defaults when the dotfile is corrupt JSON', async () => {
            dir.seedFile('.gravity-notes.json', 'not json{', 10);
            const meta = await store.readMetadata();
            expect(meta).toEqual({
                version: 1,
                sort: 'updated',
                pinned: [],
                created: {},
                active: null,
            });
        });

        it('never surfaces the dotfile as a note', async () => {
            dir.seedFile('Real.md', 'hi', 1);
            await store.writeMetadata({
                version: 1,
                sort: 'updated',
                pinned: [],
                created: {},
                active: null,
            });
            const metas = await store.list();
            expect(metas.map((m) => m.id)).toEqual(['Real.md']);
        });
    });
});
