import '@testing-library/jest-dom/vitest';
import {cleanup} from '@testing-library/react';
import {afterEach} from 'vitest';

// jsdom does not implement window.matchMedia; provide a stub so Gravity UI's
// Modal (used by Dialog) can call it without throwing.
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    }),
});

// jsdom has no layout, so a virtualized list (@tanstack/react-virtual) would measure a 0-height
// viewport and render no rows — breaking every test that asserts on list items. The getter is on the
// prototype (it can't be installed per-element before the rows mount), but it returns jsdom's own
// default (0) for every element EXCEPT a scroll container tagged `.virtual-scroll`, which gets a tall
// height so the whole (small) test list fits the window and all rows mount. Returning 0 elsewhere
// matches the un-patched default, so non-virtual components see no change.
//
// Tradeoff: because the entire test list fits, these tests exercise a fully-mounted list, not a
// partially-windowed one — so the windowing/scroll/focus-into-window paths aren't covered here. The
// row-level behavior (memoization, keyboard nav, selection) is what the suite asserts.
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
        return this.classList?.contains('virtual-scroll') ? 100000 : 0;
    },
});

// jsdom lacks ResizeObserver, which @tanstack/react-virtual observes for dynamic row measurement.
// A no-op stub is enough: the virtualizer reads the initial sizes synchronously (see offsetHeight
// above) and tests don't resize.
if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
}

// jsdom implements Range but not its layout methods (there is no layout to report). The block
// editor anchors its caret-following overlays — the slash menu, the `[[` picker — off exactly those,
// so without a stub merely typing a trigger character throws. Empty/zeroed is the honest answer, and
// it is the branch `caretLineRect` already handles: it falls back to the element's own rect.
if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = function getClientRects() {
        return Object.assign([], {item: () => null}) as unknown as DOMRectList;
    };
}
// Same story for `scrollIntoView`, which every keyboard-navigable popup calls to keep the
// highlighted row visible.
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
}
if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
        return new DOMRect(0, 0, 0, 0);
    };
}

afterEach(() => {
    cleanup();
});
