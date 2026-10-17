import {blocksToMarkdown, hasUnsupportedMarkdown, markdownToBlocks} from '../../markdown';
import {escapeHtml} from '../../markdown/inline';

import {MAX_BLOCK_DEPTH} from './documentModel';
import {newBlock} from './types';
import type {Block, BlockType, ColumnAlign} from './types';

interface Marks {
    href?: string;
    strong?: boolean;
    em?: boolean;
    s?: boolean;
    mark?: boolean;
    sub?: boolean;
    sup?: boolean;
    code?: boolean;
}

type Flag = Exclude<keyof Marks, 'href'>;

// Outermost first. Code is innermost because the serializer writes a code span's content verbatim,
// so any delimiter inside one would become literal text.
const FLAGS: Flag[] = ['strong', 'em', 's', 'mark', 'sub', 'sup', 'code'];

type Run =
    | {kind: 'text'; text: string; marks: Marks}
    | {kind: 'image'; alt: string; src: string; marks: Marks}
    | {kind: 'br'};

interface Item {
    type: BlockType;
    depth: number;
    checked?: boolean;
    listStart?: number;
    emitted: boolean;
}

interface Frame {
    depth: number;
    marks: Marks;
    item: Item | null;
    quote: Block | null;
}

const TAG_FLAGS: Record<string, Flag> = {
    b: 'strong',
    strong: 'strong',
    i: 'em',
    em: 'em',
    s: 's',
    strike: 's',
    del: 's',
    mark: 'mark',
    sub: 'sub',
    sup: 'sup',
    code: 'code',
    kbd: 'code',
    samp: 'code',
    tt: 'code',
};

const SKIPPED = new Set([
    'area',
    'audio',
    'base',
    'button',
    'canvas',
    'datalist',
    'embed',
    'frame',
    'head',
    'iframe',
    'input',
    'link',
    'map',
    'meta',
    'noscript',
    'object',
    'option',
    'rp',
    'script',
    'select',
    'source',
    'style',
    'svg',
    'template',
    'textarea',
    'title',
    'track',
    'video',
]);

const BLOCK_TAGS = [
    'address',
    'article',
    'aside',
    'blockquote',
    'body',
    'caption',
    'center',
    'details',
    'dialog',
    'dd',
    'div',
    'dl',
    'dt',
    'fieldset',
    'figcaption',
    'figure',
    'footer',
    'form',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hgroup',
    'hr',
    'html',
    'legend',
    'li',
    'main',
    'menu',
    'nav',
    'ol',
    'p',
    'pre',
    'section',
    'summary',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'ul',
];
const BLOCK = new Set(BLOCK_TAGS);
const BLOCK_SELECTOR = BLOCK_TAGS.join(',');

const LIST_TYPES = new Set<BlockType>(['bulleted', 'numbered', 'todo']);
const LINK_SCHEME = /^(?:https?|mailto|tel):/i;
const AUTOLINK = /^(?:https?|mailto):[^<>\s]+$/i;
const MONOSPACE =
    /\b(?:monospace|courier|consolas|menlo|monaco|roboto mono|source code pro|fira code|jetbrains mono|sf mono)\b/i;
const LANGUAGE = /^[\w+#.-]+$/;

/**
 * Clipboard HTML → blocks, or null when the HTML carries nothing that the plain-text flavour does
 * not (a code editor's syntax-coloured lines, a span of page text) so that flavour, which may be
 * Markdown source, wins.
 *
 * The result is what the note will reload as: the built blocks go through the Markdown writer and
 * back through the parser, so nothing the file cannot spell ever reaches the editor.
 */
export function htmlToBlocks(html: string): Block[] | null {
    if (!html.trim()) return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const content = [...doc.body.children].filter((child) => !isSkipped(child));
    if (content.length === 1 && isCodeView(content[0])) return null;
    const built = new Importer().run(doc.body);
    if (!built.some((block) => block.type !== 'text' || /<(?!br>)/.test(block.html))) return null;
    const markdown = blocksToMarkdown(built);
    if (!markdown || hasUnsupportedMarkdown(markdown)) return null;
    return markdownToBlocks(markdown);
}

class Importer {
    private blocks: Block[] = [];
    private runs: Run[] = [];

    run(body: HTMLElement): Block[] {
        const frame: Frame = {depth: 0, marks: {}, item: null, quote: null};
        this.walk(body, frame);
        this.flush(frame);
        return this.blocks;
    }

    private walk(parent: Node, frame: Frame) {
        for (const child of parent.childNodes) this.visit(child, frame);
    }

    private visit(node: Node, frame: Frame) {
        if (node.nodeType === Node.TEXT_NODE) {
            this.runs.push(textRun(node, frame.marks));
            return;
        }
        if (!isElement(node) || isSkipped(node)) return;
        const tag = node.localName;
        if (!BLOCK.has(tag)) {
            if (node.querySelector(BLOCK_SELECTOR)) {
                this.walk(node, {...frame, marks: marksFor(node, frame.marks)});
            } else collectInline(node, frame.marks, this.runs);
            return;
        }
        this.flush(frame);
        const nested = frame.item !== null || frame.quote !== null;
        if (/^h[1-6]$/.test(tag) && !nested) {
            const runs: Run[] = [];
            collectInline(node, frame.marks, runs, ' ');
            this.emit(`heading${tag[1]}` as BlockType, runsToHtml(unbold(runs), ' '), frame.depth);
        } else if (tag === 'ul' || tag === 'ol') {
            const first = this.blocks.length;
            this.list(node, frame, listDepth(frame));
            // Two lists in a row are two lists, not one that changes its marker.
            const previous = this.blocks[first - 1];
            if (!frame.item && this.blocks[first] && previous && LIST_TYPES.has(previous.type)) {
                this.blocks[first].blankBefore = 1;
            }
        } else if (tag === 'li') {
            this.item(node, frame, listDepth(frame), 'bulleted');
        } else if (tag === 'blockquote' && !frame.quote) {
            const quote = newBlock('quote');
            this.walk(node, {...frame, quote});
            this.flush({...frame, quote});
            if (quote.html) this.place(quote, frame);
        } else if (tag === 'pre' || isCodeView(node)) {
            this.code(node, frame);
        } else if (tag === 'table' && !isLayoutTable(node)) {
            this.table(node, frame);
        } else if (tag === 'hr') {
            if (!nested) this.emit('divider', '', frame.depth);
        } else {
            this.walk(node, frame);
        }
        this.flush(frame);
    }

    private list(list: Element, frame: Frame, depth: number) {
        const ordered = list.localName === 'ol';
        const start = Number.parseInt(list.getAttribute('start') ?? '', 10);
        let first = true;
        for (const child of list.childNodes) {
            if (!isElement(child) || isSkipped(child)) continue;
            if (child.localName === 'li') {
                const listStart = ordered && first && start >= 0 && start !== 1 ? start : undefined;
                this.item(child, frame, depth, ordered ? 'numbered' : 'bulleted', listStart);
                first = false;
            } else if (child.localName === 'ul' || child.localName === 'ol') {
                // Google Docs nests a sublist as a sibling of the items rather than inside one.
                this.list(child, frame, Math.min(depth + 1, MAX_BLOCK_DEPTH));
            } else {
                this.visit(child, {...frame, depth, item: null});
                this.flush({...frame, depth, item: null});
            }
        }
    }

    private item(li: Element, frame: Frame, depth: number, type: BlockType, listStart?: number) {
        const item: Item = {type, depth, listStart, emitted: false};
        const checked = checkboxState(li);
        if (checked !== null) {
            item.type = 'todo';
            item.checked = checked;
        }
        const inner = {...frame, depth, item};
        this.walk(li, inner);
        this.flush(inner);
    }

    private code(pre: Element, frame: Frame) {
        const text = preText(pre)
            .replace(/\u00a0/g, ' ')
            .replace(/\n$/, '');
        if (!text.trim()) return;
        if (frame.quote) {
            this.appendToQuote(frame.quote, escapeHtml(text).replace(/\n/g, '<br>'));
            return;
        }
        const block = newBlock('code', escapeHtml(text));
        const language = codeLanguage(pre);
        if (language) block.language = language;
        this.place(block, frame);
    }

    private table(table: Element, frame: Frame) {
        const rows = [...(table as HTMLTableElement).rows].filter(
            (row) => row.closest('table') === table,
        );
        if (!rows.length) return;
        const caption = [...table.children].find((child) => child.localName === 'caption');
        if (caption) {
            collectInline(caption, frame.marks, this.runs);
            this.flush(frame);
        }
        const runs = rows.map((row) =>
            [...row.cells].map((cell) => {
                const collected: Run[] = [];
                collectInline(cell, frame.marks, collected, ' ');
                return collected;
            }),
        );
        const head = rows[0];
        // Google Docs has no header cells; a first row set entirely in bold is how it shows one.
        const headerRow =
            head.parentElement?.localName === 'thead' ||
            [...head.cells].every((cell) => cell.localName === 'th') ||
            (runs[0].some(hasText) && runs[0].every((cell) => !hasText(cell) || allBold(cell)));
        const cells = rows.map((row, at) =>
            [...row.cells].flatMap((cell, column) => {
                const content = runs[at][column];
                const html = runsToHtml(at === 0 && headerRow ? unbold(content) : content, ' ');
                const span = Math.min(Math.max(1, cell.colSpan || 1), 50);
                return [html, ...Array<string>(span - 1).fill('')];
            }),
        );
        const width = cells.reduce((max, row) => Math.max(max, row.length), 0);
        if (!width) return;
        for (const row of cells) while (row.length < width) row.push('');
        if (frame.quote) {
            for (const row of cells) this.appendToQuote(frame.quote, row.join(' '));
            return;
        }
        const align = [...head.cells].flatMap((cell) =>
            Array<ColumnAlign | null>(Math.max(1, cell.colSpan || 1)).fill(cellAlign(cell)),
        );
        const block = newBlock('table');
        block.table = {
            cells,
            headerRow,
            headerColumn: false,
            align: align.some(Boolean) ? align.slice(0, width) : undefined,
        };
        this.place(block, frame);
    }

    private flush(frame: Frame) {
        const runs = this.runs;
        if (!runs.length) return;
        this.runs = [];
        for (const paragraph of splitParagraphs(runs)) {
            if (frame.quote) {
                const html = runsToHtml(paragraph);
                if (html) this.appendToQuote(frame.quote, html);
                continue;
            }
            const item = frame.item;
            if (item && !item.emitted) {
                const task = item.type === 'bulleted' ? stripTaskMarker(paragraph) : null;
                const html = runsToHtml(paragraph);
                if (!html) continue;
                item.emitted = true;
                const block = this.emit(task ? 'todo' : item.type, html, item.depth);
                if (task) block.checked = task.checked;
                else if (item.type === 'todo') block.checked = item.checked;
                if (item.listStart !== undefined) block.listStart = item.listStart;
                continue;
            }
            const html = runsToHtml(paragraph);
            if (html) this.emit('text', html, item ? childDepth(item.depth) : frame.depth);
        }
    }

    private appendToQuote(quote: Block, html: string) {
        quote.html = quote.html ? `${quote.html}<br><br>${html}` : html;
    }

    private place(block: Block, frame: Frame) {
        this.blocks.push({...block, depth: listDepth(frame)});
    }

    private emit(type: BlockType, html: string, depth: number): Block {
        const block = newBlock(type, html);
        block.depth = depth;
        this.blocks.push(block);
        return block;
    }
}

function childDepth(depth: number): number {
    return Math.min(depth + 1, MAX_BLOCK_DEPTH);
}

/** A list under an item that has text nests beneath it; under an empty one it stays level. */
function listDepth(frame: Frame): number {
    if (!frame.item) return frame.depth;
    return frame.item.emitted ? childDepth(frame.item.depth) : frame.item.depth;
}

/**
 * A code editor's rendering (VS Code and its forks): coloured spans in a monospace `white-space:
 * pre` div. Alone on the clipboard its plain text is the source, which may well be Markdown.
 */
function isCodeView(element: Element): boolean {
    return (
        element.localName === 'div' &&
        styleOf(element, 'white-space').startsWith('pre') &&
        MONOSPACE.test(styleOf(element, 'font-family'))
    );
}

function isElement(node: Node): node is Element {
    return node.nodeType === Node.ELEMENT_NODE;
}

function isSkipped(element: Element): boolean {
    if (SKIPPED.has(element.localName) || element.hasAttribute('hidden')) return true;
    const style = element.getAttribute('style') ?? '';
    return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style);
}

function styleOf(element: Element, property: string): string {
    const style = element.getAttribute('style');
    if (!style) return '';
    // The last declaration wins; Google Docs repeats `vertical-align` and `white-space`.
    const matches = style.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'gi'));
    return [...matches].pop()?.[1].trim().toLowerCase() ?? '';
}

function marksFor(element: Element, inherited: Marks): Marks {
    let marks = inherited;
    const set = <K extends keyof Marks>(key: K, value: Marks[K]) => {
        if (marks[key] !== value) marks = {...marks, [key]: value};
    };
    const tag = element.localName;
    const flag = TAG_FLAGS[tag];
    if (flag) set(flag, true);
    else if (tag === 'a') {
        const href = element.getAttribute('href')?.trim() ?? '';
        if (LINK_SCHEME.test(href)) set('href', href);
    }

    // Google Docs and Chromium's copy of rendered text say it all in inline styles; Docs even
    // wraps the whole fragment in a `<b style="font-weight:normal">`.
    const weight = styleOf(element, 'font-weight');
    if (weight) {
        const numeric = Number(weight);
        set('strong', weight === 'bold' || weight === 'bolder' || numeric >= 600);
    }
    const fontStyle = styleOf(element, 'font-style');
    if (fontStyle) set('em', fontStyle === 'italic' || fontStyle === 'oblique');
    const decoration =
        styleOf(element, 'text-decoration-line') || styleOf(element, 'text-decoration');
    if (decoration.includes('line-through')) set('s', true);
    const align = styleOf(element, 'vertical-align');
    if (align === 'super') set('sup', true);
    else if (align === 'sub') set('sub', true);
    if ((tag === 'span' || tag === 'font') && MONOSPACE.test(styleOf(element, 'font-family'))) {
        set('code', true);
    }
    return marks;
}

function textRun(node: Node, marks: Marks): Run {
    return {kind: 'text', text: node.textContent ?? '', marks};
}

/**
 * An element's content as inline runs. Inside a heading or a table cell there is nowhere for a
 * line break or a nested block to go, so both become `separator`.
 */
function collectInline(node: Element, marks: Marks, runs: Run[], separator?: string) {
    const visit = (current: Node, inherited: Marks) => {
        if (current.nodeType === Node.TEXT_NODE) {
            runs.push(textRun(current, inherited));
            return;
        }
        if (!isElement(current) || isSkipped(current)) return;
        const tag = current.localName;
        if (tag === 'br') {
            runs.push(separator ? {kind: 'text', text: separator, marks: {}} : {kind: 'br'});
            return;
        }
        if (tag === 'img') {
            if (current.getAttribute('role') === 'presentation') return;
            runs.push({
                kind: 'image',
                alt: current.getAttribute('alt')?.trim() ?? '',
                src: current.getAttribute('src')?.trim() ?? '',
                marks: inherited,
            });
            return;
        }
        const block = BLOCK.has(tag);
        if (block) runs.push(separator ? {kind: 'text', text: ' ', marks: {}} : {kind: 'br'});
        const next = marksFor(current, inherited);
        for (const child of current.childNodes) visit(child, next);
        if (block) runs.push(separator ? {kind: 'text', text: ' ', marks: {}} : {kind: 'br'});
    };
    visit(node, marks);
}

/** Headings and header cells are bold already; `# **Title**` says nothing more. */
function unbold(runs: Run[]): Run[] {
    return runs.map((run) =>
        run.kind !== 'br' && run.marks.strong
            ? {...run, marks: {...run.marks, strong: false}}
            : run,
    );
}

function hasText(runs: Run[]): boolean {
    return runs.some((run) => (run.kind === 'text' ? run.text.trim() : run.kind === 'image'));
}

function allBold(runs: Run[]): boolean {
    return runs.every((run) => run.kind === 'br' || !hasText([run]) || run.marks.strong);
}

/** Two or more breaks in a row end a paragraph: Markdown cannot hold a blank line inside one. */
function splitParagraphs(runs: Run[]): Run[][] {
    const paragraphs: Run[][] = [[]];
    let breaks = 0;
    for (const run of runs) {
        const current = paragraphs[paragraphs.length - 1];
        if (run.kind === 'br') {
            breaks++;
            current.push(run);
            continue;
        }
        if (run.kind === 'text' && !run.text.trim() && breaks) continue;
        if (breaks >= 2) {
            current.splice(current.length - breaks, breaks);
            paragraphs.push([run]);
        } else current.push(run);
        breaks = 0;
    }
    return paragraphs;
}

/** A leading `[ ]` / `[x]` in a bullet's text, as some apps copy a to-do. */
function stripTaskMarker(runs: Run[]): {checked: boolean} | null {
    const first = runs.find((run) => run.kind !== 'text' || run.text.trim());
    if (first?.kind !== 'text') return null;
    const match = /^\s*\[([ xX])\]\s+/.exec(first.text);
    if (!match) return null;
    first.text = first.text.slice(match[0].length);
    return {checked: match[1] !== ' '};
}

function checkboxState(li: Element): boolean | null {
    const ariaChecked = li.getAttribute('aria-checked');
    if (li.getAttribute('role') === 'checkbox' && ariaChecked) return ariaChecked === 'true';
    const own = (element: Element | null) => element?.closest('li') === li;
    const input = [...li.querySelectorAll('input')].find(
        (element) => element.type.toLowerCase() === 'checkbox' && own(element),
    );
    if (input) return input.hasAttribute('checked');
    const marker = [...li.querySelectorAll('[class*="checkbox-"]')].find(own);
    if (marker && /\bcheckbox-(?:on|off)\b/.test(marker.className)) {
        return /\bcheckbox-on\b/.test(marker.className);
    }
    return null;
}

/**
 * Runs → the editor's inline HTML. Whitespace collapses the way the page rendered it, and a mark
 * never opens or closes on a space (`** bold**` is not bold to a Markdown reader).
 */
function runsToHtml(input: Run[], breakAs?: string): string {
    const runs = imagesToText(input);
    const pieces: (Run & {kind: 'text' | 'br'})[] = [];
    let spaced = true;
    for (const run of runs) {
        if (run.kind === 'br') {
            trimTrailing(pieces);
            if (breakAs) {
                pieces.push({kind: 'text', text: breakAs, marks: {}});
                spaced = true;
            } else {
                pieces.push(run);
                spaced = true;
            }
            continue;
        }
        if (run.kind !== 'text') continue;
        let text = run.text.replace(/\s+/g, ' ');
        if (spaced && text.startsWith(' ')) text = text.slice(1);
        if (!text) continue;
        spaced = text.endsWith(' ');
        pieces.push({...run, text});
    }
    trimTrailing(pieces);
    while (pieces[0]?.kind === 'br') pieces.shift();
    while (pieces[pieces.length - 1]?.kind === 'br') pieces.pop();
    return render(unpadMarks(pieces));
}

function trimTrailing(pieces: Run[]) {
    for (let at = pieces.length - 1; at >= 0; at--) {
        const piece = pieces[at];
        if (piece.kind !== 'text') return;
        piece.text = piece.text.trimEnd();
        if (piece.text) return;
        pieces.splice(at, 1);
    }
}

/**
 * Images have no inline spelling here. One standing alone becomes a link to its source; one among
 * text (an emoji, a badge) leaves its alt text.
 */
function imagesToText(runs: Run[]): Run[] {
    const alone = runs.every(
        (run) => run.kind === 'image' || run.kind === 'br' || !run.text.trim(),
    );
    return runs.map((run) => {
        if (run.kind !== 'image') return run;
        if (alone && !run.marks.href && /^https?:/i.test(run.src)) {
            const name = decodeName(run.src);
            return {kind: 'text', text: run.alt || name || 'image', marks: {href: run.src}};
        }
        return {kind: 'text', text: run.alt, marks: run.marks};
    });
}

function decodeName(src: string): string {
    const name = src.split(/[?#]/)[0].split('/').pop() ?? '';
    try {
        return decodeURIComponent(name);
    } catch {
        return name;
    }
}

function hasFlag(marks: Marks): boolean {
    return FLAGS.some((flag) => marks[flag]);
}

function unpadMarks(pieces: (Run & {kind: 'text' | 'br'})[]): (Run & {kind: 'text' | 'br'})[] {
    const out: (Run & {kind: 'text' | 'br'})[] = [];
    const push = (piece: Run & {kind: 'text' | 'br'}) => {
        const last = out[out.length - 1];
        if (piece.kind === 'text' && last?.kind === 'text' && sameMarks(last.marks, piece.marks)) {
            last.text += piece.text;
        } else out.push(piece);
    };
    for (const piece of pieces) {
        if (piece.kind !== 'text' || !hasFlag(piece.marks)) {
            push(piece.kind === 'text' ? {...piece} : piece);
            continue;
        }
        const body = piece.text.trim();
        const start = piece.text.indexOf(body);
        const plain = {href: piece.marks.href};
        const lead = piece.text.slice(0, start);
        const trail = piece.text.slice(start + body.length);
        if (lead) push({kind: 'text', text: lead, marks: plain});
        if (body) push({kind: 'text', text: body, marks: piece.marks});
        if (trail) push({kind: 'text', text: trail, marks: plain});
    }
    return out;
}

function sameMarks(a: Marks, b: Marks): boolean {
    return a.href === b.href && FLAGS.every((flag) => Boolean(a[flag]) === Boolean(b[flag]));
}

function render(pieces: (Run & {kind: 'text' | 'br'})[]): string {
    let html = '';
    const open: string[] = [];
    let openHref: string | undefined;
    const closeTo = (keep: number) => {
        while (open.length > keep) html += `</${open.pop()}>`;
        if (!open.length) openHref = undefined;
    };
    pieces.forEach((piece, index) => {
        if (piece.kind === 'br') {
            closeTo(0);
            html += '<br>';
            return;
        }
        const href = piece.marks.href;
        const wanted = [...(href ? ['a'] : []), ...FLAGS.filter((flag) => piece.marks[flag])];
        const differs = wanted.findIndex(
            (mark, at) => open[at] !== mark || (mark === 'a' && openHref !== href),
        );
        const keep = differs === -1 ? wanted.length : differs;
        closeTo(keep);
        for (const mark of wanted.slice(keep)) {
            if (mark === 'a' && href) {
                openHref = href;
                const autolink = isAutolink(pieces, index, href) ? ' data-autolink=""' : '';
                html += `<a href="${escapeHtml(href)}"${autolink}>`;
            } else html += `<${mark}>`;
            open.push(mark);
        }
        html += escapeHtml(piece.text);
    });
    closeTo(0);
    return html;
}

/** A link whose whole label is its own address, which Markdown spells `<url>`. */
function isAutolink(pieces: Run[], from: number, href: string): boolean {
    if (!AUTOLINK.test(href)) return false;
    let label = '';
    for (let at = from; at < pieces.length; at++) {
        const piece = pieces[at];
        if (piece.kind !== 'text' || piece.marks.href !== href) break;
        if (hasFlag(piece.marks)) return false;
        label += piece.text;
    }
    return label === href;
}

function preText(pre: Element): string {
    let text = '';
    const visit = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent ?? '';
            return;
        }
        if (!isElement(node) || isSkipped(node)) return;
        if (node.localName === 'br') {
            text += '\n';
            return;
        }
        const block = BLOCK.has(node.localName);
        if (block && text && !text.endsWith('\n')) text += '\n';
        for (const child of node.childNodes) visit(child);
        if (block && text && !text.endsWith('\n')) text += '\n';
    };
    visit(pre);
    return text;
}

function codeLanguage(pre: Element): string | undefined {
    const candidates = [pre.querySelector('code'), pre, pre.parentElement];
    for (const element of candidates) {
        if (!element) continue;
        const attribute = element.getAttribute('data-language') ?? element.getAttribute('lang');
        if (attribute && LANGUAGE.test(attribute)) return attribute.toLowerCase();
        const match = /(?:^|\s)(?:language|lang|highlight-source)-([\w+#.-]+)/.exec(
            element.getAttribute('class') ?? '',
        );
        if (match) return match[1].toLowerCase();
    }
    return undefined;
}

function cellAlign(cell: HTMLTableCellElement): ColumnAlign | null {
    const value = (cell.getAttribute('align') ?? styleOf(cell, 'text-align')).toLowerCase();
    return value === 'left' || value === 'center' || value === 'right' ? value : null;
}

/**
 * A table used for page layout rather than data — one cell, or cells holding tables — whose content
 * reads as ordinary blocks.
 */
function isLayoutTable(table: Element): boolean {
    const cells = table.querySelectorAll('td, th');
    return cells.length <= 1 || table.querySelector('td table, th table') !== null;
}
