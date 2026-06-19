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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
