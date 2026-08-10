import {useCallback, useEffect, useState} from 'react';

import type {NoteAppearanceOverride} from '../storage/types';

/**
 * Font family for note CONTENT — the block editor's body and the read-only preview. Never the app
 * chrome, and never the note title or the editor's H1/H2, which are PT Serif by design (§03 gives
 * the serif exactly three jobs; this setting owns only the third one). `sans` is the system font.
 */
export type EditorFont = 'sans' | 'serif' | 'mono';
/** Max text measure of the editor/preview column. `unlimited` = no cap (fills the pane). */
export type TextWidth = 'narrow' | 'normal' | 'wide' | 'unlimited';

/** Override variants add `'default'` — inherit the app value instead of overriding it. */
export type EditorFontPref = 'default' | EditorFont;
export type TextWidthPref = 'default' | TextWidth;

export const EDITOR_FONTS: readonly EditorFont[] = ['sans', 'serif', 'mono'];
export const TEXT_WIDTHS: readonly TextWidth[] = ['narrow', 'normal', 'wide', 'unlimited'];

/**
 * App-wide user preferences (persisted in localStorage, like theme/sidebar).
 *
 * Appearance is the whole of it: §08's Settings is one section, because the two engine rows it used
 * to carry ("Editor: Markdown/Blocks", "Show editor toolbar") configured a rich editor that no
 * longer exists, and theme lives in the orb menu where it always has.
 */
export interface Settings {
    /** Font for the editor body + preview (note content only). Default `sans` (the system font). */
    editorFont: EditorFont;
    /** Editor/preview text column width. Default `normal` (a readable measure). */
    textWidth: TextWidth;
}

const DEFAULTS: Settings = {
    editorFont: 'sans',
    textWidth: 'normal',
};

/**
 * Per-note overrides — the inner layer, which wins over the app value; `'default'` inherits.
 * Persisted in the metadata sidecar, NOT in localStorage, so it survives rename/move and travels
 * with the folder; see {@link noteAppearanceOf}.
 */
export interface NoteAppearance {
    editorFont: EditorFontPref;
    textWidth: TextWidthPref;
}

const NOTE_DEFAULTS: NoteAppearance = {
    editorFont: 'default',
    textWidth: 'default',
};

const SETTINGS_KEY = 'sol:settings';

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
        ? (value as T)
        : fallback;
}

/** Read persisted app settings, tolerating absent/corrupt storage and unknown keys (defaults fill gaps). */
function loadSettings(key: string): Settings {
    try {
        const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Settings>;
        return {
            editorFont: oneOf(raw.editorFont, EDITOR_FONTS, DEFAULTS.editorFont),
            textWidth: oneOf(raw.textWidth, TEXT_WIDTHS, DEFAULTS.textWidth),
        };
    } catch {
        return DEFAULTS;
    }
}

/** Field-wise equality over two same-shape settings objects (loaders always emit every field). */
function sameSettings<T extends object>(a: T, b: T): boolean {
    return (Object.keys(b) as (keyof T)[]).every((key) => a[key] === b[key]);
}

/**
 * A localStorage-backed settings object. The desktop app opens one window per workspace and every
 * window shares one localStorage, so a naive "persist my whole in-memory object on change" turns
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

export interface EffectiveAppearance {
    editorFont: EditorFont;
    textWidth: TextWidth;
}

/**
 * Resolve the appearance actually in effect: a note override wins over the app value, and
 * `'default'` inherits outward. Two layers, not three — the per-workspace layer is cut.
 */
export function effectiveAppearance(
    app: Settings,
    note: NoteAppearance = NOTE_DEFAULTS,
): EffectiveAppearance {
    return {
        editorFont: note.editorFont === 'default' ? app.editorFont : note.editorFont,
        textWidth: note.textWidth === 'default' ? app.textWidth : note.textWidth,
    };
}
