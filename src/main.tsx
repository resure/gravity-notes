import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

// No web font for the UI: the app chrome uses the native system font (San Francisco on macOS), set
// via `--font-ui` in tokens.css — nothing to fetch or bundle, works offline, feels native. (The one
// bundled font is PT Serif, imported below — self-hosted, not a CDN fetch.)
// Sol's foundations. FIRST, so everything after it — every component sheet, the YFM maps — can
// read a token that is already defined.
import './tokens.css';

// YFM content styles for the read-only preview (NotePreview, and the release notes in
// UpdateDialog), straight from the renderer that produces that HTML. These used to arrive with
// `@gravity-ui/markdown-editor`'s nine stylesheets, which also carried the WYSIWYG editor's whole
// chrome; the editor is gone, so only the content styles are left. The `--yfm-*` variable maps they
// filled in are vendored beside them (see yfm-tokens.css).
import '@diplodoc/transform/dist/css/base.css';
import '@diplodoc/transform/dist/css/_yfm-only.css';

import './yfm-tokens.css';

// PT Serif — the face behind Settings › Editor font › Serif. Self-hosted (woff2-only @font-face
// rules over @fontsource's font files — see the rationale in fonts/pt-serif.css), so unlike a
// Google-Fonts `@import` there's nothing fetched at runtime and it works offline.
import './fonts/pt-serif.css';

import './index.css';

import {App} from './App';
import {isIos, isTauri} from './isTauri';

const rootEl = document.getElementById('root');
if (!rootEl) {
    throw new Error('Gravity Notes failed to start: no #root element in the document.');
}

// Desktop shell (Tauri): the OS title bar is hidden (titleBarStyle "Overlay") and our top bar plays
// its part, so flag the document — the topbar then insets to clear the macOS traffic lights and the
// whole strip becomes a window drag handle (see TopBar.tsx / TopBar.css). No-op in the web build.
if (isTauri) {
    document.documentElement.classList.add('tauri-app');
    // iOS is also a Tauri build but has no overlay title bar or traffic lights (that's a
    // macOS-desktop concern), so flag it separately: the mobile top bar then keeps its normal
    // safe-area padding instead of insetting past the (non-existent) traffic lights.
    if (isIos) {
        document.documentElement.classList.add('ios');
        // WKWebView auto-zooms when focusing an input whose font-size is < 16px (the search box,
        // inline rename, …) and allows pinch-zoom of the whole UI — neither of which a native app
        // wants. Cap the scale. Done here (not in index.html) so it stays OUT of the web build,
        // where disabling zoom is an accessibility regression and mobile Safari ignores it anyway;
        // WKWebView, unlike Safari, honors maximum-scale/user-scalable.
        document
            .querySelector('meta[name="viewport"]')
            ?.setAttribute(
                'content',
                'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
            );
    }
}

// The dev build is distinguished by its blue "supernova" app icon alone (set in tauri.dev.conf.json);
// the in-app mark follows the user's accent-color setting like the release build, so there's no
// document flag to recolor it here.

createRoot(rootEl).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
