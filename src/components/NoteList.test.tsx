import {createRef} from 'react';

import {act, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {NoteMeta} from '../storage/types';
import {renderWithProviders} from '../test/render';

import {NoteList, type NoteListHandle, type NoteListProps, formatNoteDate} from './NoteList';

const NOTES: NoteMeta[] = [
    {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
    {id: 'Beta.md', title: 'Beta', updatedAt: 2},
];

function setup(overrides: Partial<NoteListProps> = {}) {
    const props = {
        notes: NOTES,
        selectedId: 'Alpha.md',
        query: '',
        scopeLabel: null,
        showCrumbs: false,
        searchInputRef: createRef<HTMLInputElement>(),
        onBrowse: vi.fn(),
        onCommit: vi.fn(),
        onEscapeList: vi.fn(),
        onCreate: vi.fn(),
        onRequestMove: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        sortMode: 'updated',
        onSortChange: vi.fn(),
        pinnedIds: [],
        onTogglePin: vi.fn(),
        railOpen: false,
        onToggleRail: vi.fn(),
        onFocusRail: vi.fn(),
        ...overrides,
    };
    const ref = createRef<NoteListHandle>();
    renderWithProviders(<NoteList ref={ref} {...(props as unknown as NoteListProps)} />);
    return {props, ref};
}

describe('formatNoteDate', () => {
    // Freeze "now" so the today-vs-other-day branch can't flip if a test crosses midnight.
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 21, 14, 0, 0)); // 21 Jun 2026
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows 24-hour time for today', () => {
        const today = new Date();
        today.setHours(14, 32, 0, 0);
        expect(formatNoteDate(today.getTime())).toBe('14:32');
    });

    it('zero-pads the morning hours', () => {
        const today = new Date();
        today.setHours(9, 5, 0, 0);
        expect(formatNoteDate(today.getTime())).toBe('09:05');
    });

    it('shows DD.MM.YY for any other day', () => {
        const past = new Date(2024, 0, 5, 9, 0, 0); // 5 Jan 2024
        expect(formatNoteDate(past.getTime())).toBe('05.01.24');
    });

    it('returns an empty string when there is no timestamp', () => {
        expect(formatNoteDate(undefined)).toBe('');
    });
});

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

    it('browses a note on single click', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByText('Beta'));
        expect(props.onBrowse).toHaveBeenCalledWith('Beta.md');
    });

    it('browses the neighbor on ArrowDown', async () => {
        const user = userEvent.setup();
        const {props} = setup({selectedId: 'Alpha.md'});
        screen.getByRole('option', {name: /Alpha/}).focus();
        await user.keyboard('{ArrowDown}');
        expect(props.onBrowse).toHaveBeenCalledWith('Beta.md');
    });

    it('browses the next note on j (vim-style)', async () => {
        const user = userEvent.setup();
        const {props} = setup({selectedId: 'Alpha.md'});
        screen.getByRole('option', {name: /Alpha/}).focus();
        await user.keyboard('j');
        expect(props.onBrowse).toHaveBeenCalledWith('Beta.md');
    });

    it('browses the previous note on k (vim-style)', async () => {
        const user = userEvent.setup();
        const {props} = setup({selectedId: 'Beta.md'});
        screen.getByRole('option', {name: /Beta/}).focus();
        await user.keyboard('k');
        expect(props.onBrowse).toHaveBeenCalledWith('Alpha.md');
    });

    it('ignores j with a modifier so ⌘J bubbles to the global handler', async () => {
        const user = userEvent.setup();
        const {props} = setup({selectedId: 'Alpha.md'});
        screen.getByRole('option', {name: /Alpha/}).focus();
        await user.keyboard('{Meta>}j{/Meta}');
        expect(props.onBrowse).not.toHaveBeenCalled();
    });

    it('commits the focused note on Enter', async () => {
        const user = userEvent.setup();
        const {props} = setup({selectedId: 'Alpha.md'});
        screen.getByRole('option', {name: /Alpha/}).focus();
        await user.keyboard('{Enter}');
        expect(props.onCommit).toHaveBeenCalledWith('Alpha.md');
    });

    it('escapes the list on Escape over a row', async () => {
        const user = userEvent.setup();
        const {props} = setup({selectedId: 'Alpha.md'});
        screen.getByRole('option', {name: /Alpha/}).focus();
        await user.keyboard('{Escape}');
        expect(props.onEscapeList).toHaveBeenCalledTimes(1);
    });

    it('shows the All-Notes empty state when there are no notes', () => {
        setup({notes: [], scopeLabel: null});
        expect(screen.getByText(/No notes yet/)).toBeInTheDocument();
    });

    it('names the folder in the empty state of an empty selected folder', () => {
        setup({notes: [], scopeLabel: 'Work'});
        expect(screen.getByText(/No notes in/)).toBeInTheDocument();
        expect(screen.getByText(/Work/)).toBeInTheDocument();
    });

    it('shows a body preview snippet and a formatted date', () => {
        const when = new Date(2020, 0, 15).getTime(); // 15 Jan 2020 → renders as 15.01.20
        setup({notes: [{id: 'A.md', title: 'A', updatedAt: when, preview: 'Grocery list'}]});
        expect(screen.getByText('Grocery list')).toBeInTheDocument();
        expect(screen.getByText('15.01.20')).toBeInTheDocument();
    });
});

describe('NoteList — focus handle', () => {
    it('focusSelected() moves DOM focus to the selected row', () => {
        const {ref} = setup({selectedId: 'Beta.md'});
        ref.current?.focusSelected();
        expect(screen.getByRole('option', {name: /Beta/})).toHaveFocus();
    });

    it('focusSelected() falls back to the search box when the list is empty', () => {
        // The top bar owns the real search input; here we just assert the handle reaches for it.
        const focus = vi.fn();
        const {ref} = setup({
            notes: [],
            selectedId: null,
            searchInputRef: {current: {focus} as unknown as HTMLInputElement},
        });
        ref.current?.focusSelected();
        expect(focus).toHaveBeenCalledTimes(1);
    });
});

describe('NoteList — inline rename', () => {
    // Double-click no longer renames; the context-menu "Rename" item is the mouse path.
    async function openRename(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
        const row = screen.getByRole('option', {name});
        await user.click(within(row).getByRole('button'));
        await user.click(await screen.findByRole('menuitem', {name: /Rename/}));
    }

    it('renames via the startRename handle and commits on Enter', async () => {
        const user = userEvent.setup();
        const {ref, props} = setup({selectedId: 'Alpha.md'});
        act(() => {
            ref.current?.startRename('Alpha.md');
        });
        const input = screen.getByDisplayValue('Alpha');
        await user.clear(input);
        await user.type(input, 'Renamed{Enter}');
        expect(props.onRename).toHaveBeenCalledWith('Alpha.md', 'Renamed');
        expect(props.onRename).toHaveBeenCalledTimes(1);
    });

    it('renames from the context menu and commits on blur', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await openRename(user, /Beta/);
        const input = screen.getByDisplayValue('Beta');
        await user.clear(input);
        await user.type(input, 'Beta 2');
        await user.tab();
        expect(props.onRename).toHaveBeenCalledWith('Beta.md', 'Beta 2');
        expect(props.onRename).toHaveBeenCalledTimes(1);
    });

    it('cancels a rename on Escape', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await openRename(user, /Beta/);
        const input = screen.getByDisplayValue('Beta');
        await user.clear(input);
        await user.type(input, 'Nope{Escape}');
        expect(props.onRename).not.toHaveBeenCalled();
        expect(screen.getByText('Beta')).toBeInTheDocument();
    });

    it('restores focus to the row after cancelling a rename', async () => {
        const user = userEvent.setup();
        const {ref} = setup({selectedId: 'Alpha.md'});
        act(() => {
            ref.current?.startRename('Alpha.md');
        });
        await user.type(screen.getByDisplayValue('Alpha'), '{Escape}');
        expect(screen.getByRole('option', {name: /Alpha/})).toHaveFocus();
    });

    it('is a no-op when the title is unchanged', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await openRename(user, /Beta/);
        await user.type(screen.getByDisplayValue('Beta'), '{Enter}');
        expect(props.onRename).not.toHaveBeenCalled();
    });

    it('is a no-op when the title is emptied', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await openRename(user, /Beta/);
        const input = screen.getByDisplayValue('Beta');
        await user.clear(input);
        await user.type(input, '{Enter}');
        expect(props.onRename).not.toHaveBeenCalled();
    });

    it('does not start a rename on double-click', async () => {
        const user = userEvent.setup();
        setup();
        await user.dblClick(screen.getByText('Beta'));
        expect(screen.queryByDisplayValue('Beta')).toBeNull();
    });
});

describe('NoteList — delete', () => {
    it('deletes a note after confirming', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        const beta = screen.getByRole('option', {name: /Beta/});
        await user.click(within(beta).getByRole('button'));
        await user.click(await screen.findByRole('menuitem', {name: /Delete/}));
        await user.click(screen.getByRole('button', {name: 'Delete'}));
        expect(props.onDelete).toHaveBeenCalledWith('Beta.md');
    });

    it('deletes on Enter in the confirmation dialog', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        const beta = screen.getByRole('option', {name: /Beta/});
        await user.click(within(beta).getByRole('button'));
        await user.click(await screen.findByRole('menuitem', {name: /Delete/}));
        const dialog = await screen.findByRole('dialog');
        // Wait until the dialog has grabbed focus, else Enter races its focus trap.
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
        await user.keyboard('{Enter}');
        expect(props.onDelete).toHaveBeenCalledWith('Beta.md');
    });
});

describe('NoteList — search display', () => {
    it('highlights the matched substring in titles', () => {
        setup({query: 'lph'});
        const mark = document.querySelector('mark');
        expect(mark?.textContent).toBe('lph');
    });

    it('highlights every query term in the title (multi-term)', () => {
        setup({notes: [{id: 'G.md', title: 'Gamma beta', updatedAt: 1}], query: 'gamma beta'});
        const marks = [...document.querySelectorAll('mark')].map((m) => m.textContent);
        expect(marks).toEqual(expect.arrayContaining(['Gamma', 'beta']));
    });

    it('highlights the longer term when one query term is a prefix of another', () => {
        // "java" is a prefix of "javascript"; longest-first ordering marks the whole word.
        setup({
            notes: [{id: 'J.md', title: 'I love javascript', updatedAt: 1}],
            query: 'java javascript',
        });
        const mark = [...document.querySelectorAll('mark')].find(
            (m) => m.textContent === 'javascript',
        );
        expect(mark).toBeTruthy();
    });

    it('shows a body snippet in place of the preview, with the term highlighted', () => {
        setup({
            notes: [{id: 'A.md', title: 'A', updatedAt: 1, preview: 'head of note'}],
            query: 'needle',
            snippetById: new Map([['A.md', '…around the needle here…']]),
        });
        // The full-text snippet replaces the standard head-of-note preview.
        expect(screen.queryByText(/head of note/)).toBeNull();
        expect(screen.getByText(/around the/)).toBeInTheDocument();
        const mark = [...document.querySelectorAll('mark')].find((m) => m.textContent === 'needle');
        expect(mark).toBeTruthy();
    });

    it('shows a folder-path crumb on a nested note in search mode', () => {
        setup({
            showCrumbs: true,
            notes: [{id: 'Work/Sub/Plan.md', title: 'Plan', updatedAt: 1}],
        });
        expect(screen.getByText('Work / Sub')).toBeInTheDocument();
    });

    it('hints note creation when filtered to empty with a query', () => {
        setup({notes: [], query: 'zzz'});
        expect(screen.getByText(/create .zzz./i)).toBeInTheDocument();
    });
});

describe('NoteList — toolbar', () => {
    it('creates an untitled note from the New button', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('button', {name: 'New'}));
        expect(props.onCreate).toHaveBeenCalledWith();
    });

    it('changes the sort mode via the sort control', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('combobox', {name: 'Sort notes'}));
        await user.click(await screen.findByRole('option', {name: 'Title (A→Z)'}));
        expect(props.onSortChange).toHaveBeenCalledWith('title');
    });

    it('toggles the folder rail from the toolbar button', async () => {
        const user = userEvent.setup();
        const {props} = setup({railOpen: false});
        await user.click(screen.getByRole('button', {name: 'Show folders'}));
        expect(props.onToggleRail).toHaveBeenCalledTimes(1);
    });

    it('labels the rail toggle by its state', () => {
        setup({railOpen: true});
        expect(screen.getByRole('button', {name: 'Hide folders'})).toBeInTheDocument();
    });
});

describe('NoteList — rail focus handoff', () => {
    it('moves focus to the rail on ArrowLeft when the rail is open', async () => {
        const user = userEvent.setup();
        const {props} = setup({railOpen: true, selectedId: 'Alpha.md'});
        screen.getByRole('option', {name: /Alpha/}).focus();
        await user.keyboard('{ArrowLeft}');
        expect(props.onFocusRail).toHaveBeenCalledTimes(1);
    });

    it('ignores ArrowLeft when the rail is closed', async () => {
        const user = userEvent.setup();
        const {props} = setup({railOpen: false, selectedId: 'Alpha.md'});
        screen.getByRole('option', {name: /Alpha/}).focus();
        await user.keyboard('{ArrowLeft}');
        expect(props.onFocusRail).not.toHaveBeenCalled();
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
        const {props} = setup();
        const alpha = screen.getByRole('option', {name: /Alpha/});
        await user.click(within(alpha).getByRole('button'));
        await user.click(await screen.findByRole('menuitem', {name: /Pin to top/}));
        expect(props.onTogglePin).toHaveBeenCalledWith('Alpha.md');
    });

    it('unpins a pinned note from the menu', async () => {
        const user = userEvent.setup();
        const {props} = setup({pinnedIds: ['Alpha.md']});
        const alpha = screen.getByRole('option', {name: /Alpha/});
        await user.click(within(alpha).getByRole('button'));
        await user.click(await screen.findByRole('menuitem', {name: /Unpin/}));
        expect(props.onTogglePin).toHaveBeenCalledWith('Alpha.md');
    });
});

describe('NoteList — move picker', () => {
    it('requests a move via the row "Move to…" menu (the workspace owns the picker)', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        const beta = screen.getByRole('option', {name: /Beta/});
        await user.click(within(beta).getByRole('button'));
        await user.click(await screen.findByRole('menuitem', {name: /Move to/}));
        expect(props.onRequestMove).toHaveBeenCalledWith('Beta.md');
    });
});
