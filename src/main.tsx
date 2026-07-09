import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

// No web font for the UI: the app chrome uses the native system font (San Francisco on macOS), set
// via `--g-font-family-sans` in index.css. Gravity's `fonts.css` (a Google-Fonts Inter `@import`) is
// intentionally NOT imported — nothing to fetch or bundle, works offline, feels native. (The one
// bundled font is the opt-in serif note-content face imported below — self-hosted, not a CDN fetch.)
import '@gravity-ui/uikit/styles/styles.css';

// Markdown-editor / YFM content styles. The concatenated bundle isn't exported,
// so we pull in the individual stylesheets that compose it.
import '@gravity-ui/markdown-editor/styles/styles.css';
import '@gravity-ui/markdown-editor/styles/markdown.css';
import '@gravity-ui/markdown-editor/styles/list.css';
import '@gravity-ui/markdown-editor/styles/yc-colors.css';
import '@gravity-ui/markdown-editor/styles/yc-file.css';
import '@gravity-ui/markdown-editor/styles/yc-table.css';
import '@gravity-ui/markdown-editor/styles/yc-table-cell-bg.css';
import '@gravity-ui/markdown-editor/styles/yfm-overrides.css';
import '@gravity-ui/markdown-editor/styles/yfm-themes.css';

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
