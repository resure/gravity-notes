/**
 * Running inside the Tauri desktop shell (native fs, updater, window controls, …) rather than a
 * plain browser. `'__TAURI_INTERNALS__'` is injected by the Tauri webview; computed once at module
 * load. This is the app's load-bearing capability guard — keep it the single source of truth so
 * every feature-detect agrees. The `typeof window` guard keeps it safe under Node (tests).
 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Running in the **iOS** build of the shell (WKWebView on iPhone/iPad), as opposed to the macOS
 * desktop app or a plain browser. Distinguishes the two Tauri targets so mobile-only behavior can
 * branch on it: the on-device storage option in the gate, and (later) suppressing the menu-bar /
 * multi-window / traffic-light-inset chrome that only makes sense on the desktop. Computed once
 * from the WKWebView user agent; false on desktop and web.
 */
export const isIos =
    isTauri && typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent);

/**
 * The label of the app's primary window. THE single source of truth for the "main vs workspace
 * window" distinction, which is load-bearing across three places that must agree: the Rust shell
 * hides (not closes) this label on ⌘W (`src-tauri/src/lib.rs`, macOS convention), `useNotes`'s
 * close handler only `preventDefault()`s for it (so ws-N windows flush-then-close), and the
 * `core:window:allow-destroy` capability lets ws-N windows actually close. Keep the Rust literal
 * `"main"` and this constant in sync.
 */
export const MAIN_WINDOW_LABEL = 'main';

/**
 * The current Tauri window's label, synchronously — the same field `getCurrentWindow()` reads,
 * without pulling `@tauri-apps/api` into the caller (or the web bundle). Workspace windows are
 * `ws-1`, `ws-2`, …. Outside the shell (web build, tests) this returns {@link MAIN_WINDOW_LABEL},
 * so main-window-gated behavior stays on in the browser.
 */
export function currentWindowLabel(): string {
    if (!isTauri) return MAIN_WINDOW_LABEL;
    const internals = (
        window as {__TAURI_INTERNALS__?: {metadata?: {currentWindow?: {label?: string}}}}
    ).__TAURI_INTERNALS__;
    return internals?.metadata?.currentWindow?.label ?? MAIN_WINDOW_LABEL;
}

/** Whether this is the app's primary window (see {@link MAIN_WINDOW_LABEL}); true on web/tests. */
export function isMainWindow(): boolean {
    return currentWindowLabel() === MAIN_WINDOW_LABEL;
}

/**
 * Label prefix of single-note windows (`note-1`, `note-2`, …) created by the shell's
 * `open_note_window`. Mirrors `NOTE_WINDOW_PREFIX` in `src-tauri/src/lib.rs` — keep them in sync.
 * Like ws-N windows they really close on ⌘W; unlike them they open with both side panels closed,
 * restore their assigned note instead of the sidecar's last-active pointer, and are excluded from
 * workspace-level focus-if-open.
 */
export const NOTE_WINDOW_PREFIX = 'note-';

/** Whether this window is a single-note window (see {@link NOTE_WINDOW_PREFIX}); false on web/tests. */
export function isNoteWindow(): boolean {
    return currentWindowLabel().startsWith(NOTE_WINDOW_PREFIX);
}
