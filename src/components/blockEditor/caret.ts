/** Selection/caret and inline-HTML helpers for contentEditable blocks. */

import {WIKI_LINK_CLASS} from '../../markdown';

/** An atomic inline: a wiki-link chip, which the caret steps over and never enters. */
const ATOM = `.${WIKI_LINK_CLASS}[contenteditable="false"]`;

export type CaretPos = 'start' | 'end' | number | {x: number; edge: 'top' | 'bottom'};

export interface LineRect {
    left: number;
    top: number;
    bottom: number;
}

export function lineHeightOf(el: HTMLElement): number {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    if (!Number.isNaN(lh)) return lh;
    return (parseFloat(cs.fontSize) || 16) * 1.5;
}

/** Character offset of the selection start within `el`. */
export function getCaretOffset(el: HTMLElement): number {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    return textOffsetOf(el, range.startContainer, range.startOffset);
}

export function caretAtStart(el: HTMLElement): boolean {
    return getCaretOffset(el) === 0;
}

export function caretAtEnd(el: HTMLElement): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const post = document.createRange();
    post.selectNodeContents(el);
    try {
        post.setStart(range.endContainer, range.endOffset);
    } catch {
        return false;
    }
    return post.toString().length === 0;
}

/** Find [node, offset] for a character offset, walking text nodes. */
function findTextPos(el: HTMLElement, offset: number): [Node, number] {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node = walker.nextNode() as Text | null;
    let last: Text | null = null;
    while (node) {
        if (remaining <= node.length) return [node, remaining];
        remaining -= node.length;
        last = node;
        node = walker.nextNode() as Text | null;
    }
    if (last) return [last, last.length];
    return [el, el.childNodes.length];
}

export function setCaret(el: HTMLElement, pos: CaretPos): void {
    if (typeof pos === 'object') {
        setCaretNearX(el, pos.x, pos.edge);
        return;
    }
    const range = document.createRange();
    if (pos === 'start') {
        range.selectNodeContents(el);
        range.collapse(true);
    } else if (pos === 'end') {
        range.selectNodeContents(el);
        range.collapse(false);
    } else {
        const [node, off] = findTextPos(el, pos);
        range.setStart(node, off);
        range.collapse(true);
        keepOutOfAtoms(el, range);
    }
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
}

/** The atomic inline (a `contenteditable="false"` wiki-link chip) a range starts in, if any. */
function atomAt(el: HTMLElement, range: Range): {atom: HTMLElement; before: number} | null {
    const start = range.startContainer;
    const host = start instanceof Element ? start : start.parentElement;
    const atom = host?.closest<HTMLElement>(ATOM);
    if (!atom || atom === el || !el.contains(atom)) return null;
    return {atom, before: textOffsetOf(atom, range.startContainer, range.startOffset)};
}

/** `[node, offset]` moved out of a chip it falls inside, to the chip's near side. */
function outsideAtoms(el: HTMLElement, [node, offset]: [Node, number]): [Node, number] {
    const range = document.createRange();
    range.setStart(node, offset);
    keepOutOfAtoms(el, range);
    return [range.startContainer, range.startOffset];
}

/**
 * A collapsed caret that a click left INSIDE an atomic inline (WebKit and Chromium both put it in
 * the chip's text, where nothing can be typed) moves to the chip's near edge. Returns whether it
 * moved.
 */
export function moveCaretOutOfAtom(root: HTMLElement): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const found = atomAt(root, sel.getRangeAt(0));
    if (!found) return false;
    const next = document.createRange();
    if (found.before * 2 < (found.atom.textContent ?? '').length) next.setStartBefore(found.atom);
    else next.setStartAfter(found.atom);
    next.collapse(true);
    sel.removeAllRanges();
    sel.addRange(next);
    return true;
}

/** A text offset at a chip's edge maps to a spot INSIDE its text; move it to the chip's near side. */
function keepOutOfAtoms(el: HTMLElement, range: Range): void {
    const found = atomAt(el, range);
    if (!found) return;
    if (found.before === 0) range.setStartBefore(found.atom);
    else range.setStartAfter(found.atom);
    range.collapse(true);
}

function caretRangeFromPoint(x: number, y: number): Range | null {
    const doc = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
        caretPositionFromPoint?: (
            x: number,
            y: number,
        ) => {offsetNode: Node; offset: number} | null;
    };
    if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
    if (doc.caretPositionFromPoint) {
        const p = doc.caretPositionFromPoint(x, y);
        if (!p) return null;
        const r = document.createRange();
        r.setStart(p.offsetNode, p.offset);
        r.collapse(true);
        return r;
    }
    return null;
}

const graphemes = new Intl.Segmenter(undefined, {granularity: 'grapheme'});

function textRuns(el: HTMLElement): Text[][] {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT + NodeFilter.SHOW_ELEMENT);
    const runs: Text[][] = [[]];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeName === 'BR') runs.push([]);
        else if (node.nodeType === Node.TEXT_NODE) runs[runs.length - 1].push(node as Text);
    }
    return runs;
}

function graphemePositions(el: HTMLElement): {start: [Node, number]; end: [Node, number]}[] {
    const positions: {start: [Node, number]; end: [Node, number]}[] = [];
    for (const nodes of textRuns(el)) {
        let nodeIndex = 0;
        let nodeStart = 0;
        for (const {index, segment} of graphemes.segment(nodes.map((node) => node.data).join(''))) {
            while (nodeIndex < nodes.length - 1 && index >= nodeStart + nodes[nodeIndex].length) {
                nodeStart += nodes[nodeIndex++].length;
            }
            const start: [Node, number] = [nodes[nodeIndex], index - nodeStart];
            const end = index + segment.length;
            while (nodeIndex < nodes.length - 1 && end > nodeStart + nodes[nodeIndex].length) {
                nodeStart += nodes[nodeIndex++].length;
            }
            positions.push({start, end: [nodes[nodeIndex], end - nodeStart]});
        }
    }
    return positions;
}

function distanceToRect(rect: DOMRect, x: number, y: number): {dy: number; dx: number} {
    return {
        dy: Math.max(rect.top - y, y - rect.bottom, 0),
        dx: Math.max(rect.left - x, x - rect.right, 0),
    };
}

function compareDistance(a: {dy: number; dx: number}, b: {dy: number; dx: number}): number {
    return a.dy - b.dy || a.dx - b.dx;
}

// A hit test lands on whatever is on top, and a popup (the wiki-link tip below a chip, say) can
// cover the very line asked for. Then the nearest character is found by measuring instead.
function caretRangeIn(el: HTMLElement, x: number, y: number): Range | null {
    const hit = caretRangeFromPoint(x, y);
    if (hit && el.contains(hit.startContainer)) return hit;
    const positions = graphemePositions(el);
    const chunks: {start: number; end: number; dy: number; dx: number}[] = [];
    const chunk = document.createRange();
    for (let start = 0; start < positions.length; start += 128) {
        const end = Math.min(start + 128, positions.length);
        chunk.setStart(...positions[start].start);
        chunk.setEnd(...positions[end - 1].end);
        let nearest: {dy: number; dx: number} | null = null;
        for (const rect of chunk.getClientRects()) {
            const distance = distanceToRect(rect, x, y);
            if (!nearest || compareDistance(distance, nearest) < 0) nearest = distance;
        }
        if (nearest) chunks.push({start, end, ...nearest});
    }
    // Chunk boxes bound their graphemes, so distant text needs no individual geometry reads.
    chunks.sort(compareDistance);
    const character = document.createRange();
    let best: {position: [Node, number]; index: number; dy: number; dx: number} | null = null;
    for (const bounds of chunks) {
        if (best && compareDistance(bounds, best) > 0) break;
        for (let i = bounds.start; i < bounds.end; i++) {
            const position = positions[i];
            character.setStart(...position.start);
            character.setEnd(...position.end);
            const rect = character.getClientRects()[0];
            if (!rect) continue;
            const distance = distanceToRect(rect, x, y);
            if (
                !best ||
                compareDistance(distance, best) < 0 ||
                (compareDistance(distance, best) === 0 && i < best.index)
            ) {
                const after = x > rect.left + rect.width / 2;
                best = {position: after ? position.end : position.start, index: i, ...distance};
            }
        }
    }
    if (!best) return null;
    character.setStart(...best.position);
    character.collapse(true);
    return character;
}

/** Place caret on the first/last line of `el`, as close to viewport x as possible. */
function setCaretNearX(el: HTMLElement, x: number, edge: 'top' | 'bottom'): void {
    const rect = el.getBoundingClientRect();
    const lh = lineHeightOf(el);
    const inset = Math.min(lh / 2, rect.height / 2);
    const y = edge === 'top' ? rect.top + inset : rect.bottom - inset;
    setCaretAtPoint(el, x, y, edge === 'top' ? 'start' : 'end');
}

/**
 * The text position on `el`'s first/last line nearest viewport x, as [node, offset] — where a
 * selection EXTENDED into `el` from a neighbouring block should land.
 */
export function positionNearX(el: HTMLElement, x: number, edge: 'top' | 'bottom'): [Node, number] {
    const rect = el.getBoundingClientRect();
    const lh = lineHeightOf(el);
    const inset = Math.min(lh / 2, rect.height / 2);
    const y = edge === 'top' ? rect.top + inset : rect.bottom - inset;
    const range = caretRangeIn(
        el,
        Math.min(Math.max(x, rect.left + 2), Math.max(rect.left + 2, rect.right - 2)),
        y,
    );
    if (range) return outsideAtoms(el, [range.startContainer, range.startOffset]);
    return edgePosition(el, edge === 'top' ? 'start' : 'end');
}

/** The first or last text position inside `el`. */
export function edgePosition(el: HTMLElement, edge: 'start' | 'end'): [Node, number] {
    return outsideAtoms(el, findTextPos(el, edge === 'start' ? 0 : (el.textContent ?? '').length));
}

/** Character offset of an arbitrary DOM position within `el` (the selection's FOCUS, say). */
export function textOffsetOf(el: HTMLElement, node: Node, offset: number): number {
    const pre = document.createRange();
    pre.selectNodeContents(el);
    try {
        pre.setEnd(node, offset);
    } catch {
        return 0;
    }
    return pre.toString().length;
}

/** The caret at the character under a viewport point, pulled inside `el`'s box first. */
export function setCaretAtPoint(
    el: HTMLElement,
    x: number,
    y: number,
    fallback: 'start' | 'end',
): void {
    const rect = el.getBoundingClientRect();
    const clamp = (value: number, low: number, high: number) =>
        Math.min(Math.max(value, low), Math.max(low, high));
    const range = caretRangeIn(
        el,
        clamp(x, rect.left + 2, rect.right - 2),
        clamp(y, rect.top + 1, rect.bottom - 1),
    );
    if (range) {
        range.collapse(true);
        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
            return;
        }
    }
    setCaret(el, fallback);
}

/** Viewport rect of the caret line; falls back to the element's first line when empty. */
export function caretLineRect(el: HTMLElement): LineRect {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).startContainer)) {
        const range = sel.getRangeAt(0);
        const rect = lineRectAt(el, range.startContainer, range.startOffset);
        if (rect) return rect;
    }
    return firstLineRect(el);
}

/** Viewport rect of the line a DOM position inside `el` sits on, or null when it has no box. */
export function lineRectAt(el: HTMLElement, node: Node, offset: number): LineRect | null {
    const r = document.createRange();
    try {
        r.setStart(node, offset);
    } catch {
        return null;
    }
    r.collapse(true);
    const rects = r.getClientRects();
    if (rects.length > 0) {
        const rect = rects[0];
        return {left: rect.left, top: rect.top, bottom: rect.bottom};
    }
    const br = r.getBoundingClientRect();
    if (br.height > 0 || br.top !== 0) return {left: br.left, top: br.top, bottom: br.bottom};
    // A position parked on an ELEMENT boundary (`setCaret(el, 'end')` collapses onto the block
    // itself) has no box of its own, and falling back to the first line made ↑ from the end of a
    // long paragraph leave the block. Measure what sits before it instead — a link chip itself,
    // since the character before is its hidden `]]`, which has no box either.
    const previous = node.nodeType === Node.ELEMENT_NODE ? node.childNodes[offset - 1] : null;
    if (previous instanceof Element) {
        const boxes = previous.getClientRects();
        const last = boxes[boxes.length - 1];
        if (last && (last.height > 0 || last.top !== 0))
            return {left: last.right, top: last.top, bottom: last.bottom};
    }
    const textOffset = textOffsetOf(el, node, offset);
    return textOffset === 0 ? firstLineRect(el) : characterBeforeRect(el, textOffset);
}

function firstLineRect(el: HTMLElement): LineRect {
    const er = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const pt = parseFloat(cs.paddingTop) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0;
    const lh = lineHeightOf(el);
    return {left: er.left + pl, top: er.top + pt, bottom: er.top + pt + lh};
}

function characterBeforeRect(el: HTMLElement, offset: number): LineRect | null {
    if (offset === 0) return null;
    const [startNode, startOffset] = findTextPos(el, offset - 1);
    const [endNode, endOffset] = findTextPos(el, offset);
    const range = document.createRange();
    try {
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
    } catch {
        return null;
    }
    const rects = range.getClientRects();
    const rect = rects[rects.length - 1];
    if (!rect || (rect.height === 0 && rect.top === 0)) return null;
    return {left: rect.right, top: rect.top, bottom: rect.bottom};
}

export function caretOnFirstLine(el: HTMLElement): boolean {
    return lineIsFirst(el, caretLineRect(el));
}

export function lineIsFirst(el: HTMLElement, line: LineRect): boolean {
    const er = el.getBoundingClientRect();
    const pt = parseFloat(getComputedStyle(el).paddingTop) || 0;
    return line.top - (er.top + pt) < lineHeightOf(el) / 2;
}

export function caretOnLastLine(el: HTMLElement): boolean {
    return lineIsLast(el, caretLineRect(el));
}

export function lineIsLast(el: HTMLElement, line: LineRect): boolean {
    const er = el.getBoundingClientRect();
    const pb = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    return er.bottom - pb - line.bottom < lineHeightOf(el) / 2;
}

/** Split the element's content at the caret; returns [beforeHtml, afterHtml]. */
export function splitHtmlAtCaret(el: HTMLElement): [string, string] {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return [el.innerHTML, ''];
    const range = sel.getRangeAt(0);
    const runs = textRuns(el).map((nodes) => ({
        nodes,
        text: nodes.map((node) => node.data).join(''),
    }));
    // Programmatic selections can bisect a grapheme even though native typing usually repairs it.
    const boundary = (node: Node, offset: number, edge: 'start' | 'end'): [Node, number] => {
        const position = textOffsetOf(el, node, offset);
        let remaining = position;
        for (const {nodes, text} of runs) {
            if (remaining >= text.length) {
                remaining -= text.length;
                continue;
            }
            const segment = graphemes.segment(text).containing(remaining);
            if (!segment || segment.index === remaining) break;
            const end = segment.index + segment.segment.length;
            const after = range.collapsed
                ? remaining - segment.index >= end - remaining
                : edge === 'end';
            let local = after ? end : segment.index;
            for (const textNode of nodes) {
                if (local <= textNode.length) return [textNode, local];
                local -= textNode.length;
            }
        }
        return [node, offset];
    };
    const [startNode, startOffset] = boundary(range.startContainer, range.startOffset, 'start');
    const [endNode, endOffset] = boundary(range.endContainer, range.endOffset, 'end');
    const before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(startNode, startOffset);
    const after = document.createRange();
    after.selectNodeContents(el);
    after.setStart(endNode, endOffset);
    const toHtml = (fragment: DocumentFragment) => {
        const div = document.createElement('div');
        div.appendChild(fragment);
        // Both halves become block html, so the caret-escape U+200B must not ride along into it.
        return stripZeroWidth(div.innerHTML);
    };
    return [toHtml(before.cloneContents()), toHtml(after.cloneContents())];
}

/** Delete characters [from, to) measured in text offsets, then place caret at `from`. */
export function deleteTextRange(el: HTMLElement, from: number, to: number): void {
    if (to <= from) return;
    const [n1, o1] = findTextPos(el, from);
    const [n2, o2] = findTextPos(el, to);
    const range = document.createRange();
    range.setStart(n1, o1);
    range.setEnd(n2, o2);
    range.deleteContents();
    setCaret(el, from);
}

export function insertPlainTextAtCaret(text: string): void {
    document.execCommand('insertText', false, text);
}

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Drop the zero-width space {@link tryInlineMarkdown} leaves in the DOM. That character exists only
 * so the caret can escape a just-created `<code>`/`<strong>`; block state must never carry it,
 * because block state is what gets serialized into the user's `.md` file — and from there into the
 * search corpus and `[[wiki link]]` title matching, where an invisible character silently stops a
 * note from matching itself.
 */
export function stripZeroWidth(html: string): string {
    return html.replace(/\u200B/g, '');
}

/** Schemes the webview would execute rather than merely open. */
const DANGEROUS_SCHEME = /^(javascript|data|vbscript|blob):/;

/**
 * Whether a link destination may stay on an `<a href>` inside the editable.
 *
 * Deny-dangerous rather than allow-absolute, deliberately: a note's links are mostly RELATIVE
 * (`docs/spec.md`, `Attachments/report.pdf`, `../Other.md`), and dropping the href of everything
 * that isn't absolute rewrote every one of them to `[text]()` on the next keystroke. What must never
 * survive is a scheme that executes — in the desktop shell the app origin owns
 * `__TAURI_INTERNALS__`, so a `javascript:` href activated there runs with filesystem-command
 * access. Which links may actually be OPENED is a separate, stricter question, owned by
 * `openExternalUrl` (http/https/mailto/tel), so an exotic-but-inert scheme can stay in the file
 * rather than being deleted from it.
 */
export function isSafeLinkHref(href: string): boolean {
    // Strip C0 controls and spaces first: HTML parses `java\tscript:…` (and a leading newline) as a
    // scheme, so a naive prefix test on the raw attribute is bypassable. Matching control characters
    // is the entire point of the class below, hence the rule exemption.
    // eslint-disable-next-line no-control-regex
    return !DANGEROUS_SCHEME.test(href.replace(/[\u0000-\u0020]/g, '').toLowerCase());
}

export function htmlToText(html: string): string {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent ?? '';
}

export function isEmptyHtml(html: string): boolean {
    if (html === '' || html === '<br>') return true;
    return (
        htmlToText(html)
            .replace(/\u200B/g, '')
            .trim() === ''
    );
}

/** Wrap or unwrap the current selection in an inline <code> element. */
export function toggleInlineCode(): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const containerEl = container instanceof Element ? container : container.parentElement;
    const codeEl = containerEl?.closest('code');
    if (codeEl) {
        const parent = codeEl.parentNode;
        if (!parent) return;
        const first = codeEl.firstChild;
        const last = codeEl.lastChild;
        while (codeEl.firstChild) parent.insertBefore(codeEl.firstChild, codeEl);
        parent.removeChild(codeEl);
        if (first && last) {
            const r = document.createRange();
            r.setStartBefore(first);
            r.setEndAfter(last);
            sel.removeAllRanges();
            sel.addRange(r);
        }
    } else {
        const code = document.createElement('code');
        try {
            range.surroundContents(code);
        } catch {
            code.appendChild(range.extractContents());
            range.insertNode(code);
        }
        const r = document.createRange();
        r.selectNodeContents(code);
        sel.removeAllRanges();
        sel.addRange(r);
    }
}

export function tryInlineMarkdown(el: HTMLElement): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return false;
    const textNode = node as Text;
    if (!el.contains(textNode)) return false;
    if (textNode.parentElement?.closest('code, a')) return false;
    const upto = textNode.data.slice(0, range.startOffset);

    const rules: Array<{re: RegExp; tag: string}> = [
        {re: /`([^`\n]+)`$/, tag: 'code'},
        {re: /\*\*([^*\n]+)\*\*$/, tag: 'strong'},
        {re: /(?<!\*)\*([^*\s][^*\n]*?)\*$/, tag: 'em'},
        {re: /(?<!~)~~([^~\n]+)~~$/, tag: 's'},
        {re: /[=]=([^=\s][^=\n]*?)==$/, tag: 'mark'},
        {re: /\+\+([^+\s][^+\n]*?)\+\+$/, tag: 'ins'},
    ];

    for (const {re, tag} of rules) {
        const m = upto.match(re);
        if (!m) continue;
        const start = upto.length - m[0].length;
        let escapes = 0;
        for (let at = start - 1; at >= 0 && upto[at] === '\\'; at--) escapes++;
        if (escapes % 2 === 1 || (tag !== 'code' && /^\s|\s$/.test(m[1]))) continue;
        const wrapper = document.createElement(tag);
        wrapper.textContent = m[1];
        const r = document.createRange();
        r.setStart(textNode, start);
        r.setEnd(textNode, upto.length);
        r.deleteContents();
        r.insertNode(wrapper);
        // Zero-width space so the caret escapes the new inline element.
        const zwsp = document.createTextNode('\u200B');
        wrapper.after(zwsp);
        const nr = document.createRange();
        nr.setStart(zwsp, 1);
        nr.collapse(true);
        sel.removeAllRanges();
        sel.addRange(nr);
        return true;
    }
    return false;
}

/**
 * The current selection as HTML, or '' when nothing is selected.
 *
 * The block editor's content IS html, so this is what the clipboard paths serialize to Markdown:
 * the browser's own `text/plain` gives the RENDERED text, which is how copying `**bold**` out of a
 * Markdown app used to yield `bold`.
 */
export function selectionHtml(): string {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return '';
    const holder = document.createElement('div');
    holder.appendChild(selection.getRangeAt(0).cloneContents());
    return holder.innerHTML;
}

/**
 * How much of `el`'s text `range` actually covers ('' when none of it does).
 *
 * Every block is its OWN contentEditable, but one document selection extends right across them —
 * drag from the middle of one paragraph into the next and the range spans both. Callers need to
 * know which blocks are really involved, and `Range.intersectsNode` is too generous for that: a
 * drag that has only just entered the next block ends at its offset 0, covering none of its text
 * while still "intersecting" it.
 */
export function rangeTextWithin(el: HTMLElement, range: Range): string {
    const contents = document.createRange();
    contents.selectNodeContents(el);
    // Disjoint: the range ends before this element starts, or starts after it ends.
    if (
        range.compareBoundaryPoints(Range.END_TO_START, contents) >= 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, contents) <= 0
    )
        return '';
    const clipped = range.cloneRange();
    if (clipped.compareBoundaryPoints(Range.START_TO_START, contents) < 0)
        clipped.setStart(contents.startContainer, contents.startOffset);
    if (clipped.compareBoundaryPoints(Range.END_TO_END, contents) > 0)
        clipped.setEnd(contents.endContainer, contents.endOffset);
    return clipped.toString();
}
