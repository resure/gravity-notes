import {useCallback, useEffect, useState} from 'react';

/** User-toggleable app preferences (persisted in localStorage, like theme/sidebar). */
export interface Settings {
    /** Show the markdown editor's formatting toolbar (the surface is markdown-first, so off by default). */
    showEditorToolbar: boolean;
    /** Show a per-note icon in the list + the note title (experimental; the IconPicker feature). */
    showNoteIcons: boolean;
}

const DEFAULTS: Settings = {
    showEditorToolbar: false,
    showNoteIcons: false,
};

const SETTINGS_KEY = 'gravity-notes:settings';

/** Read persisted settings, tolerating absent/corrupt storage and unknown keys (defaults fill gaps). */
function loadSettings(): Settings {
    try {
        const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
        return {
            showEditorToolbar:
                typeof raw.showEditorToolbar === 'boolean'
                    ? raw.showEditorToolbar
                    : DEFAULTS.showEditorToolbar,
            showNoteIcons:
                typeof raw.showNoteIcons === 'boolean' ? raw.showNoteIcons : DEFAULTS.showNoteIcons,
        };
    } catch {
        return DEFAULTS;
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
