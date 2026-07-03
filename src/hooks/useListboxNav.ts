import {type Dispatch, type SetStateAction, useEffect, useRef, useState} from 'react';

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
 * The listener is on `document`, not the filter input, because Gravity's `Dialog` wraps its content
 * in a floating-ui FocusManager that can park focus on the dialog CONTAINER (or a row's ✕ button),
 * where an input-scoped `onKeyDown` goes silent — arrows/Enter dead. Pair with `initialFocus` on the
 * Dialog so type-to-filter still lands in the input.
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
        document.addEventListener('keydown', listener);
        return () => document.removeEventListener('keydown', listener);
    }, [open]);

    return {activeIndex, setActiveIndex, registerRow};
}
