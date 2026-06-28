import {beforeEach, describe, expect, it, vi} from 'vitest';

import {ConflictError, NameCollisionError} from './types';

// Holder the hoisted mock reads at call time; the fake FS is (re)created per test in beforeEach.
const {fsHolder} = vi.hoisted(() => ({fsHolder: {current: null as FakeFs | null}}));

vi.mock('@tauri-apps/api/core', () => ({
    // `async` so a thrown dispatch (e.g. renaming a missing file) surfaces as a rejected promise,
    // exactly like a failed Rust command.
    invoke: async (cmd: string, args: Record<string, unknown>) =>
        fsHolder.current!.dispatch(cmd, args),
}));

/**
 * In-memory stand-in for the Rust `notes_*` commands, modelling a case-INSENSITIVE filesystem
 * (macOS's default) so case-only renames and collisions behave like the real desktop app. Keys are
 * lowercased; each entry keeps its real (display) name, content, and a monotonically-increasing
 * mtime so optimistic-concurrency conflicts are deterministic.
 */
class FakeFs {
    private files = new Map<string, {name: string; content: string; mtime: number}>();
    private clock = 1000;

    dispatch(cmd: string, args: Record<string, unknown>): unknown {
        const name = args.name as string;
        switch (cmd) {
            case 'notes_list':
                return this.list();
            case 'notes_list_dir':
                return this.listDir(args.sub as string);
            case 'notes_read_all':
                return this.readAll();
            case 'notes_read_opt':
                return this.readOpt(name);
            case 'notes_write':
                return this.write(name, args.content as string);
            case 'notes_rename':
                return this.rename(args.from as string, args.to as string);
            case 'notes_remove':
                return this.remove(name);
            case 'notes_remove_dir_all':
                return this.removeDirAll(args.path as string);
            case 'notes_exists':
                return this.exists(name);
            case 'notes_stat':
                return this.stat(name);
            case 'notes_move_dir':
                return this.moveDir(args.from as string, args.to as string);
            default:
                throw new Error(`unknown command: ${cmd}`);
        }
    }

    write(name: string, content: string): number {
        const mtime = ++this.clock;
        this.files.set(this.key(name), {name, content, mtime});
        return mtime;
    }

    /** Raw on-disk content (unstripped), for asserting the canonical body shape. */
    raw(name: string): string | undefined {
        return this.files.get(this.key(name))?.content;
    }

    /** A file exists, or a folder does (any file lives under `name/`). */
    private exists(name: string): boolean {
        if (this.files.has(this.key(name))) return true;
        const prefix = `${this.key(name)}/`;
        return [...this.files.keys()].some((k) => k.startsWith(prefix));
    }

    /** Re-key every file under `from` to `to` (the flat fake's stand-in for an fs::rename of a dir). */
    private moveDir(from: string, to: string): null {
        const prefix = `${from}/`;
        for (const [k, f] of [...this.files]) {
            if (f.name === from || f.name.startsWith(prefix)) {
                this.files.delete(k);
                const newName = to + f.name.slice(from.length);
                this.files.set(this.key(newName), {...f, name: newName});
            }
        }
        return null;
    }

    private key(name: string): string {
        return name.toLowerCase();
    }

    private readOpt(name: string): {name: string; modifiedMs: number; content: string} | null {
        const file = this.files.get(this.key(name));
        return file ? {name, modifiedMs: file.mtime, content: file.content} : null;
    }

    private stat(name: string): number | null {
        return this.files.get(this.key(name))?.mtime ?? null;
    }

    private remove(name: string): null {
        this.files.delete(this.key(name));
        return null;
    }

    /** Recursively delete a folder and everything under it (mirrors the Rust notes_remove_dir_all). */
    private removeDirAll(path: string): null {
        const key = this.key(path);
        const prefix = `${key}/`;
        for (const k of [...this.files.keys()]) {
            if (k === key || k.startsWith(prefix)) this.files.delete(k);
        }
        return null;
    }

    private rename(from: string, to: string): number {
        const file = this.files.get(this.key(from));
        if (!file) throw new Error(`rename: "${from}" not found`);
        if (this.key(from) === this.key(to)) {
            // Case-insensitive FS: a rename differing only in case is a no-op — the display name
            // does NOT change. This is exactly the macOS hazard the store dodges via a temp name;
            // modelling it here means the case-only test would fail if that workaround regressed.
            return file.mtime;
        }
        this.files.delete(this.key(from));
        const mtime = ++this.clock;
        this.files.set(this.key(to), {name: to, content: file.content, mtime});
        return mtime;
    }

    /** `.md` files NOT inside any dot-directory — the Rust walk skips `.git`/`.trash`/… subtrees. */
    private mdFiles() {
        return [...this.files.values()].filter(
            (f) =>
                f.name.toLowerCase().endsWith('.md') &&
                !f.name
                    .split('/')
                    .slice(0, -1)
                    .some((seg) => seg.startsWith('.')),
        );
    }

    private list() {
        return this.mdFiles().map((f) => ({
            name: f.name,
            modifiedMs: f.mtime,
            head: f.content.slice(0, 500),
        }));
    }

    /** The `.md` files directly inside `sub/` (non-recursive) — backs `notes_list_dir` / the trash. */
    private listDir(sub: string) {
        const prefix = `${this.key(sub)}/`;
        return [...this.files.values()]
            .filter(
                (f) =>
                    f.name.toLowerCase().endsWith('.md') &&
                    this.key(f.name).startsWith(prefix) &&
                    !this.key(f.name).slice(prefix.length).includes('/'),
            )
            .map((f) => ({name: f.name, modifiedMs: f.mtime, head: f.content.slice(0, 500)}));
    }

    private readAll() {
        return this.mdFiles().map((f) => ({
            name: f.name,
            modifiedMs: f.mtime,
            content: f.content,
        }));
    }
}

// Imported after vi.mock so the mocked `invoke` is in place.
const {TauriNoteStore} = await import('./tauriStore');

function newStore() {
    fsHolder.current = new FakeFs();
    return {store: new TauriNoteStore('/notes'), fs: fsHolder.current};
}

describe('TauriNoteStore', () => {
    let store: InstanceType<typeof TauriNoteStore>;
    let fs: FakeFs;

    beforeEach(() => {
        ({store, fs} = newStore());
    });

    it('creates a note with the canonical body shape and reads it back stripped', async () => {
        const meta = await store.create('Hello');
        expect(meta.id).toBe('Hello.md');
        expect(meta.title).toBe('Hello');
        // On disk: canonical "blank line at EOF"; in memory: stripped to empty.
        expect(fs.raw('Hello.md')).toBe('\n\n');
        const note = await store.get('Hello.md');
        expect(note.content).toBe('');
        expect(note.updatedAt).toBe(meta.updatedAt);
    });

    it('resolves name collisions on create', async () => {
        const a = await store.create('Note');
        const b = await store.create('Note');
        const c = await store.create('Note');
        expect([a.id, b.id, c.id]).toEqual(['Note.md', 'Note 2.md', 'Note 3.md']);
    });

    describe('folders', () => {
        it('creates a note inside a subfolder with a basename title', async () => {
            const meta = await store.create('Roadmap', 'Work');
            expect(meta).toMatchObject({id: 'Work/Roadmap.md', title: 'Roadmap'});
            expect(fs.raw('Work/Roadmap.md')).toBe('\n\n');
        });

        it('scopes collision-numbering to the target folder', async () => {
            const a = await store.create('Note', 'Inbox');
            const b = await store.create('Note', 'Archive');
            const c = await store.create('Note', 'Inbox');
            expect([a.id, b.id, c.id]).toEqual([
                'Inbox/Note.md',
                'Archive/Note.md',
                'Inbox/Note 2.md',
            ]);
        });

        it('moveFolder re-keys every note under the moved folder', async () => {
            await store.create('A', 'Work/Sub');
            await store.create('B', 'Work');
            await store.moveFolder('Work', 'Archive');
            expect(await store.stat('Work/A.md')).toBeNull();
            expect((await store.list()).map((m) => m.id).sort()).toEqual([
                'Archive/B.md',
                'Archive/Sub/A.md',
            ]);
        });

        it('moveFolder hard-fails onto an existing destination', async () => {
            await store.create('A', 'Work');
            await store.create('B', 'Archive');
            await expect(store.moveFolder('Work', 'Archive')).rejects.toBeInstanceOf(
                NameCollisionError,
            );
            expect(await store.stat('Work/A.md')).not.toBeNull();
        });

        it('moveFolder refuses to nest a folder inside itself', async () => {
            await store.create('A', 'Work');
            await expect(store.moveFolder('Work', 'Work/Sub')).rejects.toThrow(/itself/i);
        });

        it('lists nested notes with basename titles', async () => {
            await store.create('Roadmap', 'Work');
            const metas = await store.list();
            expect(metas.find((m) => m.id === 'Work/Roadmap.md')?.title).toBe('Roadmap');
        });

        it('moves a note into another folder and back to the root', async () => {
            const created = await store.create('Note', 'Inbox');
            await store.save('Inbox/Note.md', 'keep', created.updatedAt ?? 0);

            const moved = await store.move('Inbox/Note.md', 'Archive');
            expect(moved.id).toBe('Archive/Note.md');
            expect((await store.get('Archive/Note.md')).content).toBe('keep');
            expect(await store.stat('Inbox/Note.md')).toBeNull();

            const back = await store.move('Archive/Note.md', '');
            expect(back.id).toBe('Note.md');
        });

        it('hard-fails a move onto an existing same-leaf note', async () => {
            await store.create('Note', 'Inbox');
            await store.create('Note', 'Archive');
            await expect(store.move('Inbox/Note.md', 'Archive')).rejects.toBeInstanceOf(
                NameCollisionError,
            );
            expect(await store.stat('Inbox/Note.md')).not.toBeNull();
        });

        it('renames a nested note within its own folder', async () => {
            await store.create('Old', 'Work');
            const meta = await store.rename('Work/Old.md', 'New');
            expect(meta.id).toBe('Work/New.md');
            expect(await store.stat('Work/Old.md')).toBeNull();
        });
    });

    it('sanitizes unsafe titles into a file-name base', async () => {
        const meta = await store.create('a/b:c?');
        expect(meta.id).toBe('a b c.md');
    });

    it('saves with the canonical body and bumps updatedAt', async () => {
        const created = await store.create('Doc');
        const saved = await store.save('Doc.md', 'body text', created.updatedAt ?? 0);
        expect(fs.raw('Doc.md')).toBe('body text\n\n');
        expect((await store.get('Doc.md')).content).toBe('body text');
        expect(saved.updatedAt).toBeGreaterThan(created.updatedAt ?? 0);
    });

    it('throws ConflictError when the on-disk mtime differs from the baseline', async () => {
        const created = await store.create('Doc');
        // An external write moves the mtime out from under our stale baseline.
        const external = fs.write('Doc.md', 'theirs\n\n');
        await expect(store.save('Doc.md', 'mine', created.updatedAt ?? 0)).rejects.toBeInstanceOf(
            ConflictError,
        );
        // Saving against the current mtime succeeds.
        const ok = await store.save('Doc.md', 'mine', external);
        expect(ok.updatedAt).toBeGreaterThan(external);
    });

    it('throws a NotFoundError (deleted) when saving a removed note', async () => {
        const created = await store.create('Doc');
        await store.remove('Doc.md');
        await expect(store.save('Doc.md', 'x', created.updatedAt ?? 0)).rejects.toMatchObject({
            name: 'NotFoundError',
        });
    });

    it('get throws NotFoundError for a missing note', async () => {
        await expect(store.get('Nope.md')).rejects.toMatchObject({name: 'NotFoundError'});
    });

    it('stat returns the mtime when present and null when missing', async () => {
        const created = await store.create('Doc');
        expect(await store.stat('Doc.md')).toBe(created.updatedAt);
        expect(await store.stat('Gone.md')).toBeNull();
    });

    it('renames a note to a new id', async () => {
        await store.create('Old');
        const meta = await store.rename('Old.md', 'New');
        expect(meta.id).toBe('New.md');
        expect(await store.stat('Old.md')).toBeNull();
        expect(await store.stat('New.md')).not.toBeNull();
    });

    it('rejects a rename onto an existing note name', async () => {
        await store.create('A');
        await store.create('B');
        await expect(store.rename('A.md', 'B')).rejects.toBeInstanceOf(NameCollisionError);
        // The source is untouched after a rejected rename.
        expect(await store.stat('A.md')).not.toBeNull();
    });

    it('treats a rename to the same name as a no-op', async () => {
        await store.create('Same');
        const meta = await store.rename('Same.md', 'Same');
        expect(meta.id).toBe('Same.md');
    });

    it('performs a case-only rename via a temp name so the display case actually changes', async () => {
        await store.create('note');
        const meta = await store.rename('note.md', 'Note');
        expect(meta.id).toBe('Note.md');
        // The on-disk display name must be the new casing — the temp-name two-step is what makes
        // this work on a case-insensitive filesystem (a direct rename would be a silent no-op).
        const listed = await store.list();
        expect(listed.map((n) => n.id)).toEqual(['Note.md']);
        // No leftover temp file.
        expect(listed.some((n) => n.id.includes('rename-tmp'))).toBe(false);
    });

    it('lists notes newest-first with previews and excludes the metadata sidecar', async () => {
        await store.create('First');
        await store.save('First.md', '# First\n\nhello world', (await store.stat('First.md'))!);
        await store.create('Second');
        await store.writeMetadata({
            version: 1,
            sort: 'updated',
            pinned: [],
            created: {},
            active: null,
            trashed: [],
        });

        const list = await store.list();
        // Newest (Second, created last) first; sidecar (.json, not .md) excluded.
        expect(list.map((n) => n.id)).toEqual(['Second.md', 'First.md']);
        const first = list.find((n) => n.id === 'First.md');
        expect(first?.preview).toBe('First hello world');
    });

    it('getAll returns every note with stripped content', async () => {
        await store.create('A');
        await store.save('A.md', 'alpha', (await store.stat('A.md'))!);
        await store.create('B');

        const all = await store.getAll();
        const byId = Object.fromEntries(all.map((n) => [n.id, n.content]));
        expect(byId['A.md']).toBe('alpha');
        expect(byId['B.md']).toBe('');
    });

    it('reads default metadata when absent and round-trips a written value', async () => {
        const fresh = await store.readMetadata();
        expect(fresh).toEqual({
            version: 1,
            sort: 'updated',
            pinned: [],
            created: {},
            active: null,
            trashed: [],
        });

        await store.writeMetadata({
            version: 1,
            sort: 'title',
            pinned: ['A.md'],
            created: {'A.md': 5},
            active: 'A.md',
            trashed: [],
        });
        expect(await store.readMetadata()).toMatchObject({sort: 'title', active: 'A.md'});
    });

    it('falls back to default metadata on corrupt JSON', async () => {
        fs.write('.gravity-notes.json', '{not json');
        expect(await store.readMetadata()).toEqual({
            version: 1,
            sort: 'updated',
            pinned: [],
            created: {},
            active: null,
            trashed: [],
        });
    });

    describe('trash', () => {
        it('moves a note to the trash (out of the listing) and restores it', async () => {
            await store.create('Plan', 'Work');
            await store.save('Work/Plan.md', 'body', (await store.stat('Work/Plan.md'))!);

            const trashId = await store.trash('Work/Plan.md');
            expect(trashId).toBe('.trash/Plan.md');
            // `.trash/` is a dot-directory the recursive walk skips, so it's gone from list().
            expect((await store.list()).map((m) => m.id)).toEqual([]);
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

            await store.create('Note'); // root Note.md reclaims the original name
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
    });
});
