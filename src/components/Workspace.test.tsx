import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@gravity-ui/markdown-editor', () => ({
    useMarkdownEditor: () => ({
        currentMode: 'wysiwyg',
        setEditorMode: vi.fn(),
        focus: vi.fn(),
        getValue: () => '',
        on: () => {},
        off: () => {},
    }),
    MarkdownEditorView: () => null,
}));

import {FakeDirectoryHandle, asDirectoryHandle} from '../storage/fakeFileSystem';
import {renderWithProviders} from '../test/render';

import {Workspace} from './Workspace';

beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'});
});

function renderWorkspace() {
    const dir = new FakeDirectoryHandle();
    dir.seedFile('Alpha.md', 'a', 100);
    dir.seedFile('Beta.md', 'b', 200);
    renderWithProviders(
        <Workspace
            dir={asDirectoryHandle(dir)}
            folderName="notes"
            themePref="light"
            onChangeThemePref={vi.fn()}
            onChangeFolder={vi.fn()}
        />,
    );
    return {dir};
}

describe('Workspace — nvALT navigation', () => {
    it('shows the placeholder until a note is opened, and never a tab strip', async () => {
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        expect(screen.getByText(/Select a note/)).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    it('previews a note in the editor on click', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
    });

    it('moves the highlight as you arrow the list', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        // updated-desc order is [Beta, Alpha]; click Beta then arrow down to Alpha.
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Beta/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
        await user.keyboard('{ArrowDown}');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Alpha/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
    });

    it('creates a note and opens it', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await user.click(screen.getByRole('button', {name: 'New'}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Untitled/})).toBeInTheDocument(),
        );
    });

    it('previews a neighbor after deleting the open note', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        // Wait until Beta is actually open (placeholder gone) so the delete sees it as active.
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());

        const beta = screen.getByRole('option', {name: /Beta/});
        await user.click(within(beta).getByRole('button'));
        await user.click(await screen.findByRole('menuitem', {name: /Delete/}));
        await user.click(screen.getByRole('button', {name: 'Delete'}));

        await waitFor(() =>
            expect(screen.queryByRole('option', {name: /Beta/})).not.toBeInTheDocument(),
        );
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Alpha/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
    });

    it('creates a note titled with the query when Enter finds no match (nvALT)', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        const search = screen.getByPlaceholderText(/Search/);
        await user.type(search, 'Zzz Notes{Enter}');
        // No existing note matches "Zzz Notes", so Enter creates it...
        await screen.findByRole('option', {name: /Zzz Notes/});
        // ...and the search box is cleared afterward.
        expect(screen.getByPlaceholderText(/Search/)).toHaveValue('');
    });

    it('closes the open note on Escape in an empty search box', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
        await user.click(screen.getByPlaceholderText(/Search/));
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.getByText(/Select a note/)).toBeInTheDocument());
    });

    it('Esc on a list row moves to search without closing the note', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
        // Esc from the focused row lands in the search box; the note stays open.
        screen.getByRole('option', {name: /Beta/}).focus();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.getByPlaceholderText(/Search/)).toHaveFocus());
        expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument();
    });

    it('Esc in the search box clears the selection so ArrowDown picks the first note', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        // Open Alpha (the 2nd row; updated order is [Beta, Alpha]).
        await user.click(screen.getByRole('option', {name: /Alpha/}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
        // Esc in the empty search box closes the note and clears the cursor.
        screen.getByPlaceholderText(/Search/).focus();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.getByText(/Select a note/)).toBeInTheDocument());
        // So ArrowDown now selects the first row (Beta), not the note we left (Alpha).
        await user.keyboard('{ArrowDown}');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Beta/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
    });

    it('toggles a read-only preview with the shortcut', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
        await user.keyboard('{Meta>}{Shift>}p{/Shift}{/Meta}');
        await waitFor(() => expect(document.querySelector('.note-preview')).toBeInTheDocument());
        // Toggling again returns to the editor.
        await user.keyboard('{Meta>}{Shift>}p{/Shift}{/Meta}');
        await waitFor(() =>
            expect(document.querySelector('.note-preview')).not.toBeInTheDocument(),
        );
    });

    it('keeps preview mode when switching notes', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
        await user.keyboard('{Meta>}{Shift>}p{/Shift}{/Meta}');
        await waitFor(() => expect(document.querySelector('.note-preview')).toBeInTheDocument());
        // Switch to Alpha — preview mode carries over to the new note.
        await user.click(screen.getByRole('option', {name: /Alpha/}));
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Alpha/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
        expect(document.querySelector('.note-preview')).toBeInTheDocument();
    });

    it('F2 renames the selected note', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Beta/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
        await user.keyboard('{F2}');
        expect(await screen.findByDisplayValue('Beta')).toBeInTheDocument();
    });

    it('keeps keyboard focus on the note after an F2 rename', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Beta/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
        await user.keyboard('{F2}');
        const input = await screen.findByDisplayValue('Beta');
        await user.clear(input);
        await user.type(input, 'Renamed{Enter}');
        const renamed = await screen.findByRole('option', {name: /Renamed/});
        await waitFor(() => expect(renamed).toHaveAttribute('aria-selected', 'true'));
        await waitFor(() => expect(renamed).toHaveFocus());
    });

    it('Escape from the top bar refocuses the note list', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        // Focus the folder-menu button (simulates losing focus to the top bar).
        screen.getByRole('button', {name: /notes/i}).focus();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.getByRole('option', {name: /Beta/})).toHaveFocus());
    });
});
