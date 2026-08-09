import {describe, expect, it} from 'vitest';

import {inlineHtmlToMarkdown} from '../../markdown';

import {decorateWikiLinks, wikiTargetsIn} from './wikiDecorate';

const none = () => false;
const all = () => true;

describe('decorateWikiLinks', () => {
    it('wraps a link without touching its text', () => {
        expect(decorateWikiLinks('go to [[Other Note]] now', none)).toBe(
            'go to <span class="wiki-link">[[Other Note]]</span> now',
        );
    });

    it('marks unresolvable targets broken', () => {
        expect(decorateWikiLinks('[[Ghost]]', all)).toBe(
            '<span class="wiki-link wiki-link_broken">[[Ghost]]</span>',
        );
    });

    it('is idempotent, and re-runs the broken decision', () => {
        const once = decorateWikiLinks('[[Target]]', none);
        expect(decorateWikiLinks(once, none)).toBe(once);
        expect(decorateWikiLinks(once, all)).toBe(
            '<span class="wiki-link wiki-link_broken">[[Target]]</span>',
        );
    });

    it('drops the wrapper once the user breaks the link up', () => {
        const decorated = decorateWikiLinks('[[Target]]', none);
        // What the DOM would hold after deleting the final `]`.
        expect(decorateWikiLinks(decorated.replace(']]</span>', ']</span>'), none)).toBe(
            '[[Target]',
        );
    });

    it('leaves code spans and existing links alone', () => {
        expect(decorateWikiLinks('<code>[[Target]]</code>', none)).toBe('<code>[[Target]]</code>');
        expect(decorateWikiLinks('<a href="x">[[Target]]</a>', none)).toBe(
            '<a href="x">[[Target]]</a>',
        );
    });

    it('decorates inside emphasis', () => {
        expect(decorateWikiLinks('<strong>a [[T]] b</strong>', none)).toBe(
            '<strong>a <span class="wiki-link">[[T]]</span> b</strong>',
        );
    });

    it('costs the serializer nothing — the Markdown is identical either way', () => {
        const plain = 'see [[A Note|alias]] and [[B]]';
        expect(inlineHtmlToMarkdown(decorateWikiLinks(plain, none))).toBe(
            inlineHtmlToMarkdown(plain),
        );
    });

    it('skips html with nothing to do', () => {
        const html = 'plain <strong>text</strong>';
        expect(decorateWikiLinks(html, none)).toBe(html);
    });
});

describe('wikiTargetsIn', () => {
    it('lists each distinct target once', () => {
        expect(wikiTargetsIn('[[A]] [[B|x]] [[A]]')).toEqual(['A', 'B|x']);
    });
});
