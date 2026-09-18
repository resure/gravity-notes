import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties, RefObject} from 'react';

/**
 * A menu pinned to the thing that opened it: clamped into the viewport, and dismissed by anything
 * that means the reader has moved on.
 *
 * Both halves are subtle enough to be worth having once. The clamp is in VIEWPORT coordinates
 * because these overlays are `position: fixed` and portaled to `<body>` (see OverlayPortal). The
 * dismissal treats SCROLLING as a dismissal — a menu anchored to a button has nothing to follow once
 * its button moves — with the menu's own scrolling exempt, which took a bug to learn: "Turn into"
 * is taller than the menu's `max-height`, so scrolling down to Heading 6, or merely arrowing onto
 * it, closed the menu the reader was reading.
 *
 * The caret-anchored menus (the slash menu, the `[[` picker) deliberately do NOT use this: they
 * re-measure against the caret instead of closing.
 */
export function useAnchoredOverlay({
    x,
    y,
    flipGap = 24,
    remeasureKey,
    onClose,
    onPlaced,
}: {
    /** VIEWPORT coordinates of the control that opened the overlay. */
    x: number;
    y: number;
    /** Extra room to leave above the anchor when the overlay has to flip over it. */
    flipGap?: number;
    /** Re-run the placement when this changes — a menu that swaps pages changes height. */
    remeasureKey?: unknown;
    onClose: () => void;
    /** Called once the overlay has been placed, for whatever should take focus. */
    onPlaced?: (element: HTMLDivElement) => void;
}): {ref: RefObject<HTMLDivElement>; style: CSSProperties} {
    const ref = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<CSSProperties>({left: x, top: y, visibility: 'hidden'});
    // Held in a ref so a caller can pass a fresh closure per render without re-running placement.
    const placedRef = useRef(onPlaced);
    placedRef.current = onPlaced;

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        // Flip above the anchor when it would run off the bottom, slide in from the right edge.
        let top = y;
        if (top + element.offsetHeight > window.innerHeight - 12) {
            top = Math.max(12, top - element.offsetHeight - flipGap);
        }
        const left = Math.max(12, Math.min(x, window.innerWidth - element.offsetWidth - 12));
        setStyle({left, top, visibility: 'visible'});
        placedRef.current?.(element);
    }, [x, y, flipGap, remeasureKey]);

    useEffect(() => {
        const onMouseDown = (event: globalThis.MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) onClose();
        };
        const onScroll = (event: Event) => {
            const target = event.target;
            if (target instanceof Node && ref.current?.contains(target)) return;
            onClose();
        };
        document.addEventListener('mousedown', onMouseDown);
        // Captured: `scroll` does not bubble, and it is the PANE that scrolls, not the document.
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onClose);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onClose);
        };
    }, [onClose]);

    return {ref, style};
}
