import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import type {NotesFolder} from '../hooks/useNotesFolder';
import {renderWithProviders} from '../test/render';

import {FolderGate} from './FolderGate';

function makeFolder(over: Partial<NotesFolder> = {}): NotesFolder {
    return {
        state: 'needs-folder',
        dir: null,
        folderName: null,
        error: null,
        pickFolder: vi.fn(async () => {}),
        grantPermission: vi.fn(async () => {}),
        forgetFolder: vi.fn(async () => {}),
        ...over,
    };
}

describe('FolderGate', () => {
    it('shows the unsupported message', () => {
        renderWithProviders(<FolderGate folder={makeFolder({state: 'unsupported'})} />);
        expect(screen.getByText('Browser not supported')).toBeInTheDocument();
    });

    it('shows the welcome CTA and picks a folder on click', async () => {
        const user = userEvent.setup();
        const folder = makeFolder({state: 'needs-folder'});
        renderWithProviders(<FolderGate folder={folder} />);
        expect(screen.getByText('Welcome to Gravity Notes')).toBeInTheDocument();
        await user.click(screen.getByRole('button', {name: 'Open notes folder'}));
        expect(folder.pickFolder).toHaveBeenCalledTimes(1);
    });

    it('shows the re-grant prompt with the folder name and wires its actions', async () => {
        const user = userEvent.setup();
        const folder = makeFolder({state: 'needs-permission', folderName: 'my-notes'});
        renderWithProviders(<FolderGate folder={folder} />);
        expect(screen.getByText(/my-notes/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', {name: 'Grant access'}));
        expect(folder.grantPermission).toHaveBeenCalledTimes(1);
        await user.click(screen.getByRole('button', {name: 'Choose a different folder'}));
        expect(folder.forgetFolder).toHaveBeenCalledTimes(1);
    });

    it('renders the idle CTA while loading', () => {
        renderWithProviders(<FolderGate folder={makeFolder({state: 'loading'})} />);
        expect(screen.getByRole('button', {name: 'Open notes folder'})).toBeInTheDocument();
    });

    it('renders the error text when set', () => {
        renderWithProviders(
            <FolderGate folder={makeFolder({error: 'Could not open the folder.'})} />,
        );
        expect(screen.getByText('Could not open the folder.')).toBeInTheDocument();
    });
});
