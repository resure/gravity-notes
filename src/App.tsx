import {useEffect, useState} from 'react';

import {
    MobileProvider,
    ThemeProvider,
    Toaster,
    ToasterComponent,
    ToasterProvider,
} from '@gravity-ui/uikit';

import {ErrorBoundary} from './components/ErrorBoundary';
import {FolderGate} from './components/FolderGate';
import {Workspace} from './components/Workspace';
import type {ThemePref} from './components/theme';
import {useNotesStorage} from './hooks/useNotesStorage';
import {isTauri} from './isTauri';

const toaster = new Toaster();

const THEME_KEY = 'gravity-notes:theme';

function initialTheme(): ThemePref {
    // Reads in App's body, before the ErrorBoundary mounts — a throw here (e.g. private mode where
    // localStorage access is denied) would blank the page, so swallow it and fall back to 'system'.
    try {
        const saved = localStorage.getItem(THEME_KEY);
        return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
    } catch {
        return 'system';
    }
}

export function App() {
    const [themePref, setThemePref] = useState<ThemePref>(initialTheme);
    const storage = useNotesStorage();

    useEffect(() => {
        // Persisting the theme is best-effort; a denied localStorage (private mode) must not crash.
        try {
            localStorage.setItem(THEME_KEY, themePref);
        } catch {
            // ignore — the theme just won't survive a reload
        }
    }, [themePref]);

    // Drive the NATIVE window's appearance to match the in-app theme on desktop. The Rust shell reads
    // the OS appearance at setup (it can't see the webview's theme pref before first paint), so without
    // this a user whose app theme differs from the OS sees the native frame — and the anti-flash
    // backdrop `set_background_color` paints in `src-tauri` — in the wrong color (a flash on launch and
    // a mismatched band during resize). `setTheme(null)` lets 'system' follow the OS. Desktop-only
    // (isTauri-guarded) and dynamically imported so the window API never enters the web bundle.
    useEffect(() => {
        if (!isTauri) return;
        void import('@tauri-apps/api/window')
            .then(({getCurrentWindow}) =>
                getCurrentWindow().setTheme(themePref === 'system' ? null : themePref),
            )
            .catch(() => {});
    }, [themePref]);

    return (
        <ThemeProvider theme={themePref}>
            <MobileProvider>
                <ToasterProvider toaster={toaster}>
                    <ErrorBoundary>
                        {storage.state === 'ready' && storage.store ? (
                            <Workspace
                                store={storage.store}
                                storageLabel={storage.storageLabel}
                                themePref={themePref}
                                onChangeThemePref={setThemePref}
                                onChangeStorage={() => void storage.reset()}
                            />
                        ) : (
                            <FolderGate storage={storage} />
                        )}
                    </ErrorBoundary>
                    <ToasterComponent />
                </ToasterProvider>
            </MobileProvider>
        </ThemeProvider>
    );
}
