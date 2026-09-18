/**
 * A colour ⇄ the bytes that carry it.
 *
 * The file spells a colour the way the YFM colour extension does — `{red}(text)` for ink,
 * `{bg:red}(text)` for a background — because read-only preview already renders that syntax
 * (`NotePreview` loads `@diplodoc/color-extension`) and because notes written by this app's previous
 * editor already contain it. It is not portable: Obsidian and GitHub show the braces as text. No
 * spelling for colour is (see docs/architecture.md), and this one at least reads back in one of the
 * app's own surfaces.
 *
 * A block colour is the same wrapper covering the block's whole content, LINE BY LINE — a paragraph
 * the file wraps across three lines carries three wrappers. The reader parses inline markup one line
 * at a time, so a wrapper that spanned a newline would come back as literal braces; per line, a
 * hard-wrapped paragraph keeps its colour and the bytes still round-trip.
 */

import {BLOCK_COLORS} from '../components/blockEditor/types';
import type {BlockColor, BlockType} from '../components/blockEditor/types';

const BACKGROUND = '_background';
const BACKGROUND_TOKEN = 'bg:';

/**
 * The class the editor puts on a coloured span, and the only `class` a `<span>` in a block's html
 * may carry besides the `[[wiki link]]` wrapper's. Like that one it is STYLE-ONLY in the sense that
 * matters here: the serializer knows how to write it back, so re-serializing the document on every
 * keystroke cannot lose it.
 */
export const COLOR_CLASS = 'gn-color';

const PALETTE = new Set<string>(BLOCK_COLORS);

export function colorClassFor(color: BlockColor): string {
    return `${COLOR_CLASS} ${COLOR_CLASS}--${color}`;
}

/** The colour a span's `class` carries, or null for any other span (the wiki-link wrapper). */
export function colorFromClass(className: string): BlockColor | null {
    // Every `[[wiki link]]` is a span too, and the serializer asks this of each one on every
    // keystroke — so answer the common "not a colour" case without splitting anything.
    if (!className.includes(`${COLOR_CLASS}--`)) return null;
    for (const name of className.split(/\s+/)) {
        if (!name.startsWith(`${COLOR_CLASS}--`)) continue;
        const color = name.slice(COLOR_CLASS.length + 2);
        if (PALETTE.has(color) && color !== 'default') return color as BlockColor;
    }
    return null;
}

/** How the file spells this colour, or null for one that carries nothing (`default`). */
export function colorToken(color: BlockColor | undefined): string | null {
    if (!color || color === 'default') return null;
    return color.endsWith(BACKGROUND)
        ? `${BACKGROUND_TOKEN}${color.slice(0, -BACKGROUND.length)}`
        : color;
}

/**
 * The colour a `{token}` names, or null when it names nothing this app knows.
 *
 * Unknown tokens are deliberately left alone: the colour extension colours `{anything}(text)`, so
 * reading every one of them would claim `{n}(x)` out of somebody's maths or code prose — and the
 * app would then rewrite that note's braces as markup it had decided to own.
 */
export function colorFromToken(token: string): BlockColor | null {
    const name = token.startsWith(BACKGROUND_TOKEN)
        ? `${token.slice(BACKGROUND_TOKEN.length)}${BACKGROUND}`
        : token;
    return PALETTE.has(name) && name !== 'default' ? (name as BlockColor) : null;
}

/**
 * Whether a block's colour survives a save. A colour is written as a wrapper around the block's own
 * inline text, so the types whose content isn't inline text have nowhere to put it: a fence's body
 * is literal, a table's text lives in its cells, and a divider or image has no text at all.
 *
 * Lives here, next to the writer that makes it true, because BOTH ends read it — the editor to
 * refuse the colour up front, and the parser to skip lifting one back.
 */
export function canCarryColor(type: BlockType): boolean {
    return type !== 'code' && type !== 'table' && type !== 'divider' && type !== 'image';
}

/** Wrap a block's serialized content in its colour, one wrapper per line. */
export function wrapBlockColor(markdown: string, color: BlockColor | undefined): string {
    const token = colorToken(color);
    if (!token) return markdown;
    return markdown
        .split('\n')
        .map((line) => (line === '' ? line : `{${token}}(${line})`))
        .join('\n');
}

/**
 * The inverse: a block whose every line is wrapped in the SAME colour is a coloured block, not a run
 * of coloured spans that happens to cover it. Returns the html with those wrappers removed, or null
 * when the block isn't one.
 */
export function liftBlockColor(html: string): {html: string; color: BlockColor} | null {
    const lines = html.split('<br>');
    let color: BlockColor | null = null;
    const stripped: string[] = [];
    for (const line of lines) {
        const span = wholeSpan(line);
        if (!span || (color && span.color !== color)) return null;
        color = span.color;
        stripped.push(span.inner);
    }
    return color ? {html: stripped.join('<br>'), color} : null;
}

const SPAN_OPEN = /^<span class="([^"]*)">/;

/** The colour span covering ALL of `html`, or null — including for two spans laid end to end. */
function wholeSpan(html: string): {color: BlockColor; inner: string} | null {
    const open = SPAN_OPEN.exec(html);
    const color = open && colorFromClass(open[1]);
    if (!open || !color || !html.endsWith('</span>')) return null;
    // Walk the nesting: a span closed before the end (`<span red>a</span><span red>b</span>`) covers
    // half the line, and lifting it would move the other half's text inside the first one.
    let depth = 0;
    for (const tag of html.matchAll(/<(\/?)span\b[^>]*>/g)) {
        depth += tag[1] ? -1 : 1;
        if (depth === 0 && tag.index + tag[0].length < html.length) return null;
    }
    return depth === 0 ? {color, inner: html.slice(open[0].length, -'</span>'.length)} : null;
}
