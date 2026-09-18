/**
 * Keep scrolling while a drag sits near the top or bottom of the editor's pane.
 *
 * The editor does not own a scrollbar — the pane above it does (see EditorPane), and hands its
 * element down — so this moves that pane rather than the window. Scrolling the WINDOW is what the
 * marquee used to do, which in this app scrolls nothing at all: a selection drag simply stopped at
 * the edge of the screen, and a block being dragged could never reach a drop point out of view.
 *
 * A pointer held still at the edge produces no further events, so the scrolling runs on its own
 * frame loop and the caller only keeps it fed with the latest position.
 */

/** How close to an edge the pointer has to be, and how far each frame moves. */
const EDGE_ZONE = 64;
const MAX_STEP = 18;

export interface EdgeScroller {
    /** Feed the pointer's viewport Y; starts or keeps the loop running. */
    to(clientY: number): void;
    stop(): void;
}

export function createEdgeScroller(container: () => HTMLElement | null): EdgeScroller {
    let frame: number | null = null;
    let pointerY = 0;
    // Resolved once per gesture: the pane cannot change mid-drag, and its VIEWPORT rect doesn't
    // move while only its own scrollTop does — where re-reading both per frame forced a style
    // recalc and a layout on every frame of every drag.
    let element: HTMLElement | null = null;
    let rect: DOMRect | null = null;

    const step = () => {
        frame = null;
        if (!element || !rect) return;
        // Ramped, not fixed: right at the edge it moves a full step, and it eases off as the
        // pointer comes back inside — so a drop two lines below the fold doesn't overshoot.
        const above = rect.top + EDGE_ZONE - pointerY;
        const below = pointerY - (rect.bottom - EDGE_ZONE);
        let delta = 0;
        if (above > 0) delta = -Math.ceil((Math.min(above, EDGE_ZONE) / EDGE_ZONE) * MAX_STEP);
        else if (below > 0) delta = Math.ceil((Math.min(below, EDGE_ZONE) / EDGE_ZONE) * MAX_STEP);
        if (delta === 0) return;
        const before = element.scrollTop;
        element.scrollTop = before + delta;
        // Stop at either end rather than spin a frame loop that moves nothing.
        if (element.scrollTop !== before) frame = requestAnimationFrame(step);
    };

    return {
        to(clientY: number) {
            pointerY = clientY;
            if (!element) {
                element = container();
                rect = element?.getBoundingClientRect() ?? null;
            }
            if (frame === null) frame = requestAnimationFrame(step);
        },
        stop() {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null;
            element = null;
            rect = null;
        },
    };
}
