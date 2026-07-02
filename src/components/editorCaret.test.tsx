import {afterEach, beforeAll, describe, expect, it} from 'vitest';

import {isCaretOnFirstLine} from './editorCaret';

// jsdom does no layout (it doesn't even implement Range's rect methods) — stub them to what real
// engines return for the carets under test: no client rects and an all-zero bounding rect. That
// sends `isCaretOnFirstLine` down its structural fallback, which is exactly the path under test.
// The measured (rect-based) path is layout territory, covered by manual/Chromium testing (see
// the module docblock).
beforeAll(() => {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
});

/** Mount the editor-pane shape the function expects: a container wrapping a contenteditable. */
function mount(bodyHtml: string): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = `<div contenteditable="true">${bodyHtml}</div>`;
    document.body.appendChild(container);
    return container;
}

function setCaret(node: Node, offset: number): void {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
}

afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
});

describe('isCaretOnFirstLine — structural fallback (unmeasurable caret)', () => {
    it('returns false with no selection at all', () => {
        const container = mount('<p>hello</p>');
        window.getSelection()?.removeAllRanges();
        expect(isCaretOnFirstLine(container)).toBe(false);
    });

    it('caret in an empty first block is the first line (blank note / blank first row)', () => {
        const container = mount('<p><br class="ProseMirror-trailingBreak"></p>');
        const p = container.querySelector('p')!;
        setCaret(p, 0);
        expect(isCaretOnFirstLine(container)).toBe(true);
    });

    it('caret on the empty continuation line after Shift+Enter is NOT the first line', () => {
        // The Shift+Enter shape: `hello`, hard break, caret on the (empty) second visual line.
        // Chromium and WebKit both report no caret rect here, so only the structure can tell
        // this line apart from the block's first — ArrowUp must move up within the block, not
        // hand off to the title.
        const container = mount('<p>hello<br><br class="ProseMirror-trailingBreak"></p>');
        const p = container.querySelector('p')!;
        setCaret(p, 2); // after the hard break, before the trailing break
        expect(isCaretOnFirstLine(container)).toBe(false);
    });

    it('caret after several hard breaks is NOT the first line', () => {
        const container = mount('<p>a<br>b<br><br class="ProseMirror-trailingBreak"></p>');
        const p = container.querySelector('p')!;
        setCaret(p, 4); // after the second <br>
        expect(isCaretOnFirstLine(container)).toBe(false);
    });

    it('caret in text following a hard break is NOT the first line', () => {
        const container = mount('<p>hello<br>world</p>');
        const world = container.querySelector('p')!.lastChild!;
        setCaret(world, 0);
        expect(isCaretOnFirstLine(container)).toBe(false);
    });

    it('caret in the first block with no break before it stays the first line', () => {
        const container = mount('<p>hello world</p>');
        const text = container.querySelector('p')!.firstChild!;
        setCaret(text, 3);
        expect(isCaretOnFirstLine(container)).toBe(true);
    });

    it('caret in a later block is NOT the first line (trailing break aside)', () => {
        const container = mount('<p>hello</p><p><br class="ProseMirror-trailingBreak"></p>');
        const second = container.querySelectorAll('p')[1];
        setCaret(second, 0);
        expect(isCaretOnFirstLine(container)).toBe(false);
    });

    it('caret reported AFTER a blank line’s trailing break is still the first line', () => {
        // Engines may leave the DOM selection at (p, 1) — past the placeholder <br> — instead of
        // (p, 0); both map to the same ProseMirror position, so PM never rewrites it. The
        // placeholder must not count as a line break before the caret.
        const container = mount('<p><br class="ProseMirror-trailingBreak"></p>');
        const p = container.querySelector('p')!;
        setCaret(p, 1);
        expect(isCaretOnFirstLine(container)).toBe(true);
    });

    it('caret on an empty second item of a leading list is NOT the first line', () => {
        // Block boundaries break lines without any <br>: `- a` then Enter puts the caret on the
        // empty second bullet — visual line 2 of the leading <ul>, ArrowUp must stay in the list.
        const container = mount(
            '<ul><li><p>a</p></li><li><p><br class="ProseMirror-trailingBreak"></p></li></ul>',
        );
        const second = container.querySelectorAll('p')[1];
        setCaret(second, 0);
        expect(isCaretOnFirstLine(container)).toBe(false);
    });

    it('caret on an empty second paragraph of a leading blockquote is NOT the first line', () => {
        const container = mount(
            '<blockquote><p>a</p><p><br class="ProseMirror-trailingBreak"></p></blockquote>',
        );
        const second = container.querySelectorAll('p')[1];
        setCaret(second, 0);
        expect(isCaretOnFirstLine(container)).toBe(false);
    });

    it('caret in an empty FIRST item of a leading list is the first line', () => {
        const container = mount('<ul><li><p><br class="ProseMirror-trailingBreak"></p></li></ul>');
        const p = container.querySelector('p')!;
        setCaret(p, 0);
        expect(isCaretOnFirstLine(container)).toBe(true);
    });

    it('a backward selection whose focus sits on the empty first line is the first line', () => {
        // Shift+ArrowUp from the second paragraph: the range START (focus) is on line 1 while
        // anchorNode stays below — the gate must test where ArrowUp acts from, not the anchor.
        const container = mount('<p><br class="ProseMirror-trailingBreak"></p><p>text</p>');
        const [first, second] = Array.from(container.querySelectorAll('p'));
        const sel = window.getSelection()!;
        sel.setBaseAndExtent(second.firstChild!, 2, first, 0);
        expect(isCaretOnFirstLine(container)).toBe(true);
    });
});
