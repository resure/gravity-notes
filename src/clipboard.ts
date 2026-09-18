import {isTauri} from './isTauri';

/**
 * Reject rather than throw.
 *
 * Every caller is a chord handler shaped `void read().then(…).catch(() => showToast(…))`, and
 * `navigator.clipboard` is undefined outside a secure context (plain `http://`, a `file://` page) —
 * so reading `.readText` off it threw SYNCHRONOUSLY, out of the call expression before the `.catch`
 * was ever attached. The chord's own error handling never ran and the failure surfaced as an
 * unhandled exception in the keydown handler instead of as a toast.
 *
 * `try`/`catch` rather than an async wrapper: the browser's clipboard read has to happen inside the
 * user gesture that triggered it, so it cannot be deferred to a microtask.
 */
function guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
        return call();
    } catch (error) {
        return Promise.reject(error);
    }
}

/** Native shells use the OS clipboard; browsers require a secure context and a key gesture. */
export function readClipboardText(): Promise<string> {
    if (isTauri) {
        return import('@tauri-apps/plugin-clipboard-manager').then((clipboard) =>
            clipboard.readText(),
        );
    }
    return guarded(() => navigator.clipboard.readText());
}

export function writeClipboardText(text: string): Promise<void> {
    if (isTauri) {
        return import('@tauri-apps/plugin-clipboard-manager').then((clipboard) =>
            clipboard.writeText(text),
        );
    }
    return guarded(() => navigator.clipboard.writeText(text));
}
