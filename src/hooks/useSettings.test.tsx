import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

import {
    type NoteAppearance,
    type Settings,
    effectiveAppearance,
    isNoteAppearanceOverridden,
    noteAppearanceOf,
    noteAppearanceToOverride,
    useSettings,
} from './useSettings';

const APP: Settings = {
    editorFont: 'serif',
    textWidth: 'wide',
};

const NOTE_DEFAULT: NoteAppearance = {
    editorFont: 'default',
    textWidth: 'default',
};

beforeEach(() => {
    localStorage.clear();
});

describe('effectiveAppearance', () => {
    it('inherits the app value when every override is "default"', () => {
        expect(effectiveAppearance(APP, NOTE_DEFAULT)).toEqual({
            editorFont: 'serif',
            textWidth: 'wide',
        });
    });

    it('lets a note override beat the app value, field by field', () => {
        const note: NoteAppearance = {editorFont: 'sans', textWidth: 'default'};
        expect(effectiveAppearance(APP, note)).toEqual({
            editorFont: 'sans', // note wins
            textWidth: 'wide', // note default → app
        });
    });

    it('defaults the note layer to all-inherit when omitted', () => {
        expect(effectiveAppearance(APP)).toEqual({
            editorFont: 'serif',
            textWidth: 'wide',
        });
    });
});

describe('useSettings', () => {
    it('defaults appearance to sans + normal width', () => {
        const {result} = renderHook(() => useSettings());
        expect(result.current.settings.editorFont).toBe('sans');
        expect(result.current.settings.textWidth).toBe('normal');
    });

    it('persists a changed appearance setting to localStorage', () => {
        const {result} = renderHook(() => useSettings());
        act(() => result.current.setSetting('textWidth', 'unlimited'));
        const stored = JSON.parse(localStorage.getItem('sol:settings') ?? '{}');
        expect(stored.textWidth).toBe('unlimited');
    });

    it('falls back to the default for an unknown stored enum value', () => {
        localStorage.setItem(
            'sol:settings',
            JSON.stringify({textWidth: 'gigantic', editorFont: 'comic'}),
        );
        const {result} = renderHook(() => useSettings());
        expect(result.current.settings.textWidth).toBe('normal');
        expect(result.current.settings.editorFont).toBe('sans');
    });

    it('merges a set into the freshest STORED object, so another window’s change survives', () => {
        const {result} = renderHook(() => useSettings());
        // Another window persists a font change after this window mounted — this window's
        // in-memory copy is now stale (same-document writes fire no storage event).
        localStorage.setItem('sol:settings', JSON.stringify({editorFont: 'mono'}));
        act(() => result.current.setSetting('textWidth', 'narrow'));
        const stored = JSON.parse(localStorage.getItem('sol:settings') ?? '{}');
        expect(stored.textWidth).toBe('narrow');
        expect(stored.editorFont).toBe('mono'); // NOT clobbered back to this window's stale sans
    });

    it('adopts another window’s write when its storage event arrives', () => {
        const {result} = renderHook(() => useSettings());
        act(() => {
            localStorage.setItem('sol:settings', JSON.stringify({editorFont: 'mono'}));
            window.dispatchEvent(new StorageEvent('storage', {key: 'sol:settings'}));
        });
        expect(result.current.settings.editorFont).toBe('mono');
    });
});

describe('noteAppearanceOf / noteAppearanceToOverride', () => {
    it('resolves an absent override to all-inherit and flags it not overridden', () => {
        expect(noteAppearanceOf(undefined)).toEqual(NOTE_DEFAULT);
        expect(isNoteAppearanceOverridden(noteAppearanceOf(undefined))).toBe(false);
    });

    it('resolves sidecar values and flags them overridden', () => {
        const appearance = noteAppearanceOf({editorFont: 'serif', textWidth: 'wide'});
        expect(appearance).toEqual({editorFont: 'serif', textWidth: 'wide'});
        expect(isNoteAppearanceOverridden(appearance)).toBe(true);
    });

    it('degrades unknown sidecar values (e.g. from a newer build) to inherit', () => {
        expect(noteAppearanceOf({editorFont: 'comic-sans', textWidth: 'gigantic'})).toEqual(
            NOTE_DEFAULT,
        );
    });

    it('round-trips through the override form, dropping "default" fields', () => {
        expect(noteAppearanceToOverride({editorFont: 'mono', textWidth: 'default'})).toEqual({
            editorFont: 'mono',
        });
        expect(noteAppearanceToOverride(NOTE_DEFAULT)).toEqual({});
        const full: NoteAppearance = {editorFont: 'serif', textWidth: 'narrow'};
        expect(noteAppearanceOf(noteAppearanceToOverride(full))).toEqual(full);
    });
});
