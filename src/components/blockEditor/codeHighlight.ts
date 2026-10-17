import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('go', go);
hljs.registerLanguage('graphql', graphql);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('lua', lua);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('php', php);
hljs.registerLanguage('python', python);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

/**
 * The full highlight.js build, loaded only when a fence names a language the picker's short list
 * doesn't cover (`jsonc`, `nix`, …). It preserves the colouring the app had when it shipped the
 * whole package eagerly, while keeping ~1 MB of grammars out of the startup bundle: a note with
 * only the picker's languages never fetches this chunk.
 *
 * It is a SEPARATE instance (the full build auto-registers every grammar), so `tokenize` routes a
 * language the core instance doesn't know to it rather than trying to copy definitions across.
 */
let fullHljs: typeof hljs | null = null;
let fullLanguages: Promise<void> | null = null;
// Set once the load SETTLES (success or failure): until then every caller waits on the same
// promise, and afterwards a fence whose language highlight.js genuinely doesn't ship settles as
// plain text instead of re-triggering the load → re-schedule cycle.
let fullLanguagesSettled = false;
function loadFullLanguages(): Promise<void> {
    if (!fullLanguages) {
        fullLanguages = import('highlight.js')
            .then((module) => {
                fullHljs = module.default ?? module;
            })
            .catch(() => {
                // No fallback pack: unknown fences simply stay plain text.
            })
            .finally(() => {
                fullLanguagesSettled = true;
            });
    }
    return fullLanguages;
}

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

const owned = new Map<HTMLElement, {group: string; range: AbstractRange}[]>();
// The text length each block was last tokenized at, so sizing it needs no fresh `textContent`.
const lengths = new WeakMap<HTMLElement, number>();

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
    if (text.length > MAX_HIGHLIGHT_CHARS || !language) return [];
    // The eager core covers the picker's list; anything else routes to the lazily-loaded full
    // build (loaded by scheduleCodeHighlight before it re-schedules the block).
    let highlighter: typeof hljs | null = hljs.getLanguage(language) ? hljs : null;
    if (!highlighter && fullHljs?.getLanguage(language)) highlighter = fullHljs;
    if (!highlighter) return [];
    let html: string;
    try {
        html = highlighter.highlight(text, {language, ignoreIllegals: true}).value;
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

function clearCodeHighlight(root: HTMLElement): void {
    const previous = owned.get(root);
    if (!previous || !supported()) return;
    for (const {group, range} of previous) highlightFor(group).delete(range);
    owned.delete(root);
}

function highlightNow(root: HTMLElement, language: string | undefined): void {
    clearCodeHighlight(root);
    if (!root.isConnected) return;
    const {text, nodes} = textModel(root);
    lengths.set(root, text.length);
    const ranges: {group: string; range: AbstractRange}[] = [];
    for (const token of tokenize(text, language)) {
        const from = point(nodes, token.start, false);
        const to = point(nodes, token.end, true);
        if (!from || !to) continue;
        // Static, not live: every live Range in the document is updated on every DOM edit, and a
        // code-heavy note holds tens of thousands. The block is re-coloured after each edit anyway.
        const range = new StaticRange({
            startContainer: from[0],
            startOffset: from[1],
            endContainer: to[0],
            endOffset: to[1],
        });
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

// Above this a block is re-coloured once typing pauses rather than on every frame: tokenizing it
// takes longer than a frame has.
const LARGE_BLOCK_CHARS = 5_000;
const LARGE_BLOCK_DELAY_MS = 200;
const delayed = new Map<HTMLElement, number>();

/** Re-colour a code block soon. A note full of code is coloured a few blocks per frame. */
export function scheduleCodeHighlight(root: HTMLElement, language: string | undefined): void {
    if (!supported()) return;
    window.clearTimeout(delayed.get(root));
    delayed.delete(root);
    // A language outside the eager set: paint it plain now and re-colour once the fallback
    // grammars land. `loadFullLanguages` is memoized and resolves even on failure, so a fence
    // whose language highlight.js genuinely lacks settles as plain text instead of looping.
    if (language && !hljs.getLanguage(language) && !fullLanguagesSettled) {
        void loadFullLanguages().then(() => {
            if (root.isConnected) scheduleCodeHighlight(root, language);
        });
        clearCodeHighlight(root);
        return;
    }
    const enqueue = () => {
        delayed.delete(root);
        pending.set(root, language);
        if (!frame) frame = window.requestAnimationFrame(flush);
    };
    if ((lengths.get(root) ?? 0) > LARGE_BLOCK_CHARS) {
        // Static ranges stay where they were painted, so a pause-long wait would show colours
        // shifted off their tokens; plain text until then reads better.
        clearCodeHighlight(root);
        delayed.set(root, window.setTimeout(enqueue, LARGE_BLOCK_DELAY_MS));
    } else {
        enqueue();
    }
}

export function cancelCodeHighlight(root: HTMLElement): void {
    window.clearTimeout(delayed.get(root));
    delayed.delete(root);
    pending.delete(root);
    clearCodeHighlight(root);
}
