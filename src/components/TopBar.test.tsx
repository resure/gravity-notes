import {createRef, useRef, useState} from 'react';

import {fireEvent, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import type {WorkspaceInfo} from '../hooks/useNotesStorage';
import type {NoteMeta} from '../storage/types';
import {renderWithProviders} from '../test/render';

import {TopBar, type TopBarProps} from './TopBar';

const NOTES: NoteMeta[] = [
    {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
    {id: 'Beta.md', title: 'Beta', updatedAt: 2},
];

const WORKSPACES: WorkspaceInfo[] = [
    {id: 'tauri:/Users/me/notes', backend: 'tauri-fs', name: 'notes', path: '/Users/me/notes'},
    {id: 'tauri:/Users/me/work', backend: 'tauri-fs', name: 'work', path: '/Users/me/work'},
];

const SEARCH = 'Search or create a note…';

function setup(overrides: Record<string, unknown> = {}) {
    const props = {
        workspaces: WORKSPACES,
        activeWorkspaceId: 'tauri:/Users/me/notes',
        isDesktop: true,
        supportsFolders: true,
        onOpenWorkspace: vi.fn(),
        onOpenWorkspaceInNewWindow: vi.fn(),
        onOpenFolder: vi.fn(),
        onOpenSwitcher: vi.fn(),
        onMenuOpen: vi.fn(),
        onExport: vi.fn(),
        onImport: vi.fn(),
        onManageAttachments: vi.fn(),
        onReload: vi.fn(),
        onOpenTrash: vi.fn(),
        trashCount: 0,
        onOpenHelp: vi.fn(),
        onOpenSettings: vi.fn(),
        onOpenAbout: vi.fn(),
        themePref: 'light',
        onChangeThemePref: vi.fn(),
        railOpen: false,
        onToggleRail: vi.fn(),
        collapsed: false,
        onToggleCollapsed: vi.fn(),
        saveState: 'idle',
        query: '',
        onQueryChange: vi.fn(),
        searchInputRef: createRef<HTMLInputElement>(),
        notes: NOTES,
        searchLoading: false,
        searchPending: false,
        selectedId: 'Alpha.md',
        onCommit: vi.fn(),
        onCreate: vi.fn(),
        onClose: vi.fn(),
        onEnterList: vi.fn(),
        onFocusList: vi.fn(),
        note: null,
        noteMenuOpen: false,
        onNoteMenuOpenChange: vi.fn(),
        noteAppearance: {editorFont: 'default', textWidth: 'default'},
        onSetNoteAppearance: vi.fn(),
        previewMode: false,
        onTogglePreview: vi.fn(),
        onToggleSource: vi.fn(),
        notePinned: false,
        onTogglePin: vi.fn(),
        onRenameNote: vi.fn(),
        onMoveNote: vi.fn(),
        onDuplicateNote: vi.fn(),
        onExportNote: vi.fn(),
        onCopyNoteLink: vi.fn(),
        onDeleteNote: vi.fn(),
        ...overrides,
    };
    const view = renderWithProviders(<TopBar {...(props as TopBarProps)} />);
    return {props, view};
}

describe('TopBar — search keyboard model', () => {
    it('calls onQueryChange when typing', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.type(screen.getByPlaceholderText(SEARCH), 'x');
        expect(props.onQueryChange).toHaveBeenCalledWith('x');
    });

    it('commits the top match on Enter with a query', async () => {
        const user = userEvent.setup();
        const {props} = setup({query: 'a'});
        screen.getByPlaceholderText(SEARCH).focus();
        await user.keyboard('{Enter}');
        expect(props.onCommit).toHaveBeenCalledWith('Alpha.md');
    });

    it('focuses the selected row on Enter when the box is empty (no editor jump)', async () => {
        const user = userEvent.setup();
        const {props} = setup({query: '', selectedId: 'Beta.md'});
        screen.getByPlaceholderText(SEARCH).focus();
        await user.keyboard('{Enter}');
        expect(props.onFocusList).toHaveBeenCalledTimes(1);
        expect(props.onCommit).not.toHaveBeenCalled();
    });

    it('creates a note and clears the query on Enter when nothing matches', async () => {
        const user = userEvent.setup();
        const {props} = setup({notes: [], query: 'Groceries'});
        screen.getByPlaceholderText(SEARCH).focus();
        await user.keyboard('{Enter}');
        expect(props.onCreate).toHaveBeenCalledWith('Groceries');
        expect(props.onQueryChange).toHaveBeenCalledWith('');
    });

    it('does not create on Enter when the query is blank', async () => {
        const user = userEvent.setup();
        const {props} = setup({notes: [], query: '   '});
        screen.getByPlaceholderText(SEARCH).focus();
        await user.keyboard('{Enter}');
        expect(props.onCreate).not.toHaveBeenCalled();
    });

    it('does not create on Enter while the full-text corpus is still loading', async () => {
        const user = userEvent.setup();
        // Empty result set but the corpus is still loading — a body match may be about to appear,
        // so Enter must not fabricate a phantom note.
        const {props} = setup({notes: [], query: 'Groceries', searchLoading: true});
        screen.getByPlaceholderText(SEARCH).focus();
        await user.keyboard('{Enter}');
        expect(props.onCreate).not.toHaveBeenCalled();
        expect(props.onCommit).not.toHaveBeenCalled();
    });

    it('swallows Enter while results are pending — never acts on a stale list', async () => {
        const user = userEvent.setup();
        // Big-vault debounce window: the box reads a fresh title but `notes` still reflects the
        // previous query (here, the whole vault). Enter must neither open the stale top note nor
        // fabricate a note — it waits for the debounce to settle.
        const {props} = setup({notes: NOTES, query: 'Groceries', searchPending: true});
        screen.getByPlaceholderText(SEARCH).focus();
        await user.keyboard('{Enter}');
        expect(props.onCommit).not.toHaveBeenCalled();
        expect(props.onCreate).not.toHaveBeenCalled();
    });

    it('enters the list on ArrowDown from the search box', async () => {
        const user = userEvent.setup();
        const {props} = setup({selectedId: 'Beta.md'});
        screen.getByPlaceholderText(SEARCH).focus();
        await user.keyboard('{ArrowDown}');
        expect(props.onEnterList).toHaveBeenCalledWith('Beta.md');
    });

    it('enters the list at the last row on ArrowUp with no selection', async () => {
        const user = userEvent.setup();
        const {props} = setup({selectedId: null});
        screen.getByPlaceholderText(SEARCH).focus();
        await user.keyboard('{ArrowUp}');
        // With no selection, ArrowUp targets the last row (notes = [Alpha, Beta]).
        expect(props.onEnterList).toHaveBeenCalledWith('Beta.md');
    });

    it('clears the query on Escape when the box has text', async () => {
        const user = userEvent.setup();
        const {props} = setup({query: 'beta'});
        screen.getByPlaceholderText(SEARCH).focus();
        await user.keyboard('{Escape}');
        expect(props.onQueryChange).toHaveBeenCalledWith('');
        expect(props.onClose).not.toHaveBeenCalled();
    });

    it('closes the note on Escape when the box is empty', async () => {
        const user = userEvent.setup();
        const {props} = setup({query: ''});
        screen.getByPlaceholderText(SEARCH).focus();
        await user.keyboard('{Escape}');
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it('⌘⇧Enter does not trigger the search action — lets the global new-note shortcut fire', () => {
        const {props} = setup({query: 'Alpha', notes: NOTES});
        const input = screen.getByPlaceholderText(SEARCH);
        fireEvent.keyDown(input, {key: 'Enter', metaKey: true, shiftKey: true});
        expect(props.onCommit).not.toHaveBeenCalled();
        expect(props.onCreate).not.toHaveBeenCalled();
    });
});

// A stateful host that actually threads `query` through, the way Workspace does — needed because the
// inline autocomplete derives the completion from the live query, not a frozen prop.
function StatefulTopBar({onCommit}: {onCommit: () => void}) {
    const [query, setQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);
    const noop = () => {};
    return (
        <TopBar
            workspaces={[]}
            activeWorkspaceId={null}
            isDesktop={false}
            supportsFolders
            onOpenWorkspace={noop}
            onOpenWorkspaceInNewWindow={noop}
            onOpenFolder={noop}
            onOpenSwitcher={noop}
            onExport={noop}
            onImport={noop}
            onManageAttachments={noop}
            onReload={noop}
            onOpenTrash={noop}
            trashCount={0}
            onOpenHelp={noop}
            onOpenSettings={noop}
            onOpenAbout={noop}
            themePref="light"
            onChangeThemePref={noop}
            railOpen={false}
            onToggleRail={noop}
            collapsed={false}
            onToggleCollapsed={noop}
            saveState="idle"
            query={query}
            onQueryChange={setQuery}
            searchInputRef={searchInputRef}
            notes={NOTES}
            searchLoading={false}
            searchPending={false}
            selectedId="Alpha.md"
            onCommit={onCommit}
            onCreate={noop}
            onClose={noop}
            onEnterList={noop}
            onFocusList={noop}
            note={null}
            noteMenuOpen={false}
            onNoteMenuOpenChange={noop}
            noteAppearance={{editorFont: 'default', textWidth: 'default'}}
            onSetNoteAppearance={noop}
            previewMode={false}
            onTogglePreview={noop}
            onToggleSource={noop}
            notePinned={false}
            onTogglePin={noop}
            onRenameNote={noop}
            onMoveNote={noop}
            onDuplicateNote={noop}
            onExportNote={noop}
            onCopyNoteLink={noop}
            onDeleteNote={noop}
        />
    );
}

describe('TopBar — inline autocomplete', () => {
    it('completes to the top match with the un-typed suffix selected as you type forward', () => {
        renderWithProviders(<StatefulTopBar onCommit={vi.fn()} />);
        const input = screen.getByPlaceholderText(SEARCH) as HTMLInputElement;
        // Typing "Al" forward: top title is "Alpha", so the box shows it with "pha" selected.
        fireEvent.change(input, {target: {value: 'Al'}});
        expect(input.value).toBe('Alpha');
        expect(input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)).toBe('pha');
    });

    it('accepts the completion on Tab (full title, selection collapsed)', () => {
        renderWithProviders(<StatefulTopBar onCommit={vi.fn()} />);
        const input = screen.getByPlaceholderText(SEARCH) as HTMLInputElement;
        fireEvent.change(input, {target: {value: 'Al'}});
        fireEvent.keyDown(input, {key: 'Tab'});
        expect(input.value).toBe('Alpha');
        // No suffix is selected once accepted.
        expect(input.selectionStart).toBe(input.selectionEnd);
    });

    it('removes the completion when the suffix is deleted (no re-completion)', () => {
        renderWithProviders(<StatefulTopBar onCommit={vi.fn()} />);
        const input = screen.getByPlaceholderText(SEARCH) as HTMLInputElement;
        fireEvent.change(input, {target: {value: 'Al'}}); // shows "Alpha", "pha" selected
        // Backspace deletes the selected suffix → the box is left with the typed prefix.
        fireEvent.change(input, {target: {value: 'Al'}});
        expect(input.value).toBe('Al');
    });

    it('does not complete when the top match does not start with the query', () => {
        renderWithProviders(<StatefulTopBar onCommit={vi.fn()} />);
        const input = screen.getByPlaceholderText(SEARCH) as HTMLInputElement;
        // "xy" prefixes neither Alpha nor Beta, so the box stays as typed.
        fireEvent.change(input, {target: {value: 'xy'}});
        expect(input.value).toBe('xy');
    });

    it('keeps the typed prefix verbatim — a lowercase query is not capitalised to match the title', () => {
        renderWithProviders(<StatefulTopBar onCommit={vi.fn()} />);
        const input = screen.getByPlaceholderText(SEARCH) as HTMLInputElement;
        // Top title is "Alpha"; typing "al" should keep the lowercase prefix and only adopt the
        // suffix, yielding "alpha" (not "Alpha"). The casing stays the user's.
        fireEvent.change(input, {target: {value: 'al'}});
        expect(input.value).toBe('alpha');
        expect(input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)).toBe('pha');
    });
});

describe('TopBar — orb menu', () => {
    it('exposes export / import / open-folder in the orb menu (and reports the open)', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('button', {name: 'Menu'}));
        await user.click(await screen.findByRole('menuitem', {name: /Export all notes/}));
        expect(props.onMenuOpen).toHaveBeenCalledTimes(1);
        expect(props.onExport).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', {name: 'Menu'}));
        await user.click(await screen.findByRole('menuitem', {name: /Import \.md files/}));
        expect(props.onImport).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', {name: 'Menu'}));
        await user.click(await screen.findByRole('menuitem', {name: /Open Folder/}));
        expect(props.onOpenFolder).toHaveBeenCalledTimes(1);
    });

    it('hides "Open Folder…" when folder storage is unavailable', async () => {
        const user = userEvent.setup();
        setup({supportsFolders: false});
        await user.click(screen.getByRole('button', {name: 'Menu'}));
        await screen.findByRole('menuitem', {name: /Export all notes/});
        expect(screen.queryByRole('menuitem', {name: /Open Folder/})).not.toBeInTheDocument();
    });

    it('switches to another workspace from the top of the orb menu', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('button', {name: 'Menu'}));
        await user.click(await screen.findByRole('menuitem', {name: 'work'}));
        expect(props.onOpenWorkspace).toHaveBeenCalledWith('tauri:/Users/me/work');
        expect(props.onOpenWorkspaceInNewWindow).not.toHaveBeenCalled();
    });

    it('⌘-clicking a workspace opens it in a new window on desktop', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('button', {name: 'Menu'}));
        fireEvent.click(await screen.findByRole('menuitem', {name: 'work'}), {metaKey: true});
        expect(props.onOpenWorkspaceInNewWindow).toHaveBeenCalledWith('tauri:/Users/me/work');
        expect(props.onOpenWorkspace).not.toHaveBeenCalled();
    });

    it('clicking the workspace that is already open is a no-op', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('button', {name: 'Menu'}));
        await user.click(await screen.findByRole('menuitem', {name: 'notes'}));
        expect(props.onOpenWorkspace).not.toHaveBeenCalled();
        expect(props.onOpenWorkspaceInNewWindow).not.toHaveBeenCalled();
    });

    it('opens the workspace switcher from the orb menu', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('button', {name: 'Menu'}));
        await user.click(await screen.findByRole('menuitem', {name: /Workspaces…/}));
        expect(props.onOpenSwitcher).toHaveBeenCalledTimes(1);
    });

    it('toggles the sidebar from the orb menu', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('button', {name: 'Menu'}));
        await user.click(await screen.findByRole('menuitem', {name: /Toggle sidebar/}));
        expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
    });

    it('opens help from the orb menu', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('button', {name: 'Menu'}));
        await user.click(await screen.findByRole('menuitem', {name: /Keyboard shortcuts/}));
        expect(props.onOpenHelp).toHaveBeenCalledTimes(1);
    });

    it('changes the theme from the orb menu', async () => {
        const user = userEvent.setup();
        const {props} = setup({themePref: 'system'});
        await user.click(screen.getByRole('button', {name: 'Menu'}));
        // Hover opens the Theme submenu (deterministic in jsdom; click would toggle it).
        // The row's accessible name carries its current value ("Theme System"). fireEvent, not
        // userEvent: the popup keeps `pointer-events: none` through its open transition, which
        // never completes under jsdom.
        fireEvent.click(await screen.findByRole('menuitem', {name: /^Theme/}));
        fireEvent.click(await screen.findByRole('menuitem', {name: 'Dark'}));
        expect(props.onChangeThemePref).toHaveBeenCalledWith('dark');
    });

    it('opens the About box from the orb menu', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('button', {name: 'Menu'}));
        await user.click(await screen.findByRole('menuitem', {name: /About/}));
        expect(props.onOpenAbout).toHaveBeenCalledTimes(1);
    });
});

describe('TopBar — sync dot', () => {
    // The orb is the app MARK, not a status light: save state lives in the dot + word at the
    // right, which is what replaced the toast that used to fire on every save.
    it('reads "Saved" at rest', () => {
        setup({saveState: 'saved'});
        expect(screen.getByRole('status')).toHaveTextContent('Saved');
    });

    it('reads "Writing" mid-save', () => {
        setup({saveState: 'saving'});
        expect(screen.getByRole('status')).toHaveTextContent('Writing');
    });

    it('turns red and says so when a save failed', () => {
        setup({saveState: 'error'});
        const sync = screen.getByRole('status');
        expect(sync).toHaveTextContent('Failed');
        expect(sync).toHaveClass('topbar__sync_error');
    });
});

describe('TopBar — pane toggles', () => {
    it('toggles the folder rail, reporting its state as aria-pressed', async () => {
        const user = userEvent.setup();
        const {props} = setup({railOpen: true});
        const button = screen.getByRole('button', {name: 'Folders'});
        expect(button).toHaveAttribute('aria-pressed', 'true');
        await user.click(button);
        expect(props.onToggleRail).toHaveBeenCalledTimes(1);
    });

    it('toggles the notes list, which reads pressed while it is docked', async () => {
        const user = userEvent.setup();
        const {props} = setup({collapsed: true});
        const button = screen.getByRole('button', {name: 'Notes list'});
        expect(button).toHaveAttribute('aria-pressed', 'false');
        await user.click(button);
        expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
    });
});

describe('TopBar — note menu', () => {
    it('acts on the open note, and offers appearance inline rather than as a submenu', async () => {
        const user = userEvent.setup();
        const {props} = setup({note: NOTES[0], noteMenuOpen: true});
        await user.click(screen.getByRole('button', {name: 'Note actions'}));
        // The strips are real controls inside the popup, not rows in the arrow-key ring.
        expect(await screen.findByRole('group', {name: 'Note font'})).toBeInTheDocument();
        expect(screen.getByRole('group', {name: 'Note text width'})).toBeInTheDocument();
        await user.click(screen.getByRole('menuitem', {name: /Copy link to note/}));
        expect(props.onCopyNoteLink).toHaveBeenCalledTimes(1);
    });

    it('sets a per-note font from the inline strip', async () => {
        const user = userEvent.setup();
        const {props} = setup({note: NOTES[0], noteMenuOpen: true});
        await user.click(screen.getByRole('button', {name: 'Note actions'}));
        await user.click(
            within(await screen.findByRole('group', {name: 'Note font'})).getByText('Serif'),
        );
        expect(props.onSetNoteAppearance).toHaveBeenCalledWith('editorFont', 'serif');
    });

    it('has no ⋯ at all with no note open', () => {
        setup({note: null, noteMenuOpen: true});
        expect(screen.queryByRole('button', {name: 'Note actions'})).not.toBeInTheDocument();
    });
});

describe('TopBar — narrow panes', () => {
    it('keeps the note menu visible when narrow chrome has no mobile push pane', () => {
        setup({mobile: true, mobilePane: undefined, note: NOTES[0]});
        expect(screen.getByRole('button', {name: 'Note actions'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Back to notes'})).not.toBeInTheDocument();
    });

    it('keeps the ⋯ slot on the list pane but hides it from everything', () => {
        // The placeholder reserves the geometry so the orb and search don't move between panes.
        const {props, view} = setup({mobile: true, mobilePane: 'list', note: NOTES[0]});
        expect(screen.queryByRole('button', {name: 'Note actions'})).not.toBeInTheDocument();
        view.rerender(<TopBar {...({...props, mobilePane: 'editor'} as TopBarProps)} />);
        expect(screen.getByRole('button', {name: 'Back to notes'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Note actions'})).toBeInTheDocument();
    });
});
