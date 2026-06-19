import react from '@vitejs/plugin-react';
import {defineConfig} from 'vitest/config';

export default defineConfig({
    plugins: [react()],
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
                },
            },
        ],
    },
});
