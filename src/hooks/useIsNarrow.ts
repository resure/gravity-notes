import {useSyncExternalStore} from 'react';

/**
 * Viewport width (px) at/below which the app switches to the single-pane mobile layout. Kept in
 * sync with the `max-width: 700px` media queries in Workspace.css / NoteList.css / TopBar.css.
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
