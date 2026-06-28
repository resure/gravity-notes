import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import type {TrashedNote} from '../storage/types';
import {renderWithProviders} from '../test/render';

import {TrashDialog} from './TrashDialog';

const trashed = (id: string, title: string, originalPath = '', trashedAt = 1): TrashedNote => ({
    id,
    title,
    originalPath,
    trashedAt,
    updatedAt: trashedAt,
});

function setup(notes: TrashedNote[], overrides: Partial<Parameters<typeof TrashDialog>[0]> = {}) {
    const props = {
        open: true,
        notes,
        onRefresh: vi.fn(async () => {}),
        onRestore: vi.fn(),
        onPurge: vi.fn(),
        onEmpty: vi.fn(),
        onClose: vi.fn(),
        ...overrides,
    };
    renderWithProviders(<TrashDialog {...props} />);
    return {props};
}

describe('TrashDialog', () => {
    it('loads on open and lists trashed notes with their original folder', async () => {
        const {props} = setup([trashed('.trash/Plan.md', 'Plan', 'Work/Sub')]);
        await waitFor(() => expect(props.onRefresh).toHaveBeenCalled());
        expect(await screen.findByText('Plan')).toBeInTheDocument();
        expect(screen.getByText('Work / Sub')).toBeInTheDocument();
    });

    it('restores a note immediately (no confirm)', async () => {
        const user = userEvent.setup();
        const {props} = setup([trashed('.trash/A.md', 'A')]);
        await screen.findByText('A');
        await user.click(screen.getByRole('button', {name: /Restore A/}));
        expect(props.onRestore).toHaveBeenCalledWith('.trash/A.md');
    });

    it('confirms before permanently deleting one note', async () => {
        const user = userEvent.setup();
        const {props} = setup([trashed('.trash/A.md', 'A')]);
        await screen.findByText('A');
        await user.click(screen.getByRole('button', {name: /Delete A permanently/}));
        // The purge only fires after the confirmation is accepted.
        expect(props.onPurge).not.toHaveBeenCalled();
        await user.click(await screen.findByRole('button', {name: 'Delete'}));
        expect(props.onPurge).toHaveBeenCalledWith('.trash/A.md');
    });

    it('confirms before emptying the whole trash', async () => {
        const user = userEvent.setup();
        const {props} = setup([trashed('.trash/A.md', 'A'), trashed('.trash/B.md', 'B')]);
        await screen.findByText('A');
        await user.click(screen.getByRole('button', {name: /Empty Trash/}));
        await user.click(await screen.findByRole('button', {name: 'Delete'}));
        expect(props.onEmpty).toHaveBeenCalled();
    });

    it('shows an empty state when the trash is empty', async () => {
        setup([]);
        expect(await screen.findByText(/Trash is empty/)).toBeInTheDocument();
    });

    it('renders an unknown deletion time as "recently", not a bogus epoch-0 age', async () => {
        // An orphan / junk entry can carry trashedAt = 0; formatAgo must not say "~56 years ago".
        setup([trashed('.trash/Orphan.md', 'Orphan', '', 0)]);
        expect(await screen.findByText(/deleted recently/)).toBeInTheDocument();
        expect(screen.queryByText(/years ago/)).not.toBeInTheDocument();
    });
});
