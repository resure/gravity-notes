import {fireEvent, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {AttachmentUrlCache} from '../attachments';
import type {AttachmentMeta, Note, NoteStore} from '../storage/types';
import {renderWithProviders} from '../test/render';

import {AttachmentsDialog} from './AttachmentsDialog';

interface FakeData {
    attachments: AttachmentMeta[];
    notes: Note[];
}

function makeStore(data: FakeData) {
    const removeAttachment = vi.fn(async (ref: string) => {
        data.attachments = data.attachments.filter((a) => a.ref !== ref);
    });
    const store = {
        listAttachments: async () => data.attachments,
        getAll: async () => data.notes,
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
