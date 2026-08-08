import {useSyncExternalStore} from 'react';

/**
 * Viewport width (px) at/below which the app switches to the single-pane mobile layout. This is the
 * SOLE source of the breakpoint: the hook applies it via matchMedia, and Workspace / TopBar toggle
 * the `workspace__body_mobile` / `topbar_mobile` classes off `isNarrow` — so the CSS reacts to those
 * classes, not to its own `@media` queries (there are none for this breakpoint).
 */
export const MOBILE_MAX_WIDTH = 700;

const QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;
/**
 * The pointer capability, NOT the viewport — the same distinction the stylesheets draw with
 * `@media (hover: hover)`, exposed to JS so behavior and styling can't disagree about what kind of
 * input they're serving. Deliberately the NEGATIVE query, negated by the hook: a matchMedia that
 * answers `false` to everything (jsdom, and any environment without real media support) then reads
 * as "has hover" — desktop — matching how `useIsNarrow`'s `false` also means desktop. Asking
 * `(hover: hover)` directly would instead make every test look like a touch device and silently
 * hide the affordances gated on it.
 */
const NO_HOVER_QUERY = '(hover: none)';

function subscribeTo(query: string, callback: () => void): () => void {
    // Guard a missing matchMedia (jsdom / SSR): nothing to subscribe to, so report no changes.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {};
    }
    const mql = window.matchMedia(query);
    // Safari <14 lacks addEventListener on MediaQueryList; fall back to the deprecated addListener.
    if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', callback);
        return () => mql.removeEventListener('change', callback);
    }
    mql.addListener(callback);
    return () => mql.removeListener(callback);
}

function matches(query: string): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia(query).matches;
}

const subscribeNarrow = (callback: () => void) => subscribeTo(QUERY, callback);
const getNarrow = () => matches(QUERY);
const subscribeHover = (callback: () => void) => subscribeTo(NO_HOVER_QUERY, callback);
const getHover = () => !matches(NO_HOVER_QUERY);

/**
 * True while the viewport is at or below the mobile breakpoint — drives the single-pane push
 * layout (list ↔ editor) on phones and narrow windows. A missing matchMedia (jsdom) reports
 * desktop, so tests keep the familiar three-pane layout.
 */
export function useIsNarrow(): boolean {
    return useSyncExternalStore(subscribeNarrow, getNarrow, () => false);
}

/**
 * True when the device has a hovering pointer (mouse/trackpad) — i.e. NOT a touch screen. Use this,
 * not the width breakpoint, to gate anything that depends on the INPUT rather than the layout: a
 * narrow desktop window still has a keyboard and a mouse, while a full-screen tablet has neither.
 * Server/jsdom report `true` (desktop) — see `NO_HOVER_QUERY` for why it's asked that way round.
 */
export function useHasHover(): boolean {
    return useSyncExternalStore(subscribeHover, getHover, () => true);
}
