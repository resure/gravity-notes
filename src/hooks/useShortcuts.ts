import {useEffect, useRef} from 'react';

import {isTauri} from '../isTauri';
import {type GlobalBinding, SHORTCUTS, type ShortcutAction} from '../shortcuts';

export type ShortcutActions = Record<ShortcutAction, () => void>;

/** True when keystrokes should be left to the focused text surface. */
function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

/** Whether a modifier ('mod'/'ctrl') binding matches this keydown. */
function matchesChord(event: KeyboardEvent, binding: GlobalBinding): boolean {
    // 'mod' accepts either command modifier; 'ctrl' is the Control key alone (a ⌘-chord must
    // NOT satisfy it — ⌃R and ⌘R are distinct on macOS).
    const modifierOk =
        binding.trigger === 'mod'
            ? event.metaKey || event.ctrlKey
            : event.ctrlKey && !event.metaKey;
    // Prefer a physical-key (event.code) match when the binding specifies one; otherwise
    // compare event.key case-insensitively.
    const keyMatches = binding.code
        ? event.code === binding.code
        : event.key.toLowerCase() === binding.key.toLowerCase();
    return (
        modifierOk &&
        (binding.shift ? event.shiftKey : !event.shiftKey) &&
        !event.altKey &&
        keyMatches
    );
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
            // A modal dialog owns the keyboard while it's open — don't let global chords act on the
            // workspace behind it (e.g. ⌘N creating a stray note behind the ⌃R switcher, or ⌘⇧⌫
            // deleting a note behind a picker). Gravity modals render role="dialog" and unmount when
            // closed, so its presence means one is open. The dialog's own keys are handled by its
            // own listeners, not this hook.
            if (document.querySelector('[role="dialog"]')) return;
            const typing = isTypingTarget(document.activeElement);
            for (const {global: binding, desktopOnly} of SHORTCUTS) {
                if (!binding) continue;
                if (desktopOnly && !isTauri) continue; // desktop-shell chords stay free on the web
                if (Boolean(binding.capture) !== capturePhase) continue;
                const allowInTyping = binding.inTyping ?? binding.trigger !== 'bare';
                if (typing && !allowInTyping) continue;
                if (binding.trigger === 'mod' || binding.trigger === 'ctrl') {
                    if (matchesChord(event, binding)) {
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
