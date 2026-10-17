import {fireEvent, render} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {isRoundTripStable} from '../../markdown';

import Editor from './Editor';
import {setCaret} from './caret';

function paste(content: HTMLElement, text: string) {
    content.focus();
    setCaret(content, 0);
    fireEvent.paste(content, {
        clipboardData: {files: [], getData: (type: string) => (type === 'text/plain' ? text : '')},
    });
}

describe('Markdown paste boundaries', () => {
    it('replaces a cross-block selection without mutating React-owned DOM', () => {
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
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('Replacement\n\nThird');
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

function pasteFlavours(content: HTMLElement, flavours: Record<string, string>) {
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
