import {useEffect, useRef} from 'react';

export interface ShortcutActions {
    focusSearch: () => void;
    createNote: () => void;
    toggleEditorMode: () => void;
    openHelp: () => void;
}

/** True when keystrokes should be left to the focused text surface. */
function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

/**
 * Global keyboard shortcuts. Command-modifier combos (⌘/Ctrl) act regardless of
 * focus and preventDefault; the `?` help key is gated so it never steals a typed
 * "?" inside the editor or an input. List ↑/↓ navigation lives in NoteList.
 *
 * Actions are read through a ref so the listener binds once and always calls the
 * latest callbacks, even though `Workspace` passes a fresh object each render.
 */
export function useShortcuts(actions: ShortcutActions): void {
    const actionsRef = useRef(actions);
    actionsRef.current = actions;

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.repeat) return; // a held key shouldn't fire the action repeatedly
            const mod = event.metaKey || event.ctrlKey;
            if (mod && !event.shiftKey && !event.altKey) {
                const key = event.key.toLowerCase();
                if (key === 'k') {
                    event.preventDefault();
                    actionsRef.current.focusSearch();
                    return;
                }
                if (key === 'j') {
                    event.preventDefault();
                    actionsRef.current.createNote();
                    return;
                }
                if (key === '/') {
                    event.preventDefault();
                    actionsRef.current.toggleEditorMode();
                    return;
                }
            }
            if (event.key === '?' && !isTypingTarget(document.activeElement)) {
                event.preventDefault();
                actionsRef.current.openHelp();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
        // Intentional empty deps: listener binds once; latest actions always read via actionsRef.
    }, []);
}
