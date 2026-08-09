import baseConfig from '@gravity-ui/eslint-config';
import a11yConfig from '@gravity-ui/eslint-config/a11y';
import clientConfig from '@gravity-ui/eslint-config/client';
import importOrderConfig from '@gravity-ui/eslint-config/import-order';
import prettierConfig from '@gravity-ui/eslint-config/prettier';

export default [
    // Flat config does NOT read .gitignore, and its only default ignores are node_modules/.git.
    // '.vite' matters: a stray root-level Vite dep-cache (340 multi-MB minified chunks) once made
    // `eslint .` grind for 40+ minutes inside prettier/scope-analysis before anyone saw output.
    // '.claude' holds machine-local settings + isolation-mode worktrees (full repo copies) — linting
    // those duplicates the whole tree and reports phantom errors; nothing tracked there is JS/TS.
    // 'design_handoff_notes_base_ui' is a vendored design bundle (a self-contained spec page and
    // its support script) — a reference artefact, not source we own or lint.
    {
        ignores: [
            'dist',
            'coverage',
            'src-tauri',
            '.vite',
            '.claude',
            'design_handoff_notes_base_ui',
        ],
    },
    ...baseConfig,
    ...clientConfig,
    ...importOrderConfig,
    ...a11yConfig,
    ...prettierConfig,
    {
        rules: {
            // Parameter properties are an idiomatic, deliberate choice in our store classes.
            '@typescript-eslint/parameter-properties': 'off',
            // Automatic JSX runtime (tsconfig "jsx": "react-jsx") — React need not be in scope.
            'react/react-in-jsx-scope': 'off',
            'react/jsx-uses-react': 'off',
            // `void promise` is our deliberate marker for intentionally-unawaited promises.
            'no-void': 'off',
        },
    },
    {
        files: ['**/*.d.ts'],
        rules: {
            // Ambient type references (e.g. vite/client) can only be pulled in via triple-slash.
            '@typescript-eslint/triple-slash-reference': 'off',
        },
    },
    {
        files: ['src/main.tsx'],
        rules: {
            // The stylesheet import order here is intentional (CSS cascade); don't reorder it.
            'import/order': 'off',
        },
    },
    {
        // The block editor is ported from a standalone project (see docs/architecture.md) and is a
        // contentEditable-per-block surface, which the jsx-a11y heuristics read as unfocusable
        // static elements: a `contentEditable` div IS focusable and IS a textbox, but the rules
        // can't see that, and the editor drives focus/keyboard itself (caret.ts + Editor.tsx).
        // Scoped to the ported directory so the rest of the app keeps the checks.
        files: ['src/components/blockEditor/**'],
        rules: {
            'jsx-a11y/interactive-supports-focus': 'off',
            'jsx-a11y/click-events-have-key-events': 'off',
            'jsx-a11y/no-static-element-interactions': 'off',
            'jsx-a11y/no-noninteractive-element-interactions': 'off',
            'jsx-a11y/no-autofocus': 'off',
        },
    },
    {
        // One-shot Node codemods, not app code: they run under `node`, not the browser.
        files: ['scripts/**/*.mjs'],
        languageOptions: {globals: {process: 'readonly', console: 'readonly'}},
        rules: {'no-console': 'off'},
    },
];
