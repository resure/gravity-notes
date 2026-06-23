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
            case 'notes_exists':
                return this.files.has(this.key(name));
            case 'notes_stat':
                return this.stat(name);
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

    private mdFiles() {
        return [...this.files.values()].filter((f) => f.name.toLowerCase().endsWith('.md'));
    }

    private list() {
        return this.mdFiles().map((f) => ({
            name: f.name,
            modifiedMs: f.mtime,
            head: f.content.slice(0, 500),
        }));
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

    describe('folders (interim, until phase 7)', () => {
        it('refuses to create a note in a subfolder', async () => {
            await expect(store.create('Note', 'Work')).rejects.toThrow(/subfolder/i);
            expect((await store.create('Note')).id).toBe('Note.md');
        });

        it('refuses a cross-folder move but allows a same-folder no-op', async () => {
            const created = await store.create('Note');
            await expect(store.move('Note.md', 'Archive')).rejects.toThrow(/folders/i);
            expect(await store.move('Note.md', '')).toMatchObject({
                id: 'Note.md',
                updatedAt: created.updatedAt,
            });
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
        expect(fresh).toEqual({version: 1, sort: 'updated', pinned: [], created: {}, active: null});

        await store.writeMetadata({
            version: 1,
            sort: 'title',
            pinned: ['A.md'],
            created: {'A.md': 5},
            active: 'A.md',
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
        });
    });
});
