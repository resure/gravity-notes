import {Toaster, ToasterComponent, ToasterProvider} from '@gravity-ui/uikit';
import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import {IDBFactory} from 'fake-indexeddb';
import {afterEach, describe, expect, it, vi} from 'vitest';

import * as clipboard from '../clipboard';
import {FakeDirectoryHandle, asDirectoryHandle} from '../storage/fakeFileSystem';
import {FileSystemNoteStore} from '../storage/fileSystemStore';
import {IndexedDbNoteStore} from '../storage/indexedDbStore';
import type {Note, NoteStore} from '../storage/types';
import {renderWithProviders} from '../test/render';
import {extractWikiLinks, resolveWikiLink} from '../wikiLinks';

import {Workspace} from './Workspace';

vi.mock('./EditorPane', async () => {
    const {forwardRef, useImperativeHandle} = await import('react');
    return {
        EditorPane: forwardRef(function EditorPane(
            {note, onOpenWikiLink}: {note: Note; onOpenWikiLink: (target: string) => void},
            ref,
        ) {
            useImperativeHandle(ref, () => ({
                focus() {},
                renameTitle() {},
                toggleMode() {},
            }));
            return (
                <>
                    <output aria-label="Open note">{note.id}</output>
                    <button type="button" onClick={() => onOpenWikiLink(note.content.slice(2, -2))}>
                        Follow wiki link
                    </button>
                </>
            );
        }),
    };
});

afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function setup(target: string, rootExists = false) {
    const dir = new FakeDirectoryHandle();
    dir.seedFile('Work/Other.md', `[[${target}]]`, 100);
    dir.seedFile('Work/Shared.md', 'sibling', 200);
    if (rootExists) dir.seedFile('Shared.md', 'root', 300);
    const store = new FileSystemNoteStore(asDirectoryHandle(dir));
    return {dir, ...(await setupStore(store))};
}

async function setupStore(store: NoteStore, restoreId?: string) {
    if (restoreId) await store.writeMetadata({...(await store.readMetadata()), active: restoreId});
    const create = vi.spyOn(store, 'create');
    renderWithProviders(
        <ToasterProvider toaster={new Toaster()}>
            <Workspace
                store={store}
                workspaceId="wiki-link-test"
                storageLabel="notes"
                workspaces={[]}
                initialNoteId={null}
                themePref="light"
                onChangeThemePref={vi.fn()}
                onOpenWorkspace={vi.fn(async () => true)}
                onOpenWorkspaceInNewWindow={vi.fn(async () => {})}
                onOpenNoteInNewWindow={vi.fn(async () => {})}
                onRemoveWorkspace={vi.fn(async () => {})}
                onRefreshWorkspaces={vi.fn(async () => {})}
                onOpenFolder={vi.fn()}
                onOpenFolderInNewWindow={vi.fn(async () => {})}
                supportsFolders
            />
            <ToasterComponent />
        </ToasterProvider>,
    );
    if (!restoreId) fireEvent.click(await screen.findByRole('option', {name: /Other/}));
    await waitFor(() =>
        expect(screen.getByLabelText('Open note').textContent).toBe(restoreId ?? 'Work/Other.md'),
    );
    return {store, create};
}

function followWikiLink() {
    fireEvent.click(screen.getByRole('button', {name: 'Follow wiki link'}));
}

describe('Workspace copy wiki link', () => {
    async function copyLink(id: string, otherId: string) {
        const dir = new FakeDirectoryHandle();
        dir.seedFile(id, 'copy source', 100);
        dir.seedFile(otherId, 'other note', 200);
        const store = new FileSystemNoteStore(asDirectoryHandle(dir));
        await setupStore(store, id);
        fireEvent.click(
            within(screen.getByRole('banner')).getByRole('button', {name: 'Note actions'}),
        );
        fireEvent.click(await screen.findByRole('menuitem', {name: 'Copy link to note'}));
        return store;
    }

    it.each([
        ['Plan.md', 'Other.md', '[[Plan]]'],
        ['Topic.md.md', 'Topic.md', '[[/Topic.md.md]]'],
        ['Work/Topic.md.md', 'Work/Topic.md', '[[/Work/Topic.md.md]]'],
        ['Shared.md', 'Work/Shared.md', '[[/Shared]]'],
        ['Work/Shared.md', 'Shared.md', '[[Work/Shared]]'],
    ])('copies a link that opens %s rather than %s', async (id, otherId, expected) => {
        const write = vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(undefined);
        const store = await copyLink(id, otherId);
        await waitFor(() => expect(write).toHaveBeenCalledExactlyOnceWith(expected));
        expect(await screen.findByText('Link copied')).toBeInTheDocument();
        const links = extractWikiLinks(expected);
        expect(links).toHaveLength(1);
        const notes = await store.list();
        for (const from of ['Elsewhere.md', 'Work/Elsewhere.md']) {
            expect(resolveWikiLink(links[0].target, from, notes)).toBe(id);
        }
    });

    it.each([
        ['C#.md', 'C.md'],
        ['A[B].md', 'A.md'],
        ['Work/C#.md', 'Work/C.md'],
    ])(
        'reports an unsupported name instead of copying the wrong link for %s',
        async (id, otherId) => {
            const write = vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(undefined);
            const store = await copyLink(id, otherId);
            expect(
                await screen.findByText('This note name cannot be represented as a wiki link'),
            ).toBeInTheDocument();
            expect(write).not.toHaveBeenCalled();
            expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
            expect((await store.list()).map((note) => note.id).sort()).toEqual(
                [id, otherId].sort(),
            );
            expect((await store.get(id)).content).toBe('copy source');
        },
    );
});

describe('Workspace wiki-link navigation', () => {
    describe.each(['fsa', 'indexeddb'])('exact root path preflight (%s)', (backend) => {
        async function setupBackend(target: string) {
            if (backend === 'fsa') return setup(target);
            vi.stubGlobal('indexedDB', new IDBFactory());
            const store = new IndexedDbNoteStore();
            const source = await store.create('Other', 'Work');
            await store.save(source.id, `[[${target}]]`, source.updatedAt ?? 0);
            const sibling = await store.create('Shared', 'Work');
            await store.save(sibling.id, 'sibling', sibling.updatedAt ?? 0);
            return setupStore(store);
        }

        it.each([
            ['/Shared', '', 'Shared.md'],
            ['/Archive/Shared', 'Archive', 'Shared.md'],
            ['/SHARED', '', 'shared.MD'],
        ])('rejects %s when a folder occupies the target', async (target, parentPath, folder) => {
            const {store, create} = await setupBackend(target);
            const occupied = await store.createFolder(parentPath, folder);
            const originalNotes = await store.list();
            const originalFolders = await store.listFolders();
            followWikiLink();
            expect(
                await screen.findByText(
                    'Cannot create this note because a folder already occupies its path',
                ),
            ).toBeInTheDocument();
            expect(create).not.toHaveBeenCalled();
            expect(await store.list()).toEqual(originalNotes);
            expect(await store.listFolders()).toEqual(originalFolders);
            expect(await store.listFolders()).toContain(occupied);
            expect(screen.getByLabelText('Open note').textContent).toBe('Work/Other.md');
        });

        it.each([
            ['/Shared', 'Shared', ''],
            ['/Archive/Shared', 'Shared', 'Archive'],
            ['/SHARED', 'shared', ''],
        ])(
            'refreshes and opens an exact note that appeared for %s',
            async (target, title, parentPath) => {
                const {store, create} = await setupBackend(target);
                const appeared = await store.create(title, parentPath);
                await store.save(appeared.id, 'external content', appeared.updatedAt ?? 0);
                create.mockClear();
                followWikiLink();
                await waitFor(() =>
                    expect(screen.getByLabelText('Open note').textContent).toBe(appeared.id),
                );
                expect(create).not.toHaveBeenCalled();
                expect((await store.list()).map((note) => note.id).sort()).toEqual(
                    [appeared.id, 'Work/Other.md', 'Work/Shared.md'].sort(),
                );
                expect(screen.getAllByRole('option')).toHaveLength(3);
                expect((await store.get(appeared.id)).content).toBe('external content');
            },
        );
    });

    it('reports a suffix returned after the preflight race and keeps both files', async () => {
        const {dir, store, create} = await setup('/Shared');
        const createNormally = FileSystemNoteStore.prototype.create.bind(store);
        create.mockImplementationOnce(async (title, parentPath) => {
            dir.seedFile('Shared.md', 'concurrent content', 300);
            const created = await createNormally(title, parentPath);
            return store.save(created.id, 'keep this new content', created.updatedAt ?? 0);
        });
        followWikiLink();
        expect(
            await screen.findByText(
                'Could not create the exact link target; the created note was kept at "Shared 2.md"',
            ),
        ).toBeInTheDocument();
        expect(create).toHaveBeenCalledExactlyOnceWith('Shared', '');
        expect((await store.get('Shared.md')).content).toBe('concurrent content');
        expect((await store.get('Shared 2.md')).content).toBe('keep this new content');
    });

    it('reports preflight read errors without attempting creation', async () => {
        const {store, create} = await setup('/Shared');
        vi.spyOn(store, 'listFolders').mockRejectedValueOnce(new Error('Folder preflight failed'));
        followWikiLink();
        expect(await screen.findByText('Folder preflight failed')).toBeInTheDocument();
        expect(create).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Open note').textContent).toBe('Work/Other.md');
    });

    it.each([
        ['/Shared', 'Shared.md'],
        ['Shared', 'Work/Shared.md'],
    ])('opens the exact expected note for %s without creating', async (target, id) => {
        const {create} = await setup(target, true);
        followWikiLink();
        await waitFor(() => expect(screen.getByLabelText('Open note').textContent).toBe(id));
        expect(create).not.toHaveBeenCalled();
    });

    it.each([
        ['/Shared', 'Shared.md', 'Shared', ''],
        ['/Shared#Heading|alias', 'Shared.md', 'Shared', ''],
        ['/Shared.md|alias', 'Shared.md', 'Shared', ''],
        ['/SHARED.MD#Heading|alias', 'SHARED.md', 'SHARED', ''],
        ['/Attachments', 'Attachments.md', 'Attachments', ''],
        ['/node_modules', 'node_modules.md', 'node_modules', ''],
        ['/Untitled', 'Untitled.md', 'Untitled', ''],
        ['/Archive/Shared', 'Archive/Shared.md', 'Shared', 'Archive'],
        ['/Archive/Sub/Shared.md#Heading|alias', 'Archive/Sub/Shared.md', 'Shared', 'Archive/Sub'],
    ])(
        'creates the missing root link %s at its exact path',
        async (target, id, title, parentPath) => {
            const {store, create} = await setup(target);
            followWikiLink();
            await waitFor(() => expect(screen.getByLabelText('Open note').textContent).toBe(id));
            expect(create).toHaveBeenCalledExactlyOnceWith(title, parentPath);
            const notes = await store.list();
            expect(notes.map((note) => note.id).sort()).toEqual(
                [id, 'Work/Other.md', 'Work/Shared.md'].sort(),
            );
            expect(resolveWikiLink(target, 'Work/Other.md', notes)).toBe(id);
            expect((await store.get('Work/Shared.md')).content).toBe('sibling');
        },
    );

    it.each(['New note', 'Elsewhere/New note#Heading|alias'])(
        'keeps creating the unresolved non-root link %s in the current folder',
        async (target) => {
            const {create} = await setup(target);
            followWikiLink();
            await waitFor(() =>
                expect(screen.getByLabelText('Open note').textContent).toBe('Work/New note.md'),
            );
            expect(create).toHaveBeenCalledExactlyOnceWith('New note', 'Work');
        },
    );

    it('keeps the existing no-op for the bare Untitled target', async () => {
        const {create} = await setup('Untitled');
        followWikiLink();
        expect(create).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Open note').textContent).toBe('Work/Other.md');
    });

    it.each([
        '/',
        '//Shared',
        '/Archive//Shared',
        '/Archive/Shared/',
        '/../Shared',
        '/Archive/../Shared',
        '/.hidden/Shared',
        '/.trash/Shared',
        '/Attachments/Shared',
        '/node_modules/Shared',
        '/Archive/.hidden',
        '/Archive/..',
        '/Archive/.md',
        '/Bad:Folder/Shared',
        '/Archive/Bad:Title',
        '/Archive/Two  Spaces',
        '/Archive/ Shared',
        '/Archive/Bad\\Title',
        '/Archive/\u0000Shared',
        '/Archive/  /Shared',
    ])('rejects the invalid root path %j before creating anything', async (target) => {
        const {store, create} = await setup(target);
        const original = await store.list();
        followWikiLink();
        expect(
            await screen.findByText('Cannot create a note from an invalid vault-root path'),
        ).toBeInTheDocument();
        expect(create).not.toHaveBeenCalled();
        expect(await store.list()).toEqual(original);
        expect(await store.listFolders()).toEqual(['Work']);
        expect(screen.getByLabelText('Open note').textContent).toBe('Work/Other.md');
    });
});
