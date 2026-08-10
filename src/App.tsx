import {useEffect, useRef, useState} from 'react';

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
import {TooltipProvider} from './ui/Tooltip';
import {ToastRegion} from './ui/toast';

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

    // Mirror the resolved theme onto `<html data-theme>`, which is what every Sol token reads
    // (tokens.css). Resolving System here rather than in a CSS media query keeps ONE source of
    // truth for "what theme is showing" — the attribute is always the answer, so a rule never has
    // to be written twice. Runs alongside Gravity's ThemeProvider during the transition; when that
    // goes, this stops being a mirror and becomes the theme.
    useEffect(() => {
        const root = document.documentElement;
        if (themePref !== 'system') {
            root.setAttribute('data-theme', themePref);
            return undefined;
        }
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const apply = () => root.setAttribute('data-theme', media.matches ? 'dark' : 'light');
        apply();
        media.addEventListener('change', apply);
        return () => media.removeEventListener('change', apply);
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

    // ⌘0 (Window ▸ Main Window): surface the full workspace view for THIS window's workspace. The
    // listener lives HERE — App mounts exactly once per window and never remounts — rather than in
    // Workspace, which is keyed by workspace and remounts on every ⌃R switch: registering it there
    // leaked a duplicate listener per switch (the async listen/unlisten doesn't tear down cleanly
    // across rapid remounts), so a window ended up firing ⌘0 for several workspaces at once. One
    // stable listener per window, reading the live workspace/state through a ref, fixes that by
    // construction. `openInNewWindow` focuses the existing main/ws window for this workspace
    // (un-hiding a ⌘W-hidden main) or creates one; the fallback re-shows main when there's no
    // workspace to scope to (still bootstrapping, or parked on the gate after a failed probe).
    const storageRef = useRef(storage);
    storageRef.current = storage;
    useEffect(() => {
        if (!isTauri) return undefined;
        let unlisten: (() => void) | undefined;
        let disposed = false;
        const showMain = () =>
            void import('@tauri-apps/api/core').then(({invoke}) =>
                invoke('focus_main_window').catch(() => {}),
            );
        void import('@tauri-apps/api/webviewWindow').then(({getCurrentWebviewWindow}) =>
            getCurrentWebviewWindow()
                .listen('menu:main-window', () => {
                    const st = storageRef.current;
                    if (st.state === 'ready' && st.activeWorkspaceId) {
                        st.openInNewWindow(st.activeWorkspaceId).catch(showMain);
                    } else {
                        showMain();
                    }
                })
                .then((fn) => {
                    if (disposed) fn();
                    else unlisten = fn;
                }),
        );
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    return (
        <ThemeProvider theme={themePref}>
            <MobileProvider>
                <ToasterProvider toaster={toaster}>
                    {/* The new providers sit INSIDE the Gravity ones for the duration of the
                        migration: the toast region owns failures and the update prompt, the tooltip
                        provider owns §07's shared 420ms/0ms delay. Both leave the Gravity wrappers
                        behind in Pass 5 without moving. */}
                    <ToastRegion>
                        <TooltipProvider>
                            <ErrorBoundary>
                                {storage.state === 'ready' && storage.store ? (
                                    <Workspace
                                        // Keyed by workspace: switching remounts the whole tree, so every
                                        // per-workspace piece (list cursor, rail state, editor session,
                                        // corpus) starts clean instead of reconciling across workspaces.
                                        key={storage.activeWorkspaceId ?? 'workspace'}
                                        store={storage.store}
                                        workspaceId={storage.activeWorkspaceId ?? 'workspace'}
                                        storageLabel={storage.storageLabel}
                                        workspaces={storage.workspaces}
                                        // A single-note window's assigned note — only while it still
                                        // shows the workspace it was created for (an in-place workspace
                                        // switch remounts Workspace without a note assignment).
                                        initialNoteId={
                                            storage.windowNote &&
                                            storage.windowNote.workspaceId ===
                                                storage.activeWorkspaceId
                                                ? storage.windowNote.noteId
                                                : null
                                        }
                                        themePref={themePref}
                                        onChangeThemePref={setThemePref}
                                        onOpenWorkspace={storage.openWorkspace}
                                        onOpenWorkspaceInNewWindow={storage.openInNewWindow}
                                        onOpenNoteInNewWindow={storage.openNoteInNewWindow}
                                        onRemoveWorkspace={storage.removeWorkspace}
                                        onRefreshWorkspaces={storage.refreshWorkspaces}
                                        onOpenFolder={() => void storage.pickFolder()}
                                        onOpenFolderInNewWindow={storage.pickFolderForNewWindow}
                                        supportsFolders={storage.supportsFolders}
                                    />
                                ) : (
                                    <FolderGate storage={storage} />
                                )}
                            </ErrorBoundary>
                        </TooltipProvider>
                    </ToastRegion>
                    <ToasterComponent />
                </ToasterProvider>
            </MobileProvider>
        </ThemeProvider>
    );
}
