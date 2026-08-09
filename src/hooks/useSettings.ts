import {useCallback, useEffect, useState} from 'react';

import type {NoteAppearanceOverride} from '../storage/types';

/**
 * Font family for note CONTENT — the WYSIWYG editor + read-only preview (both `.yfm`) and the note
 * title. Never the app chrome or the raw Markup editor. `sans` is the native system font.
 */
export type EditorFont = 'sans' | 'serif' | 'mono';
/** Max text measure of the editor/preview column. `unlimited` = no cap (fills the pane). */
export type TextWidth = 'narrow' | 'normal' | 'wide' | 'unlimited';

/** Override variants add `'default'` — inherit the wider scope's value instead of overriding it. */
export type EditorFontPref = 'default' | EditorFont;
export type TextWidthPref = 'default' | TextWidth;

export const EDITOR_FONTS: readonly EditorFont[] = ['sans', 'serif', 'mono'];
export const TEXT_WIDTHS: readonly TextWidth[] = ['narrow', 'normal', 'wide', 'unlimited'];

/** App-wide user preferences (persisted in localStorage, like theme/sidebar). */
export interface Settings {
    /** Show a per-note icon in the list + the note title (experimental; the IconPicker feature). */
    showNoteIcons: boolean;
    /** Font for the editor + preview + title (note content only). Default `sans` (the system font). */
    editorFont: EditorFont;
    /** Editor/preview text column width. Default `normal` (a readable measure). */
    textWidth: TextWidth;
}

const DEFAULTS: Settings = {
    showNoteIcons: false,
    editorFont: 'sans',
    textWidth: 'normal',
};

/** Per-workspace overrides of the appearance settings; `'default'` inherits the app-wide value. */
export interface WorkspaceSettings {
    editorFont: EditorFontPref;
    textWidth: TextWidthPref;
}

const WORKSPACE_DEFAULTS: WorkspaceSettings = {
    editorFont: 'default',
    textWidth: 'default',
};

/**
 * Per-note overrides — the innermost layer; wins over both workspace and app. `'default'` inherits.
 * Persisted in the metadata sidecar (like icons), NOT in localStorage,
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
const WIDTH_PREFS: readonly TextWidthPref[] = ['default', ...TEXT_WIDTHS];

/** Read persisted app settings, tolerating absent/corrupt storage and unknown keys (defaults fill gaps). */
function loadSettings(key: string): Settings {
    try {
        const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Settings>;
        return {
            showNoteIcons: bool(raw.showNoteIcons, DEFAULTS.showNoteIcons),
            editorFont: oneOf(raw.editorFont, EDITOR_FONTS, DEFAULTS.editorFont),
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
            textWidth: oneOf(raw.textWidth, WIDTH_PREFS, 'default'),
        };
    } catch {
        return WORKSPACE_DEFAULTS;
    }
}

/** Field-wise equality over two same-shape settings objects (loaders always emit every field). */
function sameSettings<T extends object>(a: T, b: T): boolean {
    return (Object.keys(b) as (keyof T)[]).every((key) => a[key] === b[key]);
}

/**
 * A localStorage-backed settings object — the shared machinery under {@link useSettings} and
 * {@link useWorkspaceSettings}. The desktop app opens one window per workspace and every window
 * shares one localStorage, so a naive "persist my whole in-memory object on change" turns
 * concurrent windows into lost updates (a stale window changing field A reverts another window's
 * field B). Instead:
 * - a set MERGES into the freshest STORED object (re-read at set time), so it can only change the
 *   field it was asked to change;
 * - a `storage` listener (fires in the OTHER windows) adopts external writes live.
 * `load` must be a stable module-level function — it sits in effect deps.
 */
function usePersistedSettings<T extends object>(
    storageKey: string,
    load: (key: string) => T,
): [T, <K extends keyof T>(key: K, value: T[K]) => void] {
    const [value, setValue] = useState<T>(() => load(storageKey));

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key !== null && event.key !== storageKey) return; // null = storage.clear()
            const next = load(storageKey);
            setValue((prev) => (sameSettings(prev, next) ? prev : next));
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [storageKey, load]);

    const set = useCallback(
        <K extends keyof T>(key: K, fieldValue: T[K]) => {
            const next = {...load(storageKey), [key]: fieldValue};
            try {
                localStorage.setItem(storageKey, JSON.stringify(next));
            } catch {
                // Quota/private-mode write failure: keep the in-memory change; it just won't stick.
            }
            setValue((prev) => (sameSettings(prev, next) ? prev : next));
        },
        [storageKey, load],
    );

    return [value, set];
}

export interface UseSettings {
    settings: Settings;
    setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

/** App settings state, persisted to localStorage on every change. */
export function useSettings(): UseSettings {
    const [settings, setSetting] = usePersistedSettings(SETTINGS_KEY, loadSettings);
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
    const [workspaceSettings, setWorkspaceSetting] = usePersistedSettings(
        workspaceSettingsKey(workspaceId),
        loadWorkspaceOverrides,
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

export interface LegacyNoteAppearances {
    /** id → migratable override (well-formed, non-empty). */
    overrides: Record<string, NoteAppearanceOverride>;
    /** EVERY legacy key found — including corrupt/empty ones — for the post-adoption clear pass. */
    keys: string[];
}

/** Read every legacy per-note override left for this workspace, in sidecar (override) form. */
export function readLegacyNoteAppearances(workspaceId: string): LegacyNoteAppearances {
    const overrides: Record<string, NoteAppearanceOverride> = {};
    const keys: string[] = [];
    for (const [id, key] of legacyNoteAppearanceKeys(workspaceId)) {
        keys.push(key);
        try {
            const raw = JSON.parse(
                localStorage.getItem(key) ?? '{}',
            ) as NoteAppearanceOverride | null;
            // Validate through the same lens as a live read (noteAppearanceOf), so the migration
            // and the sidecar reader can never disagree about which fields/values count.
            const override = noteAppearanceToOverride(noteAppearanceOf(raw ?? undefined));
            if (override.editorFont || override.textWidth) overrides[id] = override;
        } catch {
            // Corrupt value — nothing to migrate; the key is still in `keys` for the clear pass.
        }
    }
    return {overrides, keys};
}

/** Drop the legacy keys a {@link readLegacyNoteAppearances} pass found, once adoption has landed. */
export function clearLegacyNoteAppearanceKeys(keys: readonly string[]): void {
    for (const key of keys) {
        localStorage.removeItem(key);
    }
}

export interface EffectiveAppearance {
    editorFont: EditorFont;
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
        textWidth: resolve(app.textWidth, workspace.textWidth, note.textWidth),
    };
}
