import {describe, expect, it} from 'vitest';

import type {Block, BlockType} from '../components/blockEditor/types';

import {markdownToBlocks} from './fromMarkdown';
import {inlineHtmlToMarkdown, inlineMarkdownToHtml} from './inline';
import {isRoundTripStable} from './roundTrip';
import {blocksToMarkdown} from './toMarkdown';

function block(type: BlockType, html: string, over: Partial<Block> = {}): Block {
    return {id: `${type}-${html.slice(0, 8)}`, type, html, depth: 0, ...over};
}

/** The shape assertions care about — ids are minted fresh on every parse. */
function shape(blocks: Block[]) {
    return blocks.map((b) => ({
        type: b.type,
        html: b.html,
        depth: b.depth ?? 0,
        ...(b.checked === undefined ? {} : {checked: b.checked}),
        ...(b.collapsed === undefined ? {} : {collapsed: b.collapsed}),
        ...(b.table ? {table: b.table} : {}),
        ...(b.image ? {image: b.image} : {}),
    }));
}

/** Blocks → Markdown → blocks must be a fixed point. */
function expectRoundTrip(blocks: Block[]) {
    const markdown = blocksToMarkdown(blocks);
    expect(shape(markdownToBlocks(markdown))).toEqual(shape(blocks));
    // And the Markdown itself must be stable, so a load/save cycle never rewrites the file.
    expect(blocksToMarkdown(markdownToBlocks(markdown))).toBe(markdown);
}

describe('inline HTML → Markdown', () => {
    it('maps the editor allowlist to its Markdown spelling', () => {
        expect(inlineHtmlToMarkdown('<strong>bold</strong>')).toBe('**bold**');
        expect(inlineHtmlToMarkdown('<b>bold</b>')).toBe('**bold**');
        expect(inlineHtmlToMarkdown('<em>it</em>')).toBe('*it*');
        expect(inlineHtmlToMarkdown('<s>gone</s>')).toBe('~~gone~~');
        expect(inlineHtmlToMarkdown('<code>x = 1</code>')).toBe('`x = 1`');
    });

    it('keeps <u> as literal HTML, which Markdown has no spelling for', () => {
        expect(inlineHtmlToMarkdown('<u>under</u>')).toBe('<u>under</u>');
        expect(inlineMarkdownToHtml('<u>under</u>')).toBe('<u>under</u>');
    });

    it('writes links, angle-bracketing destinations that contain spaces', () => {
        expect(inlineHtmlToMarkdown('<a href="https://x.dev">site</a>')).toBe(
            '[site](https://x.dev)',
        );
        expect(inlineHtmlToMarkdown('<a href="a b.md">f</a>')).toBe('[f](<a b.md>)');
    });

    it('treats <br> and browser-normalised wrappers as soft breaks', () => {
        expect(inlineHtmlToMarkdown('one<br>two')).toBe('one\ntwo');
        expect(inlineHtmlToMarkdown('<div>one</div><div>two</div>')).toBe('one\ntwo');
        expect(inlineMarkdownToHtml('one\ntwo')).toBe('one<br>two');
    });

    it('escapes text that would otherwise read back as syntax', () => {
        expect(inlineHtmlToMarkdown('2 * 3 * 4')).toBe('2 \\* 3 \\* 4');
        expect(inlineMarkdownToHtml('2 \\* 3 \\* 4')).toBe('2 * 3 * 4');
        expect(inlineHtmlToMarkdown('a [b] c')).toBe('a \\[b\\] c');
    });

    it('leaves a lone ~ alone, but escapes the ~~ that would open strikethrough', () => {
        // A tilde only means something doubled, so escaping every one of them rewrote `~4 min` and
        // `~$20` on disk the first time such a note was saved.
        expect(inlineHtmlToMarkdown('about ~4 min, ~$20')).toBe('about ~4 min, ~$20');
        expect(inlineMarkdownToHtml('about ~4 min, ~$20')).toBe('about ~4 min, ~$20');
        expect(inlineHtmlToMarkdown('literal ~~tildes~~ here')).toBe(
            'literal \\~\\~tildes\\~\\~ here',
        );
        expect(inlineMarkdownToHtml('literal \\~\\~tildes\\~\\~ here')).toBe(
            'literal ~~tildes~~ here',
        );
        // …and a real strikethrough still round-trips as one.
        expect(inlineHtmlToMarkdown('<s>gone</s>')).toBe('~~gone~~');
        expect(inlineMarkdownToHtml('~~gone~~')).toBe('<s>gone</s>');
    });

    it('leaves snake_case alone (CommonMark ignores intra-word underscores)', () => {
        expect(inlineHtmlToMarkdown('some_long_name')).toBe('some_long_name');
        expect(inlineMarkdownToHtml('some_long_name')).toBe('some_long_name');
    });

    it('does not escape inside code spans', () => {
        expect(inlineHtmlToMarkdown('<code>a * b</code>')).toBe('`a * b`');
        expect(inlineMarkdownToHtml('`a * b`')).toBe('<code>a * b</code>');
    });

    it('decodes entities on the way out and re-escapes on the way in', () => {
        expect(inlineHtmlToMarkdown('a &amp; b &lt;c&gt;')).toBe('a & b <c>');
        expect(inlineMarkdownToHtml('a & b <c>')).toBe('a &amp; b &lt;c&gt;');
    });

    it('writes [[wiki links]] verbatim so other tools (and the backlink scan) still see them', () => {
        expect(inlineHtmlToMarkdown('see [[Other Note]] now')).toBe('see [[Other Note]] now');
        // The style-only wrapper keeps the literal bytes as its text, so it costs the serializer
        // nothing (an unknown tag is dropped, its text kept) — see WIKI_LINK_CLASS.
        expect(inlineMarkdownToHtml('see [[Other Note]] now')).toBe(
            'see <span class="wiki-link">[[Other Note]]</span> now',
        );
        expect(inlineHtmlToMarkdown('see <span class="wiki-link">[[Other Note]]</span> now')).toBe(
            'see [[Other Note]] now',
        );
        // Brackets that are NOT a wiki link are still escaped, and get no wrapper.
        expect(inlineHtmlToMarkdown('an [aside] here')).toBe('an \\[aside\\] here');
        expect(inlineMarkdownToHtml('empty \\[\\[\\]\\] brackets')).toBe('empty [[]] brackets');
        // …and an escaped form written by an older build still reads back as the literal link.
        expect(inlineMarkdownToHtml('see \\[\\[Other Note\\]\\] now')).toBe(
            'see [[Other Note]] now',
        );
    });

    it('renders <url> autolinks as links, and writes them back in the same spelling', () => {
        expect(inlineMarkdownToHtml('see <https://example.com/a> now')).toBe(
            'see <a href="https://example.com/a" data-autolink="" rel="noopener noreferrer">https://example.com/a</a> now',
        );
        expect(
            inlineHtmlToMarkdown(
                'see <a href="https://example.com/a" data-autolink="" rel="noopener noreferrer">https://example.com/a</a> now',
            ),
        ).toBe('see <https://example.com/a> now');
        // A label edited away from its href stops being an autolink: the text the user typed
        // inside the rendered link has to survive, and `<…>` can only hold one of the two halves.
        expect(
            inlineHtmlToMarkdown(
                '<a href="https://example.com/a" data-autolink="">https://example.com/abcd</a>',
            ),
        ).toBe('[https://example.com/abcd](https://example.com/a)');
        // An ordinary link keeps the `[label](href)` spelling — the two never trade places.
        expect(inlineHtmlToMarkdown('<a href="https://x.dev">https://x.dev</a>')).toBe(
            '[https://x.dev](https://x.dev)',
        );
        // Schemes the app won't open stay literal text (an autolink whose href the editor's
        // sanitizer would strip would serialize back as `[text]()` — a silent file rewrite).
        expect(inlineMarkdownToHtml('<javascript:alert(1)>')).toBe('&lt;javascript:alert(1)&gt;');
    });

    it('parses nested emphasis', () => {
        expect(inlineMarkdownToHtml('**bold *and italic***')).toBe(
            '<strong>bold <em>and italic</em></strong>',
        );
    });
});

describe('blocks → Markdown', () => {
    it('writes each block type in its portable spelling', () => {
        const markdown = blocksToMarkdown([
            block('heading1', 'Title'),
            block('text', 'A paragraph.'),
            block('bulleted', 'one'),
            block('bulleted', 'two'),
            block('numbered', 'first'),
            block('numbered', 'second'),
            block('todo', 'done', {checked: true}),
            block('todo', 'todo'),
            block('quote', 'quoted'),
            block('callout', 'noted'),
            block('divider', ''),
            block('code', 'const x = 1'),
        ]);

        expect(markdown).toBe(
            [
                '# Title',
                '',
                'A paragraph.',
                '',
                // Consecutive list items pack together (a tight list), whatever their family: a change
                // of marker already starts a new list in CommonMark.
                '- one',
                '- two',
                '1. first',
                '2. second',
                '- [x] done',
                '- [ ] todo',
                '',
                '> quoted',
                '',
                '> [!note] noted',
                '',
                '---',
                '',
                '```',
                'const x = 1',
                '```',
            ].join('\n'),
        );
    });

    it('numbers each depth independently and restarts after an interruption', () => {
        const markdown = blocksToMarkdown([
            block('numbered', 'one'),
            block('numbered', 'one.a', {depth: 1}),
            block('numbered', 'one.b', {depth: 1}),
            block('numbered', 'two'),
            block('text', 'break'),
            block('numbered', 'fresh'),
        ]);

        expect(markdown).toBe(
            ['1. one', '  1. one.a', '  2. one.b', '2. two', '', 'break', '', '1. fresh'].join(
                '\n',
            ),
        );
    });

    it('writes a toggle as <details>, carrying its collapsed state and subtree', () => {
        const markdown = blocksToMarkdown([
            block('toggle', 'Summary', {collapsed: true}),
            block('text', 'hidden child', {depth: 1}),
            block('text', 'after'),
        ]);

        expect(markdown).toBe(
            [
                '<details>',
                '<summary>Summary</summary>',
                '',
                'hidden child',
                '',
                '</details>',
                '',
                'after',
            ].join('\n'),
        );
        expect(blocksToMarkdown([block('toggle', 'Open', {collapsed: false})])).toContain(
            '<details open>',
        );
    });

    it('writes a GFM table, and an empty header row when the table has no header', () => {
        const withHeader = blocksToMarkdown([
            block('table', '', {
                table: {
                    cells: [
                        ['a', 'b'],
                        ['1', '2'],
                    ],
                    headerRow: true,
                },
            }),
        ]);
        expect(withHeader).toBe(['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'));

        const headerless = blocksToMarkdown([
            block('table', '', {table: {cells: [['1', '2']], headerRow: false}}),
        ]);
        expect(headerless).toBe(['|  |  |', '| --- | --- |', '| 1 | 2 |'].join('\n'));
    });
});

describe('Markdown → blocks', () => {
    it('reads the block types back', () => {
        expect(
            shape(markdownToBlocks('# Title\n\ntext\n\n- item\n\n1. one\n\n- [x] done')),
        ).toEqual([
            {type: 'heading1', html: 'Title', depth: 0},
            {type: 'text', html: 'text', depth: 0},
            {type: 'bulleted', html: 'item', depth: 0},
            {type: 'numbered', html: 'one', depth: 0},
            {type: 'todo', html: 'done', depth: 0, checked: true},
        ]);
    });

    it('clamps headings deeper than the editor supports', () => {
        expect(markdownToBlocks('##### deep')[0].type).toBe('heading3');
    });

    it('normalises four-space nesting to one level per step', () => {
        expect(
            shape(markdownToBlocks('- one\n    - two\n        - three')).map((b) => b.depth),
        ).toEqual([0, 1, 2]);
    });

    it('folds a wrapped paragraph into one block but splits on a blank line', () => {
        expect(shape(markdownToBlocks('one\ntwo\n\nthree'))).toEqual([
            {type: 'text', html: 'one<br>two', depth: 0},
            {type: 'text', html: 'three', depth: 0},
        ]);
    });

    it('keeps an indented paragraph after a blank line as its own nested block', () => {
        expect(shape(markdownToBlocks('- item\n\n  nested paragraph'))).toEqual([
            {type: 'bulleted', html: 'item', depth: 0},
            {type: 'text', html: 'nested paragraph', depth: 1},
        ]);
    });

    it('reads an Obsidian callout, and a plain quote as a quote', () => {
        expect(shape(markdownToBlocks('> [!warning] careful'))).toEqual([
            {type: 'callout', html: 'careful', depth: 0},
        ]);
        expect(shape(markdownToBlocks('> just quoted'))).toEqual([
            {type: 'quote', html: 'just quoted', depth: 0},
        ]);
    });

    it('reads fenced code verbatim, including inner Markdown', () => {
        const blocks = markdownToBlocks('```\n- not a list\n**not bold**\n```');
        expect(blocks[0].type).toBe('code');
        expect(blocks[0].html).toBe('- not a list\n**not bold**');
    });

    it('reads a standalone image as an image block', () => {
        expect(shape(markdownToBlocks('![a cat](Attachments/cat.png)'))).toEqual([
            {type: 'image', html: '', depth: 0, image: {src: 'Attachments/cat.png', alt: 'a cat'}},
        ]);
    });

    it('yields one empty paragraph for an empty note', () => {
        expect(shape(markdownToBlocks(''))).toEqual([{type: 'text', html: '', depth: 0}]);
    });
});

describe('round trips', () => {
    it('survives a document using every block type', () => {
        expectRoundTrip([
            block('heading1', 'Title'),
            // Links carry the editor sanitizer's `rel`, which is the canonical form the parser emits.
            block(
                'text',
                'Intro with <strong>bold</strong> and ' +
                    '<a href="https://x.dev" rel="noopener noreferrer">a link</a>.',
            ),
            block('heading2', 'Section'),
            block('bulleted', 'one'),
            block('bulleted', 'nested', {depth: 1}),
            block('numbered', 'first'),
            block('numbered', 'second'),
            block('todo', 'done', {checked: true}),
            block('todo', 'pending', {checked: false}),
            block('quote', 'a quote'),
            block('callout', 'a callout'),
            block('divider', ''),
            block('code', 'if (a &lt; b) return'),
            block('image', '', {image: {src: 'Attachments/x.png', alt: 'x'}}),
            block('table', '', {
                table: {
                    cells: [
                        ['h1', 'h2'],
                        ['a', 'b'],
                    ],
                    headerRow: true,
                },
            }),
            block('text', 'Trailing paragraph.'),
        ]);
    });

    it('survives a collapsed toggle with a nested subtree', () => {
        expectRoundTrip([
            block('text', 'before'),
            block('toggle', 'Summary', {collapsed: true}),
            block('bulleted', 'child one', {depth: 1}),
            block('bulleted', 'grandchild', {depth: 2}),
            block('toggle', 'Nested toggle', {depth: 1, collapsed: false}),
            block('text', 'deep child', {depth: 2}),
            block('text', 'after'),
        ]);
    });

    it('survives text that looks like Markdown syntax', () => {
        expectRoundTrip([
            block('text', '2 * 3 * 4 = 24'),
            block('text', 'a [bracketed] word'),
            // Wiki links come back wearing their style-only wrapper (WIKI_LINK_CLASS), which the
            // serializer drops again — the bytes on disk are the literal Obsidian form either way.
            block(
                'text',
                'a link to <span class="wiki-link">[[Another Note]]</span> and to <span class="wiki-link">[[Folder/Deep Note|an alias]]</span>',
            ),
            block('text', 'backtick ` and tilde ~ and hash # here'),
            block('text', 'snake_case_name'),
        ]);
    });

    it('survives wiki links in the awkward inline positions', () => {
        expectRoundTrip([
            block('text', '<strong>bold <span class="wiki-link">[[Target]]</span> word</strong>'),
            block('text', '<em><span class="wiki-link">[[Target]]</span></em>'),
            // Adjacent to a code span: the link keeps its wrapper, the code span keeps its text.
            block(
                'text',
                '<code>[[Not a link]]</code> but <span class="wiki-link">[[Target]]</span>',
            ),
        ]);
    });

    it('survives a resized image (the YFM =WxH suffix)', () => {
        expectRoundTrip([
            block('image', '', {image: {src: 'Attachments/a.png', alt: 'A', width: 600}}),
            block('image', '', {image: {src: 'Attachments/b.png', width: 320, height: 240}}),
            block('image', '', {image: {src: 'Attachments/c.png'}}),
        ]);
    });

    it('survives soft breaks inside every kind of block', () => {
        expectRoundTrip([
            block('text', 'one<br>two'),
            block('bulleted', 'item<br>continued'),
            block('quote', 'quoted<br>across lines'),
            block('callout', 'called<br>out'),
        ]);
    });

    it('survives a headerless table and one with pipes in its cells', () => {
        expectRoundTrip([block('table', '', {table: {cells: [['1', '2']], headerRow: false}})]);
        expectRoundTrip([block('table', '', {table: {cells: [['a | b', 'c']], headerRow: false}})]);
    });

    it('survives code containing a fence', () => {
        expectRoundTrip([block('code', '```\nnested\n```')]);
    });
});

/**
 * Every case below is a note the block editor once rewrote on the user's disk. They are grouped
 * apart from the round-trip suite above because each one is a specific reported defect, and the
 * value is in keeping the exact triggering input around rather than in the general property.
 */
describe('regressions: notes the serializer used to corrupt', () => {
    const stable = (markdown: string) =>
        expect(blocksToMarkdown(markdownToBlocks(markdown))).toBe(markdown);

    it('keeps consecutive blank lines inside a fence', () => {
        // The inter-block blank-line tidy-up used to run as a regex over the whole document, with
        // no idea it was inside a fence — so two blank lines between Python defs became one.
        stable('```\na = 1\n\n\nb = 2\n```');
    });

    it('keeps tabs and trailing whitespace inside a fence', () => {
        // The indent was measured in characters, so every tab came back as a single space and a
        // pasted Makefile recipe stopped being a valid recipe.
        stable('```\ndef f():\n\tif x:\n\t\treturn 1\n```');
        stable('```\na = 1   \n```');
    });

    it('keeps line breaks when a paragraph is turned into code', () => {
        // `Turn into ▸ Code` copies the paragraph's html verbatim, <br>s included; reading that
        // through the space-flattening text extractor collapsed the snippet onto one line.
        expect(blocksToMarkdown([block('code', 'const a = 1;<br>const b = 2;')])).toBe(
            '```\nconst a = 1;\nconst b = 2;\n```',
        );
    });

    it('keeps a URL containing parentheses', () => {
        // The reader stopped at the first `)`, so it could not read back the <>-wrapped form the
        // writer emitted — and each save chewed further into the link.
        stable('[Rust](https://en.wikipedia.org/wiki/Rust_(programming_language))');
        stable('[a](<my page.html>)');
    });

    it('keeps an attachment reference containing a space', () => {
        // Dropping the <> wrapper also broke `attachmentRefsIn`, so the live file was reported as
        // an orphan and offered for deletion in the Attachments dialog.
        stable('![photo](<Attachments/a b.png>)');
    });

    it('keeps two adjacent emphasis spans distinct', () => {
        // `**a***b*` used to read as `<strong>a*</strong>b*`, and since that re-serialized to a
        // DIFFERENT broken string, three save cycles turned all the formatting into literal text.
        stable('**a***b*');
        stable('*a***b**');
        expect(inlineMarkdownToHtml('**a***b*')).toBe('<strong>a</strong><em>b</em>');
        expect(inlineMarkdownToHtml('*a***b**')).toBe('<em>a</em><strong>b</strong>');
        // …without regressing the nested form, where the surplus marker closes the INNER span.
        expect(inlineMarkdownToHtml('**bold *and italic***')).toBe(
            '<strong>bold <em>and italic</em></strong>',
        );
    });

    it('widens an inline code fence around an interior backtick', () => {
        expect(inlineHtmlToMarkdown('<code>a`b</code>')).toBe('``a`b``');
        expect(inlineMarkdownToHtml('``a`b``')).toBe('<code>a`b</code>');
    });

    it('keeps an emptied-out list item, heading or to-do as its own block', () => {
        // The writer emitted `'- '`, the reader trims line ends, and its patterns required
        // whitespace after the marker — so the block degraded to a paragraph holding a literal `-`.
        stable('-');
        stable('#');
        stable('- [ ]');
    });

    it('keeps a blank line inside a quote', () => {
        stable('> one\n>\n> two');
    });

    it('does not swallow the rest of the note after an unclosed <details>', () => {
        // findDetailsEnd reported the last line for an unclosed tag, and the caller's slice left
        // that line in neither the toggle nor the document — so a note mentioning <details> lost
        // its final paragraph.
        stable('text\n\n<details>\n\nmore\n\nfinal');
    });
});

describe('round-trip guard', () => {
    it('accepts a note the block model can hold', () => {
        expect(isRoundTripStable('# Title\n\nbody\n\n- one\n- two')).toBe(true);
    });

    it('rejects notes whose constructs the block model cannot represent', () => {
        // Each of these is safe ONLY because the guard keeps the block engine from saving it.
        expect(isRoundTripStable('---\ntags: work\n---\n\nbody')).toBe(false); // frontmatter
        expect(isRoundTripStable('#### deep')).toBe(false); // headings stop at H3
        expect(isRoundTripStable('```python\nx = 1\n```')).toBe(false); // fence info string
        expect(isRoundTripStable('> [!warning] careful')).toBe(false); // callout kind
        expect(isRoundTripStable('| a | b |\n| :--- | ---: |\n| x | y |')).toBe(false); // alignment
    });
});
