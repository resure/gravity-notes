import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

import '@gravity-ui/uikit/styles/fonts.css';
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

createRoot(rootEl).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
