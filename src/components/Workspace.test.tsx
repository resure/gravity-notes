import {screen, waitFor} from '@testing-library/react';
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

describe('Workspace tabs', () => {
    it('opens a sidebar note as a tab and adds a second tab', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});

        await user.click(screen.getByRole('option', {name: /Alpha/}));
        await waitFor(() =>
            expect(screen.getByRole('tablist', {name: 'Open notes'})).toBeInTheDocument(),
        );
        expect(screen.getByRole('tab', {name: 'Alpha'})).toBeInTheDocument();

        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() => expect(screen.getByRole('tab', {name: 'Beta'})).toBeInTheDocument());
    });

    it('closes a tab from its close button', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await user.click(screen.getByRole('option', {name: /Alpha/}));
        await screen.findByRole('tab', {name: 'Alpha'});

        await user.click(screen.getByRole('button', {name: 'Close Alpha'}));
        await waitFor(() =>
            expect(screen.queryByRole('tab', {name: 'Alpha'})).not.toBeInTheDocument(),
        );
    });

    it('re-activates an existing tab when its tab is clicked', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});

        await user.click(screen.getByRole('option', {name: /Alpha/}));
        await screen.findByRole('tab', {name: 'Alpha'});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await screen.findByRole('tab', {name: 'Beta'});
        // Opening Beta second makes it active.
        await waitFor(() =>
            expect(screen.getByRole('tab', {name: 'Beta'})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );

        // Clicking Alpha's tab re-activates it.
        await user.click(screen.getByRole('tab', {name: 'Alpha'}));
        await waitFor(() =>
            expect(screen.getByRole('tab', {name: 'Alpha'})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
        expect(screen.getByRole('tab', {name: 'Beta'})).toHaveAttribute('aria-selected', 'false');
    });
});
