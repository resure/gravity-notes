import {useEffect} from 'react';

/**
 * Movement (px) before the gesture is classified. Below this the finger could still be starting a
 * vertical scroll, so nothing is claimed and the browser keeps the touch.
 */
const DECIDE_PX = 12;
/**
 * How much more horizontal than vertical the movement must be to count as a back swipe rather than
 * a scroll. Deliberately > 1 so a diagonal drag stays a scroll.
 */
const HORIZONTAL_RATIO = 1.3;
/** Fraction of the pane's width past which releasing COMPLETES the back (below it, springs back). */
const COMMIT_FRACTION = 0.35;
/** A fast flick completes regardless of distance (px/ms) — matches how iOS treats an interactive pop. */
const COMMIT_VELOCITY = 0.45;
/** Duration (ms) of the settle animation after release; matches the pane transition in Workspace.css. */
const SETTLE_MS = 200;

/**
 * Interactive **swipe-to-go-back** for the mobile editor pane: the notes list tracks the finger as
 * it drags in from the left, and on release either completes the back or springs back — the same
 * feel as iOS's interactive pop, rather than a gesture that merely triggers the Back button.
 *
 * `pane` is the list overlay (`.workspace__sidebar`), which sits at `translateX(-100%)` while the
 * editor shows; the drag moves it toward 0 and the CSS class swap takes over at the end. The gesture
 * starts ANYWHERE on the pane (not just the screen edge), because on a phone the editor fills the
 * screen and an edge-only strip is hard to hit. What keeps that from stealing real interactions:
 *
 * - it only claims the touch once the movement is clearly horizontal (`HORIZONTAL_RATIO`), so
 *   vertical scrolling is untouched;
 * - only rightward drags count (there is nothing to swipe forward to);
 * - a touch starting inside something horizontally scrolled (a wide code block or table) is ignored,
 *   so those keep their own panning;
 * - multi-touch (pinch-zooming an image) is ignored.
 *
 * `touchmove` is non-passive ONLY so the claimed gesture can `preventDefault()` and stop the page
 * from scrolling mid-drag; until the gesture is claimed nothing is prevented.
 */
export function useSwipeBack(
    container: HTMLElement | null,
    pane: HTMLElement | null,
    enabled: boolean,
    onBack: () => void,
): void {
    useEffect(() => {
        if (!enabled || !container || !pane) return undefined;
        // Snapshot both nodes for the life of this effect, so every handler AND the cleanup act on
        // the same elements even if the props point elsewhere by then (and so the style writes below
        // aren't mutations of a parameter).
        const root = container;
        const sheet = pane;

        let startX = 0;
        let startY = 0;
        let lastX = 0;
        let lastT = 0;
        let velocity = 0;
        let decided = false;
        let dragging = false;

        /** Hand the pane back to the stylesheet (its class decides the resting position). */
        const clearInlineStyle = () => {
            sheet.style.transform = '';
            sheet.style.transition = '';
            sheet.style.visibility = '';
        };

        /** Is the touch inside something that scrolls horizontally and has somewhere to scroll? */
        const startedInHorizontalScroller = (target: EventTarget | null) => {
            let el = target instanceof Element ? target : null;
            while (el && el !== root) {
                if (el.scrollWidth > el.clientWidth + 1 && el.scrollLeft > 0) return true;
                el = el.parentElement;
            }
            return false;
        };

        const onStart = (event: TouchEvent) => {
            if (event.touches.length !== 1 || startedInHorizontalScroller(event.target)) {
                decided = true; // decided-and-abandoned: this touch can never become a back swipe
                dragging = false;
                return;
            }
            const touch = event.touches[0];
            startX = lastX = touch.clientX;
            startY = touch.clientY;
            lastT = event.timeStamp;
            velocity = 0;
            decided = false;
            dragging = false;
        };

        const onMove = (event: TouchEvent) => {
            if (event.touches.length !== 1) {
                if (dragging) clearInlineStyle();
                decided = true;
                dragging = false;
                return;
            }
            const touch = event.touches[0];
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;

            if (!decided) {
                if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
                decided = true;
                dragging = dx > 0 && Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO;
                if (dragging) {
                    // Take the pane off its transition so it tracks the finger 1:1, and force it
                    // visible (the editor-pane rule hides it once it's parked off-canvas).
                    sheet.style.transition = 'none';
                    sheet.style.visibility = 'visible';
                }
            }
            if (!dragging) return;

            // Claimed: stop the page from scrolling under the drag.
            if (event.cancelable) event.preventDefault();

            const width = root.getBoundingClientRect().width || 1;
            const travel = Math.max(0, Math.min(dx, width));
            const dt = event.timeStamp - lastT;
            if (dt > 0) velocity = (touch.clientX - lastX) / dt;
            lastX = touch.clientX;
            lastT = event.timeStamp;
            // The pane rests at -100%; dragging moves it toward 0.
            sheet.style.transform = `translateX(calc(-100% + ${travel}px))`;
        };

        const onEnd = (event: TouchEvent) => {
            if (!dragging) {
                decided = false;
                return;
            }
            dragging = false;
            decided = false;
            const touch = event.changedTouches[0];
            const width = root.getBoundingClientRect().width || 1;
            const dx = touch ? Math.max(0, Math.min(touch.clientX - startX, width)) : 0;
            const commit = dx > width * COMMIT_FRACTION || velocity > COMMIT_VELOCITY;

            // Both outcomes animate from wherever the finger left off, with NO timer: a timeout
            // would be throttled while the tab is backgrounded (and would delay the state change
            // behind an animation, which is never the right dependency).
            if (commit) {
                // Drive the pane to its committed position, then flip the pane state immediately.
                // The class lands on the same translateX(0), so the two agree and nothing jumps;
                // the effect's own cleanup (this hook disables on the list pane) drops the inline
                // style afterwards. Setting the transform BEFORE onBack matters — clearing first
                // would park the pane back at -100% for a frame while React re-renders.
                sheet.style.transition = `transform ${SETTLE_MS}ms ease`;
                sheet.style.transform = 'translateX(0)';
                onBack();
            } else {
                // Not far enough: handing the pane back to the stylesheet is all that's needed —
                // its computed transform returns to -100% and the base transition animates it there.
                clearInlineStyle();
            }
        };

        const onCancel = () => {
            // Same as an uncommitted release: the stylesheet animates the pane home.
            if (dragging) clearInlineStyle();
            dragging = false;
            decided = false;
        };

        root.addEventListener('touchstart', onStart, {passive: true});
        root.addEventListener('touchmove', onMove, {passive: false});
        root.addEventListener('touchend', onEnd, {passive: true});
        root.addEventListener('touchcancel', onCancel, {passive: true});
        return () => {
            root.removeEventListener('touchstart', onStart);
            root.removeEventListener('touchmove', onMove);
            root.removeEventListener('touchend', onEnd);
            root.removeEventListener('touchcancel', onCancel);
            // A teardown mid-drag (pane closed by other means) must not strand the inline transform.
            clearInlineStyle();
        };
    }, [container, pane, enabled, onBack]);
}
