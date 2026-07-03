import {useCallback, useEffect, useRef, useState} from 'react';

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
 * `accentColor` is kept for a uniform override shape but is NOT exposed per-note (accent is
 * app/workspace only), so it stays `'default'` in practice.
 */
export interface NoteAppearance {
    editorFont: EditorFontPref;
    accentColor: AccentColorPref;
    textWidth: TextWidthPref;
}

const NOTE_DEFAULTS: NoteAppearance = {
    editorFont: 'default',
    accentColor: 'default',
    textWidth: 'default',
};

const SETTINGS_KEY = 'gravity-notes:settings';
/** Namespaced like the other per-workspace layout keys in `Workspace` (`gravity-notes:<wsId>:*`). */
const workspaceSettingsKey = (workspaceId: string) => `gravity-notes:${workspaceId}:settings`;
/** Per-note override key, nested under the workspace (a note id is only unique within its workspace). */
const noteSettingsKey = (workspaceId: string, noteId: string) =>
    `gravity-notes:${workspaceId}:note:${noteId}:appearance`;

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

/** Generic loader for an override layer (workspace / note): every field is a `'default'`-able pref. */
function loadOverrides<T extends WorkspaceSettings | NoteAppearance>(key: string, fallback: T): T {
    try {
        const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<T>;
        return {
            editorFont: oneOf(raw.editorFont, FONT_PREFS, fallback.editorFont),
            accentColor: oneOf(raw.accentColor, ACCENT_PREFS, fallback.accentColor),
            textWidth: oneOf(raw.textWidth, WIDTH_PREFS, fallback.textWidth),
        } as T;
    } catch {
        return fallback;
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
        loadOverrides(workspaceSettingsKey(workspaceId), WORKSPACE_DEFAULTS),
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

export interface UseNoteSettings {
    noteAppearance: NoteAppearance;
    setNoteSetting: <K extends keyof NoteAppearance>(key: K, value: NoteAppearance[K]) => void;
    resetNoteAppearance: () => void;
    /** True when at least one field overrides its inherited value (drives the "Reset" affordance). */
    isOverridden: boolean;
}

/**
 * Per-note appearance overrides for the OPEN note. Unlike the workspace hook, the note id changes
 * within a mounted `Workspace` (opening another note doesn't remount this), so it reloads on a
 * `noteId` change and persists imperatively in the setters — a persist-effect would clobber the new
 * note's key with the old note's value during the switch. `noteId` is null when no note is open.
 */
export function useNoteSettings(workspaceId: string, noteId: string | null): UseNoteSettings {
    const [noteAppearance, setNoteAppearance] = useState<NoteAppearance>(() =>
        noteId ? loadOverrides(noteSettingsKey(workspaceId, noteId), NOTE_DEFAULTS) : NOTE_DEFAULTS,
    );

    // Reload when the open note changes (no remount happens for a note switch).
    useEffect(() => {
        setNoteAppearance(
            noteId
                ? loadOverrides(noteSettingsKey(workspaceId, noteId), NOTE_DEFAULTS)
                : NOTE_DEFAULTS,
        );
    }, [workspaceId, noteId]);

    // Read latest via a ref so the setters can persist imperatively without a persist-effect (which
    // would fire on the reload above and write the wrong note's key mid-switch).
    const currentRef = useRef(noteAppearance);
    currentRef.current = noteAppearance;

    const setNoteSetting = useCallback(
        <K extends keyof NoteAppearance>(key: K, value: NoteAppearance[K]) => {
            if (!noteId || currentRef.current[key] === value) return;
            const next = {...currentRef.current, [key]: value};
            localStorage.setItem(noteSettingsKey(workspaceId, noteId), JSON.stringify(next));
            setNoteAppearance(next);
        },
        [workspaceId, noteId],
    );

    const resetNoteAppearance = useCallback(() => {
        if (!noteId) return;
        localStorage.removeItem(noteSettingsKey(workspaceId, noteId));
        setNoteAppearance(NOTE_DEFAULTS);
    }, [workspaceId, noteId]);

    // Accent is intentionally NOT exposed per-note (only app/workspace), so it never counts here even
    // though the field stays in the model to keep the override layers a uniform shape.
    const isOverridden =
        noteAppearance.editorFont !== 'default' || noteAppearance.textWidth !== 'default';

    return {noteAppearance, setNoteSetting, resetNoteAppearance, isOverridden};
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
 */
export function effectiveAppearance(
    app: Settings,
    workspace: WorkspaceSettings,
    note: NoteAppearance = NOTE_DEFAULTS,
): EffectiveAppearance {
    return {
        editorFont: resolve(app.editorFont, workspace.editorFont, note.editorFont),
        accentColor: resolve(app.accentColor, workspace.accentColor, note.accentColor),
        textWidth: resolve(app.textWidth, workspace.textWidth, note.textWidth),
    };
}
