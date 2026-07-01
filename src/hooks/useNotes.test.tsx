import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {FakeDirectoryHandle, asDirectoryHandle} from '../storage/fakeFileSystem';
import {FileSystemNoteStore} from '../storage/fileSystemStore';
import {METADATA_FILENAME} from '../storage/metadata';
import {
    ConflictError,
    NameCollisionError,
    type Note,
    type NoteMeta,
    type NoteStore,
    type NotesMetadata,
} from '../storage/types';

import {useNotes} from './useNotes';

beforeEach(() => {
    // The refocus detector early-returns unless the document reports "visible".
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'});
});

async function setup(seed?: (dir: FakeDirectoryHandle) => void) {
    const onError = vi.fn();
    const dir = new FakeDirectoryHandle();
    seed?.(dir);
    const store = new FileSystemNoteStore(asDirectoryHandle(dir));
    const hook = renderHook(() => useNotes(store, onError));
    await waitFor(() => expect(hook.result.current.notes).toBeDefined());
    return {hook, dir, store, onError};
}

describe('useNotes — single note', () => {
    it('opens a note as the active note and persists it', async () => {
        const {hook, store} = await setup((dir) => dir.seedFile('A.md', 'a', 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        expect(hook.result.current.activeId).toBe('A.md');
        expect(hook.result.current.note?.content).toBe('a');
        await waitFor(async () => expect((await store.readMetadata()).active).toBe('A.md'));
    });

    it('opening another note flushes the outgoing pending edit', async () => {
        const {hook, store} = await setup((dir) => {
            dir.seedFile('A.md', 'a', 100);
            dir.seedFile('B.md', 'b', 200);
        });
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        act(() => {
            hook.result.current.edit('edited a');
        });
        // Switch before the 500 ms autosave timer fires; the switch must flush A first.
        await act(async () => {
            await hook.result.current.open('B.md');
        });
        expect(hook.result.current.activeId).toBe('B.md');
        expect((await store.get('A.md')).content).toBe('edited a');
    });

    it('autosaves the open note on hide', async () => {
        const {hook, store} = await setup((dir) => dir.seedFile('A.md', 'a', 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        act(() => {
            hook.result.current.edit('edited a');
        });
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await waitFor(async () => expect((await store.get('A.md')).content).toBe('edited a'));
    });

    it('creating a note opens it as the active note', async () => {
        const {hook, store} = await setup();
        await act(async () => {
            await hook.result.current.create();
        });
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        const id = hook.result.current.notes[0].id;
        expect(hook.result.current.activeId).toBe(id);
        await waitFor(async () => expect((await store.readMetadata()).active).toBe(id));
    });

    it('duplicates a note, copying its body (shared attachment refs) into "<Title> copy"', async () => {
        const body = '![pie](Attachments/pie.png)\n\nyum';
        const {hook, store} = await setup((dir) => dir.seedFile('Recipe.md', body, 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));

        let newId: string | null = null;
        await act(async () => {
            newId = await hook.result.current.duplicate('Recipe.md');
        });

        expect(newId).toBe('Recipe copy.md');
        // The copy is opened and holds the same body, so it references the same attachment.
        expect(hook.result.current.activeId).toBe('Recipe copy.md');
        expect((await store.get('Recipe copy.md')).content).toBe(body);
        // The original is untouched; both now exist.
        expect((await store.get('Recipe.md')).content).toBe(body);
        expect(hook.result.current.notes.map((n) => n.id).sort()).toEqual([
            'Recipe copy.md',
            'Recipe.md',
        ]);
    });

    it('numbers repeated duplicates of the same note', async () => {
        const {hook} = await setup((dir) => dir.seedFile('Note.md', 'body', 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.duplicate('Note.md');
        });
        await act(async () => {
            await hook.result.current.duplicate('Note.md');
        });
        expect(hook.result.current.notes.map((n) => n.id).sort()).toEqual([
            'Note copy 2.md',
            'Note copy.md',
            'Note.md',
        ]);
    });

    it('restores the active note on remount', async () => {
        const onError = vi.fn();
        const dir = new FakeDirectoryHandle();
        dir.seedFile('A.md', 'a', 100);
        dir.seedFile('B.md', 'b', 200);
        const store = new FileSystemNoteStore(asDirectoryHandle(dir));
        const first = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(first.result.current.notes).toHaveLength(2));
        await act(async () => {
            await first.result.current.open('B.md');
        });
        await waitFor(async () => expect((await store.readMetadata()).active).toBe('B.md'));

        const second = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(second.result.current.activeId).toBe('B.md'));
        expect(second.result.current.note?.content).toBe('b');
        // The restore path loads fresh content into the editor, so it bumps the session.
        expect(second.result.current.sessionId).toBeGreaterThan(0);
    });

    it('clears a restored active id whose file no longer exists', async () => {
        const onError = vi.fn();
        const dir = new FakeDirectoryHandle();
        dir.seedFile('A.md', 'a', 100);
        dir.seedFile(
            METADATA_FILENAME,
            JSON.stringify({
                version: 1,
                sort: 'updated',
                pinned: [],
                created: {},
                active: 'Ghost.md',
            }),
        );
        const store = new FileSystemNoteStore(asDirectoryHandle(dir));
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        expect(hook.result.current.activeId).toBeNull();
        expect(hook.result.current.note).toBeNull();
    });

    it('closing clears the active note', async () => {
        const {hook, store} = await setup((dir) => dir.seedFile('A.md', 'a', 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        await act(async () => {
            await hook.result.current.close();
        });
        expect(hook.result.current.activeId).toBeNull();
        expect(hook.result.current.note).toBeNull();
        await waitFor(async () => expect((await store.readMetadata()).active).toBeNull());
    });

    it('renames the active note in place', async () => {
        const {hook, store} = await setup((dir) => dir.seedFile('Old.md', 'x', 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('Old.md');
        });
        await act(async () => {
            await hook.result.current.rename('Old.md', 'New');
        });
        expect(hook.result.current.activeId).toBe('New.md');
        expect(hook.result.current.note?.content).toBe('x');
        await waitFor(async () => expect((await store.readMetadata()).active).toBe('New.md'));
    });

    it('renaming the active note does not bump the editor session', async () => {
        const {hook} = await setup((dir) => dir.seedFile('Old.md', 'x', 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('Old.md');
        });
        const session = hook.result.current.sessionId;
        await act(async () => {
            await hook.result.current.rename('Old.md', 'New');
        });
        expect(hook.result.current.activeId).toBe('New.md');
        // Same session ⇒ the body editor is NOT remounted on a rename.
        expect(hook.result.current.sessionId).toBe(session);
    });

    it('opening a different note bumps the editor session', async () => {
        const {hook} = await setup((dir) => {
            dir.seedFile('A.md', 'a', 100);
            dir.seedFile('B.md', 'b', 200);
        });
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        const session = hook.result.current.sessionId;
        await act(async () => {
            await hook.result.current.open('B.md');
        });
        expect(hook.result.current.sessionId).not.toBe(session);
    });

    it('surfaces a rename collision and leaves the note unchanged', async () => {
        const onError = vi.fn();
        const dir = new FakeDirectoryHandle();
        dir.seedFile('A.md', 'a', 100);
        dir.seedFile('Taken.md', 't', 200);
        const store = new FileSystemNoteStore(asDirectoryHandle(dir));
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        let result: string | null = 'unset';
        await act(async () => {
            result = await hook.result.current.rename('A.md', 'Taken');
        });
        expect(result).toBeNull();
        expect(onError).toHaveBeenCalled();
        expect(hook.result.current.activeId).toBe('A.md');
    });

    it('removing the active note clears it', async () => {
        const {hook} = await setup((dir) => dir.seedFile('A.md', 'a', 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        await act(async () => {
            await hook.result.current.remove('A.md');
        });
        expect(hook.result.current.activeId).toBeNull();
        expect(hook.result.current.note).toBeNull();
    });
});

async function setupConflict() {
    const onError = vi.fn();
    const dir = new FakeDirectoryHandle();
    dir.seedFile('Note.md', 'disk v1', 100);
    const store = new FileSystemNoteStore(asDirectoryHandle(dir));
    const hook = renderHook(() => useNotes(store, onError));
    await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
    await act(async () => {
        await hook.result.current.open('Note.md');
    });
    await waitFor(() => expect(hook.result.current.activeId).toBe('Note.md'));
    // An external edit bumps the mtime past the baseline (100).
    dir.seedFile('Note.md', 'disk v2', 200);
    await act(async () => {
        window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(hook.result.current.conflict).toBeTruthy());
    return {hook, dir, store, onError};
}

describe('useNotes — conflict resolvers', () => {
    it('detects an external change on refocus', async () => {
        const {hook} = await setupConflict();
        expect(hook.result.current.conflict).toMatchObject({id: 'Note.md', deleted: false});
        expect(hook.result.current.saveState).toBe('conflict');
    });

    it('reloadDisk loads the disk version and clears the conflict', async () => {
        const {hook} = await setupConflict();
        await act(async () => {
            await hook.result.current.reloadDisk();
        });
        expect(hook.result.current.conflict).toBeNull();
        expect(hook.result.current.note?.content).toBe('disk v2');
    });

    it('keepMine overwrites disk with the local edits', async () => {
        const {hook, store} = await setupConflict();
        act(() => {
            hook.result.current.edit('my edits');
        });
        await act(async () => {
            await hook.result.current.keepMine();
        });
        expect(hook.result.current.conflict).toBeNull();
        expect((await store.get('Note.md')).content).toBe('my edits');
    });

    it('saveAsCopy writes a copy and leaves the original on disk', async () => {
        const {hook, store} = await setupConflict();
        act(() => {
            hook.result.current.edit('my edits');
        });
        let copyId: string | null = null;
        await act(async () => {
            copyId = await hook.result.current.saveAsCopy();
        });
        expect(copyId).toBe('Note (conflicted copy).md');
        expect(hook.result.current.conflict).toBeNull();
        expect(hook.result.current.activeId).toBe('Note (conflicted copy).md');
        expect((await store.get('Note (conflicted copy).md')).content).toBe('my edits');
        expect((await store.get('Note.md')).content).toBe('disk v2');
    });

    it('discard clears the conflict and closes the note', async () => {
        const {hook} = await setupConflict();
        act(() => {
            hook.result.current.discard();
        });
        await waitFor(() => expect(hook.result.current.activeId).toBeNull());
        expect(hook.result.current.conflict).toBeNull();
    });

    it('keepMine recreates the note when it was deleted on disk', async () => {
        const {hook, dir, store} = await setup((d) => d.seedFile('A.md', 'a', 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        // Delete the file externally, then a queued save fails with NotFoundError → deleted conflict.
        await dir.removeEntry('A.md');
        act(() => {
            hook.result.current.edit('rescued');
        });
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await waitFor(() => expect(hook.result.current.conflict?.deleted).toBe(true));

        await act(async () => {
            await hook.result.current.keepMine();
        });
        expect(hook.result.current.conflict).toBeNull();
        expect((await store.get('A.md')).content).toBe('rescued');
    });
});

/**
 * A minimal in-memory NoteStore whose save() resolves only when the test calls it, so a newer edit
 * can be interleaved while a save is in flight (the flush-failure-overwrite race).
 */
class DeferredSaveStore implements NoteStore {
    readonly listsRecursively = true;
    saveDeferred: {resolve(): void; reject(err: unknown): void} | null = null;
    /** When true, get() blocks until resolveGet(id) is called — to interleave overlapping opens. */
    deferGets = false;
    private content = new Map<string, string>();
    private mtime = new Map<string, number>();
    private clock = 1;
    private getQueue: Array<{id: string; resolve(note: Note): void}> = [];
    private metadata: NotesMetadata = {
        version: 1,
        sort: 'updated',
        pinned: [],
        created: {},
        icons: {},
        active: null,
        trashed: [],
    };

    seed(id: string, body: string) {
        this.content.set(id, body);
        this.mtime.set(id, ++this.clock);
    }

    resolveGet(id: string) {
        const idx = this.getQueue.findIndex((g) => g.id === id);
        if (idx === -1) return;
        const [pending] = this.getQueue.splice(idx, 1);
        pending.resolve({...this.meta(id), content: this.content.get(id) ?? ''});
    }

    async list(): Promise<NoteMeta[]> {
        return [...this.content.keys()].map((id) => this.meta(id));
    }

    async getAll(): Promise<Note[]> {
        return [...this.content.keys()].map((id) => ({
            ...this.meta(id),
            content: this.content.get(id) ?? '',
        }));
    }

    get(id: string): Promise<Note> {
        if (this.deferGets) {
            return new Promise<Note>((resolve) => this.getQueue.push({id, resolve}));
        }
        return Promise.resolve({...this.meta(id), content: this.content.get(id) ?? ''});
    }

    async create(title: string, parentPath = ''): Promise<NoteMeta> {
        const id = parentPath ? `${parentPath}/${title}.md` : `${title}.md`;
        this.content.set(id, '');
        this.mtime.set(id, ++this.clock);
        return this.meta(id);
    }

    async move(id: string, destFolder: string): Promise<NoteMeta> {
        const leaf = id.slice(id.lastIndexOf('/') + 1);
        const next = destFolder ? `${destFolder}/${leaf}` : leaf;
        if (next === id) return this.meta(id);
        this.content.set(next, this.content.get(id) ?? '');
        this.content.delete(id);
        this.mtime.set(next, this.mtime.get(id) ?? ++this.clock);
        return this.meta(next);
    }

    save(id: string, content: string): Promise<NoteMeta> {
        return new Promise<NoteMeta>((resolve, reject) => {
            this.saveDeferred = {
                resolve: () => {
                    this.content.set(id, content);
                    this.mtime.set(id, ++this.clock);
                    resolve(this.meta(id));
                },
                reject,
            };
        });
    }

    async rename(id: string, nextTitle: string): Promise<NoteMeta> {
        const next = `${nextTitle}.md`;
        this.content.set(next, this.content.get(id) ?? '');
        this.content.delete(id);
        this.mtime.set(next, ++this.clock);
        return this.meta(next);
    }

    async remove(id: string): Promise<void> {
        this.content.delete(id);
    }

    async trash(): Promise<string> {
        throw new Error('not used in these tests');
    }

    async listTrash(): Promise<never[]> {
        return [];
    }

    async restore(): Promise<NoteMeta> {
        throw new Error('not used in these tests');
    }

    async purge(): Promise<void> {}

    async emptyTrash(): Promise<void> {}

    async writeAttachment(): Promise<string> {
        throw new Error('not used in these tests');
    }

    async writeAttachmentAt(): Promise<void> {}

    async readAttachment(): Promise<Blob> {
        throw new Error('not used in these tests');
    }

    async listAttachments(): Promise<never[]> {
        return [];
    }

    async removeAttachment(): Promise<void> {}

    async createFolder(parentPath: string, name: string): Promise<string> {
        return parentPath ? `${parentPath}/${name}` : name;
    }

    async removeFolder(): Promise<void> {}

    async moveFolder(): Promise<void> {}

    async listFolders(): Promise<string[]> {
        return [];
    }

    async stat(id: string): Promise<number | null> {
        return this.mtime.get(id) ?? null;
    }

    async readMetadata(): Promise<NotesMetadata> {
        return this.metadata;
    }

    async writeMetadata(meta: NotesMetadata): Promise<void> {
        this.metadata = meta;
    }

    private meta(id: string): NoteMeta {
        return {id, title: id.replace(/\.md$/, ''), updatedAt: this.mtime.get(id)};
    }
}

describe('useNotes — save lifecycle hardening', () => {
    it('flushes a pending edit before removing a different note', async () => {
        const {hook, store} = await setup((dir) => {
            dir.seedFile('A.md', 'a', 100);
            dir.seedFile('B.md', 'b', 200);
        });
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        act(() => {
            hook.result.current.edit('edited a');
        });
        // Delete B (not the active note) within A's debounce window: remove() must flush A first.
        await act(async () => {
            await hook.result.current.remove('B.md');
        });
        expect((await store.get('A.md')).content).toBe('edited a');
    });

    it('does not remount the editor when opening the already-open note', async () => {
        const {hook} = await setup((dir) => dir.seedFile('A.md', 'a', 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        const session = hook.result.current.sessionId;
        await act(async () => {
            await hook.result.current.open('A.md'); // same note again
        });
        expect(hook.result.current.sessionId).toBe(session);
    });

    it('keeps the open note when close() runs with an unresolved conflict', async () => {
        const {hook} = await setupConflict();
        act(() => {
            hook.result.current.edit('local edit');
        });
        await act(async () => {
            await hook.result.current.close();
        });
        // flush() during close hit the conflict and re-queued the edit; the note must stay open.
        expect(hook.result.current.note).not.toBeNull();
        expect(hook.result.current.conflict).toBeTruthy();
    });

    it('warns on beforeunload while an edit is unsaved (and not when clean)', async () => {
        const {hook} = await setup((dir) => dir.seedFile('A.md', 'a', 100));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        // Clean: no pending edit → the unload prompt is not triggered.
        const clean = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(clean);
        expect(clean.defaultPrevented).toBe(false);

        act(() => {
            hook.result.current.edit('dirty');
        });
        const dirty = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(dirty);
        expect(dirty.defaultPrevented).toBe(true);
    });

    it('a failed flush does not overwrite a newer edit made during the save', async () => {
        const store = new DeferredSaveStore();
        store.seed('A.md', 'v0');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('A.md');
        });

        act(() => {
            hook.result.current.edit('v1');
        });
        // Kick off the flush (save now hangs on the deferred), then type v2 during the await.
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        act(() => {
            hook.result.current.edit('v2');
        });
        // Fail the in-flight v1 save: v2 must survive (not be clobbered by the v1 snapshot).
        await act(async () => {
            store.saveDeferred?.reject(new Error('disk full'));
        });
        // Flush again and let it succeed — the surviving v2 is what lands on disk.
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await act(async () => {
            store.saveDeferred?.resolve();
        });
        expect((await store.get('A.md')).content).toBe('v2');
    });

    it('a slow earlier open() cannot overwrite a newer one (wrong-note race)', async () => {
        const store = new DeferredSaveStore();
        store.seed('B.md', 'b');
        store.seed('C.md', 'c');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));

        store.deferGets = true;
        // Start open(B) (its get hangs), then open(C) (a newer open). Resolve C first, then the
        // stale B — the generation guard must drop B so the editor stays on C.
        let openB: Promise<void> = Promise.resolve();
        let openC: Promise<void> = Promise.resolve();
        act(() => {
            openB = hook.result.current.open('B.md');
        });
        act(() => {
            openC = hook.result.current.open('C.md');
        });
        // Let both opens advance past `await flush()` to their (deferred) get() call.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => {
            store.resolveGet('C.md');
            await openC;
        });
        await act(async () => {
            store.resolveGet('B.md');
            await openB;
        });

        expect(hook.result.current.note?.id).toBe('C.md');
        expect(hook.result.current.activeId).toBe('C.md');
    });

    it('carries a pending edit across a rename instead of dropping it', async () => {
        const store = new DeferredSaveStore();
        store.seed('Old.md', 'v0');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('Old.md');
        });

        act(() => {
            hook.result.current.edit('v1');
        });
        // rename()'s leading flush() hangs on the deferred save. While it's hung, type v2 — that
        // edit (re-queued for Old.md) must be carried to New.md, not dropped (the M1 regression).
        let rename: Promise<string | null> = Promise.resolve(null);
        act(() => {
            rename = hook.result.current.rename('Old.md', 'New');
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        act(() => {
            hook.result.current.edit('v2');
        });
        // Complete the flush (v1) so rename proceeds and carries v2 to New.md.
        await act(async () => {
            store.saveDeferred?.resolve();
            await rename;
        });
        // Flush the carried edit and let it succeed.
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            store.saveDeferred?.resolve();
        });
        expect((await store.get('New.md')).content).toBe('v2');
    });
});

/**
 * In-memory store supporting nested ids with real conflict/NotFound semantics, plus a releasable
 * gate on move() so a test can inject a keystroke while a move is mid-flight. (The FS store's move
 * is an interim stub that throws for nested paths, so it can't drive these.)
 */
class ControllableStore implements NoteStore {
    readonly listsRecursively = true;
    saves: string[] = [];
    atGate = false;
    private files = new Map<string, {content: string; updatedAt: number}>();
    private metadata: NotesMetadata = {
        version: 1,
        sort: 'updated',
        pinned: [],
        created: {},
        icons: {},
        active: null,
        trashed: [],
    };
    private clock = 100;
    private folderMarkers = new Set<string>();
    private gate: Promise<void> | null = null;
    private release: (() => void) | null = null;

    seed(id: string, content: string) {
        this.files.set(id, {content, updatedAt: ++this.clock});
    }

    /** Make the next move() park (setting atGate) until releaseMove() is called. */
    gateMove() {
        this.gate = new Promise<void>((resolve) => {
            this.release = resolve;
        });
    }

    releaseMove() {
        this.release?.();
        this.gate = null;
        this.release = null;
        this.atGate = false;
    }

    async list(): Promise<NoteMeta[]> {
        return [...this.files.keys()].filter((id) => !this.inTrash(id)).map((id) => this.meta(id));
    }

    async getAll(): Promise<Note[]> {
        return [...this.files]
            .filter(([id]) => !this.inTrash(id))
            .map(([id, f]) => ({...this.meta(id), content: f.content}));
    }

    async get(id: string): Promise<Note> {
        const f = this.files.get(id);
        if (!f) throw new DOMException(`"${id}" not found`, 'NotFoundError');
        return {...this.meta(id), content: f.content};
    }

    async create(title: string, parentPath = ''): Promise<NoteMeta> {
        const id = parentPath ? `${parentPath}/${title}.md` : `${title}.md`;
        this.files.set(id, {content: '', updatedAt: ++this.clock});
        return this.meta(id);
    }

    async save(id: string, content: string, base: number): Promise<NoteMeta> {
        this.saves.push(id);
        const f = this.files.get(id);
        if (!f) throw new DOMException(`"${id}" not found`, 'NotFoundError');
        if (f.updatedAt !== base) throw new ConflictError(id, f.updatedAt);
        f.content = content;
        f.updatedAt = ++this.clock;
        return this.meta(id);
    }

    async rename(id: string, nextTitle: string): Promise<NoteMeta> {
        const next = `${nextTitle}.md`;
        const f = this.files.get(id);
        if (!f) throw new DOMException(`"${id}" not found`, 'NotFoundError');
        this.files.set(next, {...f});
        this.files.delete(id);
        return this.meta(next);
    }

    async move(id: string, destFolder: string): Promise<NoteMeta> {
        const leaf = id.slice(id.lastIndexOf('/') + 1);
        const newId = destFolder ? `${destFolder}/${leaf}` : leaf;
        if (this.gate) {
            this.atGate = true;
            await this.gate;
        }
        const f = this.files.get(id);
        if (!f) throw new DOMException(`"${id}" not found`, 'NotFoundError');
        if (newId === id) return this.meta(id);
        if (this.files.has(newId)) throw new NameCollisionError(id, this.meta(id).title);
        this.files.set(newId, {...f}); // pure relocation: content + mtime preserved
        this.files.delete(id);
        return this.meta(newId);
    }

    async remove(id: string): Promise<void> {
        this.files.delete(id);
    }

    async trash(id: string): Promise<string> {
        const f = this.files.get(id);
        if (!f) throw new DOMException(`"${id}" not found`, 'NotFoundError');
        const trashId = this.uniqueId('.trash', this.leafOf(id));
        this.files.set(trashId, {...f});
        this.files.delete(id);
        return trashId;
    }

    async listTrash(): Promise<NoteMeta[]> {
        return [...this.files.keys()].filter((id) => this.inTrash(id)).map((id) => this.meta(id));
    }

    async restore(trashId: string, destFolder: string): Promise<NoteMeta> {
        const f = this.files.get(trashId);
        if (!f) throw new DOMException(`"${trashId}" not found`, 'NotFoundError');
        const newId = this.uniqueId(destFolder, this.leafOf(trashId));
        this.files.set(newId, {...f, updatedAt: ++this.clock});
        this.files.delete(trashId);
        return this.meta(newId);
    }

    async purge(trashId: string): Promise<void> {
        this.files.delete(trashId);
    }

    async emptyTrash(): Promise<void> {
        for (const id of [...this.files.keys()]) if (this.inTrash(id)) this.files.delete(id);
    }

    async writeAttachment(): Promise<string> {
        throw new Error('not used in these tests');
    }

    async writeAttachmentAt(): Promise<void> {}

    async readAttachment(): Promise<Blob> {
        throw new Error('not used in these tests');
    }

    async listAttachments(): Promise<never[]> {
        return [];
    }

    async removeAttachment(): Promise<void> {}

    async createFolder(parentPath: string, name: string): Promise<string> {
        const path = parentPath ? `${parentPath}/${name}` : name;
        this.folderMarkers.add(path);
        return path;
    }

    async removeFolder(path: string): Promise<void> {
        this.folderMarkers.delete(path);
    }

    async moveFolder(fromPath: string, toPath: string): Promise<void> {
        if (!fromPath || fromPath === toPath) return;
        if (toPath === fromPath || toPath.startsWith(`${fromPath}/`)) {
            throw new Error('Cannot move a folder into itself');
        }
        const toPrefix = `${toPath}/`;
        const occupied =
            [...this.files.keys()].some((id) => id === toPath || id.startsWith(toPrefix)) ||
            [...this.folderMarkers].some((f) => f === toPath || f.startsWith(toPrefix));
        if (occupied) {
            throw new NameCollisionError(fromPath, toPath.slice(toPath.lastIndexOf('/') + 1));
        }
        const prefix = `${fromPath}/`;
        const rekey = (id: string) => toPath + id.slice(fromPath.length);
        for (const [id, f] of [...this.files]) {
            if (id === fromPath || id.startsWith(prefix)) {
                this.files.set(rekey(id), f); // pure relocation: content + mtime preserved
                this.files.delete(id);
            }
        }
        for (const marker of [...this.folderMarkers]) {
            if (marker === fromPath || marker.startsWith(prefix)) {
                this.folderMarkers.delete(marker);
                this.folderMarkers.add(rekey(marker));
            }
        }
    }

    async listFolders(): Promise<string[]> {
        const set = new Set(this.folderMarkers);
        for (const id of this.files.keys()) {
            if (this.inTrash(id)) continue; // `.trash/` is not a user folder
            const parts = id.split('/');
            parts.pop(); // drop the leaf
            for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'));
        }
        return [...set].sort();
    }

    async stat(id: string): Promise<number | null> {
        return this.files.get(id)?.updatedAt ?? null;
    }

    async readMetadata(): Promise<NotesMetadata> {
        return this.metadata;
    }

    async writeMetadata(meta: NotesMetadata): Promise<void> {
        this.metadata = meta;
    }

    private meta(id: string): NoteMeta {
        return {id, title: this.leafOf(id), updatedAt: this.files.get(id)?.updatedAt};
    }

    private leafOf(id: string): string {
        return id.slice(id.lastIndexOf('/') + 1).replace(/\.md$/, '');
    }

    private inTrash(id: string): boolean {
        return id.startsWith('.trash/');
    }

    /** A free `<dir>/<leaf>.md` id, numbering on collision (mirrors the real backends' uniqueName). */
    private uniqueId(dir: string, leaf: string): string {
        const at = (n: string) => (dir ? `${dir}/${n}` : n);
        for (let i = 1; i <= 100000; i++) {
            const id = at(`${i === 1 ? leaf : `${leaf} ${i}`}.md`);
            if (!this.files.has(id)) return id;
        }
        throw new Error('no free id');
    }
}

describe('useNotes — move (folders)', () => {
    it('moves the open note into a folder, updating identity in place (no remount)', async () => {
        const store = new ControllableStore();
        store.seed('A.md', 'body');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('A.md');
        });
        const session = hook.result.current.sessionId;

        await act(async () => {
            await hook.result.current.move('A.md', 'Work');
        });

        expect(hook.result.current.activeId).toBe('Work/A.md');
        expect(hook.result.current.note?.id).toBe('Work/A.md');
        expect(hook.result.current.note?.content).toBe('body');
        expect(hook.result.current.sessionId).toBe(session); // editor instance kept
        expect(hook.result.current.notes.map((n) => n.id)).toEqual(['Work/A.md']);
        expect((await store.readMetadata()).active).toBe('Work/A.md');
        expect(onError).not.toHaveBeenCalled();
    });

    it('remaps a pinned note id when moving it', async () => {
        const store = new ControllableStore();
        store.seed('A.md', 'body');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        act(() => {
            hook.result.current.togglePin('A.md');
        });
        await act(async () => {
            await hook.result.current.move('A.md', 'Work');
        });
        expect(hook.result.current.metadata.pinned).toEqual(['Work/A.md']);
    });

    it('moveFolder re-homes the open note in place (no remount) and re-keys metadata', async () => {
        const store = new ControllableStore();
        store.seed('Work/Plan.md', 'body');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('Work/Plan.md');
        });
        const session = hook.result.current.sessionId;
        act(() => {
            hook.result.current.togglePin('Work'); // pin the folder too
        });

        await act(async () => {
            await hook.result.current.moveFolder('Work', 'Archive/Work');
        });

        expect(hook.result.current.note?.id).toBe('Archive/Work/Plan.md');
        expect(hook.result.current.activeId).toBe('Archive/Work/Plan.md');
        expect(hook.result.current.note?.content).toBe('body');
        expect(hook.result.current.sessionId).toBe(session); // editor instance kept
        expect(hook.result.current.notes.map((n) => n.id)).toEqual(['Archive/Work/Plan.md']);
        expect(hook.result.current.metadata.pinned).toEqual(['Archive/Work']);
        expect((await store.readMetadata()).active).toBe('Archive/Work/Plan.md');
        expect(onError).not.toHaveBeenCalled();
    });

    it('moveFolder reports a collision and leaves the source intact', async () => {
        const store = new ControllableStore();
        store.seed('Work/A.md', 'a');
        store.seed('Archive/B.md', 'b');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));

        await act(async () => {
            await hook.result.current.moveFolder('Work', 'Archive');
        });

        expect(onError).toHaveBeenCalled();
        expect(hook.result.current.notes.map((n) => n.id).sort()).toEqual([
            'Archive/B.md',
            'Work/A.md',
        ]);
    });

    it('moveFolder refuses to nest a folder in itself', async () => {
        const store = new ControllableStore();
        store.seed('Work/A.md', 'a');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));

        await act(async () => {
            await hook.result.current.moveFolder('Work', 'Work/Sub');
        });

        expect(onError).toHaveBeenCalledWith(expect.stringMatching(/itself/i));
        expect(hook.result.current.notes.map((n) => n.id)).toEqual(['Work/A.md']);
    });

    it('refuses a move onto an existing same-leaf note, leaving the source open and intact', async () => {
        const store = new ControllableStore();
        store.seed('A.md', 'a');
        store.seed('Work/A.md', 'other');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
        await act(async () => {
            await hook.result.current.open('A.md');
        });

        let result: string | null = 'unset';
        await act(async () => {
            result = await hook.result.current.move('A.md', 'Work');
        });

        expect(result).toBeNull();
        expect(onError).toHaveBeenCalled();
        expect(await store.stat('A.md')).not.toBeNull();
        expect(hook.result.current.activeId).toBe('A.md');
    });

    it('preserves a keystroke typed DURING the move await, saving it to the new id without conflict', async () => {
        const store = new ControllableStore();
        store.seed('A.md', 'v0');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('A.md');
        });

        // Type v1 (arms the autosave), then start a move that parks at the store.move await.
        act(() => {
            hook.result.current.edit('v1');
        });
        store.gateMove();
        // Start the move inside an awaited act so flush()'s state updates settle here, draining
        // microtasks until move() has run flush() (saving v1 to A.md) and parked on the gate.
        let movePromise: Promise<string | null> = Promise.resolve(null);
        await act(async () => {
            movePromise = hook.result.current.move('A.md', 'Work');
            for (let i = 0; i < 100 && !store.atGate; i++) await Promise.resolve();
        });
        expect(store.atGate).toBe(true);
        // Type v2 while the move is in flight — metadata.active is still 'A.md' here.
        act(() => {
            hook.result.current.edit('v2');
        });
        // Release the move; it kills the stale v2 timer and re-points the pending edit to the new id.
        await act(async () => {
            store.releaseMove();
            await movePromise;
        });
        // Drain the re-armed autosave.
        await act(async () => {
            await hook.result.current.flushPending();
        });

        expect(hook.result.current.activeId).toBe('Work/A.md');
        expect(hook.result.current.conflict).toBeNull();
        expect((await store.get('Work/A.md')).content).toBe('v2'); // keystroke not lost
        expect(await store.stat('A.md')).toBeNull(); // old id gone
        // The only save against the old id was the pre-move flush; nothing saved to it afterwards.
        expect(store.saves.filter((id) => id === 'A.md')).toHaveLength(1);
        expect(store.saves[store.saves.length - 1]).toBe('Work/A.md');
        expect(onError).not.toHaveBeenCalled();
    });
});

describe('useNotes — folders', () => {
    it('exposes folders implied by notes plus deliberately-empty ones', async () => {
        const store = new ControllableStore();
        store.seed('Work/Sub/Note.md', 'x');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));

        await act(async () => {
            await hook.result.current.createFolder('', 'Projects');
        });

        expect(hook.result.current.folders).toEqual(['Projects', 'Work', 'Work/Sub']);
    });

    it('creates a note inside a folder and opens it', async () => {
        const store = new ControllableStore();
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toBeDefined());

        await act(async () => {
            await hook.result.current.create('Idea', 'Work');
        });

        expect(hook.result.current.activeId).toBe('Work/Idea.md');
        expect(hook.result.current.folders).toContain('Work');
    });

    it('keeps a pinned empty folder across a refresh (reconcile sees it as live)', async () => {
        const store = new ControllableStore();
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toBeDefined());

        await act(async () => {
            await hook.result.current.createFolder('', 'Keep');
        });
        act(() => {
            hook.result.current.togglePin('Keep');
        });
        await act(async () => {
            await hook.result.current.refresh();
        });

        expect(hook.result.current.metadata.pinned).toContain('Keep');
        expect(hook.result.current.folders).toContain('Keep');
    });

    it('removeFolder drops the folder and unpins it', async () => {
        const store = new ControllableStore();
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toBeDefined());

        await act(async () => {
            await hook.result.current.createFolder('', 'Temp');
        });
        act(() => {
            hook.result.current.togglePin('Temp');
        });
        await act(async () => {
            await hook.result.current.removeFolder('Temp');
        });

        expect(hook.result.current.folders).not.toContain('Temp');
        expect(hook.result.current.metadata.pinned).not.toContain('Temp');
    });

    it('removeFolder refuses a folder that still holds a note', async () => {
        const store = new ControllableStore();
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toBeDefined());

        await act(async () => {
            await hook.result.current.create('Note', 'Work');
        });
        await waitFor(() => expect(hook.result.current.folders).toContain('Work'));

        await act(async () => {
            await hook.result.current.removeFolder('Work');
        });

        expect(onError).toHaveBeenCalledWith('Only empty folders can be deleted.');
        expect(hook.result.current.folders).toContain('Work'); // untouched
    });

    it('removeFolder refuses a folder that still has a subfolder', async () => {
        const store = new ControllableStore();
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toBeDefined());

        await act(async () => {
            await hook.result.current.createFolder('', 'Parent');
            await hook.result.current.createFolder('Parent', 'Child');
        });
        await waitFor(() => expect(hook.result.current.folders).toContain('Parent/Child'));

        await act(async () => {
            await hook.result.current.removeFolder('Parent');
        });

        expect(onError).toHaveBeenCalledWith('Only empty folders can be deleted.');
        expect(hook.result.current.folders).toContain('Parent');
    });
});

describe('useNotes — trash', () => {
    it('trashing the active note clears it and records a registry entry', async () => {
        const store = new ControllableStore();
        store.seed('Work/A.md', 'body');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.open('Work/A.md');
        });

        let ok = false;
        await act(async () => {
            ok = await hook.result.current.trash('Work/A.md');
        });
        expect(ok).toBe(true); // resolves true on success

        // Left the listing and cleared as the open note.
        expect(hook.result.current.notes).toHaveLength(0);
        expect(hook.result.current.activeId).toBeNull();
        expect(hook.result.current.note).toBeNull();
        // The badge count is correct straight away (registry), without loading the view.
        expect(hook.result.current.trashCount).toBe(1);

        // Opening the trash view (refreshTrash) publishes the display list with its original folder.
        await act(async () => {
            await hook.result.current.refreshTrash();
        });
        expect(hook.result.current.trashedNotes).toHaveLength(1);
        expect(hook.result.current.trashedNotes[0]).toMatchObject({
            title: 'A',
            originalPath: 'Work',
        });
        expect(onError).not.toHaveBeenCalled();
    });

    it('restores a trashed note to its original folder', async () => {
        const store = new ControllableStore();
        store.seed('Work/A.md', 'body');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        await act(async () => {
            await hook.result.current.trash('Work/A.md');
        });
        // Open the trash view to load the display list.
        await act(async () => {
            await hook.result.current.refreshTrash();
        });
        const trashId = hook.result.current.trashedNotes[0].id;

        let restoredId: string | null = null;
        await act(async () => {
            restoredId = await hook.result.current.restoreFromTrash(trashId);
        });

        expect(restoredId).toBe('Work/A.md');
        expect(hook.result.current.notes.map((n) => n.id)).toEqual(['Work/A.md']);
        expect(hook.result.current.trashCount).toBe(0);
        expect(hook.result.current.trashedNotes).toEqual([]); // dropped from the view in-memory
    });

    it('preserves a note icon across trash → restore', async () => {
        const store = new ControllableStore();
        store.seed('Work/A.md', 'body');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        act(() => {
            hook.result.current.setIcon('Work/A.md', 'Star');
        });
        expect(hook.result.current.metadata.icons['Work/A.md']).toBe('Star');

        await act(async () => {
            await hook.result.current.trash('Work/A.md');
        });
        // Trashing drops the icon from the LIVE metadata (the note is no longer a live id)…
        expect(hook.result.current.metadata.icons['Work/A.md']).toBeUndefined();

        await act(async () => {
            await hook.result.current.refreshTrash();
        });
        const trashId = hook.result.current.trashedNotes[0].id;
        let restoredId: string | null = null;
        await act(async () => {
            restoredId = await hook.result.current.restoreFromTrash(trashId);
        });

        // …and restore reinstates it on the restored id.
        expect(restoredId).toBe('Work/A.md');
        expect(hook.result.current.metadata.icons['Work/A.md']).toBe('Star');
    });

    it('purges one trashed note and empties the rest', async () => {
        const store = new ControllableStore();
        store.seed('A.md', 'a');
        store.seed('B.md', 'b');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(2));
        await act(async () => {
            await hook.result.current.trash('A.md');
        });
        await act(async () => {
            await hook.result.current.trash('B.md');
        });
        expect(hook.result.current.trashCount).toBe(2);

        await act(async () => {
            await hook.result.current.refreshTrash();
        });
        expect(hook.result.current.trashedNotes).toHaveLength(2);

        await act(async () => {
            await hook.result.current.purgeFromTrash(hook.result.current.trashedNotes[0].id);
        });
        expect(hook.result.current.trashCount).toBe(1);
        expect(hook.result.current.trashedNotes).toHaveLength(1); // dropped from the view in-memory

        await act(async () => {
            await hook.result.current.emptyTrash();
        });
        expect(hook.result.current.trashCount).toBe(0);
        expect(hook.result.current.trashedNotes).toEqual([]);
    });

    it('drops a trashed note from the pins (it is no longer a live note)', async () => {
        const store = new ControllableStore();
        store.seed('A.md', 'a');
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toHaveLength(1));
        act(() => {
            hook.result.current.togglePin('A.md');
        });
        expect(hook.result.current.metadata.pinned).toEqual(['A.md']);

        await act(async () => {
            await hook.result.current.trash('A.md');
        });
        expect(hook.result.current.metadata.pinned).toEqual([]);
    });

    it('refuses to trash a note with an unresolved conflict (returns false, no move)', async () => {
        const {hook, onError} = await setupConflict(); // opens a conflicted 'Note.md'

        let result: boolean | undefined;
        await act(async () => {
            result = await hook.result.current.trash('Note.md');
        });

        expect(result).toBe(false);
        expect(onError).toHaveBeenCalledWith(expect.stringMatching(/resolve the conflict/i));
        expect(hook.result.current.notes.map((n) => n.id)).toContain('Note.md'); // not trashed
        expect(hook.result.current.trashCount).toBe(0);
    });

    it('preserves the original created stamp across a trash → restore round-trip', async () => {
        const store = new ControllableStore();
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));
        await waitFor(() => expect(hook.result.current.notes).toBeDefined());
        await act(async () => {
            await hook.result.current.create('A'); // create() stamps a `created` time
        });
        const createdAt = hook.result.current.metadata.created['A.md'];
        expect(createdAt).toBeDefined();

        await act(async () => {
            await hook.result.current.trash('A.md');
        });
        // While trashed it leaves the live created map…
        expect(hook.result.current.metadata.created['A.md']).toBeUndefined();
        await act(async () => {
            await hook.result.current.refreshTrash();
        });
        const trashId = hook.result.current.trashedNotes[0].id;

        let restoredId: string | null = null;
        await act(async () => {
            restoredId = await hook.result.current.restoreFromTrash(trashId);
        });
        // …and the original stamp is reinstated on restore (not reset to "now").
        expect(restoredId).toBe('A.md');
        expect(hook.result.current.metadata.created['A.md']).toBe(createdAt);
    });

    it('adopts an orphan trash file (no registry entry) into the count and view on load', async () => {
        const store = new ControllableStore();
        store.seed('.trash/Orphan.md', 'lost'); // a file in .trash/ with no registry entry
        const onError = vi.fn();
        const hook = renderHook(() => useNotes(store, onError));

        // The load effect reconciles the registry against the backend, adopting the orphan, so the
        // badge count is right immediately and the view lists it (restoring to root).
        await waitFor(() => expect(hook.result.current.trashCount).toBe(1));
        expect(hook.result.current.trashedNotes.map((n) => n.id)).toEqual(['.trash/Orphan.md']);
        expect(hook.result.current.trashedNotes[0].originalPath).toBe('');
        expect(onError).not.toHaveBeenCalled();
    });
});
