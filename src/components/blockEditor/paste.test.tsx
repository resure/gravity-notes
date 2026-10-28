import {StrictMode, createRef} from 'react';

import {act, fireEvent, render} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {isRoundTripStable} from '../../markdown';

import Editor from './Editor';
import type {EditorHandle} from './Editor';
import {setCaret} from './caret';

function paste(content: HTMLElement, text: string) {
    content.focus();
    setCaret(content, 0);
    fireEvent.paste(content, {
        clipboardData: {files: [], getData: (type: string) => (type === 'text/plain' ? text : '')},
    });
}

describe('Markdown paste boundaries', () => {
    it('replaces exactly the selected text when a selection crosses blocks', () => {
        withInsertHtml(() => {
            const onChange = vi.fn();
            render(<Editor value={'First\n\nSecond\n\nThird'} onChange={onChange} />);
            const contents = document.querySelectorAll<HTMLElement>('.content');
            contents[0].focus();
            const range = document.createRange();
            range.setStart(contents[0].firstChild!, 1);
            range.setEnd(contents[1].firstChild!, 3);
            window.getSelection()!.removeAllRanges();
            window.getSelection()!.addRange(range);
            fireEvent.paste(contents[0], {
                clipboardData: {
                    files: [],
                    getData: (type: string) => (type === 'text/plain' ? 'Replacement' : ''),
                },
            });
            expect(onChange.mock.calls.at(-1)?.[0]).toBe('FReplacementond\n\nThird');
        });
    });

    it('refuses unsupported Markdown over a cross-block selection without deleting it', () => {
        const onChange = vi.fn();
        render(<Editor value={'alpha ONE\n\nTWO omega'} onChange={onChange} />);
        const contents = document.querySelectorAll<HTMLElement>('.content');
        contents[0].focus();
        const range = document.createRange();
        range.setStart(contents[0].firstChild!, 6);
        range.setEnd(contents[1].firstChild!, 3);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        fireEvent.paste(contents[0], {
            clipboardData: {
                files: [],
                getData: (type: string) =>
                    type === 'text/plain' ? '{% list tabs %}\n\n- Tab\n\n{% endlist %}' : '',
            },
        });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('refuses unsupported multiline syntax without changing the note', () => {
        const onChange = vi.fn();
        render(<Editor value="Original" onChange={onChange} />);
        paste(
            document.querySelector<HTMLElement>('.content')!,
            '{% list tabs %}\n\n- Tab\n\n  Body\n\n{% endlist %}',
        );
        expect(onChange).not.toHaveBeenCalled();
    });
    it.each([
        ['line one\r\nline two', 'line one\nline two'],
        ['1) Buy milk\n2) Eggs', '1. Buy milk\n2. Eggs'],
    ])('pastes plain text whose spelling only normalises: %j', (text, written) => {
        const onChange = vi.fn();
        render(<Editor value="" onChange={onChange} />);
        paste(document.querySelector<HTMLElement>('.content')!, text);
        expect(onChange.mock.calls.at(-1)?.[0]).toBe(written);
    });

    it.each([
        '# Heading\n\nBody',
        '## Anchored {#anchored}\n\nBody',
        '- first\n- second',
        '| a | b |\n| --- | --- |\n| c | d |',
        '{% note info "Title" %}\n\nBody\n\n{% endnote %}',
    ])('parses the entire pasted document: %s', (source) => {
        const onChange = vi.fn();
        render(<Editor value="" onChange={onChange} />);
        paste(document.querySelector<HTMLElement>('.content')!, source);
        expect(onChange.mock.calls.at(-1)?.[0]).toBe(source);
    });

    it('preserves text after the caret when pasted content ends with an image', () => {
        const onChange = vi.fn();
        render(<Editor value="Keep this suffix" onChange={onChange} />);
        paste(
            document.querySelector<HTMLElement>('.content')!,
            'Before\n\n![image](https://example.com/image.png)',
        );
        expect(onChange.mock.calls.at(-1)?.[0]).toContain('Keep this suffix');
        expect(onChange.mock.calls.at(-1)?.[0]).toContain(
            '![image](https://example.com/image.png)',
        );
    });
});

describe('single-line paste', () => {
    it('reads one line as inline Markdown, so a copied bold word stays bold', () => {
        const original = document.execCommand;
        document.execCommand = ((command: string, _ui?: boolean, value = '') => {
            if (command !== 'insertHTML' && command !== 'insertText') return false;
            const range = window.getSelection()!.getRangeAt(0);
            const holder = document.createElement('div');
            if (command === 'insertHTML') holder.innerHTML = value;
            else holder.textContent = value;
            const fragment = document.createDocumentFragment();
            fragment.append(...holder.childNodes);
            range.insertNode(fragment);
            return true;
        }) as typeof document.execCommand;
        try {
            const onChange = vi.fn();
            render(<Editor value="Other" onChange={onChange} />);
            const content = document.querySelector<HTMLElement>('.content')!;
            content.focus();
            setCaret(content, 'end');
            fireEvent.paste(content, {
                clipboardData: {
                    files: [],
                    getData: (type: string) => (type === 'text/plain' ? ' **port**' : ''),
                },
            });
            expect(onChange.mock.calls.at(-1)?.[0]).toBe('Other **port**');
        } finally {
            document.execCommand = original;
        }
    });
});

function pasteFlavours(content: HTMLElement, flavours: Record<string, string | undefined>) {
    fireEvent.paste(content, {
        clipboardData: {files: [], getData: (type: string) => flavours[type] ?? ''},
    });
}

function withInsertHtml(run: () => void) {
    const original = document.execCommand;
    document.execCommand = ((command: string, _ui?: boolean, value = '') => {
        if (command !== 'insertHTML' && command !== 'insertText') return false;
        const range = window.getSelection()!.getRangeAt(0);
        const holder = document.createElement('div');
        if (command === 'insertHTML') holder.innerHTML = value;
        else holder.textContent = value;
        const fragment = document.createDocumentFragment();
        fragment.append(...holder.childNodes);
        range.insertNode(fragment);
        return true;
    }) as typeof document.execCommand;
    try {
        run();
    } finally {
        document.execCommand = original;
    }
}

const RICH_HTML =
    '<meta charset="utf-8"><h2>Plan</h2><p>Owner: <span style="font-weight:700">Sam</span></p><ul><li>One<ul><li>Nested</li></ul></li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';

function selectAcross(first: HTMLElement, start: number, last: HTMLElement, end: number) {
    first.focus();
    const range = document.createRange();
    range.setStart(first.firstChild!, start);
    range.setEnd(last.firstChild!, end);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
}

const INTERNAL_BLOCKS = 'application/x-notion-editor-blocks';
const SOURCE_SELECTION = 'alpha ONE\n\nTWO omega';
const UNSUPPORTED = '{% list tabs %}\n\n- Tab\n\n{% endlist %}';
const CODE_EDITOR_HTML = '<div style="font-family: monospace; white-space: pre">syntax</div>';

describe('cross-block paste transactions', () => {
    it.each([
        {'text/plain': UNSUPPORTED, 'text/html': CODE_EDITOR_HTML},
        {'text/plain': UNSUPPORTED.replace(/\n/g, '\r')},
        {'text/plain': ''},
        {[INTERNAL_BLOCKS]: '{invalid'},
        {[INTERNAL_BLOCKS]: '[{"type":"unknown","html":"x"}]', 'text/plain': UNSUPPORTED},
    ])(
        'keeps the selection and history intact when the effective payload is refused: %j',
        (flavours) => {
            const onChange = vi.fn();
            const editor = createRef<EditorHandle>();
            render(<Editor ref={editor} value={SOURCE_SELECTION} onChange={onChange} />);
            const contents = document.querySelectorAll<HTMLElement>('.content');
            selectAcross(contents[0], 6, contents[1], 3);
            pasteFlavours(contents[0], flavours);
            expect(onChange).not.toHaveBeenCalled();
            expect([...contents].map((content) => content.textContent)).toEqual([
                'alpha ONE',
                'TWO omega',
            ]);
            expect(window.getSelection()?.toString()).toBe('ONETWO');
            expect(editor.current!.snapshot().past).toHaveLength(0);
        },
    );

    it.each([
        [{'text/plain': 'X\nY'}, 'alpha X\n\nY omega'],
        [{'text/plain': 'X\rY'}, 'alpha X\n\nY omega'],
        [
            {'text/plain': 'X\nY', 'text/html': '<p><b>X</b></p><p><i>Y</i></p>'},
            'alpha **X**\n\n*Y* omega',
        ],
        [
            {
                [INTERNAL_BLOCKS]: JSON.stringify([
                    {type: 'text', html: 'X'},
                    {type: 'text', html: 'Y'},
                ]),
            },
            'alpha X\n\nY omega',
        ],
    ])(
        'replaces once and restores the complete selection with one Undo: %j',
        (flavours, expected) => {
            const onChange = vi.fn();
            const editor = createRef<EditorHandle>();
            render(
                <StrictMode>
                    <Editor ref={editor} value={SOURCE_SELECTION} onChange={onChange} />
                </StrictMode>,
            );
            const contents = document.querySelectorAll<HTMLElement>('.content');
            selectAcross(contents[0], 6, contents[1], 3);
            pasteFlavours(contents[0], flavours);
            expect(onChange.mock.calls.map(([value]) => value)).toEqual([expected]);
            expect(editor.current!.snapshot().past).toHaveLength(1);
            act(() => editor.current!.undo());
            expect(onChange.mock.calls.at(-1)?.[0]).toBe(SOURCE_SELECTION);
            act(() => editor.current!.redo());
            expect(onChange.mock.calls.at(-1)?.[0]).toBe(expected);
        },
    );

    it('uses accepted rich content even when the plain flavour has unsupported Markdown', () => {
        const onChange = vi.fn();
        render(<Editor value={SOURCE_SELECTION} onChange={onChange} />);
        const contents = document.querySelectorAll<HTMLElement>('.content');
        selectAcross(contents[0], 6, contents[1], 3);
        pasteFlavours(contents[0], {
            'text/plain': UNSUPPORTED,
            'text/html': '<p><b>Accepted</b></p>',
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('alpha **Accepted** omega');
    });

    it('keeps head and tail on either side of an internal block paste', () => {
        const onChange = vi.fn();
        render(<Editor value={'abcd\n\nefgh'} onChange={onChange} />);
        const contents = document.querySelectorAll<HTMLElement>('.content');
        selectAcross(contents[0], 2, contents[1], 2);
        pasteFlavours(contents[0], {
            [INTERNAL_BLOCKS]: JSON.stringify([
                {type: 'text', html: 'ONE'},
                {type: 'text', html: 'TWO'},
            ]),
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('abONE\n\nTWOgh');
    });

    it('retains inline formatting around a rich selection replacement', () => {
        const onChange = vi.fn();
        render(<Editor value={'**abCD**\n\n*EFgh*'} onChange={onChange} />);
        const contents = document.querySelectorAll<HTMLElement>('.content');
        contents[0].focus();
        const range = document.createRange();
        range.setStart(contents[0].querySelector('strong')!.firstChild!, 2);
        range.setEnd(contents[1].querySelector('em')!.firstChild!, 2);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        pasteFlavours(contents[0], {'text/plain': 'X\nY', 'text/html': '<p>X</p><p>Y</p>'});
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('**ab**X\n\nY*gh*');
    });

    it('refuses an overly deep internal payload before replacing any text', () => {
        const onChange = vi.fn();
        const source =
            '- root\n  - a\n    - b\n      - c\n        - d\n          - e\n            - abc\n            - def';
        render(<Editor value={source} onChange={onChange} />);
        const contents = document.querySelectorAll<HTMLElement>('.content');
        selectAcross(contents[6], 1, contents[7], 2);
        pasteFlavours(contents[6], {
            [INTERNAL_BLOCKS]: JSON.stringify([
                {type: 'bulleted', html: 'X', depth: 0},
                {type: 'bulleted', html: 'Y', depth: 1},
            ]),
        });
        expect(onChange).not.toHaveBeenCalled();
        expect(contents[6]).toHaveTextContent('abc');
        expect(contents[7]).toHaveTextContent('def');
    });

    it('applies a pending plain-text clipboard read as one selection replacement', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        let resolveRead!: (text: string) => void;
        const read = new Promise<string>((resolve) => {
            resolveRead = resolve;
        });
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {readText: () => read},
        });
        try {
            const editor = createRef<EditorHandle>();
            const onChange = vi.fn();
            render(<Editor ref={editor} value={SOURCE_SELECTION} onChange={onChange} />);
            const contents = document.querySelectorAll<HTMLElement>('.content');
            selectAcross(contents[0], 6, contents[1], 3);
            fireEvent.keyDown(contents[0], {key: 'v', metaKey: true, shiftKey: true});
            expect(onChange).not.toHaveBeenCalled();
            await act(async () => {
                resolveRead('**X**\nY');
            });
            expect(onChange.mock.calls.at(-1)?.[0]).toBe('alpha X Y omega');
            expect(editor.current!.snapshot().past).toHaveLength(1);
            act(() => editor.current!.undo());
            expect(onChange.mock.calls.at(-1)?.[0]).toBe(SOURCE_SELECTION);
        } finally {
            if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
            else Reflect.deleteProperty(navigator, 'clipboard');
        }
    });

    it.each(['accepted', 'cancelled', 'failed'] as const)(
        'waits for a clipboard file to be %s before replacing the selection',
        async (outcome) => {
            let resolveWrite!: (value: string | null) => void;
            let rejectWrite!: (error: Error) => void;
            const pending = new Promise<string | null>((resolve, reject) => {
                resolveWrite = resolve;
                rejectWrite = reject;
            });
            const onChange = vi.fn();
            const editor = createRef<EditorHandle>();
            render(
                <Editor
                    ref={editor}
                    value={SOURCE_SELECTION}
                    onChange={onChange}
                    onAttachFile={() => pending}
                />,
            );
            const contents = document.querySelectorAll<HTMLElement>('.content');
            selectAcross(contents[0], 6, contents[1], 3);
            fireEvent.paste(contents[0], {
                clipboardData: {
                    files: [new File(['image'], 'photo.png', {type: 'image/png'})],
                    getData: () => '',
                },
            });
            expect(onChange).not.toHaveBeenCalled();
            expect(editor.current!.snapshot().past).toHaveLength(0);
            await act(async () => {
                if (outcome === 'failed') rejectWrite(new Error('write failed'));
                else resolveWrite(outcome === 'accepted' ? 'Attachments/photo.png' : null);
            });
            if (outcome !== 'accepted') {
                expect(onChange).not.toHaveBeenCalled();
                expect(editor.current!.snapshot().past).toHaveLength(0);
                return;
            }
            expect(onChange.mock.calls.at(-1)?.[0]).toBe(
                'alpha \n\n![photo](Attachments/photo.png)\n\n omega',
            );
            expect(editor.current!.snapshot().past).toHaveLength(1);
            act(() => editor.current!.undo());
            expect(onChange.mock.calls.at(-1)?.[0]).toBe(SOURCE_SELECTION);
        },
    );

    it.each(['markdown', 'rich', 'internal'] as const)(
        'keeps a starting collapsed toggle’s children for %s paste',
        (kind) => {
            const onChange = vi.fn();
            render(
                <Editor
                    value={
                        '<details>\n<summary>SummaryONE</summary>\n\nhidden child\n\n</details>\n\nTWO tail'
                    }
                    onChange={onChange}
                />,
            );
            const contents = document.querySelectorAll<HTMLElement>('.content');
            selectAcross(contents[0], 7, contents[1], 3);
            const flavours =
                kind === 'internal'
                    ? {
                          [INTERNAL_BLOCKS]: JSON.stringify([
                              {type: 'text', html: 'X'},
                              {type: 'text', html: 'Y'},
                          ]),
                      }
                    : kind === 'rich'
                      ? {'text/plain': 'X\nY', 'text/html': '<p>X</p><p>Y</p>'}
                      : {'text/plain': 'X\nY'};
            pasteFlavours(contents[0], flavours);
            const written = onChange.mock.calls.at(-1)?.[0] as string;
            expect(written).toContain('hidden child\n\n</details>');
            expect(written.indexOf('hidden child')).toBeLessThan(written.indexOf('Y'));
            expect(written.indexOf('Y')).toBeLessThan(written.lastIndexOf('tail'));
            expect(isRoundTripStable(written), written).toBe(true);
        },
    );

    it('keeps retained tail text visible after an internal collapsed toggle and its hidden children', () => {
        const onChange = vi.fn();
        render(<Editor value={'abcd\n\nefgh'} onChange={onChange} />);
        const contents = document.querySelectorAll<HTMLElement>('.content');
        selectAcross(contents[0], 2, contents[1], 2);
        pasteFlavours(contents[0], {
            [INTERNAL_BLOCKS]: JSON.stringify([
                {type: 'toggle', html: 'Summary', depth: 0, collapsed: true},
                {type: 'text', html: 'hidden child', depth: 1},
            ]),
        });
        expect(
            [...document.querySelectorAll('.content')].map((content) => content.textContent),
        ).toEqual(['ab', 'Summary', 'gh']);
        expect(onChange.mock.calls.at(-1)?.[0]).toContain('hidden child');
    });
});

describe('internal block paste decoration', () => {
    it('copies atomic wiki blocks and directly editable literal wiki links in table cells', () => {
        const onChange = vi.fn();
        render(
            <Editor
                value={'[[Target|alias]]\n\n| Link |\n| --- |\n| [[Target]] |\n\nHost'}
                onChange={onChange}
            />,
        );
        const sourceCell = document.querySelectorAll<HTMLElement>('.table-cell-content')[1];
        expect(sourceCell).toHaveTextContent('[[Target]]');
        expect(sourceCell.querySelector('[contenteditable="false"]')).toBeNull();
        sourceCell.focus();
        sourceCell.textContent = '[[Changed]]';
        fireEvent.input(sourceCell);
        expect(onChange.mock.calls.at(-1)?.[0]).toContain('| [[Changed]] |');

        const contents = document.querySelectorAll<HTMLElement>('.content');
        selectAcross(contents[0], 0, contents[1], 0);
        const copied: Record<string, string> = {};
        fireEvent.copy(contents[0], {
            clipboardData: {
                setData: (type: string, value: string) => {
                    copied[type] = value;
                },
            },
        });
        const host = contents[1];
        host.focus();
        setCaret(host, 'end');
        pasteFlavours(host, copied);
        const chips = document.querySelectorAll<HTMLElement>('.content .wiki-link');
        expect(chips).toHaveLength(2);
        for (const chip of chips) {
            expect(chip).toHaveAttribute('contenteditable', 'false');
            expect(chip.querySelector('.wiki-hidden')).toBeInTheDocument();
        }
        const pastedCell = document.querySelectorAll<HTMLElement>('.table-cell-content')[3];
        expect(pastedCell).toHaveTextContent('[[Changed]]');
        expect(pastedCell.querySelector('[contenteditable="false"]')).toBeNull();
        pastedCell.focus();
        pastedCell.textContent = '[[Repointed]]';
        fireEvent.input(pastedCell);
        const written = onChange.mock.calls.at(-1)?.[0] as string;
        expect(written.match(/\[\[Target\|alias\]\]/g)).toHaveLength(2);
        expect(written).toContain('| [[Changed]] |');
        expect(written).toContain('| [[Repointed]] |');
        expect(written.match(/\| Link \|/g)).toHaveLength(2);
        expect(isRoundTripStable(written)).toBe(true);
    });
});

describe('rich HTML paste', () => {
    it('imports structure into an empty paragraph, and the note round-trips', () => {
        const onChange = vi.fn();
        render(<Editor value="" onChange={onChange} />);
        const content = document.querySelector<HTMLElement>('.content')!;
        content.focus();
        setCaret(content, 0);
        pasteFlavours(content, {
            'text/plain': 'Plan\nOwner: Sam\nOne\nNested',
            'text/html': RICH_HTML,
        });
        const written = onChange.mock.calls.at(-1)?.[0];
        expect(written).toBe(
            '## Plan\n\nOwner: **Sam**\n\n- One\n  - Nested\n\n| A | B |\n| --- | --- |\n| 1 | 2 |',
        );
        expect(isRoundTripStable(written)).toBe(true);
    });

    it('flows a single formatted paragraph in at the caret', () => {
        withInsertHtml(() => {
            const onChange = vi.fn();
            render(<Editor value="Other" onChange={onChange} />);
            const content = document.querySelector<HTMLElement>('.content')!;
            content.focus();
            setCaret(content, 'end');
            pasteFlavours(content, {
                'text/plain': ' bold link',
                'text/html': ' <b>bold</b> <a href="https://example.com">link</a>',
            });
            expect(onChange.mock.calls.at(-1)?.[0]).toBe(
                'Other **bold** [link](https://example.com)',
            );
        });
    });

    it('joins a leading paragraph to the text before the caret and keeps the suffix', () => {
        const onChange = vi.fn();
        render(<Editor value="Keep suffix" onChange={onChange} />);
        const content = document.querySelector<HTMLElement>('.content')!;
        content.focus();
        setCaret(content, 5);
        pasteFlavours(content, {
            'text/plain': 'Lead in\na',
            'text/html': '<p><i>Lead</i> in</p><ul><li>a</li></ul>',
        });
        const written = onChange.mock.calls.at(-1)?.[0];
        expect(written).toBe('Keep *Lead* in\n\n- asuffix');
        expect(isRoundTripStable(written)).toBe(true);
    });

    it('keeps the spaces a mid-sentence selection had at its edges', () => {
        const onChange = vi.fn();
        render(<Editor value="leftright" onChange={onChange} />);
        const content = document.querySelector<HTMLElement>('.content')!;
        content.focus();
        setCaret(content, 4);
        pasteFlavours(content, {
            'text/plain': ' one\ntwo ',
            'text/html': '<p> <b>one</b></p><p>two </p>',
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('left **one**\n\ntwo right');
    });

    it('pastes plain text into a code block without importing the HTML', () => {
        const onChange = vi.fn();
        render(<Editor value={'```\nx\n```'} onChange={onChange} />);
        const content = document.querySelector<HTMLElement>('.content')!;
        content.focus();
        setCaret(content, 'end');
        const getData = vi.fn((type: string) =>
            type === 'text/plain'
                ? 'y'
                : type === 'text/html'
                  ? '<table><tr><td>y</td></tr></table>'
                  : '',
        );
        const insert = vi.fn(() => true);
        Object.defineProperty(document, 'execCommand', {value: insert, configurable: true});
        try {
            fireEvent.paste(content, {clipboardData: {files: [], getData}});
        } finally {
            delete (document as Partial<Document>).execCommand;
        }
        expect(insert).toHaveBeenCalledWith('insertText', false, 'y');
        expect(getData).not.toHaveBeenCalledWith('text/html');
    });

    it('replaces a cross-block selection with the imported blocks', () => {
        const onChange = vi.fn();
        render(<Editor value={'First\n\nSecond\n\nThird'} onChange={onChange} />);
        const contents = document.querySelectorAll<HTMLElement>('.content');
        contents[0].focus();
        const range = document.createRange();
        range.setStart(contents[0].firstChild!, 0);
        range.setEnd(contents[1].firstChild!, 6);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        pasteFlavours(contents[0], {
            'text/plain': 'Done\nNext',
            'text/html': '<ul><li><input type="checkbox" checked> Done</li><li>Next</li></ul>',
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('- [x] Done\n- Next\n\nThird');
    });

    it('prefers the plain Markdown when the HTML is only a code editor’s colouring', () => {
        const onChange = vi.fn();
        render(<Editor value="" onChange={onChange} />);
        const content = document.querySelector<HTMLElement>('.content')!;
        content.focus();
        setCaret(content, 0);
        pasteFlavours(content, {
            'text/plain': '# Title\n\n- item',
            'text/html':
                '<div style="font-family: Menlo, monospace; white-space: pre;"><div><span style="color: #569cd6;font-weight: bold;"># Title</span></div><br><div><span>- item</span></div></div>',
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('# Title\n\n- item');
    });

    it('pastes plain text into a code block whatever HTML came with it', () => {
        withInsertHtml(() => {
            const onChange = vi.fn();
            render(<Editor value={'```\nx\n```'} onChange={onChange} />);
            const content = document.querySelector<HTMLElement>('.content')!;
            content.focus();
            setCaret(content, 'end');
            pasteFlavours(content, {'text/plain': 'y', 'text/html': '<h1>y</h1>'});
            expect(onChange.mock.calls.at(-1)?.[0]).toBe('```\nxy\n```');
        });
    });
});
