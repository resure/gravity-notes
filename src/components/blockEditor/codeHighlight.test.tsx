import {afterEach, describe, expect, it, vi} from 'vitest';

import {tokenize} from './codeHighlight';

describe('tokenize', () => {
    it('finds token groups at their character offsets', () => {
        const code = 'const greeting = "hi"; // say it\nreturn 42;';
        const slices = tokenize(code, 'js').map(({start, end, group}) => [
            group,
            code.slice(start, end),
        ]);
        expect(slices).toContainEqual(['string', '"hi"']);
        expect(slices).toContainEqual(['comment', '// say it']);
        expect(slices).toContainEqual(['string', '42']);
    });

    it('resolves the picker’s tokens through highlight.js aliases', () => {
        expect(tokenize('let x: number = 1', 'ts').length).toBeGreaterThan(0);
        expect(tokenize('echo "x"', 'bash').length).toBeGreaterThan(0);
    });

    it('colours nothing for plain text or a language it does not know', () => {
        expect(tokenize('const a = "x"', '')).toEqual([]);
        expect(tokenize('const a = "x"', 'nosuchlang')).toEqual([]);
    });
});

describe('tokenize — size limit', () => {
    it('leaves a fence too large to colour within a frame plain', () => {
        const code = 'const s = "x";\n'.repeat(10_000);
        const started = performance.now();
        expect(tokenize(code, 'js')).toEqual([]);
        expect(performance.now() - started).toBeLessThan(50);
    });
});

describe('scheduleCodeHighlight — fallback grammars', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.doUnmock('highlight.js');
        vi.resetModules();
        document.body.innerHTML = '';
    });

    it('colours every fence scheduled while the full build is still loading', async () => {
        const highlights = new Map<string, Set<StaticRange>>();
        vi.stubGlobal('CSS', {highlights});
        vi.stubGlobal('Highlight', class extends Set<StaticRange> {});
        // Hold the full build back until the second fence has already been painted.
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.doMock('highlight.js', async (importOriginal) => {
            await gate;
            return importOriginal();
        });
        const {scheduleCodeHighlight} = await import('./codeHighlight');
        const fence = () => {
            const root = document.createElement('div');
            root.textContent = '{ greeting = "hi"; }';
            document.body.append(root);
            return root;
        };
        const first = fence();
        const second = fence();

        scheduleCodeHighlight(first, 'nix');
        scheduleCodeHighlight(second, 'nix');
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        release();

        const painted = (root: HTMLElement) =>
            [...highlights.values()].some((ranges) =>
                [...ranges].some((range) => root.contains(range.startContainer)),
            );
        await vi.waitFor(() => {
            expect(painted(first)).toBe(true);
            expect(painted(second)).toBe(true);
        });
    });
});
