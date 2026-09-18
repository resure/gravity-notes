import {describe, expect, it} from 'vitest';

import {createEdgeScroller} from './autoScroll';

/** A stand-in for the pane: jsdom lays nothing out, so the rect and the scroll are supplied. */
function fakePane(top = 0, bottom = 600, scrollMax = 2000) {
    let scrollTop = 500;
    return {
        element: {
            getBoundingClientRect: () => ({top, bottom}) as DOMRect,
            get scrollTop() {
                return scrollTop;
            },
            set scrollTop(value: number) {
                scrollTop = Math.max(0, Math.min(scrollMax, value));
            },
        } as HTMLElement,
        at: () => scrollTop,
    };
}

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

describe('the drag edge scroller', () => {
    it('scrolls while the pointer sits near an edge, and keeps going without new events', async () => {
        const pane = fakePane();
        const scroller = createEdgeScroller(() => pane.element);

        scroller.to(590); // 10px from the bottom of the pane
        await frame();
        const afterOne = pane.at();
        expect(afterOne).toBeGreaterThan(500);

        // A pointer held still fires no further events — the loop has to carry on by itself, which
        // is the whole reason this isn't just a handler that nudges scrollTop.
        await frame();
        expect(pane.at()).toBeGreaterThan(afterOne);

        scroller.stop();
        const stopped = pane.at();
        await frame();
        expect(pane.at()).toBe(stopped);
    });

    it('scrolls the other way near the top, and stops once the pointer leaves the zone', async () => {
        const pane = fakePane();
        const scroller = createEdgeScroller(() => pane.element);

        scroller.to(4);
        await frame();
        expect(pane.at()).toBeLessThan(500);

        scroller.to(300); // the middle of the pane: nothing to do
        const settled = pane.at();
        await frame();
        await frame();
        expect(pane.at()).toBe(settled);
    });

    it('gives up at the end of the content rather than spinning', async () => {
        const pane = fakePane(0, 600, 500); // already scrolled to the bottom
        const scroller = createEdgeScroller(() => pane.element);
        scroller.to(599);
        await frame();
        await frame();
        expect(pane.at()).toBe(500);
    });
});
