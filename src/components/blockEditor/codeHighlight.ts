import hljs from 'highlight.js';

// Code blocks are coloured with the CSS Custom Highlight API: ranges painted over the text, so the
// editable element's DOM, the caret and what is serialized are never touched. Token groups follow
// the preview's YFM palette (see `::highlight(gn-hl-*)` in editor.css).
const GROUPS: Record<string, string> = {
    comment: 'comment',
    quote: 'string',
    string: 'string',
    number: 'string',
    type: 'string',
    'selector-id': 'string',
    'selector-class': 'string',
    'template-tag': 'string',
    deletion: 'string',
    title: 'title',
    section: 'title',
    regexp: 'variable',
    symbol: 'variable',
    variable: 'variable',
    'template-variable': 'variable',
    link: 'variable',
    'selector-attr': 'variable',
    'selector-pseudo': 'variable',
    literal: 'literal',
    built_in: 'builtin',
    bullet: 'builtin',
    code: 'builtin',
    addition: 'builtin',
    meta: 'meta',
    subst: 'subst',
};

const supported = () => typeof CSS !== 'undefined' && 'highlights' in CSS;

interface Token {
    start: number;
    end: number;
    group: string;
}

const owned = new Map<HTMLElement, {group: string; range: Range}[]>();

function highlightFor(group: string): Highlight {
    const name = `gn-hl-${group}`;
    let highlight = CSS.highlights.get(name);
    if (!highlight) {
        highlight = new Highlight();
        CSS.highlights.set(name, highlight);
    }
    return highlight;
}

/** The element's text as the highlighter sees it, and where each text node starts in it. */
function textModel(root: HTMLElement): {text: string; nodes: {node: Text; start: number}[]} {
    let text = '';
    const nodes: {node: Text; start: number}[] = [];
    const walk = (parent: Node) => {
        for (const child of parent.childNodes) {
            if (child instanceof Text) {
                nodes.push({node: child, start: text.length});
                text += child.data;
            } else if (child.nodeName === 'BR') {
                text += '\n';
            } else {
                if (
                    (child.nodeName === 'DIV' || child.nodeName === 'P') &&
                    text &&
                    !text.endsWith('\n')
                )
                    text += '\n';
                walk(child);
            }
        }
    };
    walk(root);
    return {text, nodes};
}

// One fence this long would take far more than a frame to colour, and recolour on every keystroke.
const MAX_HIGHLIGHT_CHARS = 100_000;

export function tokenize(text: string, language: string | undefined): Token[] {
    if (text.length > MAX_HIGHLIGHT_CHARS || !language || !hljs.getLanguage(language)) return [];
    let html: string;
    try {
        html = hljs.highlight(text, {language, ignoreIllegals: true}).value;
    } catch {
        return [];
    }
    const template = document.createElement('template');
    template.innerHTML = html;
    const tokens: Token[] = [];
    let offset = 0;
    const walk = (parent: Node, group: string | null) => {
        for (const child of parent.childNodes) {
            if (child instanceof Text) {
                const end = offset + child.data.length;
                const last = tokens[tokens.length - 1];
                if (group && last?.group === group && last.end === offset) last.end = end;
                else if (group && end > offset) tokens.push({start: offset, end, group});
                offset = end;
            } else if (child instanceof Element) {
                const scope = [...child.classList]
                    .find((name) => name.startsWith('hljs-'))
                    ?.slice('hljs-'.length);
                walk(child, (scope && GROUPS[scope]) ?? group);
            }
        }
    };
    walk(template.content, null);
    return tokens;
}

function point(
    nodes: {node: Text; start: number}[],
    position: number,
    end: boolean,
): [Text, number] | null {
    let low = 0;
    let high = nodes.length - 1;
    let found = -1;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (nodes[middle].start <= position) {
            found = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    const at = nodes[found];
    if (at && position <= at.start + at.node.data.length) return [at.node, position - at.start];
    // In a gap a `<br>` stands for: a start moves to the next text, an end back to the last.
    if (end) return at ? [at.node, at.node.data.length] : null;
    const next = nodes[found + 1];
    return next ? [next.node, 0] : null;
}

export function clearCodeHighlight(root: HTMLElement): void {
    const previous = owned.get(root);
    if (!previous || !supported()) return;
    for (const {group, range} of previous) highlightFor(group).delete(range);
    owned.delete(root);
}

function highlightNow(root: HTMLElement, language: string | undefined): void {
    clearCodeHighlight(root);
    if (!root.isConnected) return;
    const {text, nodes} = textModel(root);
    const ranges: {group: string; range: Range}[] = [];
    for (const token of tokenize(text, language)) {
        const from = point(nodes, token.start, false);
        const to = point(nodes, token.end, true);
        if (!from || !to) continue;
        const range = document.createRange();
        range.setStart(...from);
        range.setEnd(...to);
        if (range.collapsed) continue;
        highlightFor(token.group).add(range);
        ranges.push({group: token.group, range});
    }
    if (ranges.length) owned.set(root, ranges);
}

const pending = new Map<HTMLElement, string | undefined>();
let frame = 0;

function flush() {
    frame = 0;
    const deadline = performance.now() + 8;
    for (const [root, language] of pending) {
        pending.delete(root);
        highlightNow(root, language);
        if (performance.now() > deadline) break;
    }
    if (pending.size) frame = window.requestAnimationFrame(flush);
}

/**
 * Re-colour a code block on the next frame. A note full of code is coloured a few blocks per frame,
 * and the live ranges keep the old colours on the right characters while a keystroke waits its turn.
 */
export function scheduleCodeHighlight(root: HTMLElement, language: string | undefined): void {
    if (!supported()) return;
    pending.set(root, language);
    if (!frame) frame = window.requestAnimationFrame(flush);
}

export function cancelCodeHighlight(root: HTMLElement): void {
    pending.delete(root);
    clearCodeHighlight(root);
}
