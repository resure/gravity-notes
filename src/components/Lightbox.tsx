import {
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';

import {Xmark} from '@gravity-ui/icons';
import {Icon} from '@gravity-ui/uikit';
import {createPortal} from 'react-dom';

import './Lightbox.css';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
/** Scale a double-click jumps to (from fit). */
const DOUBLE_CLICK_SCALE = 2.5;

interface View {
    scale: number;
    /** Pan offset in px, applied before the scale (transform-origin: center). */
    x: number;
    y: number;
}

const FIT: View = {scale: 1, x: 0, y: 0};

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(Math.max(n, lo), hi);
}

/**
 * Re-anchor the pan so the point `(dx, dy)` — measured from the frame centre — stays put as the
 * scale changes from `v.scale` to `next`. Returns to a centred fit once we're back at 1×.
 */
function zoomAround(v: View, next: number, dx: number, dy: number): View {
    if (next === v.scale) return v;
    if (next <= MIN_SCALE) return FIT;
    const ratio = next / v.scale;
    return {scale: next, x: dx - (dx - v.x) * ratio, y: dy - (dy - v.y) * ratio};
}

/** Distance and midpoint of a two-finger touch, for pinch-zoom. */
function touchPinch(touches: TouchList) {
    const [a, b] = [touches[0], touches[1]];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    return {dist, midX: (a.clientX + b.clientX) / 2, midY: (a.clientY + b.clientY) / 2};
}

/**
 * Full-size image overlay, portaled to `<body>` so it isn't clipped by the editor or a dialog.
 * Supports trackpad / ctrl-wheel pinch-zoom (anchored at the cursor), two-finger touch pinch,
 * drag-to-pan while zoomed, and double-click to toggle zoom. Escape (and a backdrop click) close it.
 *
 * On open it moves focus to the close button: when launched from the editor's contenteditable with
 * an image node selected, leaving focus there would let Escape be typed *into* the note (a literal
 * U+001B), corrupting the saved Markdown. The caller restores focus on close.
 */
export function Lightbox({src, alt, onClose}: {src: string; alt: string; onClose: () => void}) {
    const closeRef = useRef<HTMLButtonElement>(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const [view, setView] = useState<View>(FIT);
    // Latest view, read by the native gesture listeners (which subscribe once) without re-subscribing.
    const viewRef = useRef(view);
    viewRef.current = view;
    // Live mouse-drag pan; the two-finger pinch baseline lives in pinchRef.
    const dragRef = useRef<{startX: number; startY: number; ox: number; oy: number} | null>(null);
    const pinchRef = useRef<{dist: number; scale: number} | null>(null);

    // Pointer position relative to the frame centre — the anchor for cursor-centred zoom.
    const fromCentre = useCallback((clientX: number, clientY: number) => {
        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect) return {dx: 0, dy: 0};
        return {
            dx: clientX - (rect.left + rect.width / 2),
            dy: clientY - (rect.top + rect.height / 2),
        };
    }, []);

    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    // Wheel (trackpad pinch on macOS arrives as ctrl+wheel) and touch pinch are attached natively so
    // they can be non-passive — React's synthetic wheel/touch listeners are passive, so their
    // preventDefault is a no-op and the page would zoom/scroll underneath the overlay.
    useEffect(() => {
        const el = frameRef.current;
        if (!el) return undefined;

        const onWheel = (e: WheelEvent) => {
            // Always swallow wheel over the overlay so the page/editor behind it can't scroll; only a
            // ctrl/trackpad-pinch wheel actually zooms.
            e.preventDefault();
            if (!e.ctrlKey) return;
            const {dx, dy} = fromCentre(e.clientX, e.clientY);
            setView((v) =>
                zoomAround(
                    v,
                    clamp(v.scale * Math.exp(-e.deltaY * 0.01), MIN_SCALE, MAX_SCALE),
                    dx,
                    dy,
                ),
            );
        };

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const {dist} = touchPinch(e.touches);
                // Skip a zero baseline (coincident touches) — a later dist / 0 would be NaN/Infinity
                // and poison the scale.
                if (dist > 0) pinchRef.current = {dist, scale: viewRef.current.scale};
            }
        };
        const onTouchMove = (e: TouchEvent) => {
            const pinch = pinchRef.current;
            if (e.touches.length === 2 && pinch) {
                e.preventDefault();
                const {dist, midX, midY} = touchPinch(e.touches);
                const {dx, dy} = fromCentre(midX, midY);
                const next = clamp((pinch.scale * dist) / pinch.dist, MIN_SCALE, MAX_SCALE);
                setView((v) => zoomAround(v, next, dx, dy));
            }
        };
        const onTouchEnd = (e: TouchEvent) => {
            if (e.touches.length < 2) pinchRef.current = null;
        };

        el.addEventListener('wheel', onWheel, {passive: false});
        el.addEventListener('touchstart', onTouchStart, {passive: false});
        el.addEventListener('touchmove', onTouchMove, {passive: false});
        el.addEventListener('touchend', onTouchEnd);
        return () => {
            el.removeEventListener('wheel', onWheel);
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
        };
    }, [fromCentre]);

    const zoomed = view.scale > MIN_SCALE;

    // Mouse drag-to-pan, only meaningful while zoomed in.
    const onPointerDown = (e: ReactPointerEvent) => {
        if (e.pointerType === 'touch' || !zoomed) return;
        e.preventDefault();
        dragRef.current = {startX: e.clientX, startY: e.clientY, ox: view.x, oy: view.y};
        e.currentTarget.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: ReactPointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        setView((v) => ({
            ...v,
            x: d.ox + (e.clientX - d.startX),
            y: d.oy + (e.clientY - d.startY),
        }));
    };
    const endDrag = () => {
        dragRef.current = null;
    };

    const onDoubleClick = (e: ReactMouseEvent) => {
        e.stopPropagation();
        const {dx, dy} = fromCentre(e.clientX, e.clientY);
        setView((v) => (v.scale > MIN_SCALE ? FIT : zoomAround(v, DOUBLE_CLICK_SCALE, dx, dy)));
    };

    return createPortal(
        <div className="lightbox" onClick={onClose} role="presentation">
            <button
                ref={closeRef}
                type="button"
                className="lightbox__close"
                aria-label="Close"
                onClick={onClose}
            >
                <Icon data={Xmark} size={20} />
            </button>
            <div className="lightbox__frame" ref={frameRef}>
                {/* The gesture surface wraps the image (kept presentational so its `alt` survives). A
                    click here is swallowed so only a click on the surrounding backdrop closes. */}
                <div
                    className={'lightbox__hit' + (zoomed ? ' lightbox__hit_zoomed' : '')}
                    role="presentation"
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={onDoubleClick}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                >
                    <img
                        className="lightbox__img"
                        src={src}
                        alt={alt}
                        draggable={false}
                        style={{
                            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                        }}
                    />
                </div>
            </div>
        </div>,
        document.body,
    );
}
