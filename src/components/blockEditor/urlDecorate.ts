/**
 * Bare `http(s)://` URLs as links in the editor, the way `[[wiki links]]` are (see wikiDecorate.ts):
 * a style-only wrapper whose text is the URL itself, so `inlineHtmlToMarkdown` writes the note back
 * byte-identical and a caret offset survives a pass. The file keeps the bare URL, which the preview,
 * Obsidian and GitHub all link on their own.
 */

import {WIKI_LINK_CLASS, decodeEntities, inlineHtmlToMarkdown} from '../../markdown';

export const URL_LINK_CLASS = 'url-link';

const EXISTING_WRAPPER = new RegExp(`<span class="${URL_LINK_CLASS}">([^<]*)</span>`, 'g');
const NEEDS_PASS = new RegExp(`https?://|class="${URL_LINK_CLASS}"`, 'i');
// Explicit schemes only, like the preview's linkify: a bare `example.com` stays text.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', "'", '"', '*', '_', '~']);
const BRACKETS = [
    ['(', ')'],
    ['[', ']'],
];

/**
 * Where a URL found in prose really ends: sentence punctuation and an unopened bracket are not part
 * of it. Walks an index rather than re-slicing, so a run of thousands of `)` stays linear.
 */
export function trimUrl(url: string): string {
    let end = url.length;
    const skipTrailing = () => {
        while (end > 0 && TRAILING.has(url[end - 1])) end--;
    };
    skipTrailing();
    for (const [open, close] of BRACKETS) {
        let opens = 0;
        let closes = 0;
        for (let at = 0; at < end; at++) {
            if (url[at] === open) opens++;
            else if (url[at] === close) closes++;
        }
        while (end > 0 && url[end - 1] === close && opens < closes) {
            end--;
            closes--;
            skipTrailing();
        }
    }
    return url.slice(0, end);
}

export function findUrls(text: string): {start: number; end: number}[] {
    const found: {start: number; end: number}[] = [];
    for (const match of text.matchAll(URL_PATTERN)) {
        const url = trimUrl(match[0]);
        if (url.length > url.indexOf('//') + 2) {
            found.push({start: match.index, end: match.index + url.length});
        }
    }
    return found;
}

/** The decoded text of an escaped HTML run, and where each decoded character starts in the run. */
function decodeWithOffsets(escaped: string): {text: string; at: number[]} {
    let text = '';
    const at: number[] = [];
    let index = 0;
    while (index < escaped.length) {
        const entity =
            escaped[index] === '&'
                ? /^&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/.exec(escaped.slice(index))
                : null;
        const piece = entity ? decodeEntities(entity[0]) : escaped[index];
        for (let unit = 0; unit < piece.length; unit++) at.push(index);
        text += piece;
        index += entity ? entity[0].length : 1;
    }
    at.push(escaped.length);
    return {text, at};
}

function wrapUrls(escaped: string): string {
    if (!/https?:/i.test(escaped)) return escaped;
    const {text, at} = decodeWithOffsets(escaped);
    let out = '';
    let last = 0;
    for (const {start, end} of findUrls(text)) {
        out += escaped.slice(last, at[start]);
        out += `<span class="${URL_LINK_CLASS}">${escaped.slice(at[start], at[end])}</span>`;
        last = at[end];
    }
    return out + escaped.slice(last);
}

/**
 * Wrap every bare URL in `html`. Text inside `<a>` and `<code>` is left alone, and so is a wiki
 * link's text — `[[https://…]]` is a link to a note.
 */
export function decorateUrls(html: string): string {
    if (!NEEDS_PASS.test(html)) return html;
    const source = html.replace(EXISTING_WRAPPER, '$1');
    let out = '';
    let index = 0;
    let opaqueDepth = 0;
    // Whether each open `<span>` is a wiki link, so its `</span>` can be told from a colour's.
    const spans: boolean[] = [];

    while (index < source.length) {
        const lt = source.indexOf('<', index);
        const gt = lt === -1 ? -1 : source.indexOf('>', lt);
        if (lt === -1 || gt === -1) {
            out += opaqueDepth ? source.slice(index) : wrapUrls(source.slice(index));
            break;
        }
        if (lt > index) {
            const text = source.slice(index, lt);
            out += opaqueDepth ? text : wrapUrls(text);
        }
        const tag = source.slice(lt, gt + 1);
        const closing = tag[1] === '/';
        const name = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(tag)?.[1].toLowerCase();
        if (name === 'code' || name === 'a') {
            opaqueDepth = closing ? Math.max(0, opaqueDepth - 1) : opaqueDepth + 1;
        } else if (name === 'span') {
            if (closing) {
                if (spans.pop()) opaqueDepth = Math.max(0, opaqueDepth - 1);
            } else {
                const wiki = new RegExp(`class="${WIKI_LINK_CLASS}[ "]`).test(tag);
                spans.push(wiki);
                if (wiki) opaqueDepth++;
            }
        }
        out += tag;
        index = gt + 1;
    }
    // The wrapper splits a text run in two, and escaping is decided per run: `\~https://x~` would
    // lose its backslash. Such a block simply stays undecorated.
    if (out !== source && inlineHtmlToMarkdown(out) !== inlineHtmlToMarkdown(source)) return source;
    return out;
}
