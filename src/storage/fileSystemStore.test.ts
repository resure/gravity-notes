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

    describe('folders: recursive listing', () => {
        it('lists nested notes with forward-slash path ids, newest-first', async () => {
            dir.seedFile('Inbox.md', 'a', 100);
            dir.seedFile('Work/Roadmap.md', 'b', 300);
            dir.seedFile('Work/Sub/Deep.md', 'c', 200);

            const metas = await store.list();

            expect(metas.map((m) => m.id)).toEqual([
                'Work/Roadmap.md',
                'Work/Sub/Deep.md',
                'Inbox.md',
            ]);
            // Titles are leaf-only (never the folder prefix).
            expect(metas.find((m) => m.id === 'Work/Roadmap.md')?.title).toBe('Roadmap');
        });

        it('getAll returns every nested note with its full body', async () => {
            dir.seedFile('Inbox.md', 'a', 100);
            dir.seedFile('Work/Sub/Deep.md', 'deep body\n\n', 200);

            const all = await store.getAll();

            expect(all.map((n) => n.id).sort()).toEqual(['Inbox.md', 'Work/Sub/Deep.md']);
            expect(all.find((n) => n.id === 'Work/Sub/Deep.md')?.content).toBe('deep body');
        });

        it('skips dot-directories in the walk', async () => {
            dir.seedFile('Real.md', 'x', 1);
            dir.seedFile('.obsidian/Secret.md', 'y', 2);

            expect((await store.list()).map((m) => m.id)).toEqual(['Real.md']);
            expect((await store.getAll()).map((n) => n.id)).toEqual(['Real.md']);
        });
    });

    describe('folders: nested create / move / rename', () => {
        it('creates a note inside a subfolder, creating the directory', async () => {
            const meta = await store.create('Roadmap', 'Work');

            expect(meta).toMatchObject({id: 'Work/Roadmap.md', title: 'Roadmap'});
            expect((await store.get('Work/Roadmap.md')).content).toBe('');
            expect(dir.paths()).toContain('Work/Roadmap.md');
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

        it('moves a note into another folder, preserving content', async () => {
            const created = await store.create('Note', 'Inbox');
            await store.save('Inbox/Note.md', 'keep me', created.updatedAt ?? 0);

            const moved = await store.move('Inbox/Note.md', 'Archive');

            expect(moved).toMatchObject({id: 'Archive/Note.md', title: 'Note'});
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
            dir.seedFile('Inbox/Note.md', 'hi', 150);
            const moved = await store.move('Inbox/Note.md', 'Inbox');
            expect(moved).toMatchObject({id: 'Inbox/Note.md', updatedAt: 150});
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

    describe('folders: empty folders + prune', () => {
        it('creates an empty folder kept alive by a .gnkeep marker', async () => {
            const path = await store.createFolder('', 'Projects');

            expect(path).toBe('Projects');
            expect(await store.listFolders()).toEqual(['Projects']);
            expect(dir.paths()).toContain('Projects/.gnkeep');
            // The marker is not a note.
            expect(await store.list()).toEqual([]);
        });

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

        it('removeFolder drops an empty folder entirely', async () => {
            await store.createFolder('', 'Temp');
            expect(await store.listFolders()).toContain('Temp');
            await store.removeFolder('Temp');
            expect(await store.listFolders()).not.toContain('Temp');
            expect(dir.paths().some((p) => p.startsWith('Temp/'))).toBe(false);
        });

        it('removing the last note prunes an implicit folder but keeps a marked one', async () => {
            await store.create('Note', 'Implicit');
            await store.create('Note', 'Marked');
            await store.createFolder('', 'Marked');

            await store.remove('Implicit/Note.md');
            await store.remove('Marked/Note.md');

            // Implicit/ vanishes (only existed via its note); Marked/ survives via its .gnkeep.
            expect(await store.listFolders()).toEqual(['Marked']);
        });

        it('moving the last note out prunes nested empty ancestors', async () => {
            await store.create('Note', 'A/B/C');
            await store.move('A/B/C/Note.md', '');
            expect(await store.listFolders()).toEqual([]);
            expect(await store.stat('Note.md')).not.toBeNull();
        });
    });

    describe('folders: moveFolder (rename + reparent)', () => {
        it('renames a folder, re-keying its notes and pruning the old name', async () => {
            await store.create('Plan', 'Work');
            await store.moveFolder('Work', 'Archive');
            expect(await store.stat('Work/Plan.md')).toBeNull();
            expect((await store.get('Archive/Plan.md')).title).toBe('Plan');
            expect(await store.listFolders()).toEqual(['Archive']);
        });

        it('reparents a folder, carrying its whole nested subtree (content intact)', async () => {
            const created = await store.create('A', 'Work/Sub');
            await store.save('Work/Sub/A.md', 'keep me', created.updatedAt ?? 0);
            await store.create('B', 'Work');
            await store.moveFolder('Work', 'Done/Work');
            expect((await store.list()).map((m) => m.id).sort()).toEqual([
                'Done/Work/B.md',
                'Done/Work/Sub/A.md',
            ]);
            expect((await store.get('Done/Work/Sub/A.md')).content).toBe('keep me');
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
            expect(await store.stat('Work/A.md')).not.toBeNull();
        });

        it('refuses to move a folder into its own descendant', async () => {
            await store.create('A', 'Work/Sub');
            await expect(store.moveFolder('Work', 'Work/Sub/Deep')).rejects.toThrow(/itself/i);
        });
    });

    describe('rename — nested case-only (case-insensitive filesystem)', () => {
        it('changes a nested note title case via a temp file', async () => {
            const ciDir = new FakeDirectoryHandle('notes', true);
            ciDir.seedFile('Work/note.md', 'keep me', 5);
            const ciStore = new FileSystemNoteStore(asDirectoryHandle(ciDir));

            const meta = await ciStore.rename('Work/note.md', 'Note');

            expect(meta.id).toBe('Work/Note.md');
            const metas = await ciStore.list();
            expect(metas.map((m) => m.id)).toEqual(['Work/Note.md']);
            expect((await ciStore.get('Work/Note.md')).content).toBe('keep me');
        });
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

    describe('getAll', () => {
        it('returns every markdown note with its full body, ignoring non-md entries', async () => {
            dir.seedFile('Alpha.md', '# Alpha\n\nfull alpha body', 100);
            dir.seedFile('Beta.md', 'beta body\n\n', 200);
            dir.seedFile('image.png', 'x', 3);
            dir.seedSubdir('attachments');

            const all = await store.getAll();

            expect(all.map((n) => n.id).sort()).toEqual(['Alpha.md', 'Beta.md']);
            const alpha = all.find((n) => n.id === 'Alpha.md');
            // Full content (not just the preview head), with trailing newlines stripped like get().
            expect(alpha?.content).toBe('# Alpha\n\nfull alpha body');
            expect(all.find((n) => n.id === 'Beta.md')?.content).toBe('beta body');
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
