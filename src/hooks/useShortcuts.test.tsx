import {renderHook} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {type ShortcutActions, useShortcuts} from './useShortcuts';

function makeActions(): ShortcutActions {
    return {
        focusSearch: vi.fn(),
        createNote: vi.fn(),
        toggleEditorMode: vi.fn(),
        openHelp: vi.fn(),
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

    it('focuses search on mod+k and prevents default', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const event = press({key: 'k', metaKey: true});
        expect(actions.focusSearch).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('creates a note on ctrl+j', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: 'j', ctrlKey: true});
        expect(actions.createNote).toHaveBeenCalledTimes(1);
    });

    it('toggles editor mode on mod+/', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: '/', metaKey: true});
        expect(actions.toggleEditorMode).toHaveBeenCalledTimes(1);
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
        expect(actions.createNote).toHaveBeenCalledTimes(1);
    });

    it('does not focus search on mod+k while typing in an input', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        press({key: 'k', metaKey: true});
        expect(actions.focusSearch).not.toHaveBeenCalled();
    });

    it('still creates a note on ctrl+j while typing in an input', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        press({key: 'j', ctrlKey: true});
        expect(actions.createNote).toHaveBeenCalledTimes(1);
    });
});
