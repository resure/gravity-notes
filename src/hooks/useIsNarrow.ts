import {useSyncExternalStore} from 'react';

/**
 * Viewport width (px) at/below which the app switches to the single-pane mobile layout. This is the
 * SOLE source of the breakpoint: the hook applies it via matchMedia, and Workspace / TopBar toggle
 * the `workspace__body_mobile` / `topbar_mobile` classes off `isNarrow` — so the CSS reacts to those
 * classes, not to its own `@media` queries (there are none for this breakpoint).
 */
export const MOBILE_MAX_WIDTH = 700;

const QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

function subscribe(callback: () => void): () => void {
    // Guard a missing matchMedia (jsdom / SSR): nothing to subscribe to, so report no changes.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {};
    }
    const mql = window.matchMedia(QUERY);
    // Safari <14 lacks addEventListener on MediaQueryList; fall back to the deprecated addListener.
    if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', callback);
        return () => mql.removeEventListener('change', callback);
    }
    mql.addListener(callback);
    return () => mql.removeListener(callback);
}

function getSnapshot(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia(QUERY).matches;
}

/**
 * True while the viewport is at or below the mobile breakpoint — drives the single-pane push
 * layout (list ↔ editor) on phones and narrow windows. A missing matchMedia (jsdom) reports
 * desktop, so tests keep the familiar three-pane layout.
 */
export function useIsNarrow(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
