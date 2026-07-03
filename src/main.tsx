import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

// No web font: the UI uses the native system font (San Francisco on macOS), set via
// `--g-font-family-sans` in index.css. Gravity's `fonts.css` (a Google-Fonts Inter `@import`) is
// intentionally NOT imported — nothing to fetch or bundle, works offline, feels native.
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

import './index.css';

import {App} from './App';
import {isTauri} from './isTauri';

const rootEl = document.getElementById('root');
if (!rootEl) {
    throw new Error('Gravity Notes failed to start: no #root element in the document.');
}

// Desktop shell (Tauri): the OS title bar is hidden (titleBarStyle "Overlay") and our top bar plays
// its part, so flag the document — the topbar then insets to clear the macOS traffic lights and the
// whole strip becomes a window drag handle (see TopBar.tsx / TopBar.css). No-op in the web build.
if (isTauri) {
    document.documentElement.classList.add('tauri-app');
}

// The dev build is distinguished by its blue "supernova" app icon alone (set in tauri.dev.conf.json);
// the in-app mark follows the user's accent-color setting like the release build, so there's no
// document flag to recolor it here.

createRoot(rootEl).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
