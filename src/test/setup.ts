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
// viewport and render no rows — breaking every test that asserts on list items. Give the scroll
// containers (tagged `.virtual-scroll`) a tall offsetHeight so the whole (small) test list fits the
// window and all rows mount; every other element keeps jsdom's default 0. Scoped by class so it can't
// perturb other components' layout-sensitive behavior.
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
