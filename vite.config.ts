import react from '@vitejs/plugin-react';
import {viteSingleFile} from 'vite-plugin-singlefile';
import {defineConfig} from 'vitest/config';

// `vite build --mode singlefile` (npm run build:single) inlines all JS/CSS into a single
// self-contained index.html; the normal build stays multi-file.
export default defineConfig(({mode}) => ({
    plugins: [react(), ...(mode === 'singlefile' ? [viteSingleFile()] : [])],
    // Emit ASCII-only JS so the single-file inliner can't corrupt non-ASCII/control bytes:
    // raw bytes embedded in an inline <script> get mangled by the HTML parser (a stray NUL
    // becomes U+FFFD), which previously broke a regex range. Escaped output is inlining-safe.
    esbuild: {charset: 'ascii'},
    test: {
        projects: [
            {
                extends: true,
                test: {
                    name: 'node',
                    environment: 'node',
                    include: ['src/**/*.test.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'dom',
                    environment: 'jsdom',
                    include: ['src/**/*.test.tsx'],
                    setupFiles: ['./src/test/setup.ts'],
                    server: {
                        deps: {
                            // Gravity's ESM imports `.css`; route it through Vite so jsdom doesn't choke.
                            inline: [/@gravity-ui\//],
                        },
                    },
                },
            },
        ],
    },
}));
