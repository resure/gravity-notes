import {createRef} from 'react';

import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import Editor, {type EditorHandle} from './Editor';
import {setCaret} from './caret';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (document as unknown as {caretRangeFromPoint?: unknown}).caretRangeFromPoint;
    window.getSelection()?.removeAllRanges();
});

describe('block type transitions', () => {
    it.each(['shortcut', 'toolbar'] as const)(
        'updates wiki links before and after syntax highlighting through the %s',
        async (command) => {
            const highlights = new Map<string, Set<StaticRange>>();
            vi.stubGlobal('CSS', {highlights});
            vi.stubGlobal('Highlight', class extends Set<StaticRange> {});
            const ref = createRef<EditorHandle>();
            const onChange = vi.fn();
            render(<Editor ref={ref} value="matrix[[1]]" onChange={onChange} />);
            const content = () => document.querySelector<HTMLElement>('.content')!;
            const convert = (code: boolean) => {
                act(() => {
                    content().focus();
                    setCaret(content(), 'end');
                    if (command === 'toolbar') ref.current!.setBlockType(code ? 'code' : 'text');
                    else {
                        fireEvent.keyDown(content(), {
                            key: code ? '8' : '0',
                            code: code ? 'Digit8' : 'Digit0',
                            metaKey: true,
                            altKey: true,
                        });
                    }
                });
            };

            expect(content().querySelector('.wiki-link[contenteditable="false"]')).not.toBeNull();
            convert(true);
            expect(content()).toHaveAttribute('data-block-type', 'code');
            const beforeHighlight = content().innerHTML;

            fireEvent.click(document.querySelector('.code-lang')!);
            fireEvent.click(screen.getByText('JavaScript', {exact: true}));
            await waitFor(() => {
                expect([...highlights.values()].some((ranges) => ranges.size > 0)).toBe(true);
            });
            expect(beforeHighlight).toBe('matrix[[1]]');
            expect(content().innerHTML).toBe('matrix[[1]]');
            expect(onChange.mock.calls.at(-1)?.[0]).toBe('```js\nmatrix[[1]]\n```');

            convert(false);
            expect(content()).toHaveAttribute('data-block-type', 'text');
            expect(content().textContent).toBe('matrix[[1]]');
            expect(content().querySelector('.wiki-link[contenteditable="false"]')).not.toBeNull();
            expect(onChange.mock.calls.at(-1)?.[0]).toBe('matrix[[1]]');
        },
    );

    it('decorates links when a code block becomes text without an input event', () => {
        const ref = createRef<EditorHandle>();
        render(<Editor ref={ref} value={'```js\nmatrix[[1]]\n```'} onChange={vi.fn()} />);
        const code = document.querySelector<HTMLElement>('.content')!;
        expect(code.querySelector('.wiki-link')).toBeNull();
        act(() => {
            code.focus();
            setCaret(code, 'end');
            ref.current!.setBlockType('text');
        });
        const text = document.querySelector<HTMLElement>('.content')!;
        expect(text.querySelector('.wiki-link[contenteditable="false"]')?.textContent).toBe(
            '[[1]]',
        );
    });
});

describe('vertical selection into an offscreen block', () => {
    it.each([
        ['code', 'ArrowDown'],
        ['code', 'ArrowUp'],
        ['toggle', 'ArrowDown'],
        ['toggle', 'ArrowUp'],
    ] as const)('reveals the %s before hit testing for Shift+%s', (type, key) => {
        const forward = key === 'ArrowDown';
        const text = `😀${'abcdefghij '.repeat(24000)}`;
        const targetMarkdown =
            type === 'code'
                ? `\`\`\`text\n${text}\n\`\`\``
                : `<details>\n<summary>${text}</summary>\n\n</details>`;
        render(
            <Editor
                value={forward ? `source\n\n${targetMarkdown}` : `${targetMarkdown}\n\nsource`}
                onChange={vi.fn()}
            />,
        );
        const contents = document.querySelectorAll<HTMLElement>('.content');
        const source = contents[forward ? 0 : 1];
        const target = contents[forward ? 1 : 0];
        const targetEnd = target.textContent!.length;
        let revealed = false;
        source.style.lineHeight = '20px';
        target.style.lineHeight = '20px';
        const sourceRect = new DOMRect(0, forward ? 760 : 20, 600, 20);
        vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(sourceRect);
        vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
            () =>
                new DOMRect(
                    0,
                    revealed ? (forward ? 20 : -3380) : forward ? 800 : -4000,
                    600,
                    4000,
                ),
        );
        const scroll = vi.spyOn(target, 'scrollIntoView').mockImplementation(() => {
            revealed = true;
        });
        const targetReads = vi.fn();
        vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
            if (target.contains(this.startContainer)) {
                targetReads();
                return [] as unknown as DOMRectList;
            }
            return [new DOMRect(40, sourceRect.top, 0, 20)] as unknown as DOMRectList;
        });
        const hit = vi.fn(() => {
            if (!revealed) return null;
            const range = document.createRange();
            range.setStart(target.firstChild!, forward ? 2 : targetEnd);
            range.collapse(true);
            return range;
        });
        Object.defineProperty(document, 'caretRangeFromPoint', {configurable: true, value: hit});
        act(() => {
            source.focus();
            window.getSelection()!.collapse(source.firstChild!, forward ? 6 : 0);
            fireEvent.keyDown(source, {key, shiftKey: true});
        });

        expect(scroll).toHaveBeenCalledWith({block: 'nearest'});
        expect(hit).toHaveBeenCalledOnce();
        expect(targetReads.mock.calls.length).toBe(0);
        expect(window.getSelection()!.anchorNode).toBe(source.firstChild);
        expect(window.getSelection()!.anchorOffset).toBe(forward ? 6 : 0);
        expect(window.getSelection()!.focusNode).toBe(target.firstChild);
        expect(window.getSelection()!.focusOffset).toBe(forward ? 2 : targetEnd);
    });
});
