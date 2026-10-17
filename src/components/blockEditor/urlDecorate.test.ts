import {describe, expect, it} from 'vitest';

import {inlineHtmlToMarkdown, inlineMarkdownToHtml} from '../../markdown';

import {URL_LINK_CLASS, decorateUrls, trimUrl} from './urlDecorate';

const wrap = (url: string) => `<span class="${URL_LINK_CLASS}">${url}</span>`;

describe('decorateUrls', () => {
    it('wraps a bare URL and leaves sentence punctuation outside it', () => {
        expect(decorateUrls('see https://example.com/a. Then')).toBe(
            `see ${wrap('https://example.com/a')}. Then`,
        );
        expect(decorateUrls('(at https://example.com)')).toBe(
            `(at ${wrap('https://example.com')})`,
        );
        expect(decorateUrls('https://en.wikipedia.org/wiki/Foo_(bar), ok')).toBe(
            `${wrap('https://en.wikipedia.org/wiki/Foo_(bar)')}, ok`,
        );
    });

    it('keeps entities whole, wherever the URL ends', () => {
        expect(decorateUrls('https://x.com/?a=1&amp;b=2 next')).toBe(
            `${wrap('https://x.com/?a=1&amp;b=2')} next`,
        );
        expect(decorateUrls('https://x.com/a&amp;')).toBe(`${wrap('https://x.com/a&amp;')}`);
        expect(decorateUrls('https://x.com&nbsp;tail')).toBe(`${wrap('https://x.com')}&nbsp;tail`);
    });

    it('is idempotent, and drops the wrapper once the text stops being a URL', () => {
        const once = decorateUrls('go https://example.com now');
        expect(decorateUrls(once)).toBe(once);
        expect(decorateUrls(`go ${wrap('https:/example.com')} now`)).toBe(
            'go https:/example.com now',
        );
    });

    it('leaves links, code and wiki links alone, but reaches into colour spans', () => {
        const anchor = '<a href="https://a.com">https://a.com</a>';
        expect(decorateUrls(anchor)).toBe(anchor);
        expect(decorateUrls('<code>https://a.com</code>')).toBe('<code>https://a.com</code>');
        const wiki = '<span class="wiki-link">[[https://a.com]]</span>';
        expect(decorateUrls(wiki)).toBe(wiki);
        expect(decorateUrls('<span class="gn-color--red">https://a.com</span>')).toBe(
            `<span class="gn-color--red">${wrap('https://a.com')}</span>`,
        );
    });

    it('needs a scheme and something after it', () => {
        expect(decorateUrls('example.com and www.example.com')).toBe(
            'example.com and www.example.com',
        );
        expect(decorateUrls('just https:// here')).toBe('just https:// here');
        expect(trimUrl('https://a.com/x).')).toBe('https://a.com/x');
    });

    it('never changes what a block is written as', () => {
        const samples = [
            'see https://example.com/a_b_c and more',
            'a **bold https://x.com/y** end',
            'ends with https://x.com/path.',
            '(https://x.com/q?a=1&b=2) and `https://code.com`',
            'two https://a.com https://b.com/~user/x*y',
            '[label](https://link.com) next to https://bare.com',
            '[[https://wiki.com]] and https://after.com!',
            '{red}(https://coloured.com) done',
            'escaped \\_ https://x.com/\\_a',
        ];
        for (const markdown of samples) {
            const html = inlineMarkdownToHtml(markdown);
            expect(inlineHtmlToMarkdown(decorateUrls(html)), markdown).toBe(
                inlineHtmlToMarkdown(html),
            );
        }
    });
});

describe('decorateUrls — review regressions', () => {
    it('stays off a URL whose wrapper would change how the block is written', () => {
        for (const markdown of [
            '\\~https://example.com~',
            '\\*https://example.com\\*',
            'a\\_https://x.com\\_',
        ]) {
            const html = inlineMarkdownToHtml(markdown);
            expect(inlineHtmlToMarkdown(decorateUrls(html)), markdown).toBe(
                inlineHtmlToMarkdown(html),
            );
        }
    });

    it('trims a long run of unmatched brackets in linear time', () => {
        const url = `https://example.com/${')'.repeat(200_000)}`;
        const started = performance.now();
        expect(trimUrl(url)).toBe('https://example.com/');
        expect(performance.now() - started).toBeLessThan(200);
    });
});
