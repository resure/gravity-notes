import {type Dispatch, type SetStateAction, useEffect, useRef, useState} from 'react';

/**
 * A row key rendered safe to use as an HTML `id`, for `aria-activedescendant`.
 *
 * An IDREF cannot contain whitespace, and the keys these listboxes carry are raw workspace ids and
 * folder paths (`tauri:/Users/me/Gravity Notes Demo`, `' root'`) — an id built straight from one
 * never resolves, so a screen reader announces nothing for the highlighted row. Hex-escaping the
 * unsafe characters keeps the mapping injective, so two different rows can't collide on one id.
 */
export function domIdPart(key: string): string {
    return key.replace(/[^A-Za-z0-9-]/g, (ch) => `_${ch.charCodeAt(0).toString(16)}`);
}

export interface ListboxNav {
    /** The highlighted row index (`-1` = nothing highlighted). */
    activeIndex: number;
    /** Set the highlight directly (callers own the pre-highlight / typeahead seeding). */
    setActiveIndex: Dispatch<SetStateAction<number>>;
    /** Ref callback for each rendered row, so the active row can be scrolled into view. */
    registerRow: (key: string, el: HTMLElement | null) => void;
}

interface Options<T> {
    /** Whether the owning dialog is open — the keydown listener is bound only while true. */
    open: boolean;
    /** The current (already-filtered) rows, most stable identity possible (a useMemo). */
    items: T[];
    /** Stable key per row (used for scroll-into-view lookup). */
    getKey: (item: T) => string;
    /** Rows that can't be committed/removed and are skipped by arrow navigation. */
    isDisabled: (item: T) => boolean;
    /** Commit the row at `index` (↵). The raw event is passed so ⌘↵ can branch. */
    onEnter: (index: number, event: KeyboardEvent) => void;
    /** ⌘⌫ on the row at `index`. Omit to disable removal. */
    onRemove?: (index: number) => void;
    /** Esc. */
    onClose: () => void;
}

/**
 * The shared keyboard model for a filter-over-listbox dialog — the ⌃R workspace switcher and the
 * ⌘⇧M move-to picker. Owns: a DOCUMENT-level keydown listener while open (↑/↓ move, ↵ commit,
 * ⌘⌫ remove, Esc close), skip-disabled highlight navigation with a range/disabled clamp when the
 * list changes, and scroll-the-active-row-into-view. Callers own filtering, rendering, and the
 * pre-highlight/typeahead seeding (via `setActiveIndex`).
 *
 * The listener is on `document`, not the filter input, because the dialog's focus manager can park
 * focus on the popup CONTAINER (or a row's ✕ button), where an input-scoped `onKeyDown` goes silent
 * — arrows/Enter dead. Pair with `initialFocus` on the Dialog so type-to-filter still lands in the
 * input.
 *
 * It listens in the CAPTURE phase, which is not optional: Base UI's dialog popup stops keydown
 * propagation at its own root (so a nested dialog's Escape can't also close its parent), and a
 * bubble-phase document listener therefore never fires for a key pressed inside the dialog. Capture
 * runs on the way DOWN, before the popup can swallow anything.
 */
export function useListboxNav<T>({
    open,
    items,
    getKey,
    isDisabled,
    onEnter,
    onRemove,
    onClose,
}: Options<T>): ListboxNav {
    const [activeIndex, setActiveIndex] = useState(-1);
    const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

    const registerRow = useRef((key: string, el: HTMLElement | null) => {
        if (el) rowRefs.current.set(key, el);
        else rowRefs.current.delete(key);
    }).current;

    // Keep the highlight on a SELECTABLE row when the list changes (e.g. a removal shifts a
    // disabled row under the cursor). An intentional "nothing highlighted" (-1) is left as-is; a
    // landed-on-disabled or fell-off-the-end index snaps to the nearest selectable (searching down
    // from the old position, then up).
    useEffect(() => {
        setActiveIndex((cur) => {
            if (cur < 0) return -1;
            if (cur < items.length && !isDisabled(items[cur])) return cur;
            for (let i = Math.min(cur, items.length - 1); i >= 0; i--) {
                if (!isDisabled(items[i])) return i;
            }
            for (let i = 0; i < items.length; i++) {
                if (!isDisabled(items[i])) return i;
            }
            return -1;
        });
        // Re-runs on the items identity; getKey/isDisabled are treated as stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items]);

    // Keep the active row in view as it moves.
    useEffect(() => {
        if (!open) return;
        const item = items[activeIndex];
        if (item) rowRefs.current.get(getKey(item))?.scrollIntoView?.({block: 'nearest'});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeIndex, items, open]);

    // Step the highlight to the next selectable row in `delta` direction (clamped, skips disabled).
    // From "nothing highlighted" (-1), ArrowDown lands on the first selectable row, ArrowUp the last.
    const move = (delta: number) => {
        setActiveIndex((cur) => {
            let start = cur;
            if (cur < 0) start = delta > 0 ? -1 : items.length;
            for (let i = start + delta; i >= 0 && i < items.length; i += delta) {
                if (!isDisabled(items[i])) return i;
            }
            return cur;
        });
    };

    // Rebound every render (via the ref) so the once-bound document listener reads fresh state.
    const handleKey = (event: KeyboardEvent) => {
        // An IME owns the keyboard while a composition is open: its candidate list uses the same
        // arrows and Enter this hook does. Skipping composition keystrokes matters MORE in the
        // capture phase, where we would otherwise beat every handler that might have stopped us —
        // typing kana into the filter would move the workspace highlight and commit a switch
        // instead of choosing a candidate. `keyCode === 229` is the legacy signal some IMEs
        // still send without `isComposing`.
        if (event.isComposing || event.keyCode === 229) return;
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                move(1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                move(-1);
                break;
            case 'Enter':
                event.preventDefault();
                onEnter(activeIndex, event);
                break;
            case 'Backspace':
                if (onRemove && event.metaKey) {
                    event.preventDefault();
                    onRemove(activeIndex);
                }
                break;
            case 'Escape':
                // The Modal's own dismiss also closes on Escape; keeping it here means the behavior
                // survives even if that path is ever configured away. onClose is idempotent.
                event.preventDefault();
                onClose();
                break;
        }
    };
    const handleKeyRef = useRef(handleKey);
    handleKeyRef.current = handleKey;
    useEffect(() => {
        if (!open) return undefined;
        const listener = (event: KeyboardEvent) => handleKeyRef.current(event);
        document.addEventListener('keydown', listener, true);
        return () => document.removeEventListener('keydown', listener, true);
    }, [open]);

    return {activeIndex, setActiveIndex, registerRow};
}
