import {afterEach, describe, expect, it, vi} from 'vitest';

import {htmlToText, positionNearX, setCaretAtPoint, splitHtmlAtCaret, textOffsetOf} from './caret';

type Box = {start: number; end: number; rect: DOMRect};

function content(html: string, height = 20): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    el.style.lineHeight = '20px';
    document.body.append(el);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, height));
    return el;
}

function layout(el: HTMLElement, boxes: Box[]) {
    Object.defineProperty(document, 'caretRangeFromPoint', {
        configurable: true,
        value: vi.fn(() => null),
    });
    return vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
        const start = textOffsetOf(el, this.startContainer, this.startOffset);
        const end = textOffsetOf(el, this.endContainer, this.endOffset);
        return boxes
            .filter((box) => box.start < end && box.end > start)
            .map((box) => box.rect) as unknown as DOMRectList;
    });
}

function unicodeLayout(el: HTMLElement, cluster: string) {
    return layout(el, [
        ...[0, 1, 2].map((start) => ({
            start,
            end: start + 1,
            rect: new DOMRect(start * 10, 0, 10, 20),
        })),
        {start: 3, end: 3 + cluster.length, rect: new DOMRect(30, 0, 20, 20)},
        {
            start: 3 + cluster.length,
            end: 4 + cluster.length,
            rect: new DOMRect(50, 0, 10, 20),
        },
    ]);
}

function caretOffset(el: HTMLElement) {
    const selection = window.getSelection()!;
    return textOffsetOf(el, selection.anchorNode!, selection.anchorOffset);
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (document as Partial<Document>).caretRangeFromPoint;
    document.body.replaceChildren();
    window.getSelection()!.removeAllRanges();
});

describe('fallback caret hit testing', () => {
    it.each(['😀', '👩‍💻', 'e\u0301', '🇫🇷', '👩🏽'])(
        'places the caret on either side of the whole %s grapheme using UTF-16 offsets',
        (cluster) => {
            const el = content(`AAA${cluster}B`);
            unicodeLayout(el, cluster);

            setCaretAtPoint(el, 34, 10, 'start');
            expect(caretOffset(el)).toBe(3);
            setCaretAtPoint(el, 44, 10, 'start');
            expect(caretOffset(el)).toBe(3 + cluster.length);
            expect(splitHtmlAtCaret(el)).toEqual([`AAA${cluster}`, 'B']);

            const [node, offset] = positionNearX(el, 44, 'top');
            expect(textOffsetOf(el, node, offset)).toBe(3 + cluster.length);
        },
    );

    it.each([
        ['e\u0301', 'AAA<strong>e</strong><em>\u0301</em>B'],
        ['👩‍💻', 'AAA<strong>👩</strong><em>‍💻</em>B'],
    ])('keeps %s whole across inline nodes', (cluster, html) => {
        const el = content(html);
        unicodeLayout(el, cluster);

        setCaretAtPoint(el, 44, 10, 'start');

        expect(caretOffset(el)).toBe(3 + cluster.length);
        expect(splitHtmlAtCaret(el).map(htmlToText)).toEqual([`AAA${cluster}`, 'B']);
    });

    it('measures text when a popup owns the native hit', () => {
        const el = content('AAA😀B');
        unicodeLayout(el, '😀');
        const popup = content('popup');
        const hit = document.createRange();
        hit.setStart(popup.firstChild!, 1);
        vi.mocked(document.caretRangeFromPoint).mockReturnValue(hit);

        setCaretAtPoint(el, 44, 10, 'start');

        expect(caretOffset(el)).toBe(5);
    });

    it('treats a soft line break as a grapheme boundary', () => {
        const el = content('e<br>\u0301B', 40);
        layout(el, [
            {start: 0, end: 1, rect: new DOMRect(0, 0, 10, 20)},
            {start: 1, end: 2, rect: new DOMRect(0, 20, 10, 20)},
            {start: 2, end: 3, rect: new DOMRect(10, 20, 10, 20)},
        ]);

        setCaretAtPoint(el, 8, 10, 'start');

        expect(caretOffset(el)).toBe(1);
        expect(splitHtmlAtCaret(el)).toEqual(['e', '<br>\u0301B']);
    });

    it('keeps a native hit inside the target without measuring text', () => {
        const el = content('ABC');
        const measure = layout(el, []);
        const hit = document.createRange();
        hit.setStart(el.firstChild!, 2);
        vi.mocked(document.caretRangeFromPoint).mockReturnValue(hit);

        setCaretAtPoint(el, 44, 10, 'start');

        expect(caretOffset(el)).toBe(2);
        expect(measure).not.toHaveBeenCalled();
    });

    it('uses the requested edge when text has no visible boxes', () => {
        const el = content('ABC');
        layout(el, []);

        setCaretAtPoint(el, 44, 10, 'end');

        expect(caretOffset(el)).toBe(3);
    });

    it('bounds individual measurements to nearby chunks of a long wrapped paragraph', () => {
        const length = 50_000;
        const el = content('A'.repeat(length), 10_000);
        const measure = layout(
            el,
            Array.from({length}, (_, start) => ({
                start,
                end: start + 1,
                rect: new DOMRect((start % 100) * 10, Math.floor(start / 100) * 20, 10, 20),
            })),
        );

        setCaretAtPoint(el, 36, 9990, 'end');

        expect(caretOffset(el)).toBe(49_904);
        expect(measure.mock.calls.length).toBeLessThan(650);
    });
});

describe('splitHtmlAtCaret', () => {
    it('keeps a preceding soft line break before a snapped caret', () => {
        const el = content('A<br>👩‍💻B');
        const range = document.createRange();
        range.setStart(el.lastChild!, 1);
        range.collapse(true);
        window.getSelection()!.addRange(range);

        expect(splitHtmlAtCaret(el)).toEqual(['A<br>', '👩‍💻B']);
    });

    it('keeps a preceding soft line break outside a snapped selection', () => {
        const el = content('A<br>👩‍💻B');
        const range = document.createRange();
        range.setStart(el.lastChild!, 1);
        range.setEnd(el.lastChild!, 3);
        window.getSelection()!.addRange(range);

        expect(splitHtmlAtCaret(el)).toEqual(['A<br>', 'B']);
    });

    it.each([false, true])(
        'keeps a preceding soft line break with inline markup and selected=%s',
        (selected) => {
            const el = content('A<br><strong>👩</strong><em>‍💻</em>B');
            const range = document.createRange();
            range.setStart(el.querySelector('strong')!.firstChild!, 1);
            if (selected) range.setEnd(el.querySelector('em')!.firstChild!, 1);
            else range.collapse(true);
            window.getSelection()!.addRange(range);

            const [before, after] = splitHtmlAtCaret(el);

            expect(before).toBe('A<br><strong></strong>');
            expect(after).toBe(selected ? '<em></em>B' : '<strong>👩</strong><em>‍💻</em>B');
        },
    );

    it.each(['😀', '👩‍💻', 'e\u0301', '🇫🇷', '👩🏽'])(
        'cannot split %s even when selection starts inside its grapheme',
        (cluster) => {
            const el = content(`AAA${cluster}B`);
            const range = document.createRange();
            range.setStart(el.firstChild!, 4);
            range.collapse(true);
            window.getSelection()!.addRange(range);

            const halves = splitHtmlAtCaret(el).map(htmlToText);

            expect(halves.join('')).toBe(`AAA${cluster}B`);
            expect(halves.some((half) => half.includes(cluster))).toBe(true);
        },
    );

    it('removes a selected grapheme wholly when both selection edges fall inside it', () => {
        const el = content('AAA👩‍💻B');
        const range = document.createRange();
        range.setStart(el.firstChild!, 4);
        range.setEnd(el.firstChild!, 6);
        window.getSelection()!.addRange(range);

        expect(splitHtmlAtCaret(el)).toEqual(['AAA', 'B']);
    });
});
