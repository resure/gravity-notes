import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

import {
    type Settings,
    type WorkspaceSettings,
    effectiveAppearance,
    useSettings,
    useWorkspaceSettings,
} from './useSettings';

const APP: Settings = {
    showEditorToolbar: false,
    showNoteIcons: false,
    editorFont: 'serif',
    accentColor: 'blue',
};

beforeEach(() => {
    localStorage.clear();
});

describe('effectiveAppearance', () => {
    it('inherits the app value when the workspace pref is "default"', () => {
        const ws: WorkspaceSettings = {editorFont: 'default', accentColor: 'default'};
        expect(effectiveAppearance(APP, ws)).toEqual({editorFont: 'serif', accentColor: 'blue'});
    });

    it('lets a non-default workspace pref override the app value, field by field', () => {
        const ws: WorkspaceSettings = {editorFont: 'mono', accentColor: 'default'};
        expect(effectiveAppearance(APP, ws)).toEqual({editorFont: 'mono', accentColor: 'blue'});
    });
});

describe('useSettings', () => {
    it('defaults the appearance settings to sans + amber', () => {
        const {result} = renderHook(() => useSettings());
        expect(result.current.settings.editorFont).toBe('sans');
        expect(result.current.settings.accentColor).toBe('amber');
    });

    it('persists a changed appearance setting to localStorage', () => {
        const {result} = renderHook(() => useSettings());
        act(() => result.current.setSetting('editorFont', 'serif'));
        act(() => result.current.setSetting('accentColor', 'gray'));
        const stored = JSON.parse(localStorage.getItem('gravity-notes:settings') ?? '{}');
        expect(stored.editorFont).toBe('serif');
        expect(stored.accentColor).toBe('gray');
    });

    it('falls back to the default for an unknown stored enum value', () => {
        localStorage.setItem(
            'gravity-notes:settings',
            JSON.stringify({editorFont: 'comic', accentColor: 'purple', showNoteIcons: true}),
        );
        const {result} = renderHook(() => useSettings());
        expect(result.current.settings.editorFont).toBe('sans');
        expect(result.current.settings.accentColor).toBe('amber');
        // Unrelated valid keys still load.
        expect(result.current.settings.showNoteIcons).toBe(true);
    });
});

describe('useWorkspaceSettings', () => {
    it('defaults both overrides to "default" (inherit the app value)', () => {
        const {result} = renderHook(() => useWorkspaceSettings('ws-1'));
        expect(result.current.workspaceSettings).toEqual({
            editorFont: 'default',
            accentColor: 'default',
        });
    });

    it('persists an override under the workspace-namespaced key only', () => {
        const {result} = renderHook(() => useWorkspaceSettings('ws-1'));
        act(() => result.current.setWorkspaceSetting('editorFont', 'mono'));
        const stored = JSON.parse(localStorage.getItem('gravity-notes:ws-1:settings') ?? '{}');
        expect(stored.editorFont).toBe('mono');
        // The global settings key is untouched.
        expect(localStorage.getItem('gravity-notes:settings')).toBeNull();
    });

    it('loads a previously saved override for its workspace', () => {
        localStorage.setItem(
            'gravity-notes:ws-2:settings',
            JSON.stringify({editorFont: 'serif', accentColor: 'blue'}),
        );
        const {result} = renderHook(() => useWorkspaceSettings('ws-2'));
        expect(result.current.workspaceSettings).toEqual({
            editorFont: 'serif',
            accentColor: 'blue',
        });
    });
});
