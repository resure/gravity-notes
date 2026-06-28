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
