import {useCallback, useEffect, useState} from 'react';

import type {NoteAppearanceOverride} from '../storage/types';

/**
 * Font family for note CONTENT — the WYSIWYG editor + read-only preview (both `.yfm`) and the note
 * title. Never the app chrome or the raw Markup editor. `sans` is the native system font.
 */
export type EditorFont = 'sans' | 'serif' | 'mono';
/** Accent hue for the app mark: the orb menu, the saving-status dot, and the list-selection wash. */
export type AccentColor = 'amber' | 'blue' | 'gray';
/** Max text measure of the editor/preview column. `unlimited` = no cap (fills the pane). */
export type TextWidth = 'narrow' | 'normal' | 'wide' | 'unlimited';

/** Override variants add `'default'` — inherit the wider scope's value instead of overriding it. */
export type EditorFontPref = 'default' | EditorFont;
export type AccentColorPref = 'default' | AccentColor;
export type TextWidthPref = 'default' | TextWidth;

export const EDITOR_FONTS: readonly EditorFont[] = ['sans', 'serif', 'mono'];
export const ACCENT_COLORS: readonly AccentColor[] = ['amber', 'blue', 'gray'];
export const TEXT_WIDTHS: readonly TextWidth[] = ['narrow', 'normal', 'wide', 'unlimited'];

/** App-wide user preferences (persisted in localStorage, like theme/sidebar). */
export interface Settings {
    /** Show the markdown editor's formatting toolbar (the surface is markdown-first, so off by default). */
    showEditorToolbar: boolean;
    /** Show a per-note icon in the list + the note title (experimental; the IconPicker feature). */
    showNoteIcons: boolean;
    /** Font for the editor + preview + title (note content only). Default `sans` (the system font). */
    editorFont: EditorFont;
    /** App accent hue. Default `amber` (the logo orange). */
    accentColor: AccentColor;
    /** Editor/preview text column width. Default `normal` (a readable measure). */
    textWidth: TextWidth;
}

const DEFAULTS: Settings = {
    showEditorToolbar: false,
    showNoteIcons: false,
    editorFont: 'sans',
    accentColor: 'amber',
    textWidth: 'normal',
};

/** Per-workspace overrides of the appearance settings; `'default'` inherits the app-wide value. */
export interface WorkspaceSettings {
    editorFont: EditorFontPref;
    accentColor: AccentColorPref;
    textWidth: TextWidthPref;
}

const WORKSPACE_DEFAULTS: WorkspaceSettings = {
    editorFont: 'default',
    accentColor: 'default',
    textWidth: 'default',
};

/**
 * Per-note overrides — the innermost layer; wins over both workspace and app. `'default'` inherits.
 * Accent is deliberately NOT overridable per-note (it's app/workspace only) — the app mark shouldn't
 * recolor as you browse notes. Persisted in the metadata sidecar (like icons), NOT in localStorage,
 * so it survives rename/move and travels with the folder; see {@link noteAppearanceOf}.
 */
export interface NoteAppearance {
    editorFont: EditorFontPref;
    textWidth: TextWidthPref;
}

const NOTE_DEFAULTS: NoteAppearance = {
    editorFont: 'default',
    textWidth: 'default',
};

const SETTINGS_KEY = 'gravity-notes:settings';
/** Namespaced like the other per-workspace layout keys in `Workspace` (`gravity-notes:<wsId>:*`). */
const workspaceSettingsKey = (workspaceId: string) => `gravity-notes:${workspaceId}:settings`;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
        ? (value as T)
        : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

const FONT_PREFS: readonly EditorFontPref[] = ['default', ...EDITOR_FONTS];
const ACCENT_PREFS: readonly AccentColorPref[] = ['default', ...ACCENT_COLORS];
const WIDTH_PREFS: readonly TextWidthPref[] = ['default', ...TEXT_WIDTHS];

/** Read persisted app settings, tolerating absent/corrupt storage and unknown keys (defaults fill gaps). */
function loadSettings(): Settings {
    try {
        const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
        return {
            showEditorToolbar: bool(raw.showEditorToolbar, DEFAULTS.showEditorToolbar),
            showNoteIcons: bool(raw.showNoteIcons, DEFAULTS.showNoteIcons),
            editorFont: oneOf(raw.editorFont, EDITOR_FONTS, DEFAULTS.editorFont),
            accentColor: oneOf(raw.accentColor, ACCENT_COLORS, DEFAULTS.accentColor),
            textWidth: oneOf(raw.textWidth, TEXT_WIDTHS, DEFAULTS.textWidth),
        };
    } catch {
        return DEFAULTS;
    }
}

/** Read the persisted per-workspace overrides: every field is a `'default'`-able pref. */
function loadWorkspaceOverrides(key: string): WorkspaceSettings {
    try {
        const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<WorkspaceSettings>;
        return {
            editorFont: oneOf(raw.editorFont, FONT_PREFS, 'default'),
            accentColor: oneOf(raw.accentColor, ACCENT_PREFS, 'default'),
            textWidth: oneOf(raw.textWidth, WIDTH_PREFS, 'default'),
        };
    } catch {
        return WORKSPACE_DEFAULTS;
    }
}

export interface UseSettings {
    settings: Settings;
    setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

/** App settings state, persisted to localStorage on every change. */
export function useSettings(): UseSettings {
    const [settings, setSettings] = useState<Settings>(loadSettings);

    useEffect(() => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }, [settings]);

    const setSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
        setSettings((prev) => (prev[key] === value ? prev : {...prev, [key]: value}));
    }, []);

    return {settings, setSetting};
}

export interface UseWorkspaceSettings {
    workspaceSettings: WorkspaceSettings;
    setWorkspaceSetting: <K extends keyof WorkspaceSettings>(
        key: K,
        value: WorkspaceSettings[K],
    ) => void;
}

/**
 * Per-workspace appearance overrides, persisted under a workspace-namespaced key. `App` remounts
 * `Workspace` keyed by workspace, so this hook mounts fresh per workspace and `workspaceId` (hence
 * the storage key) is constant for its lifetime — no cross-workspace reconcile to worry about.
 */
export function useWorkspaceSettings(workspaceId: string): UseWorkspaceSettings {
    const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings>(() =>
        loadWorkspaceOverrides(workspaceSettingsKey(workspaceId)),
    );

    useEffect(() => {
        localStorage.setItem(workspaceSettingsKey(workspaceId), JSON.stringify(workspaceSettings));
    }, [workspaceId, workspaceSettings]);

    const setWorkspaceSetting = useCallback(
        <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
            setWorkspaceSettings((prev) => (prev[key] === value ? prev : {...prev, [key]: value}));
        },
        [],
    );

    return {workspaceSettings, setWorkspaceSetting};
}

/**
 * Resolve a note's sidecar override (raw strings, absent field = inherit) to a validated
 * {@link NoteAppearance}. Unknown/absent values degrade to `'default'`, so a sidecar written by a
 * newer build can't inject an unsupported font/width. Pass `undefined` for "no override" / no note.
 */
export function noteAppearanceOf(override: NoteAppearanceOverride | undefined): NoteAppearance {
    return {
        editorFont: oneOf<EditorFontPref>(override?.editorFont, EDITOR_FONTS, 'default'),
        textWidth: oneOf<TextWidthPref>(override?.textWidth, TEXT_WIDTHS, 'default'),
    };
}

/** The sidecar form of a per-note appearance: only overridden fields, `'default'` becomes absent. */
export function noteAppearanceToOverride(appearance: NoteAppearance): NoteAppearanceOverride {
    const override: NoteAppearanceOverride = {};
    if (appearance.editorFont !== 'default') override.editorFont = appearance.editorFont;
    if (appearance.textWidth !== 'default') override.textWidth = appearance.textWidth;
    return override;
}

/** True when at least one field overrides its inherited value (drives the "Reset" affordance). */
export function isNoteAppearanceOverridden(appearance: NoteAppearance): boolean {
    return appearance.editorFont !== 'default' || appearance.textWidth !== 'default';
}

/**
 * Legacy migration: per-note appearance used to live in localStorage under
 * `gravity-notes:<wsId>:note:<noteId>:appearance`, which silently stranded the override whenever a
 * rename/move changed the note's id (the id IS its rel-path). It now lives in the metadata sidecar;
 * `Workspace` folds any leftover keys in once per workspace, then clears them.
 */
const legacyNoteKeyPrefix = (workspaceId: string) => `gravity-notes:${workspaceId}:note:`;
const LEGACY_NOTE_KEY_SUFFIX = ':appearance';

function legacyNoteAppearanceKeys(workspaceId: string): Map<string, string> {
    const prefix = legacyNoteKeyPrefix(workspaceId);
    const byId = new Map<string, string>();
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(prefix) || !key.endsWith(LEGACY_NOTE_KEY_SUFFIX)) continue;
        const id = key.slice(prefix.length, -LEGACY_NOTE_KEY_SUFFIX.length);
        if (id) byId.set(id, key);
    }
    return byId;
}

/** Read every legacy per-note override left for this workspace, in sidecar (override) form. */
export function readLegacyNoteAppearances(
    workspaceId: string,
): Record<string, NoteAppearanceOverride> {
    const overrides: Record<string, NoteAppearanceOverride> = {};
    for (const [id, key] of legacyNoteAppearanceKeys(workspaceId)) {
        try {
            const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
            const override = noteAppearanceToOverride({
                editorFont: oneOf<EditorFontPref>(raw.editorFont, EDITOR_FONTS, 'default'),
                textWidth: oneOf<TextWidthPref>(raw.textWidth, TEXT_WIDTHS, 'default'),
            });
            if (override.editorFont || override.textWidth) overrides[id] = override;
        } catch {
            // Corrupt value — nothing to migrate; the key still goes with the clear pass.
        }
    }
    return overrides;
}

/** Drop every legacy per-note override key for this workspace (after a successful migration). */
export function clearLegacyNoteAppearances(workspaceId: string): void {
    for (const key of legacyNoteAppearanceKeys(workspaceId).values()) {
        localStorage.removeItem(key);
    }
}

export interface EffectiveAppearance {
    editorFont: EditorFont;
    accentColor: AccentColor;
    textWidth: TextWidth;
}

/** Resolve one field across the layers: note wins, then workspace, then app (skipping `'default'`). */
function resolve<T extends string>(app: T, workspace: 'default' | T, note: 'default' | T): T {
    if (note !== 'default') return note;
    if (workspace !== 'default') return workspace;
    return app;
}

/**
 * Resolve the appearance actually in effect across app → workspace → note. A note override wins over
 * a workspace override, which wins over the app value; `'default'` at any layer inherits outward.
 * Accent has no note layer (it's app/workspace only), so it resolves across the outer two.
 */
export function effectiveAppearance(
    app: Settings,
    workspace: WorkspaceSettings,
    note: NoteAppearance = NOTE_DEFAULTS,
): EffectiveAppearance {
    return {
        editorFont: resolve(app.editorFont, workspace.editorFont, note.editorFont),
        accentColor: resolve<AccentColor>(app.accentColor, workspace.accentColor, 'default'),
        textWidth: resolve(app.textWidth, workspace.textWidth, note.textWidth),
    };
}
