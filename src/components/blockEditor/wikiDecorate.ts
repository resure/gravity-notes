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
 * The link renders as an atomic chip (`contenteditable="false"`): the caret steps over it as one
 * unit and the link is changed through its popup. Inside, the parts a reader shouldn't see — the
 * brackets, and the note name when an `|alias` gives display text — sit in `WIKI_HIDDEN_CLASS`
 * spans, hidden by CSS. The text, and so the file, still holds every byte.
 *
 * String-based rather than DOM-based, like the rest of `src/markdown/*`: it runs in plain Node tests
 * and cannot be fooled by whatever a browser normalizes the markup into.
 */

import {WIKI_LINK_CLASS, decodeEntities} from '../../markdown';
import {splitWikiTarget} from '../../wikiLinks';

/** Marks a link whose target resolves to no note (styled as "broken", like the Markdown engine's). */
export const WIKI_LINK_BROKEN_CLASS = 'wiki-link_broken';
/** Wraps the parts of a link that are kept in the text but never shown: `[[`, `]]`, `Note|`. */
export const WIKI_HIDDEN_CLASS = 'wiki-hidden';

const WIKI_LINK = /\[\[([^[\]\n]+)\]\]/g;
/** Cheap pre-test: nothing to do unless the html holds a link or a wrapper from an earlier pass. */
const NEEDS_PASS = new RegExp(`\\[\\[|class="${WIKI_LINK_CLASS}`);

const OUR_SPAN = new RegExp(`^<span class="(?:${WIKI_LINK_CLASS}|${WIKI_HIDDEN_CLASS})[ "]`);

/**
 * Strip the wrappers a previous pass added, so re-decorating is idempotent and a link the user just
 * broke up (deleting a `]`) loses its styling. Spans are paired by a stack rather than by pattern,
 * so typing that lands INSIDE a bracket span (or a colour span around a link) can never make the
 * pass drop someone else's `</span>`. Only OUR spans are removed; a `<span>` from anywhere else
 * can't reach a block's html (the editor's sanitizer drops it).
 */
export function undecorate(html: string): string {
    if (!html.includes('class="wiki-')) return html;
    let out = '';
    let index = 0;
    const ours: boolean[] = [];
    while (index < html.length) {
        const lt = html.indexOf('<', index);
        if (lt === -1) {
            out += html.slice(index);
            break;
        }
        out += html.slice(index, lt);
        const gt = html.indexOf('>', lt);
        if (gt === -1) {
            out += html.slice(lt);
            break;
        }
        const tag = html.slice(lt, gt + 1);
        if (/^<span[\s>]/i.test(tag)) {
            const mine = OUR_SPAN.test(tag);
            ours.push(mine);
            if (!mine) out += tag;
        } else if (/^<\/span>/i.test(tag)) {
            if (!ours.pop()) out += tag;
        } else {
            out += tag;
        }
        index = gt + 1;
    }
    return out;
}

const hidden = (text: string) => `<span class="${WIKI_HIDDEN_CLASS}">${text}</span>`;

/** The chip's inside: the note name, or — given `Note|text` — the text, with the rest hidden. */
function chipContent(inner: string): string {
    const {name, alias} = splitWikiTarget(inner);
    if (alias === null) return `${hidden('[[')}${inner}${hidden(']]')}`;
    return `${hidden(`[[${name}|`)}${alias}${hidden(']]')}`;
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
        out += text.replace(WIKI_LINK, (_whole, inner: string) => {
            // This walks HTML, so the target arrives escaped — `[[R&D notes]]` is `[[R&amp;D notes]]`
            // here. Resolve the DECODED form, or every title holding an `&`, `<` or `>` would read
            // as broken while ⌘↵ (which reads textContent) followed it perfectly well.
            const className = isBroken(decodeEntities(inner))
                ? `${WIKI_LINK_CLASS} ${WIKI_LINK_BROKEN_CLASS}`
                : WIKI_LINK_CLASS;
            return `<span class="${className}" contenteditable="false">${chipContent(inner)}</span>`;
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

/**
 * Every distinct `[[target]]` in a block's html (alias/anchor included), decoded back out of its
 * HTML escaping so callers get the target as the file spells it.
 */
export function wikiTargetsIn(html: string): string[] {
    const targets = new Set<string>();
    for (const match of html.matchAll(WIKI_LINK)) targets.add(decodeEntities(match[1]));
    return [...targets];
}
