import {createRef} from 'react';

import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import type {NoteMeta} from '../storage/types';
import {renderWithProviders} from '../test/render';

import {TopBar, type TopBarProps} from './TopBar';

const NOTES: NoteMeta[] = [
    {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
    {id: 'Beta.md', title: 'Beta', updatedAt: 2},
];

const SEARCH = 'Search or create a note…';

function setup(overrides: Record<string, unknown> = {}) {
    const props = {
        folderName: 'notes',
        onChangeFolder: vi.fn(),
        onOpenHelp: vi.fn(),
        themePref: 'light',
        onChangeThemePref: vi.fn(),
        saveLabel: '',
        query: '',
        onQueryChange: vi.fn(),
        searchInputRef: createRef<HTMLInputElement>(),
        notes: NOTES,
        selectedId: 'Alpha.md',
        onCommit: vi.fn(),
        onCreate: vi.fn(),
        onClose: vi.fn(),
        onEnterList: vi.fn(),
        onFocusList: vi.fn(),
        ...overrides,
    };
    renderWithProviders(<TopBar {...(props as TopBarProps)} />);
    return {props};
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
});

describe('TopBar — controls', () => {
    it('changes folder from the folder button', async () => {
        const user = userEvent.setup();
        const {props} = setup({folderName: 'my-notes'});
        await user.click(screen.getByRole('button', {name: /my-notes/}));
        expect(props.onChangeFolder).toHaveBeenCalledTimes(1);
    });

    it('opens help from the help button', async () => {
        const user = userEvent.setup();
        const {props} = setup();
        await user.click(screen.getByRole('button', {name: /Keyboard shortcuts/}));
        expect(props.onOpenHelp).toHaveBeenCalledTimes(1);
    });
});
