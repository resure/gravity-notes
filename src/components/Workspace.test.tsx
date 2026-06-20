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

describe('Workspace — single note', () => {
    it('shows the placeholder until a note is opened', async () => {
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        expect(screen.getByText(/Select a note/)).toBeInTheDocument();
    });

    it('opens a sidebar note into the editor with no tab strip', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await user.click(screen.getByRole('option', {name: /Alpha/}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });
});
