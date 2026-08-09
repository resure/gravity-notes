import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

import {
    type NoteAppearance,
    type Settings,
    type WorkspaceSettings,
    clearLegacyNoteAppearanceKeys,
    effectiveAppearance,
    isNoteAppearanceOverridden,
    noteAppearanceOf,
    noteAppearanceToOverride,
    readLegacyNoteAppearances,
    useSettings,
    useWorkspaceSettings,
} from './useSettings';

const APP: Settings = {
    showEditorToolbar: false,
    showNoteIcons: false,
    editorFont: 'serif',
    accentColor: 'blue',
    textWidth: 'wide',
    editorEngine: 'rich',
};

const WS_DEFAULT: WorkspaceSettings = {
    editorFont: 'default',
    accentColor: 'default',
    textWidth: 'default',
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
        expect(effectiveAppearance(APP, WS_DEFAULT, NOTE_DEFAULT)).toEqual({
            editorFont: 'serif',
            accentColor: 'blue',
            textWidth: 'wide',
        });
    });

    it('lets a workspace override beat the app value, field by field', () => {
        const ws: WorkspaceSettings = {
            editorFont: 'mono',
            accentColor: 'default',
            textWidth: 'narrow',
        };
        expect(effectiveAppearance(APP, ws, NOTE_DEFAULT)).toEqual({
            editorFont: 'mono',
            accentColor: 'blue',
            textWidth: 'narrow',
        });
    });

    it('lets a note override beat both workspace and app (note wins; accent has no note layer)', () => {
        const ws: WorkspaceSettings = {
            editorFont: 'mono',
            accentColor: 'gray',
            textWidth: 'narrow',
        };
        const note: NoteAppearance = {
            editorFont: 'sans',
            textWidth: 'default',
        };
        expect(effectiveAppearance(APP, ws, note)).toEqual({
            editorFont: 'sans', // note wins
            accentColor: 'gray', // app ← workspace (never per-note)
            textWidth: 'narrow', // note default → workspace
        });
    });

    it('defaults the note layer to all-inherit when omitted', () => {
        expect(effectiveAppearance(APP, WS_DEFAULT)).toEqual({
            editorFont: 'serif',
            accentColor: 'blue',
            textWidth: 'wide',
        });
    });
});

describe('useSettings', () => {
    it('defaults appearance to sans + amber + normal width', () => {
        const {result} = renderHook(() => useSettings());
        expect(result.current.settings.editorFont).toBe('sans');
        expect(result.current.settings.accentColor).toBe('amber');
        expect(result.current.settings.textWidth).toBe('normal');
    });

    it('persists a changed appearance setting to localStorage', () => {
        const {result} = renderHook(() => useSettings());
        act(() => result.current.setSetting('textWidth', 'unlimited'));
        const stored = JSON.parse(localStorage.getItem('gravity-notes:settings') ?? '{}');
        expect(stored.textWidth).toBe('unlimited');
    });

    it('falls back to the default for an unknown stored enum value', () => {
        localStorage.setItem(
            'gravity-notes:settings',
            JSON.stringify({textWidth: 'gigantic', editorFont: 'comic'}),
        );
        const {result} = renderHook(() => useSettings());
        expect(result.current.settings.textWidth).toBe('normal');
        expect(result.current.settings.editorFont).toBe('sans');
    });

    it('merges a set into the freshest STORED object, so another window’s change survives', () => {
        const {result} = renderHook(() => useSettings());
        // Another window persists an accent change after this window mounted — this window's
        // in-memory copy is now stale (same-document writes fire no storage event).
        localStorage.setItem('gravity-notes:settings', JSON.stringify({accentColor: 'blue'}));
        act(() => result.current.setSetting('showEditorToolbar', true));
        const stored = JSON.parse(localStorage.getItem('gravity-notes:settings') ?? '{}');
        expect(stored.showEditorToolbar).toBe(true);
        expect(stored.accentColor).toBe('blue'); // NOT clobbered back to this window's stale amber
    });

    it('adopts another window’s write when its storage event arrives', () => {
        const {result} = renderHook(() => useSettings());
        act(() => {
            localStorage.setItem('gravity-notes:settings', JSON.stringify({accentColor: 'gray'}));
            window.dispatchEvent(new StorageEvent('storage', {key: 'gravity-notes:settings'}));
        });
        expect(result.current.settings.accentColor).toBe('gray');
    });
});

describe('useWorkspaceSettings', () => {
    it('defaults every override to "default" (inherit the app value)', () => {
        const {result} = renderHook(() => useWorkspaceSettings('ws-1'));
        expect(result.current.workspaceSettings).toEqual(WS_DEFAULT);
    });

    it('persists an override under the workspace-namespaced key only', () => {
        const {result} = renderHook(() => useWorkspaceSettings('ws-1'));
        act(() => result.current.setWorkspaceSetting('textWidth', 'wide'));
        const stored = JSON.parse(localStorage.getItem('gravity-notes:ws-1:settings') ?? '{}');
        expect(stored.textWidth).toBe('wide');
        expect(localStorage.getItem('gravity-notes:settings')).toBeNull();
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

describe('legacy per-note appearance migration', () => {
    const key = (id: string) => `gravity-notes:ws-1:note:${id}:appearance`;

    it('reads legacy keys as overrides, skipping all-default and corrupt values — but lists every key', () => {
        localStorage.setItem(
            key('Work/Plan.md'),
            JSON.stringify({editorFont: 'serif', accentColor: 'default', textWidth: 'default'}),
        );
        localStorage.setItem(
            key('Idle.md'),
            JSON.stringify({editorFont: 'default', accentColor: 'default', textWidth: 'default'}),
        );
        localStorage.setItem(key('Broken.md'), 'not json{');
        localStorage.setItem('gravity-notes:ws-2:note:Other.md:appearance', '{}'); // other workspace
        const legacy = readLegacyNoteAppearances('ws-1');
        expect(legacy.overrides).toEqual({
            'Work/Plan.md': {editorFont: 'serif'},
        });
        // All-default and corrupt entries carry nothing to migrate, but their keys still get cleared.
        expect([...legacy.keys].sort()).toEqual(
            [key('Work/Plan.md'), key('Idle.md'), key('Broken.md')].sort(),
        );
    });

    it('handles a note title containing the key separator', () => {
        localStorage.setItem(key('Meeting: notes.md'), JSON.stringify({textWidth: 'wide'}));
        expect(readLegacyNoteAppearances('ws-1').overrides).toEqual({
            'Meeting: notes.md': {textWidth: 'wide'},
        });
    });

    it('clearLegacyNoteAppearanceKeys removes exactly the keys the read pass found', () => {
        localStorage.setItem(key('A.md'), JSON.stringify({editorFont: 'mono'}));
        localStorage.setItem(key('B.md'), 'junk');
        localStorage.setItem('gravity-notes:ws-2:note:C.md:appearance', '{}');
        localStorage.setItem('gravity-notes:ws-1:settings', '{}');
        clearLegacyNoteAppearanceKeys(readLegacyNoteAppearances('ws-1').keys);
        expect(localStorage.getItem(key('A.md'))).toBeNull();
        expect(localStorage.getItem(key('B.md'))).toBeNull();
        expect(localStorage.getItem('gravity-notes:ws-2:note:C.md:appearance')).not.toBeNull();
        expect(localStorage.getItem('gravity-notes:ws-1:settings')).not.toBeNull();
    });
});
