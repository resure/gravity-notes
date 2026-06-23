import {describe, expect, it} from 'vitest';

import {FakeDirectoryHandle} from './fakeFileSystem';

/** Walk a fake tree the way a recursive list() would, collecting file paths. */
async function walk(dir: FakeDirectoryHandle, prefix = ''): Promise<string[]> {
    const out: string[] = [];
    for await (const entry of dir.values()) {
        if (entry.kind === 'file') {
            out.push(prefix + entry.name);
        } else {
            out.push(...(await walk(entry, `${prefix}${entry.name}/`)));
        }
    }
    return out.sort();
}

describe('FakeDirectoryHandle nesting', () => {
    it('seeds files into auto-created nested folders', () => {
        const root = new FakeDirectoryHandle();
        root.seedFile('Inbox.md', 'a');
        root.seedFile('Work/Roadmap.md', 'b');
        root.seedFile('Work/Sub/Deep.md', 'c');
        expect(root.paths()).toEqual(['Inbox.md', 'Work/Roadmap.md', 'Work/Sub/Deep.md']);
    });

    it("values() yields only a directory's immediate children (files + subdirs)", async () => {
        const root = new FakeDirectoryHandle();
        root.seedFile('Inbox.md', 'a');
        root.seedFile('Work/Roadmap.md', 'b');
        const names: string[] = [];
        for await (const entry of root.values()) names.push(`${entry.kind}:${entry.name}`);
        expect(names.sort()).toEqual(['directory:Work', 'file:Inbox.md']);
    });

    it('is recursively walkable the way list() will descend', async () => {
        const root = new FakeDirectoryHandle();
        root.seedFile('Inbox.md', 'a');
        root.seedFile('Work/Roadmap.md', 'b');
        root.seedFile('Work/Sub/Deep.md', 'c');
        expect(await walk(root)).toEqual(['Inbox.md', 'Work/Roadmap.md', 'Work/Sub/Deep.md']);
    });

    it('getDirectoryHandle navigates, creates on demand, and 404s otherwise', async () => {
        const root = new FakeDirectoryHandle();
        root.seedFile('Work/Roadmap.md', 'b');

        const work = await root.getDirectoryHandle('Work');
        const file = await work.getFileHandle('Roadmap.md');
        await expect((await file.getFile()).text()).resolves.toBe('b');

        await expect(root.getDirectoryHandle('Missing')).rejects.toMatchObject({
            name: 'NotFoundError',
        });

        const made = await root.getDirectoryHandle('Personal', {create: true});
        await made.getFileHandle('Recipes.md', {create: true});
        expect(root.paths()).toContain('Personal/Recipes.md');
    });
});

describe('FakeDirectoryHandle removeEntry', () => {
    it('removes a file', async () => {
        const root = new FakeDirectoryHandle();
        root.seedFile('Inbox.md', 'a');
        await root.removeEntry('Inbox.md');
        expect(root.paths()).toEqual([]);
    });

    it('removes an empty directory but refuses a non-empty one without {recursive}', async () => {
        const root = new FakeDirectoryHandle();
        root.seedSubdir('Empty');
        root.seedFile('Work/Roadmap.md', 'b');

        await root.removeEntry('Empty');
        await expect(root.getDirectoryHandle('Empty')).rejects.toMatchObject({
            name: 'NotFoundError',
        });

        await expect(root.removeEntry('Work')).rejects.toMatchObject({
            name: 'InvalidModificationError',
        });
        await root.removeEntry('Work', {recursive: true});
        expect(root.paths()).toEqual([]);
    });

    it('404s on a missing entry', async () => {
        const root = new FakeDirectoryHandle();
        await expect(root.removeEntry('Nope.md')).rejects.toMatchObject({name: 'NotFoundError'});
    });
});

describe('FakeDirectoryHandle case-insensitivity', () => {
    it('folds case for both file and directory lookups at any depth', async () => {
        const root = new FakeDirectoryHandle('notes', true);
        root.seedFile('Work/Roadmap.md', 'b');

        // Directory name folds case...
        const work = await root.getDirectoryHandle('work');
        // ...and so does the file name inside it.
        const file = await work.getFileHandle('ROADMAP.MD');
        await expect((await file.getFile()).text()).resolves.toBe('b');

        await expect(root.removeEntry('WORK', {recursive: true})).resolves.toBeUndefined();
        expect(root.paths()).toEqual([]);
    });

    it('stays case-sensitive when not configured otherwise', async () => {
        const root = new FakeDirectoryHandle('notes', false);
        root.seedFile('Work/Roadmap.md', 'b');
        await expect(root.getDirectoryHandle('work')).rejects.toMatchObject({
            name: 'NotFoundError',
        });
    });
});
