import {useCallback, useEffect, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent} from 'react';

import './PanelResizer.css';

// One shared range for both panels (the rail and the list read as one family; per-panel ranges
// would make equal-feeling drags stop at different places). The stylesheet defaults (200/280 in
// Workspace.css) sit comfortably inside it.
export const PANEL_MIN_WIDTH = 160;
export const PANEL_MAX_WIDTH = 480;

/** Arrow-key resize step on a focused divider. */
const KEYBOARD_STEP = 16;

/** Marks a live divider drag on <body>: app-wide col-resize cursor + no text selection. */
const DRAGGING_BODY_CLASS = 'panel-resizing';

/**
 * Clamp a panel width into the shared range, optionally tightened by a gesture-time `max` (the
 * "leave the editor room" cap). A cap below the minimum loses: a tiny window must not wedge the
 * divider into an undraggable dead state. Rounded — a fractional clientX delta must not commit a
 * fractional width (symmetric with parsePanelWidth, which rounds what it reads back).
 */
export function clampPanelWidth(width: number, max = PANEL_MAX_WIDTH): number {
    return Math.round(
        Math.min(
            Math.max(width, PANEL_MIN_WIDTH),
            Math.max(Math.min(max, PANEL_MAX_WIDTH), PANEL_MIN_WIDTH),
        ),
    );
}

/**
 * Parse a persisted panel width. Anything non-numeric → null (= stylesheet default), anything
 * numeric is clamped into range — localStorage contents are user-editable and must not be able
 * to break the layout.
 */
export function parsePanelWidth(raw: string | null): number | null {
    if (raw === null || raw.trim() === '') return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return clampPanelWidth(Math.round(value));
}

interface PanelResizerProps {
    /** Accessible name for the separator ("Resize folder rail" / "Resize note list"). */
    label: string;
    /** Committed width of the panel this divider resizes — the panel to its LEFT. */
    width: number;
    /**
     * Gesture-time upper bound, sampled once at drag start (and per keypress): how wide the panel
     * may get before the editor drops under its minimum. Omitted → the shared max alone.
     */
    getMaxWidth?: () => number;
    /** Live width during a drag, every pointer move — apply it, don't persist it. */
    onResize: (width: number) => void;
    /** Final width — pointer release or a keyboard step. Persist here. */
    onCommit: (width: number) => void;
    /** Double-click: back to the stylesheet default. */
    onReset: () => void;
}

/**
 * A draggable divider between two panes: a 7px hit strip straddling the 1px border the left
 * panel already draws, consuming no layout width of its own. Follows the WAI-ARIA window
 * splitter pattern — focusable, arrows resize, Home/End jump to the range edges — with
 * double-click resetting to the default width.
 */
export function PanelResizer({
    label,
    width,
    getMaxWidth,
    onResize,
    onCommit,
    onReset,
}: PanelResizerProps) {
    const [dragging, setDragging] = useState(false);
    // Gesture state lives in a ref: pointer moves must not re-render the divider, and the cap is
    // frozen at drag start (mid-drag window resizes are not worth chasing).
    const drag = useRef<{startX: number; startWidth: number; max: number; last: number} | null>(
        null,
    );

    const gestureMax = useCallback(
        () => (getMaxWidth ? getMaxWidth() : PANEL_MAX_WIDTH),
        [getMaxWidth],
    );

    // Read through a ref so the cleanup below can stay on [dragging] alone. Naming onCommit as a
    // dep would make the cleanup fire on any identity change — and it TEARS DOWN A LIVE GESTURE
    // (nulls `drag`), so a caller passing an inline lambda would break dragging the moment its
    // parent re-rendered: a premature commit, the rest of the gesture ignored, and — because
    // endDrag then returns early and never clears `dragging` — the body class stuck on, leaving
    // the whole app in col-resize/no-select. Today's callers happen to pass useState setters;
    // that must not be load-bearing.
    const onCommitRef = useRef(onCommit);
    onCommitRef.current = onCommit;

    // The body class and a pending commit outlive the component only if it unmounts mid-drag —
    // ⌘⇧\ closing the rail under a held divider is the real case (Workspace stays mounted, so
    // the inline var it wrote survives with no matching state until a reload). No pointerup will
    // arrive, so the cleanup both drops the class and commits the width the DOM already shows.
    // On a normal release endDrag has already nulled the gesture, so the commit is a no-op.
    useEffect(() => {
        if (!dragging) return undefined;
        document.body.classList.add(DRAGGING_BODY_CLASS);
        return () => {
            document.body.classList.remove(DRAGGING_BODY_CLASS);
            const pending = drag.current;
            drag.current = null;
            if (pending && pending.last !== pending.startWidth) onCommitRef.current(pending.last);
        };
    }, [dragging]);

    const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        // Kill the native mousedown behaviors at the root: WebKit otherwise starts a TEXT
        // SELECTION that outlives any later user-select:none (the body class lands an effect-tick
        // too late), and a divider click must not steal focus from wherever the user is working.
        e.preventDefault();
        // Optional call: jsdom lacks pointer capture.
        e.currentTarget.setPointerCapture?.(e.pointerId);
        // The editor-room cap stops GROWTH; it must never pull an already-wider panel back on the
        // first move (a small window would otherwise snap the panel to the cap regardless of drag
        // direction), so the current width always floors it. Frozen for the gesture, unlike the
        // keyboard path's per-keypress floor: shrinking past the cap mid-drag and coming back can
        // end above it, but never past where the drag started — a drag returning to its own
        // starting width is the one place a rubber-band feels worse than honoring the cap.
        drag.current = {
            startX: e.clientX,
            startWidth: width,
            max: Math.max(gestureMax(), width),
            last: width,
        };
        setDragging(true);
    };

    const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!drag.current) return;
        const next = clampPanelWidth(
            drag.current.startWidth + (e.clientX - drag.current.startX),
            drag.current.max,
        );
        if (next === drag.current.last) return;
        drag.current.last = next;
        // Keep the separator's value fresh for assistive tech mid-drag: state (and the rendered
        // aria-valuenow) only commits on release, by design — so write the attribute directly,
        // same as the width var.
        e.currentTarget.setAttribute('aria-valuenow', String(next));
        onResize(next);
    };

    const endDrag = () => {
        if (!drag.current) return;
        const {startWidth, last} = drag.current;
        drag.current = null;
        setDragging(false);
        // A stray click (zero movement) must not commit: it would pin today's stylesheet default
        // into localStorage as if the user had chosen it — and the first click of a double-click
        // reset would write the very key the second click removes.
        if (last !== startWidth) onCommit(last);
    };

    const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        // Same floor as the drag path: a cap below the current width blocks growth but must not
        // yank the panel backwards (ArrowLeft would otherwise overshoot its 16px step, and
        // ArrowRight/End would shrink the panel they promise to grow).
        const max = Math.max(gestureMax(), width);
        let next: number | null = null;
        if (e.key === 'ArrowLeft') next = clampPanelWidth(width - KEYBOARD_STEP, max);
        else if (e.key === 'ArrowRight') next = clampPanelWidth(width + KEYBOARD_STEP, max);
        else if (e.key === 'Home') next = PANEL_MIN_WIDTH;
        else if (e.key === 'End') next = clampPanelWidth(PANEL_MAX_WIDTH, max);
        if (next === null) return;
        e.preventDefault();
        if (next !== width) onCommit(next);
    };

    return (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a FOCUSABLE separator with aria-valuenow is the WAI-ARIA "window splitter" widget, interactive by spec; jsx-a11y only knows the static variant
        <div
            className={'panel-resizer' + (dragging ? ' panel-resizer_dragging' : '')}
            role="separator"
            aria-orientation="vertical"
            aria-label={label}
            aria-valuemin={PANEL_MIN_WIDTH}
            aria-valuemax={PANEL_MAX_WIDTH}
            aria-valuenow={Math.round(width)}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- same: the window splitter pattern requires focus
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={onReset}
            onKeyDown={handleKeyDown}
        />
    );
}
