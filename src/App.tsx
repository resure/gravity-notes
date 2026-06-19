import {useCallback, useEffect, useState} from 'react';

import {
    MobileProvider,
    Theme,
    ThemeProvider,
    Toaster,
    ToasterComponent,
    ToasterProvider,
} from '@gravity-ui/uikit';

import {FolderGate} from './components/FolderGate';
import {Workspace} from './components/Workspace';
import {useNotesFolder} from './hooks/useNotesFolder';

const toaster = new Toaster();

const THEME_KEY = 'gravity-notes:theme';

function initialTheme(): Theme {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'dark' || saved === 'light' ? saved : 'light';
}

export function App() {
    const [theme, setTheme] = useState<Theme>(initialTheme);
    const folder = useNotesFolder();

    useEffect(() => {
        localStorage.setItem(THEME_KEY, theme);
    }, [theme]);

    const toggleTheme = useCallback(() => {
        setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
    }, []);

    return (
        <ThemeProvider theme={theme}>
            <MobileProvider>
                <ToasterProvider toaster={toaster}>
                    {folder.state === 'ready' && folder.dir ? (
                        <Workspace
                            dir={folder.dir}
                            folderName={folder.folderName}
                            theme={theme}
                            onToggleTheme={toggleTheme}
                            onChangeFolder={() => void folder.forgetFolder()}
                        />
                    ) : (
                        <FolderGate folder={folder} />
                    )}
                    <ToasterComponent />
                </ToasterProvider>
            </MobileProvider>
        </ThemeProvider>
    );
}
