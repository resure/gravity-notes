import {invoke} from '@tauri-apps/api/core';

/** True when running inside the Tauri desktop shell (WKWebView), false in a browser. */
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Open an external link the way the host expects: the OS default browser on the desktop (via the
 * native `open_external` command — WKWebView won't navigate away on its own), or a new tab on the
 * web. Used for ⌘/Ctrl-click on links in the editor; failures are swallowed (a dead link shouldn't
 * surface a toast).
 */
export function openExternalUrl(url: string): void {
    if (isTauri) {
        void invoke('open_external', {url}).catch(() => {});
        return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
}
