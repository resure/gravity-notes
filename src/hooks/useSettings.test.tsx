import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

import {
    type NoteAppearance,
    type Settings,
    type WorkspaceSettings,
    effectiveAppearance,
    useNoteSettings,
    useSettings,
    useWorkspaceSettings,
} from './useSettings';

const APP: Settings = {
    showEditorToolbar: false,
    showNoteIcons: false,
    editorFont: 'serif',
    accentColor: 'blue',
    textWidth: 'wide',
};

const WS_DEFAULT: WorkspaceSettings = {
    editorFont: 'default',
    accentColor: 'default',
    textWidth: 'default',
};

const NOTE_DEFAULT: NoteAppearance = {
    editorFont: 'default',
    accentColor: 'default',
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

    it('lets a note override beat both workspace and app (note wins)', () => {
        const ws: WorkspaceSettings = {
            editorFont: 'mono',
            accentColor: 'gray',
            textWidth: 'narrow',
        };
        const note: NoteAppearance = {
            editorFont: 'sans',
            accentColor: 'default',
            textWidth: 'default',
        };
        expect(effectiveAppearance(APP, ws, note)).toEqual({
            editorFont: 'sans', // note wins
            accentColor: 'gray', // note default → workspace
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

describe('useNoteSettings', () => {
    it('defaults every field to "default" and reports not overridden', () => {
        const {result} = renderHook(() => useNoteSettings('ws-1', 'Note.md'));
        expect(result.current.noteAppearance).toEqual(NOTE_DEFAULT);
        expect(result.current.isOverridden).toBe(false);
    });

    it('persists an override under the per-note key and flags overridden', () => {
        const {result} = renderHook(() => useNoteSettings('ws-1', 'Work/Plan.md'));
        act(() => result.current.setNoteSetting('editorFont', 'serif'));
        const stored = JSON.parse(
            localStorage.getItem('gravity-notes:ws-1:note:Work/Plan.md:appearance') ?? '{}',
        );
        expect(stored.editorFont).toBe('serif');
        expect(result.current.isOverridden).toBe(true);
    });

    it('reloads when the open note changes', () => {
        localStorage.setItem(
            'gravity-notes:ws-1:note:B.md:appearance',
            JSON.stringify({editorFont: 'mono', accentColor: 'default', textWidth: 'default'}),
        );
        const {result, rerender} = renderHook(({id}) => useNoteSettings('ws-1', id), {
            initialProps: {id: 'A.md'},
        });
        expect(result.current.noteAppearance.editorFont).toBe('default');
        rerender({id: 'B.md'});
        expect(result.current.noteAppearance.editorFont).toBe('mono');
    });

    it('reset clears the override and removes the key', () => {
        const {result} = renderHook(() => useNoteSettings('ws-1', 'A.md'));
        act(() => result.current.setNoteSetting('accentColor', 'blue'));
        expect(localStorage.getItem('gravity-notes:ws-1:note:A.md:appearance')).not.toBeNull();
        act(() => result.current.resetNoteAppearance());
        expect(result.current.noteAppearance).toEqual(NOTE_DEFAULT);
        expect(localStorage.getItem('gravity-notes:ws-1:note:A.md:appearance')).toBeNull();
    });

    it('is a no-op when no note is open (null id)', () => {
        const {result} = renderHook(() => useNoteSettings('ws-1', null));
        act(() => result.current.setNoteSetting('editorFont', 'serif'));
        expect(result.current.noteAppearance).toEqual(NOTE_DEFAULT);
    });
});
