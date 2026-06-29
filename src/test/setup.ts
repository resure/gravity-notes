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

afterEach(() => {
    cleanup();
});
