import baseConfig from '@gravity-ui/eslint-config';
import a11yConfig from '@gravity-ui/eslint-config/a11y';
import clientConfig from '@gravity-ui/eslint-config/client';
import importOrderConfig from '@gravity-ui/eslint-config/import-order';
import prettierConfig from '@gravity-ui/eslint-config/prettier';

export default [
    {ignores: ['dist', 'coverage']},
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
];
