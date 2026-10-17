import {describe, expect, it} from 'vitest';

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
