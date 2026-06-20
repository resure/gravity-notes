import {createRef} from 'react';

import {screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import type {NoteMeta} from '../storage/types';
import {renderWithProviders} from '../test/render';

import type {NoteListProps} from './NoteList';
import {NoteList} from './NoteList';

const NOTES: NoteMeta[] = [
    {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
    {id: 'Beta.md', title: 'Beta', updatedAt: 2},
];

function setup(overrides: Record<string, unknown> = {}) {
    const props = {
        notes: NOTES,
        selectedId: 'Alpha.md',
        query: '',
        onQueryChange: vi.fn(),
        searchInputRef: createRef<HTMLInputElement>(),
        onSelect: vi.fn(),
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        sortMode: 'updated',
        onSortChange: vi.fn(),
        pinnedIds: [],
        onTogglePin: vi.fn(),
        ...overrides,
    };
    renderWithProviders(<NoteList {...(props as NoteListProps)} />);
    return props;
}

describe('NoteList — list & a11y', () => {
    it('renders notes as a listbox of options', () => {
        setup();
        expect(screen.getByRole('listbox', {name: 'Notes'})).toBeInTheDocument();
        expect(screen.getAllByRole('option')).toHaveLength(2);
    });

    it('marks the selected option and makes it the roving-tabindex target', () => {
        setup({selectedId: 'Beta.md'});
        const selected = screen.getByRole('option', {name: /Beta/});
        const other = screen.getByRole('option', {name: /Alpha/});
        expect(selected).toHaveAttribute('aria-selected', 'true');
        expect(selected).toHaveAttribute('tabindex', '0');
        expect(other).toHaveAttribute('aria-selected', 'false');
        expect(other).toHaveAttribute('tabindex', '-1');
    });

    it('selects a note on click', async () => {
        const user = userEvent.setup();
        const props = setup();
        await user.click(screen.getByText('Beta'));
        expect(props.onSelect).toHaveBeenCalledWith('Beta.md');
    });

    it('moves selection to the neighbor on ArrowDown', async () => {
        const user = userEvent.setup();
        const props = setup({selectedId: 'Alpha.md'});
        screen.getByRole('option', {name: /Alpha/}).focus();
        await user.keyboard('{ArrowDown}');
        expect(props.onSelect).toHaveBeenCalledWith('Beta.md');
    });

    it('shows the empty state when there are no notes', () => {
        setup({notes: []});
        expect(screen.getByText(/No notes yet/)).toBeInTheDocument();
    });
});

describe('NoteList — inline rename', () => {
    it('renames via F2 and commits on Enter', async () => {
        const user = userEvent.setup();
        const props = setup({selectedId: 'Alpha.md'});
        screen.getByRole('option', {name: /Alpha/}).focus();
        await user.keyboard('{F2}');
        const input = screen.getByDisplayValue('Alpha');
        await user.clear(input);
        await user.type(input, 'Renamed{Enter}');
        expect(props.onRename).toHaveBeenCalledWith('Alpha.md', 'Renamed');
        // Enter unmounts the input, so the blur handler must not commit a second time.
        expect(props.onRename).toHaveBeenCalledTimes(1);
    });

    it('commits a rename on blur', async () => {
        const user = userEvent.setup();
        const props = setup();
        await user.dblClick(screen.getByText('Beta'));
        const input = screen.getByDisplayValue('Beta');
        await user.clear(input);
        await user.type(input, 'Beta 2');
        await user.tab(); // blur
        expect(props.onRename).toHaveBeenCalledWith('Beta.md', 'Beta 2');
        expect(props.onRename).toHaveBeenCalledTimes(1);
    });

    it('cancels a rename on Escape', async () => {
        const user = userEvent.setup();
        const props = setup();
        await user.dblClick(screen.getByText('Beta'));
        const input = screen.getByDisplayValue('Beta');
        await user.clear(input);
        await user.type(input, 'Nope{Escape}');
        expect(props.onRename).not.toHaveBeenCalled();
        expect(screen.getByText('Beta')).toBeInTheDocument();
    });

    it('is a no-op when the title is unchanged', async () => {
        const user = userEvent.setup();
        const props = setup();
        await user.dblClick(screen.getByText('Beta'));
        await user.type(screen.getByDisplayValue('Beta'), '{Enter}');
        expect(props.onRename).not.toHaveBeenCalled();
    });

    it('is a no-op when the title is emptied', async () => {
        const user = userEvent.setup();
        const props = setup();
        await user.dblClick(screen.getByText('Beta'));
        const input = screen.getByDisplayValue('Beta');
        await user.clear(input);
        await user.type(input, '{Enter}');
        expect(props.onRename).not.toHaveBeenCalled();
    });
});

describe('NoteList — delete', () => {
    it('deletes a note after confirming', async () => {
        const user = userEvent.setup();
        const props = setup();
        const beta = screen.getByRole('option', {name: /Beta/});
        await user.click(within(beta).getByRole('button'));
        await user.click(await screen.findByRole('menuitem', {name: /Delete/}));
        await user.click(screen.getByRole('button', {name: 'Delete'}));
        expect(props.onDelete).toHaveBeenCalledWith('Beta.md');
    });
});

describe('NoteList — search', () => {
    it('calls onQueryChange when typing in the search field', async () => {
        const user = userEvent.setup();
        const props = setup();
        await user.type(screen.getByPlaceholderText('Search'), 'x');
        expect(props.onQueryChange).toHaveBeenCalledWith('x');
    });

    it('highlights the matched substring in titles', () => {
        setup({query: 'lph'});
        const mark = document.querySelector('mark');
        expect(mark?.textContent).toBe('lph');
    });

    it('shows a no-results message when filtered to empty with a query', () => {
        setup({notes: [], query: 'zzz'});
        expect(screen.getByText(/No notes match/)).toBeInTheDocument();
    });

    it('opens the top match on Enter in the search field', async () => {
        const user = userEvent.setup();
        const props = setup({query: 'a'});
        screen.getByPlaceholderText('Search').focus();
        await user.keyboard('{Enter}');
        expect(props.onSelect).toHaveBeenCalledWith('Alpha.md');
    });

    it('clears the query on Escape in the search field', async () => {
        const user = userEvent.setup();
        const props = setup({query: 'beta'});
        screen.getByPlaceholderText('Search').focus();
        await user.keyboard('{Escape}');
        expect(props.onQueryChange).toHaveBeenCalledWith('');
    });
});

describe('NoteList — sort control', () => {
    it('changes the sort mode via the sort control', async () => {
        const user = userEvent.setup();
        const props = setup();
        await user.click(screen.getByRole('combobox'));
        await user.click(await screen.findByRole('option', {name: 'Title (A→Z)'}));
        expect(props.onSortChange).toHaveBeenCalledWith('title');
    });
});

describe('NoteList — pinning', () => {
    it('shows a pin icon on pinned notes only', () => {
        setup({pinnedIds: ['Alpha.md']});
        const alpha = screen.getByRole('option', {name: /Alpha/});
        const beta = screen.getByRole('option', {name: /Beta/});
        expect(alpha.querySelector('.note-list__pin')).toBeTruthy();
        expect(beta.querySelector('.note-list__pin')).toBeFalsy();
    });

    it('pins an unpinned note from the menu', async () => {
        const user = userEvent.setup();
        const props = setup();
        const alpha = screen.getByRole('option', {name: /Alpha/});
        await user.click(within(alpha).getByRole('button'));
        await user.click(await screen.findByRole('menuitem', {name: /Pin to top/}));
        expect(props.onTogglePin).toHaveBeenCalledWith('Alpha.md');
    });

    it('unpins a pinned note from the menu', async () => {
        const user = userEvent.setup();
        const props = setup({pinnedIds: ['Alpha.md']});
        const alpha = screen.getByRole('option', {name: /Alpha/});
        await user.click(within(alpha).getByRole('button'));
        await user.click(await screen.findByRole('menuitem', {name: /Unpin/}));
        expect(props.onTogglePin).toHaveBeenCalledWith('Alpha.md');
    });
});
