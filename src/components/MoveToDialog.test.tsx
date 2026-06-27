import {fireEvent, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {DEFAULT_METADATA} from '../storage/metadata';
import type {NotesMetadata} from '../storage/types';
import {renderWithProviders} from '../test/render';

import {MoveToDialog, type MoveToDialogProps} from './MoveToDialog';

const FOLDERS = ['Work', 'Work/Projects', 'Work/Archive', 'Personal'];
const META: NotesMetadata = {...DEFAULT_METADATA, sort: 'title'};

function setup(over: Partial<MoveToDialogProps> = {}) {
    const onMove = vi.fn();
    const onClose = vi.fn();
    const props: MoveToDialogProps = {
        open: true,
        note: {id: 'Work/Plan.md', title: 'Plan'}, // current folder = "Work"
        folders: FOLDERS,
        notes: [],
        metadata: META,
        onMove,
        onClose,
        ...over,
    };
    renderWithProviders(<MoveToDialog {...props} />);
    return {onMove, onClose};
}

const filter = () => screen.getByRole('combobox', {name: 'Filter folders'});
// Gravity's Dialog focus-trap drops keystrokes from userEvent.type in jsdom, so drive the controlled
// field with fireEvent.change (one shot) and keys with fireEvent.keyDown. Clicks use userEvent.
const type = (value: string) => fireEvent.change(filter(), {target: {value}});
const press = (key: string) => fireEvent.keyDown(filter(), {key});

describe('MoveToDialog', () => {
    it('lists Root and the folder tree as options', () => {
        setup();
        for (const name of ['Root', 'Work', 'Projects', 'Archive', 'Personal']) {
            expect(screen.getByRole('option', {name: new RegExp(name)})).toBeInTheDocument();
        }
    });

    it('disables the note’s current folder (a no-op move) and ignores a click on it', async () => {
        const user = userEvent.setup();
        const {onMove} = setup();
        const work = screen.getByRole('option', {name: /Work/});
        expect(work).toHaveAttribute('aria-disabled', 'true');
        await user.click(work);
        expect(onMove).not.toHaveBeenCalled();
    });

    it('moves into a folder on click', async () => {
        const user = userEvent.setup();
        const {onMove} = setup();
        await user.click(screen.getByRole('option', {name: /Personal/}));
        expect(onMove).toHaveBeenCalledWith('Personal');
    });

    it('moves to the root on clicking Root', async () => {
        const user = userEvent.setup();
        const {onMove} = setup();
        await user.click(screen.getByRole('option', {name: /Root/}));
        expect(onMove).toHaveBeenCalledWith('');
    });

    it('filters by folder name, keeping ancestors for context', () => {
        setup();
        type('arch');
        expect(screen.getByRole('option', {name: /Archive/})).toBeInTheDocument();
        expect(screen.getByRole('option', {name: /Work/})).toBeInTheDocument(); // ancestor context
        expect(screen.queryByRole('option', {name: /Personal/})).not.toBeInTheDocument();
    });

    it('Enter moves to the first filter match (typeahead)', () => {
        const {onMove} = setup();
        type('arch');
        press('Enter');
        expect(onMove).toHaveBeenCalledWith('Work/Archive');
    });

    it('does not move on Enter with an empty filter (nothing highlighted)', () => {
        const {onMove} = setup();
        press('Enter');
        expect(onMove).not.toHaveBeenCalled();
    });

    it('ArrowDown then Enter moves to the first selectable row, skipping the current folder', () => {
        const {onMove} = setup();
        // Order: Root, Personal, Work(disabled), Archive, Projects → first selectable is Root.
        press('ArrowDown');
        press('Enter');
        expect(onMove).toHaveBeenCalledWith('');
    });

    it('shows an empty hint when nothing matches', () => {
        setup();
        type('zzz');
        expect(screen.getByText(/No folders match/)).toBeInTheDocument();
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('Escape closes the picker', () => {
        const {onClose} = setup();
        press('Escape');
        expect(onClose).toHaveBeenCalled();
    });

    it('collapses a folder’s subtree via its caret (unfiltered)', async () => {
        const user = userEvent.setup();
        setup();
        expect(screen.getByRole('option', {name: /Projects/})).toBeInTheDocument();
        await user.click(screen.getByRole('button', {name: /Collapse Work/}));
        expect(screen.queryByRole('option', {name: /Projects/})).not.toBeInTheDocument();
    });
});
