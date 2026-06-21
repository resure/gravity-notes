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
            theme="light"
            onToggleTheme={vi.fn()}
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

    it('closes the open note on Escape in an empty search box', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
        await user.click(screen.getByPlaceholderText('Search'));
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.getByText(/Select a note/)).toBeInTheDocument());
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
});
