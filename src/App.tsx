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
import type {ThemePref} from './components/ThemeSwitcher';
import {Workspace} from './components/Workspace';
import {useNotesFolder} from './hooks/useNotesFolder';

const toaster = new Toaster();

const THEME_KEY = 'gravity-notes:theme';

function initialTheme(): ThemePref {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}

export function App() {
    const [themePref, setThemePref] = useState<ThemePref>(initialTheme);
    const folder = useNotesFolder();

    useEffect(() => {
        localStorage.setItem(THEME_KEY, themePref);
    }, [themePref]);

    return (
        <ThemeProvider theme={themePref}>
            <MobileProvider>
                <ToasterProvider toaster={toaster}>
                    <ErrorBoundary>
                        {folder.state === 'ready' && folder.dir ? (
                            <Workspace
                                dir={folder.dir}
                                folderName={folder.folderName}
                                themePref={themePref}
                                onChangeThemePref={setThemePref}
                                onChangeFolder={() => void folder.forgetFolder()}
                            />
                        ) : (
                            <FolderGate folder={folder} />
                        )}
                    </ErrorBoundary>
                    <ToasterComponent />
                </ToasterProvider>
            </MobileProvider>
        </ThemeProvider>
    );
}
