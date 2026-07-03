import {useCallback, useEffect, useState} from 'react';

/**
 * Font family for note CONTENT — the WYSIWYG editor + read-only preview (both `.yfm`). Never the
 * app chrome or the raw Markup editor. `sans` is the native system font (San Francisco on macOS).
 */
export type EditorFont = 'sans' | 'serif' | 'mono';
/** Accent hue for the app mark: the orb menu, the saving-status dot, and the list-selection wash. */
export type AccentColor = 'amber' | 'blue' | 'gray';

/** Per-workspace variants add `'default'` — inherit the app-wide value instead of overriding it. */
export type EditorFontPref = 'default' | EditorFont;
export type AccentColorPref = 'default' | AccentColor;

export const EDITOR_FONTS: readonly EditorFont[] = ['sans', 'serif', 'mono'];
export const ACCENT_COLORS: readonly AccentColor[] = ['amber', 'blue', 'gray'];

/** App-wide user preferences (persisted in localStorage, like theme/sidebar). */
export interface Settings {
    /** Show the markdown editor's formatting toolbar (the surface is markdown-first, so off by default). */
    showEditorToolbar: boolean;
    /** Show a per-note icon in the list + the note title (experimental; the IconPicker feature). */
    showNoteIcons: boolean;
    /** Font for the editor + preview (note content only). Default `sans` (the system font). */
    editorFont: EditorFont;
    /** App accent hue. Default `amber` (the logo orange). */
    accentColor: AccentColor;
}

const DEFAULTS: Settings = {
    showEditorToolbar: false,
    showNoteIcons: false,
    editorFont: 'sans',
    accentColor: 'amber',
};

/** Per-workspace overrides of the appearance settings; `'default'` inherits the app-wide value. */
export interface WorkspaceSettings {
    editorFont: EditorFontPref;
    accentColor: AccentColorPref;
}

const WORKSPACE_DEFAULTS: WorkspaceSettings = {
    editorFont: 'default',
    accentColor: 'default',
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

/** Read persisted app settings, tolerating absent/corrupt storage and unknown keys (defaults fill gaps). */
function loadSettings(): Settings {
    try {
        const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
        return {
            showEditorToolbar: bool(raw.showEditorToolbar, DEFAULTS.showEditorToolbar),
            showNoteIcons: bool(raw.showNoteIcons, DEFAULTS.showNoteIcons),
            editorFont: oneOf(raw.editorFont, EDITOR_FONTS, DEFAULTS.editorFont),
            accentColor: oneOf(raw.accentColor, ACCENT_COLORS, DEFAULTS.accentColor),
        };
    } catch {
        return DEFAULTS;
    }
}

/** Read a workspace's overrides, tolerating absent/corrupt storage (defaults = inherit the app value). */
function loadWorkspaceSettings(workspaceId: string): WorkspaceSettings {
    try {
        const raw = JSON.parse(
            localStorage.getItem(workspaceSettingsKey(workspaceId)) ?? '{}',
        ) as Partial<WorkspaceSettings>;
        return {
            editorFont: oneOf(
                raw.editorFont,
                ['default', ...EDITOR_FONTS],
                WORKSPACE_DEFAULTS.editorFont,
            ),
            accentColor: oneOf(
                raw.accentColor,
                ['default', ...ACCENT_COLORS],
                WORKSPACE_DEFAULTS.accentColor,
            ),
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
        loadWorkspaceSettings(workspaceId),
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

export interface EffectiveAppearance {
    editorFont: EditorFont;
    accentColor: AccentColor;
}

/** Resolve the appearance actually in effect: a workspace override wins unless it's `'default'`. */
export function effectiveAppearance(
    app: Settings,
    workspace: WorkspaceSettings,
): EffectiveAppearance {
    return {
        editorFont: workspace.editorFont === 'default' ? app.editorFont : workspace.editorFont,
        accentColor: workspace.accentColor === 'default' ? app.accentColor : workspace.accentColor,
    };
}
