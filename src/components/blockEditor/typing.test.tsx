import {fireEvent, render} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import Editor from './Editor';
import {setCaret} from './caret';

function typeInto(content: HTMLElement, text: string) {
    content.focus();
    content.textContent = text;
    setCaret(content, text.length);
    fireEvent.input(content);
}

describe('Markdown typing rules', () => {
    it('preserves a typed ordered list start', () => {
        const onChange = vi.fn();
        render(<Editor value="" onChange={onChange} />);
        const content = document.querySelector<HTMLElement>('.content')!;
        typeInto(content, '7.');
        fireEvent.keyDown(content, {key: ' '});
        typeInto(document.querySelector<HTMLElement>('.content')!, 'seventh');
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('7. seventh');
    });

    it('leaves escaped Markdown literal while typing', () => {
        render(<Editor value="" onChange={vi.fn()} />);
        const content = document.querySelector<HTMLElement>('.content')!;
        typeInto(content, '\\**literal**');
        expect(content.querySelector('strong, em')).toBeNull();
        expect(content.textContent).toBe('\\**literal**');
    });

    it.each(['==trailing ==', '++trailing ++', '**trailing **', '~~ leading~~'])(
        'does not create formatting that cannot be reloaded: %s',
        (text) => {
            render(<Editor value="" onChange={vi.fn()} />);
            const content = document.querySelector<HTMLElement>('.content')!;
            typeInto(content, text);
            expect(content.querySelector('strong, em, ins, mark, s')).toBeNull();
        },
    );

    it.each([
        ['~~gone~~', 's', '~~gone~~'],
        ['==marked==', 'mark', '==marked=='],
        ['++underlined++', 'ins', '++underlined++'],
    ])('formats %s while typing and keeps its Markdown', (text, tag, source) => {
        const onChange = vi.fn();
        render(<Editor value="" onChange={onChange} />);
        const content = document.querySelector<HTMLElement>('.content')!;
        typeInto(content, text);
        expect(content.querySelector(tag)).not.toBeNull();
        expect(onChange.mock.calls.at(-1)?.[0]).toBe(source);
    });
});
