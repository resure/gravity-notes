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
        // Each phase owns the bindings whose `capture` flag matches it: capture-phase bindings (e.g.
        // ⌘[/⌘]) preempt the editor and stopPropagation; everything else runs on bubble as before.
        const tryHandle = (event: KeyboardEvent, capturePhase: boolean): void => {
            if (event.repeat) return; // a held key shouldn't fire the action repeatedly
            const mod = event.metaKey || event.ctrlKey;
            const typing = isTypingTarget(document.activeElement);
            for (const {global: binding} of SHORTCUTS) {
                if (!binding) continue;
                if (Boolean(binding.capture) !== capturePhase) continue;
                const allowInTyping = binding.inTyping ?? binding.trigger === 'mod';
                if (typing && !allowInTyping) continue;
                if (binding.trigger === 'mod') {
                    // Prefer a physical-key (event.code) match when the binding specifies one;
                    // otherwise compare event.key case-insensitively.
                    const keyMatches = binding.code
                        ? event.code === binding.code
                        : event.key.toLowerCase() === binding.key.toLowerCase();
                    if (
                        mod &&
                        (binding.shift ? event.shiftKey : !event.shiftKey) &&
                        !event.altKey &&
                        keyMatches
                    ) {
                        event.preventDefault();
                        if (capturePhase) event.stopPropagation(); // keep it from reaching the editor
                        actionsRef.current[binding.action]();
                        return;
                    }
                } else if (event.key === binding.key) {
                    event.preventDefault();
                    if (capturePhase) event.stopPropagation();
                    actionsRef.current[binding.action]();
                    return;
                }
            }
        };
        const onCapture = (event: KeyboardEvent) => tryHandle(event, true);
        const onBubble = (event: KeyboardEvent) => tryHandle(event, false);
        document.addEventListener('keydown', onCapture, true);
        document.addEventListener('keydown', onBubble);
        return () => {
            document.removeEventListener('keydown', onCapture, true);
            document.removeEventListener('keydown', onBubble);
        };
        // Intentional empty deps: listeners bind once; latest actions always read via actionsRef.
    }, []);
}
