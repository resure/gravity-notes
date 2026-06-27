import {createRef} from 'react';

import {act, fireEvent, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {renderWithProviders} from '../test/render';
import type {FolderRow} from '../tree';

import {FolderRail, type FolderRailHandle, type FolderRailProps} from './FolderRail';

const folder = (path: string, over: Partial<FolderRow> = {}): FolderRow => ({
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    depth: path.split('/').length - 1,
    collapsed: false,
    pinned: false,
    hasChildren: false,
    noteCount: 0,
    ...over,
});

function setup(overrides: Partial<FolderRailProps> = {}) {
    const props = {
        rows: [folder('Work', {noteCount: 2}), folder('Personal')],
        selectedFolder: null,
        allNotesCount: 5,
        onSelectFolder: vi.fn(),
        onToggleCollapse: vi.fn(),
        onCreateFolder: vi.fn(),
        onRemoveFolder: vi.fn(),
        onMoveFolder: vi.fn(),
        onTogglePin: vi.fn(),
        onMoveTo: vi.fn(),
        onFocusList: vi.fn(),
        ...overrides,
    };
    const ref = createRef<FolderRailHandle>();
    renderWithProviders(<FolderRail ref={ref} {...(props as unknown as FolderRailProps)} />);
    return {props, ref};
}

describe('FolderRail — render & selection', () => {
    it('renders All Notes plus each folder as tree items', () => {
        setup();
        expect(screen.getByRole('tree', {name: 'Folders'})).toBeInTheDocument();
        expect(screen.getByRole('treeitem', {name: /All Notes/})).toBeInTheDocument();
        expect(screen.getByRole('treeitem', {name: /Work/})).toBeInTheDocument();
        expect(screen.getByRole('treeitem', {name: /Personal/})).toBeInTheDocument();
    });

    it('marks the selected folder', () => {
        setup({selectedFolder: 'Work'});
        expect(screen.getByRole('treeitem', {name: /Work/})).toHaveAttribute(
            'aria-selected',
            'true',
        );
        expect(screen.getByRole('treeitem', {name: /All Notes/})).toHaveAttribute(
            'aria-selected',
            'false',
        );
    });

    it('selects a folder on click', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByText('Work'));
        expect(props.onSelectFolder).toHaveBeenCalledWith('Work');
    });

    it('selects All Notes on click', async () => {
        const user = userEvent.setup();
        const {props} = setup({selectedFolder: 'Work'});
        await user.click(screen.getByText('All Notes'));
        expect(props.onSelectFolder).toHaveBeenCalledWith(null);
    });

    it('shows a recursive note-count badge', () => {
        setup();
        const work = screen.getByRole('treeitem', {name: /Work/});
        expect(within(work).getByText('2')).toBeInTheDocument();
    });

    it('shows a first-run hint when there are no folders', () => {
        setup({rows: []});
        expect(screen.getByText(/No folders yet/)).toBeInTheDocument();
    });
});

describe('FolderRail — collapse', () => {
    it('toggles a folder via its caret button', async () => {
        const user = userEvent.setup();
        const {props} = setup({rows: [folder('Work', {hasChildren: true, collapsed: true})]});
        await user.click(screen.getByRole('button', {name: 'Expand Work'}));
        expect(props.onToggleCollapse).toHaveBeenCalledWith('Work');
    });

    it('has no caret on a folder without subfolders', () => {
        setup({rows: [folder('Work', {hasChildren: false})]});
        expect(screen.queryByRole('button', {name: /Expand|Collapse/})).toBeNull();
    });
});

describe('FolderRail — keyboard', () => {
    it('selects the next row on ArrowDown', async () => {
        const user = userEvent.setup();
        const {props} = setup({selectedFolder: null});
        screen.getByRole('treeitem', {name: /All Notes/}).focus();
        await user.keyboard('{ArrowDown}');
        expect(props.onSelectFolder).toHaveBeenCalledWith('Work');
    });

    it('selects the previous row on ArrowUp', async () => {
        const user = userEvent.setup();
        const {props} = setup({selectedFolder: 'Work'});
        screen.getByRole('treeitem', {name: /Work/}).focus();
        await user.keyboard('{ArrowUp}');
        expect(props.onSelectFolder).toHaveBeenCalledWith(null);
    });

    it('expands a collapsed folder on ArrowRight', async () => {
        const user = userEvent.setup();
        const {props} = setup({
            selectedFolder: 'Work',
            rows: [folder('Work', {hasChildren: true, collapsed: true})],
        });
        screen.getByRole('treeitem', {name: /Work/}).focus();
        await user.keyboard('{ArrowRight}');
        expect(props.onToggleCollapse).toHaveBeenCalledWith('Work');
        expect(props.onFocusList).not.toHaveBeenCalled();
    });

    it('moves into the notes list on ArrowRight over a leaf folder', async () => {
        const user = userEvent.setup();
        const {props} = setup({selectedFolder: 'Personal'});
        screen.getByRole('treeitem', {name: /Personal/}).focus();
        await user.keyboard('{ArrowRight}');
        expect(props.onFocusList).toHaveBeenCalledTimes(1);
    });

    it('collapses an expanded folder on ArrowLeft', async () => {
        const user = userEvent.setup();
        const {props} = setup({
            selectedFolder: 'Work',
            rows: [folder('Work', {hasChildren: true, collapsed: false})],
        });
        screen.getByRole('treeitem', {name: /Work/}).focus();
        await user.keyboard('{ArrowLeft}');
        expect(props.onToggleCollapse).toHaveBeenCalledWith('Work');
    });

    it('dives into the notes list on Enter over a leaf folder', async () => {
        const user = userEvent.setup();
        const {props} = setup({selectedFolder: 'Work'}); // default Work is a leaf
        screen.getByRole('treeitem', {name: /Work/}).focus();
        await user.keyboard('{Enter}');
        expect(props.onFocusList).toHaveBeenCalledTimes(1);
        expect(props.onToggleCollapse).not.toHaveBeenCalled();
    });

    it('toggles (reveal/conceal) a folder with subfolders on Enter', async () => {
        const user = userEvent.setup();
        const {props} = setup({
            selectedFolder: 'Work',
            rows: [folder('Work', {hasChildren: true, collapsed: false})],
        });
        screen.getByRole('treeitem', {name: /Work/}).focus();
        await user.keyboard('{Enter}');
        expect(props.onToggleCollapse).toHaveBeenCalledWith('Work');
        expect(props.onFocusList).not.toHaveBeenCalled();
    });
});

describe('FolderRail — folder actions', () => {
    it('pins a folder from its menu', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('button', {name: 'Work actions'}));
        await user.click(await screen.findByRole('menuitem', {name: /Pin to top/}));
        expect(props.onTogglePin).toHaveBeenCalledWith('Work');
    });

    it('removes an empty folder from its menu', async () => {
        const user = userEvent.setup();
        const {props} = setup({rows: [folder('Empty', {noteCount: 0, hasChildren: false})]});
        await user.click(screen.getByRole('button', {name: 'Empty actions'}));
        await user.click(await screen.findByRole('menuitem', {name: /Delete folder/}));
        expect(props.onRemoveFolder).toHaveBeenCalledWith('Empty');
    });

    it('disables delete for a folder that still holds notes', async () => {
        const user = userEvent.setup();
        const {props} = setup({rows: [folder('Work', {noteCount: 3})]});
        await user.click(screen.getByRole('button', {name: 'Work actions'}));
        const del = await screen.findByRole('menuitem', {name: /Delete folder/});
        await user.click(del);
        expect(props.onRemoveFolder).not.toHaveBeenCalled();
    });

    it('creates a folder at the root from the header button', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('button', {name: 'New folder'}));
        await user.type(await screen.findByPlaceholderText('Folder name'), 'Projects{Enter}');
        expect(props.onCreateFolder).toHaveBeenCalledWith('', 'Projects');
    });

    it('creates a subfolder from a folder menu', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('button', {name: 'Work actions'}));
        await user.click(await screen.findByRole('menuitem', {name: /New subfolder/}));
        await user.type(await screen.findByPlaceholderText('Folder name'), 'Plans{Enter}');
        expect(props.onCreateFolder).toHaveBeenCalledWith('Work', 'Plans');
    });

    it('renders the new-subfolder editor directly under its parent, not at the top', async () => {
        const user = userEvent.setup();
        setup(); // rows: Work, Personal
        await user.click(screen.getByRole('button', {name: 'Work actions'}));
        await user.click(await screen.findByRole('menuitem', {name: /New subfolder/}));
        const inputRow = (await screen.findByPlaceholderText('Folder name')).closest(
            '.folder-rail__row',
        );
        const rows = [...document.querySelectorAll('.folder-rail__items .folder-rail__row')];
        const workRow = screen.getByRole('treeitem', {name: /Work/});
        const personalRow = screen.getByRole('treeitem', {name: /Personal/});
        // The editor sits immediately after Work and before the next sibling — not floating at the top.
        expect(rows.indexOf(inputRow as Element)).toBe(rows.indexOf(workRow) + 1);
        expect(rows.indexOf(inputRow as Element)).toBeLessThan(rows.indexOf(personalRow));
    });

    it('expands a collapsed parent when starting a new subfolder', async () => {
        const user = userEvent.setup();
        const {props} = setup({
            rows: [folder('Work', {hasChildren: true, collapsed: true}), folder('Personal')],
        });
        await user.click(screen.getByRole('button', {name: 'Work actions'}));
        await user.click(await screen.findByRole('menuitem', {name: /New subfolder/}));
        // The collapsed parent is expanded so the editor (and the folder once created) are visible.
        expect(props.onToggleCollapse).toHaveBeenCalledWith('Work');
    });
});

describe('FolderRail — drag and drop', () => {
    // A note drag carries only `text/plain` — `getData` of any other type is empty, like a real one.
    const noteDt = (id: string) => ({
        setData: vi.fn(),
        getData: (type: string) => (type === 'text/plain' ? id : ''),
    });

    it('moves a dropped note into the folder', () => {
        const {props} = setup();
        const dataTransfer = noteDt('Note.md');
        fireEvent.dragOver(screen.getByText('Work'), {dataTransfer});
        fireEvent.drop(screen.getByText('Work'), {dataTransfer});
        expect(props.onMoveTo).toHaveBeenCalledWith('Note.md', 'Work');
    });

    it('moves a note dropped on All Notes to the root', () => {
        const {props} = setup();
        const dataTransfer = noteDt('Work/Note.md');
        fireEvent.dragOver(screen.getByText('All Notes'), {dataTransfer});
        fireEvent.drop(screen.getByText('All Notes'), {dataTransfer});
        expect(props.onMoveTo).toHaveBeenCalledWith('Work/Note.md', '');
    });
});

describe('FolderRail — focus handle', () => {
    it('focusSelected() focuses the selected folder row', () => {
        const {ref} = setup({selectedFolder: 'Work'});
        ref.current?.focusSelected();
        expect(screen.getByRole('treeitem', {name: /Work/})).toHaveFocus();
    });

    it('focusSelected() focuses All Notes when nothing is selected', () => {
        const {ref} = setup({selectedFolder: null});
        ref.current?.focusSelected();
        expect(screen.getByRole('treeitem', {name: /All Notes/})).toHaveFocus();
    });

    it('selectRelative() moves the folder selection (⌘J/⌘K)', () => {
        const {props, ref} = setup({selectedFolder: 'Work'}); // order: All Notes, Work, Personal
        act(() => ref.current?.selectRelative(1));
        expect(props.onSelectFolder).toHaveBeenCalledWith('Personal');
        act(() => ref.current?.selectRelative(-1));
        expect(props.onSelectFolder).toHaveBeenLastCalledWith(null); // back up to All Notes
    });
});

describe('FolderRail — folder drag and drop', () => {
    /** A dataTransfer whose getData returns the dragged folder path for any type. */
    const folderDt = (path: string) => ({setData: vi.fn(), getData: () => path, effectAllowed: ''});

    it('reparents a folder dropped onto another folder', () => {
        const {props} = setup({rows: [folder('Work'), folder('Archive')]});
        const dataTransfer = folderDt('Work');
        fireEvent.dragStart(screen.getByText('Work'), {dataTransfer});
        fireEvent.dragOver(screen.getByText('Archive'), {dataTransfer});
        fireEvent.drop(screen.getByText('Archive'), {dataTransfer});
        expect(props.onMoveFolder).toHaveBeenCalledWith('Work', 'Archive/Work');
    });

    it('moves a folder to the root when dropped on All Notes', () => {
        const {props} = setup({rows: [folder('Work/Sub')]});
        const dataTransfer = folderDt('Work/Sub');
        fireEvent.dragStart(screen.getByText('Sub'), {dataTransfer});
        fireEvent.drop(screen.getByText('All Notes'), {dataTransfer});
        expect(props.onMoveFolder).toHaveBeenCalledWith('Work/Sub', 'Sub');
    });

    it('ignores a folder dropped onto itself', () => {
        const {props} = setup({rows: [folder('Work')]});
        const dataTransfer = folderDt('Work');
        fireEvent.dragStart(screen.getByText('Work'), {dataTransfer});
        fireEvent.drop(screen.getByText('Work'), {dataTransfer});
        expect(props.onMoveFolder).not.toHaveBeenCalled();
    });

    it('still moves a dropped note into the folder (note drag, not folder)', () => {
        const {props} = setup({rows: [folder('Work')]});
        const dataTransfer = {
            setData: vi.fn(),
            getData: (type: string) => (type === 'text/plain' ? 'Note.md' : ''),
        };
        fireEvent.dragOver(screen.getByText('Work'), {dataTransfer});
        fireEvent.drop(screen.getByText('Work'), {dataTransfer});
        expect(props.onMoveTo).toHaveBeenCalledWith('Note.md', 'Work');
        expect(props.onMoveFolder).not.toHaveBeenCalled();
    });
});

describe('FolderRail — rename', () => {
    it('renames a folder via double-click', async () => {
        const user = userEvent.setup();
        const {props} = setup({rows: [folder('Work')]});
        await user.dblClick(screen.getByText('Work'));
        const input = screen.getByDisplayValue('Work');
        await user.clear(input);
        await user.type(input, 'Wonk{Enter}');
        expect(props.onMoveFolder).toHaveBeenCalledWith('Work', 'Wonk');
    });

    it('renames a nested folder, keeping its parent', async () => {
        const user = userEvent.setup();
        const {props} = setup({rows: [folder('Work/Sub')]});
        await user.dblClick(screen.getByText('Sub'));
        const input = screen.getByDisplayValue('Sub');
        await user.clear(input);
        await user.type(input, 'Renamed{Enter}');
        expect(props.onMoveFolder).toHaveBeenCalledWith('Work/Sub', 'Work/Renamed');
    });

    it('renames via the startRename handle (the global F2)', async () => {
        const user = userEvent.setup();
        const {ref, props} = setup({rows: [folder('Work')]});
        act(() => ref.current?.startRename('Work'));
        const input = screen.getByDisplayValue('Work');
        await user.clear(input);
        await user.type(input, 'New{Enter}');
        expect(props.onMoveFolder).toHaveBeenCalledWith('Work', 'New');
    });

    it('cancels a rename on Escape', async () => {
        const user = userEvent.setup();
        const {props} = setup({rows: [folder('Work')]});
        await user.dblClick(screen.getByText('Work'));
        await user.type(screen.getByDisplayValue('Work'), '{Escape}');
        expect(props.onMoveFolder).not.toHaveBeenCalled();
        expect(screen.getByText('Work')).toBeInTheDocument();
    });
});

describe('FolderRail — in-rail keys', () => {
    it('opens the new-subfolder editor on n over a folder', async () => {
        const user = userEvent.setup();
        const {props} = setup({rows: [folder('Work')], selectedFolder: 'Work'});
        screen.getByRole('treeitem', {name: /Work/}).focus();
        await user.keyboard('n');
        await user.type(await screen.findByPlaceholderText('Folder name'), 'Plans{Enter}');
        expect(props.onCreateFolder).toHaveBeenCalledWith('Work', 'Plans');
    });

    it('removes an empty focused folder on Backspace', async () => {
        const user = userEvent.setup();
        const {props} = setup({
            rows: [folder('Empty', {noteCount: 0, hasChildren: false})],
            selectedFolder: 'Empty',
        });
        screen.getByRole('treeitem', {name: /Empty/}).focus();
        await user.keyboard('{Backspace}');
        expect(props.onRemoveFolder).toHaveBeenCalledWith('Empty');
    });

    it('does not remove a folder that still holds notes', async () => {
        const user = userEvent.setup();
        const {props} = setup({rows: [folder('Work', {noteCount: 3})], selectedFolder: 'Work'});
        screen.getByRole('treeitem', {name: /Work/}).focus();
        await user.keyboard('{Backspace}');
        expect(props.onRemoveFolder).not.toHaveBeenCalled();
    });
});
