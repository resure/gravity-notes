import {act, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import type {NotesStorage} from '../hooks/useNotesStorage';
import {renderWithProviders} from '../test/render';

import {FolderGate} from './FolderGate';

function makeStorage(over: Partial<NotesStorage> = {}): NotesStorage {
    const isTauri = over.isTauri ?? false;
    const supportsFileSystem = over.supportsFileSystem ?? true;
    return {
        state: 'choosing',
        store: null,
        backend: null,
        storageLabel: null,
        activeWorkspaceId: null,
        windowNote: null,
        workspaces: [],
        error: null,
        isTauri,
        supportsFileSystem,
        // Default to consistency with the other flags unless a test overrides it explicitly.
        supportsFolders: over.supportsFolders ?? (isTauri || supportsFileSystem),
        pickFolder: vi.fn(async () => {}),
        pickFolderForNewWindow: vi.fn(async () => {}),
        useBrowserStorage: vi.fn(async () => {}),
        grantPermission: vi.fn(async () => {}),
        reset: vi.fn(async () => {}),
        openWorkspace: vi.fn(async () => true),
        openInNewWindow: vi.fn(async () => {}),
        openNoteInNewWindow: vi.fn(async () => {}),
        removeWorkspace: vi.fn(async () => {}),
        refreshWorkspaces: vi.fn(async () => {}),
        ...over,
    };
}

describe('FolderGate', () => {
    it('offers both options on the choice screen when the FS API is supported', async () => {
        const user = userEvent.setup();
        const storage = makeStorage({supportsFileSystem: true});
        renderWithProviders(<FolderGate storage={storage} />);
        expect(screen.getByText('Choose a notes folder')).toBeInTheDocument();

        await user.click(screen.getByRole('button', {name: /Open Folder/}));
        expect(storage.pickFolder).toHaveBeenCalledTimes(1);
        await user.click(screen.getByRole('button', {name: 'Store in this browser'}));
        expect(storage.useBrowserStorage).toHaveBeenCalledTimes(1);
    });

    it('offers only in-browser storage when the FS API is unsupported', async () => {
        const user = userEvent.setup();
        const storage = makeStorage({supportsFileSystem: false});
        renderWithProviders(<FolderGate storage={storage} />);

        expect(screen.queryByRole('button', {name: /Open Folder/})).not.toBeInTheDocument();
        expect(screen.getByText(/needs a Chromium browser/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', {name: 'Store in this browser'}));
        expect(storage.useBrowserStorage).toHaveBeenCalledTimes(1);
    });

    it('offers ONLY the native folder option inside the desktop app (folder-first)', async () => {
        const user = userEvent.setup();
        // In the Tauri shell the FS API is absent, but native folders are available — and they
        // are the only choice: the desktop app doesn't offer in-app (IndexedDB) storage.
        const storage = makeStorage({isTauri: true, supportsFileSystem: false});
        renderWithProviders(<FolderGate storage={storage} />);

        expect(screen.getByRole('button', {name: /Open Folder/})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /Store in/})).not.toBeInTheDocument();
        expect(screen.queryByText(/needs a Chromium browser/)).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', {name: /Open Folder/}));
        expect(storage.pickFolder).toHaveBeenCalledTimes(1);
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

    it('renders no gate UI while loading (no welcome-card flash in fresh windows)', () => {
        renderWithProviders(<FolderGate storage={makeStorage({state: 'loading'})} />);
        expect(screen.queryByText('Choose a notes folder')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /Open Folder/})).not.toBeInTheDocument();
    });

    it('shows the bootstrap wait only once the restore proves slow', () => {
        vi.useFakeTimers();
        try {
            renderWithProviders(<FolderGate storage={makeStorage({state: 'loading'})} />);
            // Immediately: just the themed background, nothing at all (the common fast case).
            expect(document.querySelector('.folder-gate__wait')).toBeNull();
            act(() => {
                vi.advanceTimersByTime(400);
            });
            expect(document.querySelector('.folder-gate__wait')).not.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('renders the error text when set', () => {
        renderWithProviders(
            <FolderGate storage={makeStorage({error: 'Could not open the folder.'})} />,
        );
        expect(screen.getByText('Could not open the folder.')).toBeInTheDocument();
    });

    it('lists recent workspaces on the choice screen and opens one on click', async () => {
        const user = userEvent.setup();
        const storage = makeStorage({
            workspaces: [
                {id: 'tauri:/Users/me/Vault', backend: 'tauri-fs', name: 'Vault'},
                {id: 'indexeddb', backend: 'indexeddb', name: 'In this browser'},
            ],
        });
        renderWithProviders(<FolderGate storage={storage} />);

        expect(screen.getByText(/reopen a recent workspace/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', {name: /Vault/}));
        expect(storage.openWorkspace).toHaveBeenCalledWith('tauri:/Users/me/Vault');
    });

    it('hides the recents list while loading (no gate UI at all — a click would race the restore)', () => {
        renderWithProviders(
            <FolderGate
                storage={makeStorage({
                    state: 'loading',
                    workspaces: [{id: 'tauri:/A', backend: 'tauri-fs', name: 'A'}],
                })}
            />,
        );
        expect(screen.queryByText(/reopen a recent workspace/)).not.toBeInTheDocument();
    });
});
