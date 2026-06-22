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
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}

export function App() {
    const [themePref, setThemePref] = useState<ThemePref>(initialTheme);
    const storage = useNotesStorage();

    useEffect(() => {
        localStorage.setItem(THEME_KEY, themePref);
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
