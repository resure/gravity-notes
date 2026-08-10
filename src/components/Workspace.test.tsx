import {StrictMode} from 'react';

import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@gravity-ui/markdown-editor', () => ({
    useMarkdownEditor: () => ({
        currentMode: 'wysiwyg',
        setEditorMode: vi.fn(),
        focus: vi.fn(),
        moveCursor: vi.fn(),
        replace: vi.fn(),
        getValue: () => '',
        on: () => {},
        off: () => {},
    }),
    MarkdownEditorView: () => null,
    // EditorPane derives its selection-toolbar config from this at module load.
    wSelectionMenuConfigByPreset: {full: []},
}));

import {FakeDirectoryHandle, asDirectoryHandle} from '../storage/fakeFileSystem';
import {FileSystemNoteStore} from '../storage/fileSystemStore';
import {renderWithProviders} from '../test/render';

import {Workspace} from './Workspace';

beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'});
});

/** The non-store Workspace props (workspace identity + switching callbacks), all inert. */
function workspaceProps() {
    return {
        workspaceId: 'test-ws',
        storageLabel: 'notes',
        workspaces: [],
        initialNoteId: null,
        themePref: 'light' as const,
        onChangeThemePref: vi.fn(),
        onOpenWorkspace: vi.fn(async () => true),
        onOpenWorkspaceInNewWindow: vi.fn(async () => {}),
        onOpenNoteInNewWindow: vi.fn(async () => {}),
        onRemoveWorkspace: vi.fn(async () => {}),
        onRefreshWorkspaces: vi.fn(async () => {}),
        onOpenFolder: vi.fn(),
        onOpenFolderInNewWindow: vi.fn(async () => {}),
        supportsFolders: true,
    };
}

function renderWorkspace() {
    const dir = new FakeDirectoryHandle();
    dir.seedFile('Alpha.md', 'a', 100);
    dir.seedFile('Beta.md', 'b', 200);
    const store = new FileSystemNoteStore(asDirectoryHandle(dir));
    renderWithProviders(<Workspace store={store} {...workspaceProps()} />);
    return {dir, store};
}

// The sidebar toggle now lives in the orb menu: open it, then click the item.
async function toggleSidebarViaMenu(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', {name: 'Menu'}));
    await user.click(await screen.findByRole('menuitem', {name: /Toggle sidebar/}));
}

describe('Workspace — nvALT navigation', () => {
    afterEach(() => {
        // Some tests persist to localStorage (sidebar collapse, settings); the layout keys are now
        // namespaced per workspace id, so clear everything rather than chase key shapes (jsdom
        // shares localStorage across a suite).
        localStorage.clear();
    });

    // Collapse the sidebar, then fire ⌘' to peek it. Resolves once the peek class is present.
    async function collapseThenPeek(user: ReturnType<typeof userEvent.setup>) {
        await toggleSidebarViaMenu(user);
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
        await user.click(within(beta).getByRole('button', {name: 'Note actions'}));
        await user.click(await screen.findByRole('menuitem', {name: /Delete/}));
        await user.click(screen.getByRole('button', {name: 'Move to Trash'}));

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
        // Focus the orb menu button (simulates losing focus to the top bar).
        screen.getByRole('button', {name: 'Menu'}).focus();
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

    it('creates a note with ⌘⇧Enter', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await user.keyboard('{Meta>}{Shift>}{Enter}{/Shift}{/Meta}');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Untitled/})).toBeInTheDocument(),
        );
    });

    it('creates a note with ⌘N', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await user.keyboard('{Meta>}n{/Meta}');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Untitled/})).toBeInTheDocument(),
        );
    });

    it('jumps to the search box with ⌘L', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        // Open a note so focus leaves the search box (which is focused on load).
        await user.click(await screen.findByRole('option', {name: /Alpha/}));
        await waitFor(() => expect(screen.getByPlaceholderText(/Search/)).not.toHaveFocus());
        await user.keyboard('{Meta>}l{/Meta}');
        await waitFor(() => expect(screen.getByPlaceholderText(/Search/)).toHaveFocus());
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

    it('toggles the sidebar from the orb menu and persists it', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        expect(document.querySelector('.workspace__body_collapsed')).toBeNull();
        await toggleSidebarViaMenu(user);
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull(),
        );
        // Layout state persists under the workspace-namespaced key.
        expect(localStorage.getItem('gravity-notes:test-ws:sidebar-collapsed')).toBe('true');
        await toggleSidebarViaMenu(user);
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).toBeNull(),
        );
        expect(localStorage.getItem('gravity-notes:test-ws:sidebar-collapsed')).toBe('false');
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

    it('restores the collapsed sidebar from the pre-workspace key and adopts it', async () => {
        // An upgrade scenario: only the legacy (un-namespaced) key exists. The first workspace
        // opened inherits it — and consumes it, so "back to default" can't fall through later.
        localStorage.setItem('gravity-notes:sidebar-collapsed', 'true');
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull();
        expect(localStorage.getItem('gravity-notes:test-ws:sidebar-collapsed')).toBe('true');
        expect(localStorage.getItem('gravity-notes:sidebar-collapsed')).toBeNull();
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

    it('typing a search auto-peeks the collapsed sidebar without stealing focus', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await toggleSidebarViaMenu(user);
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull(),
        );
        // Type into the search box: results must become visible (peek opens)…
        const search = screen.getByRole('textbox', {name: 'Search or create a note'});
        search.focus();
        fireEvent.change(search, {target: {value: 'Alp'}});
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_peeked')).not.toBeNull(),
        );
        // …while focus STAYS in the box (unlike the deliberate ⌘' peek, which enters the list).
        expect(document.activeElement).toBe(search);
        // Clearing the query tucks the peek back away.
        fireEvent.change(search, {target: {value: ''}});
        await waitFor(() => expect(document.querySelector('.workspace__body_peeked')).toBeNull());
    });

    it('Enter on a search match while auto-peeked opens the note and closes the peek', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await toggleSidebarViaMenu(user);
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull(),
        );
        const search = screen.getByRole('textbox', {name: 'Search or create a note'});
        search.focus();
        fireEvent.change(search, {target: {value: 'Alpha'}});
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_peeked')).not.toBeNull(),
        );
        fireEvent.keyDown(search, {key: 'Enter'});
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

    it('F2 does not start a list rename from the title icon picker (button or open popup)', async () => {
        localStorage.setItem('gravity-notes:settings', JSON.stringify({showNoteIcons: true}));
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        const title = await screen.findByLabelText('Note title');
        const row = title.closest('.note-title-row') as HTMLElement;
        const iconButton = within(row).getByRole('button', {name: /note icon/i});
        const list = screen.getByRole('listbox', {name: 'Notes'});

        // The icon button is a sibling of the .note-title input — a `.note-title`-only
        // guard misses it and F2 yanked focus to a sidebar rename.
        iconButton.focus();
        await user.keyboard('{F2}');
        expect(within(list).queryByDisplayValue('Beta')).toBeNull();

        // …and the open picker popup is portaled out of the title row entirely (guarded as a
        // floating layer via uikit's .g-popup).
        await user.click(iconButton);
        const search = await screen.findByPlaceholderText('Search icons…');
        search.focus();
        await user.keyboard('{F2}');
        expect(within(list).queryByDisplayValue('Beta')).toBeNull();
    });

    it('F2 while typing in a dialog does not start a list rename behind it', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        // Grab the list before the modal opens — the focus trap aria-hides the background.
        const list = screen.getByRole('listbox', {name: 'Notes'});
        // Open the Move-to dialog from the row menu; F2 in its filter input used to fall through
        // to renameSelected, opening an inline rename behind the modal (committing on blur).
        const beta = screen.getByRole('option', {name: /Beta/});
        await user.click(within(beta).getByRole('button', {name: 'Note actions'}));
        await user.click(await screen.findByRole('menuitem', {name: /Move to/}));
        const filter = await screen.findByPlaceholderText('Filter folders…');
        filter.focus();
        await user.keyboard('{F2}');
        expect(within(list).queryByDisplayValue('Beta')).toBeNull();
    });

    it('finds a note by its body text and shows a match snippet', async () => {
        const user = userEvent.setup();
        const dir = new FakeDirectoryHandle();
        dir.seedFile('Recipes.md', 'pancakes need buttermilk', 100);
        dir.seedFile('Travel.md', 'flights to tokyo', 200);
        const store = new FileSystemNoteStore(asDirectoryHandle(dir));
        renderWithProviders(<Workspace store={store} {...workspaceProps()} />);
        await screen.findByRole('option', {name: /Recipes/});
        await user.type(screen.getByPlaceholderText(/Search/), 'buttermilk');
        // "buttermilk" lives only in Recipes' body — it surfaces once the corpus loads...
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Recipes/})).toBeInTheDocument(),
        );
        // ...while Travel (no match in title or body) is filtered out, and the body snippet shows
        // the matched word highlighted.
        expect(screen.queryByRole('option', {name: /Travel/})).toBeNull();
        const recipes = screen.getByRole('option', {name: /Recipes/});
        const mark = [...recipes.querySelectorAll('mark')].find(
            (m) => m.textContent === 'buttermilk',
        );
        expect(mark).toBeTruthy();
    });

    it('shows a snippet around a body match that lies beyond the head-preview window', async () => {
        const user = userEvent.setup();
        const dir = new FakeDirectoryHandle();
        const preamble = 'lorem ipsum dolor sit amet '.repeat(10); // ~270 chars, no "kubernetes"
        dir.seedFile('Journal.md', `${preamble} then we discussed kubernetes at length`, 100);
        const store = new FileSystemNoteStore(asDirectoryHandle(dir));
        renderWithProviders(<Workspace store={store} {...workspaceProps()} />);
        await screen.findByRole('option', {name: /Journal/});
        await user.type(screen.getByPlaceholderText(/Search/), 'kubernetes');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Journal/})).toBeInTheDocument(),
        );
        // The deep body match is surfaced as a highlighted snippet, not the (non-matching) head.
        const row = screen.getByRole('option', {name: /Journal/});
        const mark = [...row.querySelectorAll('mark')].find((m) => m.textContent === 'kubernetes');
        expect(mark).toBeTruthy();
    });

    it('Esc from the editor peeks the sidebar when collapsed', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
        await toggleSidebarViaMenu(user);
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

describe('Workspace — move picker', () => {
    function renderWithFolder() {
        const dir = new FakeDirectoryHandle();
        dir.seedFile('Beta.md', 'b', 200);
        dir.seedFile('Work/Existing.md', 'x', 50); // makes the "Work" folder exist
        const store = new FileSystemNoteStore(asDirectoryHandle(dir));
        renderWithProviders(<Workspace store={store} {...workspaceProps()} />);
        return {store};
    }

    it('⌘⇧M opens the picker for the selected note and moves it into a folder', async () => {
        const user = userEvent.setup();
        const {store} = renderWithFolder();
        await user.click(await screen.findByRole('option', {name: /Beta/}));
        // ⌘⇧M opens the move picker scoped to the selected note.
        fireEvent.keyDown(document, {key: 'm', metaKey: true, shiftKey: true});
        expect(await screen.findByText(/Move .*Beta.* to/)).toBeInTheDocument();
        // Pick the "Work" folder; the note file moves under it.
        await user.click(screen.getByRole('option', {name: 'Work'}));
        await waitFor(async () => {
            const ids = (await store.list()).map((n) => n.id);
            expect(ids).toContain('Work/Beta.md');
        });
    });

    it('⌘⇧⌫ opens the delete confirmation for the selected note', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await user.click(await screen.findByRole('option', {name: /Beta/}));
        fireEvent.keyDown(document, {key: 'Backspace', metaKey: true, shiftKey: true});
        // The confirm dialog appears, naming the selected note (it isn't trashed until confirmed).
        expect(await screen.findByText(/Move "Beta" to the Trash\?/)).toBeInTheDocument();
    });
});

describe('Workspace — trash', () => {
    it('deletes a note to the Trash, then restores it from the Trash dialog', async () => {
        const user = userEvent.setup();
        const {store} = renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});

        // Delete Beta → confirm "Move to Trash" → it leaves the list.
        const beta = screen.getByRole('option', {name: /Beta/});
        await user.click(within(beta).getByRole('button', {name: 'Note actions'}));
        await user.click(await screen.findByRole('menuitem', {name: /Delete/}));
        await user.click(screen.getByRole('button', {name: 'Move to Trash'}));
        await waitFor(() =>
            expect(screen.queryByRole('option', {name: /Beta/})).not.toBeInTheDocument(),
        );

        // The orb menu's Trash item now shows a count and opens the trash view holding Beta.
        await user.click(await screen.findByRole('button', {name: 'Menu'}));
        await user.click(await screen.findByRole('menuitem', {name: /Trash \(1\)/}));
        const dialog = await screen.findByRole('dialog');
        expect(await within(dialog).findByText('Beta')).toBeInTheDocument();

        // Restore it → it leaves the trash (now empty) and is written back to its folder.
        await user.click(within(dialog).getByRole('button', {name: /Restore Beta/}));
        expect(await within(dialog).findByText(/Trash is empty/)).toBeInTheDocument();
        await waitFor(async () =>
            expect((await store.list()).map((n) => n.id)).toContain('Beta.md'),
        );
    });
});

describe('Workspace — folder auto-preview', () => {
    it('previews the first note of a folder when it is selected', async () => {
        const user = userEvent.setup();
        const dir = new FakeDirectoryHandle();
        dir.seedFile('Root.md', 'r', 100);
        dir.seedFile('Work/Inside.md', 'i', 50);
        const store = new FileSystemNoteStore(asDirectoryHandle(dir));
        renderWithProviders(<Workspace store={store} {...workspaceProps()} />);
        await screen.findByRole('option', {name: /Root/});
        // Open the folder rail, then select the Work folder.
        fireEvent.keyDown(document, {key: '\\', code: 'Backslash', metaKey: true, shiftKey: true});
        await user.click(await screen.findByRole('treeitem', {name: /Work/}));
        // The folder's first note is previewed in the editor.
        await waitFor(() => expect(screen.getByLabelText('Note title')).toHaveValue('Inside'));
    });
});

describe('Workspace — storage menu', () => {
    async function openOrbMenu(user: ReturnType<typeof userEvent.setup>) {
        await user.click(screen.getByRole('button', {name: 'Menu'}));
    }

    it('opens the attachments manager from the menu (after flushing pending edits)', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await openOrbMenu(user);
        await user.click(await screen.findByRole('menuitem', {name: /Manage attachments/}));
        // The handler awaits flushPending() before opening — the dialog still appears.
        expect(await screen.findByText('Attachments')).toBeInTheDocument();
    });

    it('confirms before switching workspaces while an unresolved conflict holds unsaved edits', async () => {
        const user = userEvent.setup();
        const dir = new FakeDirectoryHandle();
        dir.seedFile('Note.md', 'disk v1', 100);
        const store = new FileSystemNoteStore(asDirectoryHandle(dir));
        const props = workspaceProps();
        const onOpenWorkspace = props.onOpenWorkspace;
        renderWithProviders(
            <Workspace
                store={store}
                {...props}
                workspaces={[
                    {id: 'test-ws', backend: 'filesystem', name: 'notes'},
                    {id: 'tauri:/other', backend: 'tauri-fs', name: 'other'},
                ]}
            />,
        );
        // Open the note, then create an external conflict (bump its mtime past the baseline).
        await user.click(await screen.findByRole('option', {name: /Note/}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
        dir.seedFile('Note.md', 'disk v2', 200);
        fireEvent.focus(window);
        // Wait for the conflict banner so we know an unresolved conflict is holding the note.
        await screen.findByText('Changed on disk');

        const switchToOther = async () => {
            await user.click(screen.getByRole('button', {name: 'Menu'}));
            fireEvent.mouseEnter(await screen.findByRole('menuitem', {name: /Open Recent/}));
            await user.click(await screen.findByRole('menuitem', {name: 'other'}));
        };

        // Decline the confirm: the workspace must NOT switch.
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        await switchToOther();
        await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
        expect(onOpenWorkspace).not.toHaveBeenCalled();

        // Accept the confirm: the switch goes through.
        confirmSpy.mockReturnValue(true);
        await switchToOther();
        await waitFor(() => expect(onOpenWorkspace).toHaveBeenCalledWith('tauri:/other'));
        confirmSpy.mockRestore();
    });
});

describe('Workspace — folder move', () => {
    it('reverts the rail selection when a folder rename collides', async () => {
        const user = userEvent.setup();
        const dir = new FakeDirectoryHandle();
        dir.seedFile('Work/Note.md', 'w', 100);
        dir.seedFile('Archive/Other.md', 'a', 50); // makes "Archive" already exist → rename collides
        const store = new FileSystemNoteStore(asDirectoryHandle(dir));
        renderWithProviders(<Workspace store={store} {...workspaceProps()} />);
        await screen.findByRole('option', {name: /Note/});
        fireEvent.keyDown(document, {key: '\\', code: 'Backslash', metaKey: true, shiftKey: true});
        const work = await screen.findByRole('treeitem', {name: /Work/});
        await user.click(work);
        await waitFor(() => expect(work).toHaveAttribute('aria-selected', 'true'));

        // Rename Work → Archive: the store hard-fails (Archive exists). The optimistic re-prefix
        // briefly points selection at "Archive", but the failed move must revert it to "Work".
        await user.dblClick(screen.getByText('Work'));
        const input = screen.getByDisplayValue('Work');
        await user.clear(input);
        await user.type(input, 'Archive{Enter}');

        // The move was rejected, so Work survives and selection reverts to it — not stranded on the
        // unrelated, pre-existing Archive folder.
        await waitFor(() =>
            expect(screen.getByRole('treeitem', {name: /Work/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
        expect(screen.getByRole('treeitem', {name: /Archive/})).toHaveAttribute(
            'aria-selected',
            'false',
        );
    });
});

describe('Workspace — attachments survive StrictMode', () => {
    afterEach(() => vi.unstubAllGlobals());

    // React StrictMode (active in `tauri:dev`) mount→unmount→mount's every effect. An earlier cache
    // wiring retired the live AttachmentUrlCache in that spurious unmount cleanup, after which every
    // resolve() short-circuited to '' — every attachment rendered as "image not found" in the editor
    // and as an empty thumbnail in the manager. The cache must stay live across the double-invoke.
    it('resolves an attachment thumbnail under StrictMode (cache not retired on its spurious unmount)', async () => {
        let n = 0;
        vi.stubGlobal('URL', {
            createObjectURL: () => `blob:obj-${++n}`,
            revokeObjectURL: () => {},
        });

        const dir = new FakeDirectoryHandle();
        dir.seedFile('Note.md', '![pic](Attachments/pic.png)\n');
        dir.seedBytes('Attachments/pic.png', new Uint8Array([1, 2, 3, 4]));
        const store = new FileSystemNoteStore(asDirectoryHandle(dir));

        const user = userEvent.setup();
        renderWithProviders(
            <StrictMode>
                <Workspace store={store} {...workspaceProps()} />
            </StrictMode>,
        );

        // Open the Attachments manager via the orb menu.
        await user.click(screen.getByRole('button', {name: 'Menu'}));
        await user.click(await screen.findByRole('menuitem', {name: /Manage attachments/}));

        // Under the bug, the retired cache makes resolve() yield '' and the Thumb stays a placeholder
        // span (no <img>). With the fix the thumbnail resolves through the still-live cache → an <img>
        // with a blob src. Query for the IMG specifically (the placeholder is a span with the same class).
        await waitFor(() => {
            const img = document.querySelector('img.attachments__thumb') as HTMLImageElement | null;
            expect(img).not.toBeNull();
            expect(img?.getAttribute('src')).toMatch(/^blob:/);
        });
        // The note references it, so it must read as used — not flagged "Unused".
        expect(screen.getByText(/Used by 1 note/)).toBeInTheDocument();
    });
});

describe('Workspace — legacy note-appearance migration', () => {
    afterEach(() => {
        localStorage.clear();
    });

    it('folds legacy localStorage overrides into the sidecar and clears the keys', async () => {
        // The pre-sidecar layer: one override for a live note, one stranded by a long-ago rename.
        localStorage.setItem(
            'gravity-notes:test-ws:note:Alpha.md:appearance',
            JSON.stringify({editorFont: 'serif', accentColor: 'default', textWidth: 'default'}),
        );
        localStorage.setItem(
            'gravity-notes:test-ws:note:Gone.md:appearance',
            JSON.stringify({editorFont: 'mono', accentColor: 'default', textWidth: 'default'}),
        );
        const {store} = renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});

        // The live note's override lands in the sidecar; the stranded one is dropped, not adopted.
        await waitFor(async () => {
            const meta = await store.readMetadata();
            expect(meta.appearances).toEqual({'Alpha.md': {editorFont: 'serif'}});
        });
        // Both legacy keys are gone (the stranded one was the leak this migration also cleans up).
        expect(localStorage.getItem('gravity-notes:test-ws:note:Alpha.md:appearance')).toBeNull();
        expect(localStorage.getItem('gravity-notes:test-ws:note:Gone.md:appearance')).toBeNull();
    });
});

describe('Workspace — resizable panels', () => {
    afterEach(() => {
        localStorage.clear();
    });

    const workspaceStyle = () => (document.querySelector('.workspace') as HTMLElement).style;

    // jsdom lays nothing out (clientWidth 0), which reads as a zero-width window — the
    // "leave the editor room" cap would floor every drag. Give the body a real width.
    const layOutBody = (width: number) => {
        Object.defineProperty(
            document.querySelector('.workspace__body') as HTMLElement,
            'clientWidth',
            {
                configurable: true,
                value: width,
            },
        );
    };

    it('drags the note-list divider live and persists the width on release', async () => {
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        layOutBody(1200);
        const divider = screen.getByRole('separator', {name: 'Resize note list'});

        fireEvent.pointerDown(divider, {button: 0, clientX: 280, pointerId: 1});
        fireEvent.pointerMove(divider, {clientX: 340, pointerId: 1});
        // Mid-drag: the live width is on the element, nothing persisted yet.
        expect(workspaceStyle().getPropertyValue('--sidebar-width')).toBe('340px');
        expect(localStorage.getItem('gravity-notes:test-ws:sidebar-width')).toBeNull();

        fireEvent.pointerUp(divider, {pointerId: 1});
        expect(localStorage.getItem('gravity-notes:test-ws:sidebar-width')).toBe('340');
        expect(workspaceStyle().getPropertyValue('--sidebar-width')).toBe('340px');
    });

    it('restores a persisted width on mount and clamps garbage', async () => {
        localStorage.setItem('gravity-notes:test-ws:sidebar-width', '333');
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        expect(workspaceStyle().getPropertyValue('--sidebar-width')).toBe('333px');
        // The untouched rail width stays on the stylesheet default (no inline override).
        expect(workspaceStyle().getPropertyValue('--rail-width')).toBe('');
    });

    it('double-click resets the panel to its default and clears the key', async () => {
        localStorage.setItem('gravity-notes:test-ws:sidebar-width', '333');
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        const divider = screen.getByRole('separator', {name: 'Resize note list'});

        fireEvent.doubleClick(divider);
        expect(workspaceStyle().getPropertyValue('--sidebar-width')).toBe('');
        expect(localStorage.getItem('gravity-notes:test-ws:sidebar-width')).toBeNull();
    });

    it('shows the rail divider only when the rail is open', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        expect(screen.queryByRole('separator', {name: 'Resize folder rail'})).toBeNull();

        await user.click(screen.getByRole('button', {name: 'Folders'}));
        expect(await screen.findByRole('separator', {name: 'Resize folder rail'})).toBeVisible();
    });

    it('renders no dividers in the mobile single-pane layout', async () => {
        // Phone-sim: the ≤700px width query matches while the hover query still reports a mouse.
        // No divider belongs there — the rail is a drawer and the list fills the width, so a drag
        // could only rewrite the DESKTOP widths sight unseen.
        const original = window.matchMedia;
        window.matchMedia = ((query: string) => ({
            ...original(query),
            matches: query.includes('max-width'),
        })) as typeof window.matchMedia;
        try {
            renderWorkspace();
            await screen.findByRole('option', {name: /Alpha/});
            expect(document.querySelector('.workspace__body_mobile')).not.toBeNull();
            expect(screen.queryAllByRole('separator')).toHaveLength(0);
        } finally {
            window.matchMedia = original;
        }
    });
});
