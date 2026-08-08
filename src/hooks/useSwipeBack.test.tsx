import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {useSwipeBack} from './useSwipeBack';

/**
 * jsdom implements neither `Touch` nor `TouchEvent`, so the gesture is driven with hand-rolled
 * events carrying only what the hook reads: the touch points, the timestamp, and `preventDefault`.
 * That's enough to exercise the whole decision path (claim / commit / abandon) without a browser.
 */
function touchEvent(type: string, points: {x: number; y: number}[], timeStamp = 0): Event {
    const event = new Event(type, {bubbles: true, cancelable: true});
    const list = points.map((p) => ({clientX: p.x, clientY: p.y}));
    Object.defineProperties(event, {
        // On touchend the finger is gone from `touches` but reported in `changedTouches`.
        touches: {value: type === 'touchend' ? [] : list},
        changedTouches: {value: list},
        timeStamp: {value: timeStamp},
    });
    return event;
}

function setup({enabled = true}: {enabled?: boolean} = {}) {
    const container = document.createElement('div');
    // 400px wide, so the 35% commit threshold sits at 140px.
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
        width: 400,
        height: 800,
        left: 0,
        top: 0,
        right: 400,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    });
    const pane = document.createElement('div');
    container.appendChild(pane);
    document.body.appendChild(container);
    const onBack = vi.fn();
    renderHook(() => useSwipeBack(container, pane, enabled, onBack));
    return {container, pane, onBack};
}

/**
 * Play a whole gesture: press at `from`, drag through `path`, lift at the last point. `stepMs` is
 * the gap between moves and matters as much as the distance — the hook commits a SHORT drag when
 * it's flicked, so a test for "too short" has to move at an unhurried, human speed.
 */
function swipe(
    container: HTMLElement,
    from: [number, number],
    path: [number, number][],
    stepMs = 120,
) {
    act(() => {
        container.dispatchEvent(touchEvent('touchstart', [{x: from[0], y: from[1]}], 0));
        path.forEach(([x, y], i) => {
            container.dispatchEvent(touchEvent('touchmove', [{x, y}], (i + 1) * stepMs));
        });
        const [lastX, lastY] = path[path.length - 1] ?? from;
        container.dispatchEvent(
            touchEvent('touchend', [{x: lastX, y: lastY}], (path.length + 1) * stepMs),
        );
    });
}

describe('useSwipeBack', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('completes the back when a rightward drag passes the commit threshold', () => {
        const {container, pane, onBack} = setup();
        // 200px right on a 400px pane — past the 35% (140px) threshold.
        swipe(
            container,
            [50, 400],
            [
                [90, 402],
                [250, 404],
            ],
        );
        expect(onBack).toHaveBeenCalledTimes(1);
        // Driven to the committed position; the class swap takes it from there.
        expect(pane.style.transform).toBe('translateX(0)');
    });

    it('springs back without going back when a slow drag is too short', () => {
        const {container, pane, onBack} = setup();
        swipe(
            container,
            [50, 400],
            [
                [80, 402],
                [110, 403], // 60px — short of the 140px threshold, and moved unhurriedly
            ],
        );
        expect(onBack).not.toHaveBeenCalled();
        // Handed back to the stylesheet, which parks it off-canvas again.
        expect(pane.style.transform).toBe('');
        expect(pane.style.transition).toBe('');
    });

    it('completes a short drag when it is FLICKED, matching an interactive pop', () => {
        const {container, onBack} = setup();
        // The same 60px as above — but fast (16ms/step ≈ 1.9 px/ms), so velocity carries it.
        swipe(
            container,
            [50, 400],
            [
                [80, 402],
                [110, 403],
            ],
            16,
        );
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('tracks the finger while dragging', () => {
        const {container, pane} = setup();
        act(() => {
            container.dispatchEvent(touchEvent('touchstart', [{x: 50, y: 400}], 0));
            container.dispatchEvent(touchEvent('touchmove', [{x: 90, y: 402}], 16));
            container.dispatchEvent(touchEvent('touchmove', [{x: 170, y: 404}], 32));
        });
        expect(pane.style.transform).toBe('translateX(calc(-100% + 120px))');
        // Off its transition so it follows 1:1, and visible even though the pane rule hides it.
        expect(pane.style.transition).toBe('none');
        expect(pane.style.visibility).toBe('visible');
    });

    it('ignores a vertical scroll, leaving the pane untouched', () => {
        const {container, pane, onBack} = setup();
        swipe(
            container,
            [50, 200],
            [
                [54, 260],
                [58, 380],
            ],
        );
        expect(onBack).not.toHaveBeenCalled();
        expect(pane.style.transform).toBe('');
    });

    it('ignores a diagonal drag that is mostly vertical', () => {
        const {container, onBack} = setup();
        swipe(
            container,
            [50, 200],
            [
                [80, 240],
                [120, 300], // dx 70 vs dy 100 — below the horizontal ratio
            ],
        );
        expect(onBack).not.toHaveBeenCalled();
    });

    it('ignores a leftward drag (there is nothing to swipe forward to)', () => {
        const {container, onBack} = setup();
        swipe(
            container,
            [300, 400],
            [
                [250, 402],
                [120, 404],
            ],
        );
        expect(onBack).not.toHaveBeenCalled();
    });

    it('ignores multi-touch, so pinch-zooming an image never navigates', () => {
        const {container, onBack} = setup();
        act(() => {
            container.dispatchEvent(
                touchEvent('touchstart', [
                    {x: 50, y: 400},
                    {x: 200, y: 400},
                ]),
            );
            container.dispatchEvent(
                touchEvent('touchmove', [
                    {x: 250, y: 402},
                    {x: 380, y: 402},
                ]),
            );
            container.dispatchEvent(touchEvent('touchend', [{x: 250, y: 402}]));
        });
        expect(onBack).not.toHaveBeenCalled();
    });

    it('leaves a horizontally scrolled block (wide table, code fence) to pan itself', () => {
        const {container, onBack} = setup();
        const scroller = document.createElement('div');
        container.appendChild(scroller);
        // Scrolled right, so a rightward drag belongs to the block, not to navigation.
        Object.defineProperty(scroller, 'scrollWidth', {value: 800});
        Object.defineProperty(scroller, 'clientWidth', {value: 300});
        Object.defineProperty(scroller, 'scrollLeft', {value: 120, writable: true});
        act(() => {
            const start = touchEvent('touchstart', [{x: 50, y: 400}]);
            Object.defineProperty(start, 'target', {value: scroller});
            scroller.dispatchEvent(start);
            container.dispatchEvent(touchEvent('touchmove', [{x: 250, y: 402}], 16));
            container.dispatchEvent(touchEvent('touchend', [{x: 250, y: 402}], 32));
        });
        expect(onBack).not.toHaveBeenCalled();
    });

    it('does nothing at all while disabled (the list pane, or a desktop layout)', () => {
        const {container, pane, onBack} = setup({enabled: false});
        swipe(
            container,
            [50, 400],
            [
                [90, 402],
                [250, 404],
            ],
        );
        expect(onBack).not.toHaveBeenCalled();
        expect(pane.style.transform).toBe('');
    });

    it('claims the gesture only once it is clearly horizontal, so a scroll keeps its first pixels', () => {
        const {container, pane} = setup();
        act(() => {
            container.dispatchEvent(touchEvent('touchstart', [{x: 50, y: 400}], 0));
            // Under the decide threshold in both axes: nothing claimed yet.
            container.dispatchEvent(touchEvent('touchmove', [{x: 56, y: 404}], 16));
        });
        expect(pane.style.transform).toBe('');
        expect(pane.style.transition).toBe('');
    });

    it('parks the pane again if the gesture is cancelled mid-drag', () => {
        const {container, pane, onBack} = setup();
        act(() => {
            container.dispatchEvent(touchEvent('touchstart', [{x: 50, y: 400}], 0));
            container.dispatchEvent(touchEvent('touchmove', [{x: 170, y: 402}], 16));
            container.dispatchEvent(touchEvent('touchcancel', [{x: 170, y: 402}], 32));
        });
        expect(onBack).not.toHaveBeenCalled();
        expect(pane.style.transform).toBe('');
    });

    it('prevents the default only while the gesture is claimed', () => {
        const {container} = setup();
        act(() => {
            container.dispatchEvent(touchEvent('touchstart', [{x: 50, y: 400}], 0));
        });
        // A vertical move must stay scrollable — nothing prevented.
        const vertical = touchEvent('touchmove', [{x: 52, y: 470}], 16);
        act(() => {
            container.dispatchEvent(vertical);
        });
        expect(vertical.defaultPrevented).toBe(false);

        // A fresh, clearly horizontal gesture claims the touch and blocks the page scroll.
        const claimed = touchEvent('touchmove', [{x: 200, y: 402}], 32);
        act(() => {
            container.dispatchEvent(touchEvent('touchstart', [{x: 50, y: 400}], 48));
            container.dispatchEvent(claimed);
        });
        expect(claimed.defaultPrevented).toBe(true);
    });
});
