import {fireEvent, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {AttachmentUrlCache} from '../attachments';
import type {AttachmentMeta, Note, NoteStore} from '../storage/types';
import {renderWithProviders} from '../test/render';

import {AttachmentsDialog} from './AttachmentsDialog';

interface FakeData {
    attachments: AttachmentMeta[];
    notes: Note[];
    /** Trashed notes, scanned for attachment refs alongside live notes (so a trashed-only ref counts). */
    trash?: Note[];
}

function makeStore(data: FakeData) {
    const removeAttachment = vi.fn(async (ref: string) => {
        data.attachments = data.attachments.filter((a) => a.ref !== ref);
    });
    const trash = data.trash ?? [];
    const store = {
        listAttachments: async () => data.attachments,
        getAll: async () => data.notes,
        listTrash: async () =>
            trash.map(({id, title, updatedAt, preview}) => ({id, title, updatedAt, preview})),
        get: async (id: string) => {
            const found = trash.find((t) => t.id === id);
            if (!found) throw new Error(`no note ${id}`);
            return found;
        },
        removeAttachment,
        readAttachment: async () => new Blob(['bytes']),
    } as unknown as NoteStore;
    return {store, removeAttachment};
}

const note = (id: string, content: string): Note => ({id, title: id, content});
const att = (name: string): AttachmentMeta => ({
    ref: `Attachments/${name}`,
    name,
    size: 2048,
    updatedAt: 1,
});

describe('AttachmentsDialog', () => {
    beforeEach(() => {
        let n = 0;
        vi.stubGlobal('URL', {
            createObjectURL: () => `blob:obj-${++n}`,
            revokeObjectURL: () => {},
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('lists attachments and flags used vs unused', async () => {
        const {store} = makeStore({
            attachments: [att('used.png'), att('orphan.png')],
            notes: [note('A.md', '![x](Attachments/used.png)')],
        });
        renderWithProviders(
            <AttachmentsDialog
                open
                store={store}
                cache={new AttachmentUrlCache(store)}
                onClose={() => {}}
                onError={() => {}}
            />,
        );

        expect(await screen.findByText('used.png')).toBeInTheDocument();
        expect(screen.getByText('orphan.png')).toBeInTheDocument();
        expect(screen.getByText('Unused')).toBeInTheDocument();
        expect(screen.getByText(/Used by 1 note/)).toBeInTheDocument();
        // One orphan → a bulk "Delete unused (1)" action is offered.
        expect(screen.getByRole('button', {name: /Delete unused \(1\)/})).toBeInTheDocument();
        // "Reveal in Finder" is gated on a backend that supports it — this fake store doesn't.
        expect(screen.queryByRole('button', {name: /Reveal/})).not.toBeInTheDocument();
    });

    it('counts an attachment referenced only by a trashed note as used (not orphaned)', async () => {
        const {store} = makeStore({
            attachments: [att('intrash.png')],
            notes: [],
            trash: [note('.trash/Old.md', '![x](Attachments/intrash.png)')],
        });
        renderWithProviders(
            <AttachmentsDialog
                open
                store={store}
                cache={new AttachmentUrlCache(store)}
                onClose={() => {}}
                onError={() => {}}
            />,
        );

        expect(await screen.findByText('intrash.png')).toBeInTheDocument();
        // A trashed note still references it → "Used by 1 note", not "Unused" (so it stays out of the
        // bulk-delete and a restore won't find its image already purged).
        expect(screen.getByText(/Used by 1 note/)).toBeInTheDocument();
        expect(screen.queryByText('Unused')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /Delete unused/})).not.toBeInTheDocument();
    });

    it('orders attachments by size when "Largest" is picked', async () => {
        const user = userEvent.setup();
        const sized = (name: string, size: number, updatedAt: number): AttachmentMeta => ({
            ref: `Attachments/${name}`,
            name,
            size,
            updatedAt,
        });
        const {store} = makeStore({
            attachments: [
                sized('small.png', 100, 3),
                sized('big.png', 9000, 1),
                sized('mid.png', 2000, 2),
            ],
            notes: [],
        });
        renderWithProviders(
            <AttachmentsDialog
                open
                store={store}
                cache={new AttachmentUrlCache(store)}
                onClose={() => {}}
                onError={() => {}}
            />,
        );
        // The dialog portals to <body>, so query the document rather than the render container.
        const names = () =>
            [...document.querySelectorAll('.attachments__name')].map((el) => el.textContent);

        await screen.findByText('small.png');
        // Default order is Recent (updatedAt desc).
        expect(names()).toEqual(['small.png', 'mid.png', 'big.png']);

        await user.click(screen.getByLabelText('Sort attachments'));
        await user.click(await screen.findByRole('option', {name: 'Largest'}));

        expect(names()).toEqual(['big.png', 'mid.png', 'small.png']);
    });

    it('opens an attachment full-size when its thumbnail is clicked', async () => {
        const user = userEvent.setup();
        const {store} = makeStore({attachments: [att('photo.png')], notes: []});
        renderWithProviders(
            <AttachmentsDialog
                open
                store={store}
                cache={new AttachmentUrlCache(store)}
                onClose={() => {}}
                onError={() => {}}
            />,
        );

        await user.click(await screen.findByRole('button', {name: 'View photo.png'}));
        // The lightbox overlay appears over the dialog, showing the full-size image.
        await waitFor(() => expect(document.querySelector('.lightbox__img')).toBeInTheDocument());
    });

    it('reveals an attachment in Finder, preserving the store binding', async () => {
        const user = userEvent.setup();
        const {store} = makeStore({attachments: [att('photo.png')], notes: []});
        // Mimic TauriNoteStore.reveal, which reads `this.dir` — a detached call (lost `this`) would
        // leave `this` undefined and throw, so this guards against calling a bare `store.reveal` ref.
        const calls: {dir: unknown; ref: string}[] = [];
        Object.assign(store, {
            dir: '/notes',
            reveal(ref: string) {
                calls.push({dir: (this as {dir?: string}).dir, ref});
                return Promise.resolve();
            },
        });
        renderWithProviders(
            <AttachmentsDialog
                open
                store={store}
                cache={new AttachmentUrlCache(store)}
                onClose={() => {}}
                onError={() => {}}
            />,
        );

        await user.click(await screen.findByRole('button', {name: 'Reveal photo.png in Finder'}));
        expect(calls).toEqual([{dir: '/notes', ref: 'Attachments/photo.png'}]);
    });

    it('confirms then deletes a single attachment', async () => {
        const {store, removeAttachment} = makeStore({
            attachments: [att('used.png'), att('orphan.png')],
            notes: [note('A.md', '![x](Attachments/used.png)')],
        });
        renderWithProviders(
            <AttachmentsDialog
                open
                store={store}
                cache={new AttachmentUrlCache(store)}
                onClose={() => {}}
                onError={() => {}}
            />,
        );

        fireEvent.click(await screen.findByRole('button', {name: 'Delete orphan.png'}));
        // A confirm dialog appears; its apply button performs the delete.
        const confirm = await screen.findByRole('button', {name: 'Delete'});
        fireEvent.click(confirm);

        await waitFor(() =>
            expect(removeAttachment).toHaveBeenCalledWith('Attachments/orphan.png'),
        );
        await waitFor(() => expect(screen.queryByText('orphan.png')).not.toBeInTheDocument());
        // The referenced one is untouched.
        expect(screen.getByText('used.png')).toBeInTheDocument();
    });

    it('shows an empty state when there are no attachments', async () => {
        const {store} = makeStore({attachments: [], notes: []});
        renderWithProviders(
            <AttachmentsDialog
                open
                store={store}
                cache={new AttachmentUrlCache(store)}
                onClose={() => {}}
                onError={() => {}}
            />,
        );

        expect(await screen.findByText(/No attachments yet/)).toBeInTheDocument();
    });
});
