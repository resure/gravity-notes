// @vitest-environment jsdom
import {describe, expect, it} from 'vitest';

import {blocksToMarkdown, isRoundTripStable} from '../../markdown';

import {htmlToBlocks} from './htmlImport';

const DOCS_TEXT =
    'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-variant:normal;vertical-align:baseline;white-space:pre;white-space:pre-wrap;';

const GOOGLE_DOCS = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-3f2a1b7c-7fff-5e1d-0c2a-4b9e8d7f6a51"><h1 dir="ltr" style="line-height:1.38;margin-top:20pt;margin-bottom:6pt;"><span style="font-size:20pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;font-style:normal;text-decoration:none;">Meeting notes</span></h1><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="${DOCS_TEXT}font-weight:700;font-style:normal;text-decoration:none;">Decision:</span><span style="${DOCS_TEXT}font-weight:400;font-style:normal;text-decoration:none;">&nbsp;ship the </span><span style="${DOCS_TEXT}font-weight:400;font-style:italic;text-decoration:none;">beta</span><span style="${DOCS_TEXT}font-weight:400;font-style:normal;text-decoration:none;"> on </span><a href="https://example.com/calendar" style="text-decoration:none;"><span style="${DOCS_TEXT}color:#1155cc;font-weight:400;font-style:normal;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;">Friday</span></a><span style="${DOCS_TEXT}font-weight:400;">.</span></p><br><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;" aria-level="1"><p dir="ltr" style="line-height:1.38;" role="presentation"><span style="${DOCS_TEXT}font-weight:400;">Write the changelog</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:circle;font-size:11pt;" aria-level="2"><p dir="ltr" style="line-height:1.38;" role="presentation"><span style="${DOCS_TEXT}font-weight:400;text-decoration:line-through;">Draft it</span></p></li></ul><li dir="ltr" style="list-style-type:disc;" aria-level="1"><p dir="ltr" role="presentation"><span style="font-size:11pt;font-family:'Courier New',monospace;font-weight:400;">npm run build</span></p></li></ul><br><ul style="margin-top:0;margin-bottom:0;"><li dir="ltr" role="checkbox" aria-checked="true" style="list-style-type:none;" aria-level="1"><img src="data:image/png;base64,iVBORw0KGgo=" width="17.6px" height="17.6px" alt="checked" aria-roledescription="checkbox" role="presentation"><p dir="ltr" role="presentation" style="display:inline-block;"><span style="${DOCS_TEXT}font-weight:400;">Book the room</span></p></li><li dir="ltr" role="checkbox" aria-checked="false" style="list-style-type:none;" aria-level="1"><img src="data:image/png;base64,iVBORw0KGgo=" alt="unchecked" role="presentation"><p dir="ltr" role="presentation" style="display:inline-block;"><span style="${DOCS_TEXT}font-weight:400;">Send the invite</span></p></li></ul><br><div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;"><colgroup><col width="100"><col width="100"></colgroup><tbody><tr style="height:0pt"><td style="border-left:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;"><p dir="ltr" style="line-height:1.2;"><span style="${DOCS_TEXT}font-weight:700;">Owner</span></p></td><td style="vertical-align:top;"><p dir="ltr"><span style="${DOCS_TEXT}font-weight:700;">Due</span></p></td></tr><tr style="height:0pt"><td><p dir="ltr"><span style="${DOCS_TEXT}font-weight:400;">Ana</span></p></td><td><p dir="ltr"><span style="${DOCS_TEXT}font-weight:400;">Mon</span><span style="${DOCS_TEXT}font-weight:400;vertical-align:super;">1</span></p></td></tr></tbody></table></div></b>`;

const NOTION = `<meta charset="utf-8"><h2>Launch plan</h2><p>Owner: <strong>Sam</strong>, see <a href="https://www.notion.so/acme/Spec-0f1e2d3c4b5a">Spec</a> and <mark class="highlight-yellow">read it</mark></p><ul><li>Design<ul><li>Review mocks</li></ul></li><li>Build</li></ul><ol><li>Kickoff</li><li>Ship</li></ol><ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span class="to-do-children-checked">Book room</span></li><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">Send invite</span></li></ul><blockquote>Ship small, ship often.</blockquote><pre><code class="language-JavaScript">const answer = 42;
console.log(answer);</code></pre><hr><p><s>Old idea</s> and <code>inline()</code></p>`;

const GITHUB_README = `<meta charset='utf-8'><div class="markdown-heading" dir="auto"><h2 tabindex="-1" class="heading-element" dir="auto">Installation</h2><a id="user-content-installation" class="anchor" aria-label="Permalink: Installation" href="https://github.com/acme/tool#installation"><svg class="octicon octicon-link" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5"></path></svg></a></div><p dir="auto"><a target="_blank" rel="noopener noreferrer" href="https://github.com/acme/tool/actions"><img src="https://github.com/acme/tool/workflows/CI/badge.svg" alt="CI" style="max-width: 100%;"></a> Install it with <code>npm</code>:</p><div class="highlight highlight-source-shell notranslate position-relative overflow-auto" dir="auto"><pre>npm install --save acme-tool</pre><div class="zeroclipboard-container"><clipboard-copy aria-label="Copy" class="ClipboardButton btn btn-invisible js-clipboard-copy m-2 p-0" data-copy-feedback="Copied!" value="npm install --save acme-tool" tabindex="0" role="button"><svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16"><path d="M0 6.75C0 5.784"></path></svg></clipboard-copy></div></div><ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" id="" disabled="" class="task-list-item-checkbox" checked=""> Parser</li><li class="task-list-item"><input type="checkbox" id="" disabled="" class="task-list-item-checkbox"> Docs</li></ul><markdown-accessiblity-table><table><thead><tr><th align="left">Option</th><th align="right">Default</th></tr></thead><tbody><tr><td align="left"><code>port</code></td><td align="right">8080</td></tr></tbody></table></markdown-accessiblity-table><div class="markdown-alert markdown-alert-note" dir="auto"><p class="markdown-alert-title" dir="auto">Note</p><p dir="auto">See <a href="https://github.com/acme/tool/blob/main/docs/config.md">the docs</a>.</p></div>`;

const WEB_PAGE = `<html><head><style>p { color: red }</style><script>alert(1)</script></head><body><!--StartFragment--><article><h3 style="font-weight: 700; font-size: 1.4em">Packing list</h3><p style="color: rgb(33, 33, 33); font-family: Georgia, serif; font-weight: 400;">Remember   the <em>essentials</em>:</p><ul><li>Clothes<ul><li>Shirts</li><li>Socks<ol start="3"><li>Wool</li><li>Cotton</li></ol></li></ul></li><li>Documents</li></ul><table><caption>Prices</caption><tr><th>Item</th><th>Cost</th></tr><tr><td>Tent</td><td>$120</td></tr><tr><td colspan="2">Total on request</td></tr></table><p hidden>secret</p><span style="display:none">invisible</span><p onclick="steal()">Click <a href="javascript:alert(1)">here</a> or <a href="/relative">there</a>.</p><figure><img src="https://example.com/photos/tent%20pitch.jpg" alt="Our tent"><figcaption>Pitched at dusk</figcaption></figure><nav><button>Share</button></nav></article><!--EndFragment--></body></html>`;

const APPLE_NOTES = `<meta charset="UTF-8"><style type="text/css">p.p1 {margin: 0.0px 0.0px 0.0px 0.0px; font: 13.0px 'Helvetica Neue'}</style><div><h1>Groceries</h1></div><div>For <b>Saturday</b><br></div><div><br></div><ul><li>Eggs</li><li><i>Fresh</i> bread</li></ul><div><br></div><div>Call the shop</div>`;

const VS_CODE = `<meta charset='utf-8'><div style="color: #cccccc;background-color: #1f1f1f;font-family: Menlo, Monaco, 'Courier New', monospace;font-weight: normal;font-size: 12px;line-height: 18px;white-space: pre;"><div><span style="color: #569cd6;font-weight: bold;"># </span><span style="color: #569cd6;font-weight: bold;">Title</span></div><br><div><span style="color: #cccccc;">- item</span></div></div>`;

function toMarkdown(html: string): string {
    const blocks = htmlToBlocks(html);
    expect(blocks).not.toBeNull();
    const markdown = blocksToMarkdown(blocks!);
    expect(isRoundTripStable(markdown)).toBe(true);
    return markdown;
}

describe('htmlToBlocks — real clipboard HTML', () => {
    it('Google Docs: style-only bold/italic, the normal-weight wrapper, lists, checklists, tables', () => {
        expect(toMarkdown(GOOGLE_DOCS)).toBe(
            [
                '# Meeting notes',
                '',
                '**Decision:** ship the *beta* on [Friday](https://example.com/calendar).',
                '',
                '- Write the changelog',
                '  - ~~Draft it~~',
                '- `npm run build`',
                '',
                '- [x] Book the room',
                '- [ ] Send the invite',
                '',
                '| Owner | Due |',
                '| --- | --- |',
                '| Ana | Mon^1^ |',
            ].join('\n'),
        );
    });

    it('Notion: lists, to-dos, quote, fenced code with its language, rule', () => {
        expect(toMarkdown(NOTION)).toBe(
            [
                '## Launch plan',
                '',
                'Owner: **Sam**, see [Spec](https://www.notion.so/acme/Spec-0f1e2d3c4b5a) and ==read it==',
                '',
                '- Design',
                '  - Review mocks',
                '- Build',
                '',
                '1. Kickoff',
                '2. Ship',
                '',
                '- [x] Book room',
                '- [ ] Send invite',
                '',
                '> Ship small, ship often.',
                '',
                '```javascript',
                'const answer = 42;',
                'console.log(answer);',
                '```',
                '',
                '---',
                '',
                '~~Old idea~~ and `inline()`',
            ].join('\n'),
        );
    });

    it('GitHub README: badges, highlighted code, task lists, aligned table; no copy-button furniture', () => {
        expect(toMarkdown(GITHUB_README)).toBe(
            [
                '## Installation',
                '',
                '[CI](https://github.com/acme/tool/actions) Install it with `npm`:',
                '',
                '```shell',
                'npm install --save acme-tool',
                '```',
                '',
                '- [x] Parser',
                '- [ ] Docs',
                '',
                '| Option | Default |',
                '| :--- | ---: |',
                '| `port` | 8080 |',
                '',
                'Note',
                '',
                'See [the docs](https://github.com/acme/tool/blob/main/docs/config.md).',
            ].join('\n'),
        );
    });

    it('a web page with nested lists, a table and page furniture', () => {
        expect(toMarkdown(WEB_PAGE)).toBe(
            [
                '### Packing list',
                '',
                'Remember the *essentials*:',
                '',
                '- Clothes',
                '  - Shirts',
                '  - Socks',
                '    3. Wool',
                '    4. Cotton',
                '- Documents',
                '',
                'Prices',
                '',
                '| Item | Cost |',
                '| --- | --- |',
                '| Tent | $120 |',
                '| Total on request |  |',
                '',
                'Click here or there.',
                '',
                '[Our tent](https://example.com/photos/tent%20pitch.jpg)',
                '',
                'Pitched at dusk',
            ].join('\n'),
        );
    });

    it('Apple Notes: div-per-line paragraphs and their blank-line spacers', () => {
        expect(toMarkdown(APPLE_NOTES)).toBe(
            [
                '# Groceries',
                '',
                'For **Saturday**',
                '',
                '- Eggs',
                '- *Fresh* bread',
                '',
                'Call the shop',
            ].join('\n'),
        );
    });
});

describe('htmlToBlocks — what it refuses or strips', () => {
    it.each([
        ['empty', ''],
        [
            'a span of page text',
            '<meta charset="utf-8"><span style="color: rgb(0, 0, 0);">Just text</span>',
        ],
        ['plain paragraphs', '<p>One</p><p>Two</p>'],
        ['a code editor’s coloured lines, whose plain text is the Markdown source', VS_CODE],
    ])('defers to the plain-text flavour for %s', (_, html) => {
        expect(htmlToBlocks(html)).toBeNull();
    });

    it('keeps the text of scripts-free markup and drops unsafe or page-relative links', () => {
        expect(
            toMarkdown(
                '<p><b>Hi</b> <a href="javascript:alert(1)">x</a> <a href="#top">top</a> <a href="data:text/html,1">d</a><script>steal()</script><img src="x" onerror="steal()"></p>',
            ),
        ).toBe('**Hi** x top d');
    });

    it('never lets a mark cross a line break or hug a space', () => {
        expect(toMarkdown('<p><b>one<br>two </b>three <i> four</i></p>')).toBe(
            '**one**\n**two** three *four*',
        );
    });

    it('escapes text that would read back as structure', () => {
        expect(
            toMarkdown(
                '<p><b>Note</b></p><p># not a heading</p><p>1. not a list</p><p>**literal**</p>',
            ),
        ).toBe('**Note**\n\n\\# not a heading\n\n1\\. not a list\n\n\\*\\*literal\\*\\*');
    });

    it('writes a link labelled with its own address as an autolink', () => {
        expect(
            toMarkdown('<p>See <a href="https://example.com/a">https://example.com/a</a></p>'),
        ).toBe('See <https://example.com/a>');
    });

    it('splits a paragraph at a blank line and drops empty ones', () => {
        expect(toMarkdown('<div><i>a</i><br><br>b</div><p> </p><div><br></div>')).toBe('*a*\n\nb');
    });

    it('nests code, paragraphs and tables under the list item they sit in', () => {
        expect(
            toMarkdown(
                '<ol><li><p>Install</p><pre><code class="lang-sh">make</code></pre><p>Then run it.</p></li><li>Done</li></ol>',
            ),
        ).toBe('1. Install\n\n  ```sh\n  make\n  ```\n\n  Then run it.\n\n2. Done');
    });

    it('reads a to-do written as a leading [ ] or [x]', () => {
        expect(toMarkdown('<ul><li>[x] shipped</li><li>[ ] next</li></ul>')).toBe(
            '- [x] shipped\n- [ ] next',
        );
    });

    it('keeps a multi-paragraph quote as one quote', () => {
        expect(toMarkdown('<blockquote><p>First</p><p><em>Second</em></p></blockquote>')).toBe(
            '> First\n>\n> *Second*',
        );
    });

    it('clamps nesting to the editor’s depth limit', () => {
        const html =
            Array.from({length: 10}, (_, at) => `<ul><li>level ${at}`).join('') +
            '</li></ul>'.repeat(10);
        const blocks = htmlToBlocks(html)!;
        expect(Math.max(...blocks.map((block) => block.depth ?? 0))).toBe(6);
        expect(isRoundTripStable(blocksToMarkdown(blocks))).toBe(true);
    });

    it('reads a layout table’s content as ordinary blocks', () => {
        expect(toMarkdown('<table><tr><td><h2>Inside</h2><p>body</p></td></tr></table>')).toBe(
            '## Inside\n\nbody',
        );
    });

    it('reads a code editor’s view inside a larger fragment as a code block', () => {
        expect(toMarkdown(`<h2>Snippet</h2>${VS_CODE}`)).toBe(
            '## Snippet\n\n```\n# Title\n\n- item\n```',
        );
    });
});

describe('htmlToBlocks — property', () => {
    const TAGS = [
        'p',
        'div',
        'span',
        'b',
        'strong',
        'i',
        'em',
        's',
        'code',
        'mark',
        'sub',
        'sup',
        'a',
        'br',
        'h1',
        'h3',
        'ul',
        'ol',
        'li',
        'blockquote',
        'pre',
        'table',
        'tr',
        'td',
        'th',
        'hr',
        'img',
    ];
    const WORDS = [
        'word',
        ' ',
        '  ',
        '*',
        '**',
        '_',
        '`',
        '#',
        '- ',
        '1. ',
        '>',
        '|',
        '[[Note]]',
        '\\',
        '~~',
        '==',
        '&amp;',
        '&nbsp;',
        'x',
    ];

    function random(seed: number) {
        let state = seed;
        return (limit: number) => {
            state = (state * 1103515245 + 12345) % 2147483648;
            return state % limit;
        };
    }

    function soup(next: (limit: number) => number, depth: number): string {
        let html = '';
        const count = 1 + next(4);
        for (let n = 0; n < count; n++) {
            if (depth > 4 || next(3) === 0) {
                html += WORDS[next(WORDS.length)];
                continue;
            }
            const tag = TAGS[next(TAGS.length)];
            if (tag === 'br' || tag === 'hr') html += `<${tag}>`;
            else if (tag === 'img') html += '<img src="https://example.com/i.png" alt="pic">';
            else {
                const attrs =
                    tag === 'a'
                        ? ' href="https://example.com/x"'
                        : next(4) === 0
                          ? ' style="font-weight:700;font-style:italic"'
                          : '';
                html += `<${tag}${attrs}>${soup(next, depth + 1)}</${tag}>`;
            }
        }
        return html;
    }

    it('writes Markdown that always round-trips', () => {
        for (let seed = 1; seed <= 400; seed++) {
            const html = soup(random(seed), 0);
            const blocks = htmlToBlocks(html);
            if (!blocks) continue;
            const markdown = blocksToMarkdown(blocks);
            expect({html, stable: isRoundTripStable(markdown)}).toEqual({html, stable: true});
        }
    });
});

describe('htmlToBlocks — spanning table cells', () => {
    it('keeps a row under a rowspan cell in its own columns', () => {
        const html =
            '<table><tr><th>Person</th><th>Q1</th><th>Q2</th></tr>' +
            '<tr><td rowspan="2">Alice</td><td>10</td><td>20</td></tr>' +
            '<tr><td>30</td><td>40</td></tr></table>';
        const table = htmlToBlocks(html)?.find((block) => block.type === 'table')?.table;
        expect(table?.cells).toEqual([
            ['Person', 'Q1', 'Q2'],
            ['Alice', '10', '20'],
            ['', '30', '40'],
        ]);
    });

    it('does not build a table whose spans describe a huge grid', () => {
        const wide = Array.from({length: 1000}, () => '<td colspan="50">x</td>').join('');
        const rows = Array.from({length: 2000}, () => '<tr><td>y</td></tr>').join('');
        const started = performance.now();
        const blocks = htmlToBlocks(`<table><tr>${wide}</tr>${rows}</table>`) ?? [];
        expect(blocks.some((block) => block.type === 'table')).toBe(false);
        expect(performance.now() - started).toBeLessThan(2000);
    });
});
