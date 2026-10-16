import {fireEvent, render} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

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
