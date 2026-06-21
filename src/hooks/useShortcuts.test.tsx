import {renderHook} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {type ShortcutActions, useShortcuts} from './useShortcuts';

function makeActions(): ShortcutActions {
    return {
        createNote: vi.fn(),
        selectNextNote: vi.fn(),
        selectPrevNote: vi.fn(),
        toggleSidebar: vi.fn(),
        peekSidebar: vi.fn(),
        toggleEditorMode: vi.fn(),
        togglePreview: vi.fn(),
        openHelp: vi.fn(),
        renameSelected: vi.fn(),
    };
}

function press(init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {bubbles: true, cancelable: true, ...init});
    document.dispatchEvent(event);
    return event;
}

describe('useShortcuts', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('selects the next note on ctrl+j', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: 'j', ctrlKey: true});
        expect(actions.selectNextNote).toHaveBeenCalledTimes(1);
        expect(actions.createNote).not.toHaveBeenCalled();
    });

    it('selects the previous note on ctrl+k', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: 'k', ctrlKey: true});
        expect(actions.selectPrevNote).toHaveBeenCalledTimes(1);
    });

    it('creates a note on ctrl+enter', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: 'Enter', ctrlKey: true});
        expect(actions.createNote).toHaveBeenCalledTimes(1);
    });

    it('toggles editor mode on mod+/', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: '/', metaKey: true});
        expect(actions.toggleEditorMode).toHaveBeenCalledTimes(1);
    });

    it('toggles preview on mod+shift+p', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: 'p', metaKey: true, shiftKey: true});
        expect(actions.togglePreview).toHaveBeenCalledTimes(1);
    });

    it('does not toggle preview on mod+p without shift', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: 'p', metaKey: true});
        expect(actions.togglePreview).not.toHaveBeenCalled();
    });

    it('opens help on ? when focus is outside inputs', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const event = press({key: '?'});
        expect(actions.openHelp).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('does not open help on ? while typing in an input', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        press({key: '?'});
        expect(actions.openHelp).not.toHaveBeenCalled();
    });

    it('ignores auto-repeat so a held key fires once', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: 'j', ctrlKey: true});
        press({key: 'j', ctrlKey: true, repeat: true});
        press({key: 'j', ctrlKey: true, repeat: true});
        expect(actions.selectNextNote).toHaveBeenCalledTimes(1);
    });

    it('still navigates on ctrl+j while typing in an input', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        press({key: 'j', ctrlKey: true});
        expect(actions.selectNextNote).toHaveBeenCalledTimes(1);
    });

    it('still navigates on ctrl+k while typing in an input', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        press({key: 'k', ctrlKey: true});
        expect(actions.selectPrevNote).toHaveBeenCalledTimes(1);
    });

    it('renames the selected note on F2, even while typing in an input', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        press({key: 'F2'});
        expect(actions.renameSelected).toHaveBeenCalledTimes(1);
    });

    it('toggles the sidebar on ctrl+apostrophe', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: "'", ctrlKey: true});
        expect(actions.toggleSidebar).toHaveBeenCalledTimes(1);
    });

    it('still toggles the sidebar on ctrl+apostrophe while typing in an input', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        press({key: "'", ctrlKey: true});
        expect(actions.toggleSidebar).toHaveBeenCalledTimes(1);
    });

    it('peeks the sidebar on ctrl+shift+doublequote (and does not toggle)', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        // Shift+apostrophe emits the double-quote character; that + shift is the ⌘⇧' binding.
        press({key: '"', ctrlKey: true, shiftKey: true});
        expect(actions.peekSidebar).toHaveBeenCalledTimes(1);
        expect(actions.toggleSidebar).not.toHaveBeenCalled();
    });

    it('does not peek the sidebar on ctrl+apostrophe without shift', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: "'", ctrlKey: true});
        expect(actions.peekSidebar).not.toHaveBeenCalled();
    });
});
