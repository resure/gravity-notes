import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@gravity-ui/markdown-editor', () => ({
    useMarkdownEditor: () => ({
        currentMode: 'wysiwyg',
        setEditorMode: vi.fn(),
        focus: vi.fn(),
        moveCursor: vi.fn(),
        getValue: () => '',
        on: () => {},
        off: () => {},
    }),
    MarkdownEditorView: () => null,
}));

import {FakeDirectoryHandle, asDirectoryHandle} from '../storage/fakeFileSystem';
import {FileSystemNoteStore} from '../storage/fileSystemStore';
import {renderWithProviders} from '../test/render';

import {Workspace} from './Workspace';

beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'});
});

function renderWorkspace() {
    const dir = new FakeDirectoryHandle();
    dir.seedFile('Alpha.md', 'a', 100);
    dir.seedFile('Beta.md', 'b', 200);
    const store = new FileSystemNoteStore(asDirectoryHandle(dir));
    renderWithProviders(
        <Workspace
            store={store}
            storageLabel="notes"
            themePref="light"
            onChangeThemePref={vi.fn()}
            onChangeStorage={vi.fn()}
        />,
    );
    return {dir, store};
}

describe('Workspace — nvALT navigation', () => {
    afterEach(() => {
        // The sidebar-collapse tests persist to localStorage; clear it so no collapsed state
        // leaks into the other tests (jsdom shares localStorage across a suite).
        localStorage.removeItem('gravity-notes:sidebar-collapsed');
    });

    // Collapse the sidebar, then fire ⌘' to peek it. Resolves once the peek class is present.
    async function collapseThenPeek(user: ReturnType<typeof userEvent.setup>) {
        await user.click(screen.getByLabelText('Toggle sidebar'));
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull(),
        );
        fireEvent.keyDown(document, {key: "'", metaKey: true});
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_peeked')).not.toBeNull(),
        );
    }

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
        // Scope to the list to avoid matching the NoteTitle field in the editor pane.
        const list = screen.getByRole('listbox', {name: 'Notes'});
        expect(await within(list).findByDisplayValue('Beta')).toBeInTheDocument();
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
        // Scope to the list to avoid matching the NoteTitle field in the editor pane.
        const list = screen.getByRole('listbox', {name: 'Notes'});
        const input = await within(list).findByDisplayValue('Beta');
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
        // Focus the storage-menu button (simulates losing focus to the top bar).
        screen.getByRole('button', {name: 'Storage options'}).focus();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.getByRole('option', {name: /Beta/})).toHaveFocus());
    });

    it('shows the open note title in an editable field', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() => expect(screen.getByLabelText('Note title')).toHaveValue('Beta'));
    });

    it('renames the file when the title is edited and committed', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        const title = await screen.findByLabelText('Note title');
        await user.clear(title);
        await user.type(title, 'Beta Renamed');
        // Commit by blurring to the search box (no note switch).
        await user.click(screen.getByPlaceholderText(/Search/));
        await screen.findByRole('option', {name: /Beta Renamed/});
    });

    it('focuses the title when creating a note', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await user.click(screen.getByRole('button', {name: 'New'}));
        await waitFor(() => expect(screen.getByLabelText('Note title')).toHaveFocus());
    });

    it('navigates to the next/previous note with ⌘J / ⌘K', async () => {
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
        await user.keyboard('{Meta>}j{/Meta}');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Alpha/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
        await user.keyboard('{Meta>}k{/Meta}');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Beta/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
    });

    it('⌘J navigates even while the title field is focused', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
        screen.getByLabelText('Note title').focus();
        await user.keyboard('{Meta>}j{/Meta}');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Alpha/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
    });

    it('creates a note with ⌘Enter', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await user.keyboard('{Meta>}{Enter}{/Meta}');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Untitled/})).toBeInTheDocument(),
        );
    });

    it('⌘K clamps at the first row — does not wrap to the last', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        // updated-desc order is [Beta, Alpha]; click Beta (the first row) to select it.
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Beta/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
        // ⌘K at the top should clamp — Beta should still be selected.
        await user.keyboard('{Meta>}k{/Meta}');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Beta/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
    });

    it('toggles the sidebar from the top bar and persists it', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        const toggle = screen.getByLabelText('Toggle sidebar');
        expect(document.querySelector('.workspace__body_collapsed')).toBeNull();
        await user.click(toggle);
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull(),
        );
        expect(localStorage.getItem('gravity-notes:sidebar-collapsed')).toBe('true');
        await user.click(toggle);
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).toBeNull(),
        );
        expect(localStorage.getItem('gravity-notes:sidebar-collapsed')).toBe('false');
    });

    it('toggles the sidebar with ⌘\\', async () => {
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        expect(document.querySelector('.workspace__body_collapsed')).toBeNull();
        fireEvent.keyDown(document, {key: '\\', metaKey: true});
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull(),
        );
    });

    it('restores the collapsed sidebar from localStorage', async () => {
        localStorage.setItem('gravity-notes:sidebar-collapsed', 'true');
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull();
    });

    it("⌘' peeks the collapsed sidebar", async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await collapseThenPeek(user);
        expect(document.querySelector('.workspace__body_peeked')).not.toBeNull();
    });

    it("⌘' does nothing while the sidebar is docked", async () => {
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        expect(document.querySelector('.workspace__body_collapsed')).toBeNull();
        fireEvent.keyDown(document, {key: "'", metaKey: true});
        expect(document.querySelector('.workspace__body_peeked')).toBeNull();
    });

    it('Esc closes the peek', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await collapseThenPeek(user);
        // Focus is on a list row; Esc there closes the peek.
        await user.keyboard('{Escape}');
        await waitFor(() => expect(document.querySelector('.workspace__body_peeked')).toBeNull());
    });

    it('opening a note closes the peek', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await collapseThenPeek(user);
        // Enter on the focused row commits (opens) the note → closes the peek.
        await user.keyboard('{Enter}');
        await waitFor(() => expect(document.querySelector('.workspace__body_peeked')).toBeNull());
    });

    it('clicking outside the sidebar closes the peek', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await collapseThenPeek(user);
        fireEvent.pointerDown(document.body);
        await waitFor(() => expect(document.querySelector('.workspace__body_peeked')).toBeNull());
    });

    it('docking with ⌘\\ clears the peek', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await collapseThenPeek(user);
        fireEvent.keyDown(document, {key: '\\', metaKey: true});
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).toBeNull(),
        );
        expect(document.querySelector('.workspace__body_peeked')).toBeNull();
    });

    it("⌘' focuses the list when it peeks", async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await collapseThenPeek(user);
        // The peek moved DOM focus onto a note row (the first, since nothing was selected yet).
        await waitFor(() => expect(screen.getByRole('option', {name: /Beta/})).toHaveFocus());
    });

    it('⌘J browsing keeps the peek open', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await collapseThenPeek(user);
        // ⌘J previews (browses) — it must NOT close the peek; only commit/Esc/click-outside do.
        fireEvent.keyDown(document, {key: 'j', metaKey: true});
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Beta/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
        expect(document.querySelector('.workspace__body_peeked')).not.toBeNull();
    });

    it("a second ⌘' commits the selected note and closes the peek", async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await collapseThenPeek(user);
        // Browse to a row so a note is selected, then a second ⌘' commits it (like Enter) + closes.
        fireEvent.keyDown(document, {key: 'j', metaKey: true});
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Beta/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
        fireEvent.keyDown(document, {key: "'", metaKey: true});
        await waitFor(() => expect(document.querySelector('.workspace__body_peeked')).toBeNull());
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
    });

    it('F2 does not start a list rename while the in-editor title is focused', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        const title = await screen.findByLabelText('Note title');
        title.focus();
        await user.keyboard('{F2}');
        // The guard means the list does NOT open an inline rename input for the selected row.
        const list = screen.getByRole('listbox', {name: 'Notes'});
        expect(within(list).queryByDisplayValue('Beta')).toBeNull();
    });

    it('Esc from the editor peeks the sidebar when collapsed', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
        await user.click(screen.getByLabelText('Toggle sidebar'));
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull(),
        );
        // With the sidebar collapsed, Esc out of the editor reveals (peeks) it instead of focusing
        // a hidden row.
        const pane = document.querySelector('.editor-pane');
        if (!pane) throw new Error('editor-pane not rendered');
        fireEvent.keyDown(pane, {key: 'Escape'});
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_peeked')).not.toBeNull(),
        );
    });
});
