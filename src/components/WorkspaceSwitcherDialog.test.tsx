import {fireEvent, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import type {WorkspaceInfo} from '../hooks/useNotesStorage';
import {renderWithProviders} from '../test/render';

import {
    WorkspaceSwitcherDialog,
    type WorkspaceSwitcherDialogProps,
} from './WorkspaceSwitcherDialog';

const WORKSPACES: WorkspaceInfo[] = [
    {id: 'tauri:/Users/me/Notes', backend: 'tauri-fs', name: 'Notes', path: '/Users/me/Notes'},
    {id: 'tauri:/Users/me/Work', backend: 'tauri-fs', name: 'Work', path: '/Users/me/Work'},
    {id: 'indexeddb', backend: 'indexeddb', name: 'In this app'},
];

function setup(over: Partial<WorkspaceSwitcherDialogProps> = {}) {
    const onOpen = vi.fn();
    const onOpenInNewWindow = vi.fn();
    const onOpenFolder = vi.fn();
    const onRemove = vi.fn();
    const onClose = vi.fn();
    const props: WorkspaceSwitcherDialogProps = {
        open: true,
        workspaces: WORKSPACES,
        currentId: 'tauri:/Users/me/Notes',
        isDesktop: true,
        supportsFolders: true,
        onOpen,
        onOpenInNewWindow,
        onOpenFolder,
        onRemove,
        onClose,
        ...over,
    };
    renderWithProviders(<WorkspaceSwitcherDialog {...props} />);
    return {onOpen, onOpenInNewWindow, onOpenFolder, onRemove, onClose};
}

const filter = () => screen.getByRole('combobox', {name: 'Filter workspaces'});
// Gravity's Dialog focus-trap drops keystrokes from userEvent.type in jsdom, so drive the controlled
// field with fireEvent.change (one shot) and keys with fireEvent.keyDown. Clicks use userEvent.
const type = (value: string) => fireEvent.change(filter(), {target: {value}});
const press = (key: string, init: Record<string, unknown> = {}) =>
    fireEvent.keyDown(filter(), {key, ...init});

describe('WorkspaceSwitcherDialog', () => {
    it('lists the workspaces with the current one badged and not pickable', async () => {
        const user = userEvent.setup();
        const {onOpen} = setup();
        for (const name of ['Notes', 'Work', 'In this app']) {
            expect(screen.getByRole('option', {name: new RegExp(name)})).toBeInTheDocument();
        }
        const current = screen.getByRole('option', {name: /Notes/});
        expect(current).toHaveAttribute('aria-disabled', 'true');
        expect(current).toHaveTextContent('current');
        await user.click(current);
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('synthesizes the in-browser row on the web — and never lets ⌘⌫ remove it', () => {
        const {onRemove} = setup({
            workspaces: WORKSPACES.filter((ws) => ws.backend !== 'indexeddb'),
            isDesktop: false,
        });
        expect(screen.getByRole('option', {name: /In this browser/})).toBeInTheDocument();
        // Pre-highlight is Work (first selectable); the synthesized row is next.
        press('ArrowDown');
        press('Backspace', {metaKey: true});
        expect(onRemove).not.toHaveBeenCalled();
    });

    it('does not offer in-browser storage on desktop (folder-first)', () => {
        setup({workspaces: WORKSPACES.filter((ws) => ws.backend !== 'indexeddb')});
        expect(screen.queryByRole('option', {name: /In this (app|browser)/})).toBeNull();
    });

    it('still lists an in-app workspace that exists in the registry (data safety)', () => {
        // Not offered ≠ hidden: someone who stored notes in-app before must keep reaching them.
        setup();
        expect(screen.getByRole('option', {name: /In this app/})).toBeInTheDocument();
    });

    it('opens a workspace on click', async () => {
        const user = userEvent.setup();
        const {onOpen, onOpenInNewWindow} = setup();
        await user.click(screen.getByRole('option', {name: /Work/}));
        expect(onOpen).toHaveBeenCalledWith('tauri:/Users/me/Work');
        expect(onOpenInNewWindow).not.toHaveBeenCalled();
    });

    it('filters by name or path and opens the first match on Enter (typeahead)', () => {
        const {onOpen} = setup();
        type('wor');
        expect(screen.queryByRole('option', {name: /In this app/})).not.toBeInTheDocument();
        press('Enter');
        expect(onOpen).toHaveBeenCalledWith('tauri:/Users/me/Work');
    });

    it('orders others by recency with the current workspace last (before the action row)', () => {
        setup();
        const texts = screen.getAllByRole('option').map((el) => el.textContent ?? '');
        // WORKSPACES recency: Notes (current) > Work > In this app. Others lead, current sinks.
        expect(texts[0]).toContain('Work');
        expect(texts[1]).toContain('In this app');
        expect(texts[2]).toContain('Notes');
        expect(texts[2]).toContain('current');
        expect(texts[3]).toContain('Open Folder');
    });

    it('pre-highlights the top row (most recent OTHER workspace), so ⌃R↵ ⌃R↵ ping-pongs', () => {
        const {onOpen} = setup();
        // No arrows, no filter: Work — the top row — is highlighted on open; the current
        // workspace sits at the bottom and never takes the highlight.
        press('Enter');
        expect(onOpen).toHaveBeenCalledWith('tauri:/Users/me/Work');
    });

    it('handles keys at the DOCUMENT level — navigation works wherever focus sits', () => {
        const {onOpen, onOpenFolder} = setup();
        // Fire on <body>, NOT the input: in the live app the Dialog's focus manager can park
        // focus on the dialog container (or a row's ✕), where an input-scoped handler goes
        // silent — arrows/Enter must still work (regression for a live-only bug).
        fireEvent.keyDown(document.body, {key: 'ArrowDown'});
        fireEvent.keyDown(document.body, {key: 'ArrowDown'});
        fireEvent.keyDown(document.body, {key: 'Enter'});
        expect(onOpenFolder).toHaveBeenCalledTimes(1);
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('arrows walk the selectable rows down to the Open Folder action', () => {
        const {onOpen, onOpenFolder} = setup();
        // Order: [Work] → In this app → Notes (current, skipped) → Open Folder….
        press('ArrowDown');
        press('ArrowDown');
        press('Enter');
        expect(onOpenFolder).toHaveBeenCalledTimes(1);
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('⌘Enter opens the highlighted workspace in a new window on desktop', () => {
        const {onOpen, onOpenInNewWindow} = setup();
        press('Enter', {metaKey: true});
        expect(onOpenInNewWindow).toHaveBeenCalledWith('tauri:/Users/me/Work');
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('⌘Enter falls back to a plain open on the web (no windows there)', () => {
        const {onOpen, onOpenInNewWindow} = setup({isDesktop: false});
        press('Enter', {metaKey: true});
        expect(onOpen).toHaveBeenCalledWith('tauri:/Users/me/Work');
        expect(onOpenInNewWindow).not.toHaveBeenCalled();
    });

    it('⌘⌫ removes the highlighted workspace from recents', () => {
        const {onRemove} = setup();
        press('Backspace', {metaKey: true});
        expect(onRemove).toHaveBeenCalledWith('tauri:/Users/me/Work');
    });

    it('never removes the Open Folder action row', () => {
        const {onRemove} = setup({
            workspaces: WORKSPACES.filter((ws) => ws.backend !== 'indexeddb'),
        });
        // Desktop, no in-app row: Notes (current, skipped) → [Work] → Open Folder….
        press('ArrowDown');
        press('Backspace', {metaKey: true});
        expect(onRemove).not.toHaveBeenCalled();
    });

    it('removes via the row ✕ button without opening the workspace', async () => {
        const user = userEvent.setup();
        const {onOpen, onRemove} = setup();
        await user.click(screen.getByRole('button', {name: 'Remove Work from recents'}));
        expect(onRemove).toHaveBeenCalledWith('tauri:/Users/me/Work');
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('opens the folder picker from the Open Folder row on click', async () => {
        const user = userEvent.setup();
        const {onOpen, onOpenFolder} = setup();
        await user.click(screen.getByRole('option', {name: /Open Folder/}));
        expect(onOpenFolder).toHaveBeenCalledTimes(1);
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('hides the Open Folder action when folder storage is unavailable', () => {
        setup({supportsFolders: false, isDesktop: false});
        expect(screen.queryByRole('option', {name: /Open Folder/})).toBeNull();
    });

    it('shows an empty hint when nothing matches — with Open Folder still reachable', () => {
        const {onOpenFolder} = setup();
        type('zzz');
        expect(screen.getByText(/No workspaces match/)).toBeInTheDocument();
        // The action row sits outside the filter, so it survives as the only option…
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(1);
        expect(options[0]).toHaveTextContent('Open Folder…');
        // …and is the pre-highlighted target, so ↵ still does something useful.
        press('Enter');
        expect(onOpenFolder).toHaveBeenCalledTimes(1);
    });

    it('Escape closes the switcher', () => {
        const {onClose} = setup();
        press('Escape');
        expect(onClose).toHaveBeenCalled();
    });
});
