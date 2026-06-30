import {invoke} from '@tauri-apps/api/core';

import {isTauri} from './isTauri';

/**
 * Schemes a note's link may open. Mirrors the Rust `open_external` allow-list (`src-tauri/src/lib.rs`)
 * so the web and desktop paths agree, and so a crafted note can't run a `javascript:`/`data:`/`file:`
 * URL or shell out to a local app URL. This is the single choke point for ⌘/Ctrl-click opens
 * (`openLinkExtension` routes through here), so validating it here covers every caller.
 */
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Whether `url` is safe to hand to the OS / a new tab (parseable + an allow-listed scheme). */
export function isExternallyOpenable(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false; // not an absolute URL → nothing safe to open
    }
    return ALLOWED_SCHEMES.has(parsed.protocol);
}

/**
 * Open an external link the way the host expects: the OS default browser on the desktop (via the
 * native `open_external` command — WKWebView won't navigate away on its own), or a new tab on the
 * web. Used for ⌘/Ctrl-click on links in the editor; failures are swallowed (a dead link shouldn't
 * surface a toast). A URL outside the allow-list is refused outright on both backends.
 */
export function openExternalUrl(url: string): void {
    if (!isExternallyOpenable(url)) return;
    if (isTauri) {
        void invoke('open_external', {url}).catch(() => {});
        return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
}
