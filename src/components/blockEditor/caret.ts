/** Selection/caret and inline-HTML helpers for contentEditable blocks. */

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
    const pre = document.createRange();
    pre.selectNodeContents(el);
    try {
        pre.setEnd(range.startContainer, range.startOffset);
    } catch {
        return 0;
    }
    return pre.toString().length;
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
    }
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
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

/** Place caret on the first/last line of `el`, as close to viewport x as possible. */
function setCaretNearX(el: HTMLElement, x: number, edge: 'top' | 'bottom'): void {
    const rect = el.getBoundingClientRect();
    const lh = lineHeightOf(el);
    const inset = Math.min(lh / 2, rect.height / 2);
    const y = edge === 'top' ? rect.top + inset : rect.bottom - inset;
    const clampedX = Math.min(Math.max(x, rect.left + 2), rect.right - 2);
    const range = caretRangeFromPoint(clampedX, y);
    if (range && el.contains(range.startContainer)) {
        range.collapse(true);
        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
            return;
        }
    }
    setCaret(el, edge === 'top' ? 'start' : 'end');
}

/** Viewport rect of the caret line; falls back to the element's first line when empty. */
export function caretLineRect(el: HTMLElement): LineRect {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).startContainer)) {
        const r = sel.getRangeAt(0).cloneRange();
        r.collapse(true);
        const rects = r.getClientRects();
        if (rects.length > 0) {
            const rect = rects[0];
            return {left: rect.left, top: rect.top, bottom: rect.bottom};
        }
        const br = r.getBoundingClientRect();
        if (br.height > 0 || br.top !== 0) return {left: br.left, top: br.top, bottom: br.bottom};
    }
    const er = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const pt = parseFloat(cs.paddingTop) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0;
    const lh = lineHeightOf(el);
    return {left: er.left + pl, top: er.top + pt, bottom: er.top + pt + lh};
}

export function caretOnFirstLine(el: HTMLElement): boolean {
    const line = caretLineRect(el);
    const er = el.getBoundingClientRect();
    const pt = parseFloat(getComputedStyle(el).paddingTop) || 0;
    return line.top - (er.top + pt) < lineHeightOf(el) / 2;
}

export function caretOnLastLine(el: HTMLElement): boolean {
    const line = caretLineRect(el);
    const er = el.getBoundingClientRect();
    const pb = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    return er.bottom - pb - line.bottom < lineHeightOf(el) / 2;
}

/** Split the element's content at the caret; returns [beforeHtml, afterHtml]. */
export function splitHtmlAtCaret(el: HTMLElement): [string, string] {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return [el.innerHTML, ''];
    const range = sel.getRangeAt(0);
    const before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(el);
    after.setStart(range.endContainer, range.endOffset);
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

/**
 * Live inline markdown: converts `code`, **bold**, *italic* right before the caret.
 * Returns true if a conversion happened.
 */
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
    ];

    for (const {re, tag} of rules) {
        const m = upto.match(re);
        if (!m) continue;
        const start = upto.length - m[0].length;
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
