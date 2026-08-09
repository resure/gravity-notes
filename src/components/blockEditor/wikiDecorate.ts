/**
 * `[[wiki link]]` decoration for a block's inner HTML — the editable counterpart of
 * `NotePreview.withWikiLinks`.
 *
 * The block engine re-serializes the WHOLE document from the live DOM on every keystroke, so a
 * decoration that changed the TEXT (hiding the brackets, the way the read-only preview does) would
 * rewrite every `[[Title]]` in the file to a bare `Title` the first time a single character changed
 * anywhere in the note. So the wrapper here is style-only: `<span class="wiki-link">[[Title]]</span>`
 * keeps the literal bytes as its text, and `inlineHtmlToMarkdown` — which drops any tag it has no
 * Markdown spelling for while keeping its text — writes the note back byte-identical.
 *
 * Because the text never changes, a plain-text caret offset is invariant across a decoration pass,
 * which is what lets the editor re-decorate mid-typing and simply put the caret back where it was.
 *
 * String-based rather than DOM-based, like the rest of `src/markdown/*`: it runs in plain Node tests
 * and cannot be fooled by whatever a browser normalizes the markup into.
 */

import {WIKI_LINK_CLASS} from '../../markdown';

/** Marks a link whose target resolves to no note (styled as "broken", like the Markdown engine's). */
export const WIKI_LINK_BROKEN_CLASS = 'wiki-link_broken';

const WIKI_LINK = /\[\[([^[\]\n]+)\]\]/g;
/**
 * A whole wrapper written by a previous pass. Matched as a unit (rather than as two loose tags) so
 * the pass can never eat a `</span>` that isn't ours; the wrapper's content is escaped text, so it
 * holds no nested tags to confuse the lazy match.
 */
const EXISTING_WRAPPER = new RegExp(
    `<span class="${WIKI_LINK_CLASS}(?: ${WIKI_LINK_BROKEN_CLASS})?">([^<]*)</span>`,
    'g',
);
/** Cheap pre-test: nothing to do unless the html holds a link or a wrapper from an earlier pass. */
const NEEDS_PASS = new RegExp(`\\[\\[|class="${WIKI_LINK_CLASS}`);

/**
 * Strip the wrappers a previous pass added, so re-decorating is idempotent and a link the user just
 * broke up (deleting a `]`) loses its styling. Only OUR spans are touched; a `<span>` from anywhere
 * else can't reach a block's html (the editor's sanitizer drops it).
 */
function undecorate(html: string): string {
    return html.replace(EXISTING_WRAPPER, '$1');
}

/**
 * Wrap every `[[target]]` in `html` for styling. `isBroken` decides the broken class per target
 * (already normalized of `|alias` / `#heading` by the caller's resolver).
 *
 * Text inside `<code>` is left alone — a wiki link written in a code span is code, not a link — and
 * so is anything already inside an `<a>`.
 */
export function decorateWikiLinks(html: string, isBroken: (target: string) => boolean): string {
    if (!NEEDS_PASS.test(html)) return html;
    const source = undecorate(html);
    let out = '';
    let index = 0;
    let opaqueDepth = 0; // inside <code> / <a>: the text there is not a link

    const pushText = (text: string) => {
        if (opaqueDepth > 0 || !text.includes('[[')) {
            out += text;
            return;
        }
        out += text.replace(WIKI_LINK, (whole, inner: string) => {
            const className = isBroken(inner)
                ? `${WIKI_LINK_CLASS} ${WIKI_LINK_BROKEN_CLASS}`
                : WIKI_LINK_CLASS;
            return `<span class="${className}">${whole}</span>`;
        });
    };

    while (index < source.length) {
        const lt = source.indexOf('<', index);
        if (lt === -1) {
            pushText(source.slice(index));
            break;
        }
        if (lt > index) pushText(source.slice(index, lt));
        const gt = source.indexOf('>', lt);
        if (gt === -1) {
            pushText(source.slice(lt));
            break;
        }
        const tag = source.slice(lt, gt + 1);
        const name = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(tag)?.[1].toLowerCase();
        if (name === 'code' || name === 'a') {
            opaqueDepth = tag[1] === '/' ? Math.max(0, opaqueDepth - 1) : opaqueDepth + 1;
        }
        out += tag;
        index = gt + 1;
    }
    return out;
}

/** Every distinct `[[target]]` in a block's html (raw inner text, alias/anchor included). */
export function wikiTargetsIn(html: string): string[] {
    const targets = new Set<string>();
    for (const match of html.matchAll(WIKI_LINK)) targets.add(match[1]);
    return [...targets];
}
