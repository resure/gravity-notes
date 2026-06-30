/**
 * Running inside the Tauri desktop shell (native fs, updater, window controls, …) rather than a
 * plain browser. `'__TAURI_INTERNALS__'` is injected by the Tauri webview; computed once at module
 * load. This is the app's load-bearing capability guard — keep it the single source of truth so
 * every feature-detect agrees. The `typeof window` guard keeps it safe under Node (tests).
 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
