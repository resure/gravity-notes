import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import type {NotesStorage} from '../hooks/useNotesStorage';
import {renderWithProviders} from '../test/render';

import {FolderGate} from './FolderGate';

function makeStorage(over: Partial<NotesStorage> = {}): NotesStorage {
    return {
        state: 'choosing',
        store: null,
        backend: null,
        storageLabel: null,
        error: null,
        supportsFileSystem: true,
        pickFolder: vi.fn(async () => {}),
        useBrowserStorage: vi.fn(async () => {}),
        grantPermission: vi.fn(async () => {}),
        reset: vi.fn(async () => {}),
        ...over,
    };
}

describe('FolderGate', () => {
    it('offers both options on the choice screen when the FS API is supported', async () => {
        const user = userEvent.setup();
        const storage = makeStorage({supportsFileSystem: true});
        renderWithProviders(<FolderGate storage={storage} />);
        expect(screen.getByText('Welcome to Gravity Notes')).toBeInTheDocument();

        await user.click(screen.getByRole('button', {name: /Open a folder/}));
        expect(storage.pickFolder).toHaveBeenCalledTimes(1);
        await user.click(screen.getByRole('button', {name: 'Store in this browser'}));
        expect(storage.useBrowserStorage).toHaveBeenCalledTimes(1);
    });

    it('offers only in-browser storage when the FS API is unsupported', async () => {
        const user = userEvent.setup();
        const storage = makeStorage({supportsFileSystem: false});
        renderWithProviders(<FolderGate storage={storage} />);

        expect(screen.queryByRole('button', {name: /Open a folder/})).not.toBeInTheDocument();
        expect(screen.getByText(/needs a Chromium browser/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', {name: 'Store in this browser'}));
        expect(storage.useBrowserStorage).toHaveBeenCalledTimes(1);
    });

    it('shows the re-grant prompt with the folder name and wires its actions', async () => {
        const user = userEvent.setup();
        const storage = makeStorage({state: 'needs-permission', storageLabel: 'my-notes'});
        renderWithProviders(<FolderGate storage={storage} />);
        expect(screen.getByText(/my-notes/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', {name: 'Grant access'}));
        expect(storage.grantPermission).toHaveBeenCalledTimes(1);
        await user.click(screen.getByRole('button', {name: 'Choose different storage'}));
        expect(storage.reset).toHaveBeenCalledTimes(1);
    });

    it('renders the choice screen while loading', () => {
        renderWithProviders(<FolderGate storage={makeStorage({state: 'loading'})} />);
        expect(screen.getByRole('button', {name: /Open a folder/})).toBeInTheDocument();
    });

    it('renders the error text when set', () => {
        renderWithProviders(
            <FolderGate storage={makeStorage({error: 'Could not open the folder.'})} />,
        );
        expect(screen.getByText('Could not open the folder.')).toBeInTheDocument();
    });
});
