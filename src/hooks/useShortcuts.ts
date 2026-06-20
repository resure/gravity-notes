import {useEffect, useRef} from 'react';

import {SHORTCUTS, type ShortcutAction} from '../shortcuts';

export type ShortcutActions = Record<ShortcutAction, () => void>;

/** True when keystrokes should be left to the focused text surface. */
function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

/**
 * Global keyboard shortcuts, driven by the SHORTCUTS descriptor (the same source
 * the help dialog renders from). Command-modifier combos act regardless of focus
 * and preventDefault; bare keys (the `?` help key) are gated so they never steal a
 * keystroke from the editor or an input. List ↑/↓ navigation lives in NoteList.
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
            for (const {global: binding} of SHORTCUTS) {
                if (!binding) continue;
                if (binding.trigger === 'mod') {
                    if (
                        mod &&
                        !event.shiftKey &&
                        !event.altKey &&
                        event.key.toLowerCase() === binding.key
                    ) {
                        event.preventDefault();
                        actionsRef.current[binding.action]();
                        return;
                    }
                } else if (event.key === binding.key && !isTypingTarget(document.activeElement)) {
                    event.preventDefault();
                    actionsRef.current[binding.action]();
                    return;
                }
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
        // Intentional empty deps: listener binds once; latest actions always read via actionsRef.
    }, []);
}
