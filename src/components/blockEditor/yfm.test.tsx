import {fireEvent, render} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import Editor from './Editor';
import {setCaret} from './caret';

describe('YFM inline content', () => {
    it.each([
        ['==marked==', 'mark'],
        ['++underlined++', 'ins'],
        ['H~2~O', 'sub'],
        ['x^2^', 'sup'],
        ['##monospace##', 'samp'],
    ])('renders and edits %s without losing its spelling', (source, tag) => {
        const onChange = vi.fn();
        render(<Editor value={source} onChange={onChange} />);
        const content = document.querySelector<HTMLElement>('.content')!;
        expect(content.querySelector(tag)).not.toBeNull();
        expect(onChange).not.toHaveBeenCalled();
        content.append(' edited');
        fireEvent.input(content);
        expect(onChange.mock.calls.at(-1)?.[0]).toBe(`${source} edited`);
    });
});

describe('YFM container content', () => {
    it.each(['Title', ''])('Enter in a note title %s keeps its existing body inside', (title) => {
        const source = `{% note info "${title}" %}\n\nBody\n\n{% endnote %}`;
        const onChange = vi.fn();
        render(<Editor value={source} onChange={onChange} />);
        const header = document.querySelector<HTMLElement>('.content')!;
        header.focus();
        setCaret(header, 'end');
        fireEvent.keyDown(header, {key: 'Enter'});
        expect(document.querySelectorAll('.block')[1].getAttribute('data-depth')).toBe('1');
        expect(onChange.mock.calls.at(-1)?.[0]).toContain('Body\n\n{% endnote %}');
    });
    it('offers only valid YFM note kinds', () => {
        const {getByRole, queryByRole} = render(
            <Editor
                value={'{% note info "Title" %}\n\nBody\n\n{% endnote %}'}
                onChange={vi.fn()}
            />,
        );
        fireEvent.click(getByRole('button', {name: 'Info callout — change kind'}));
        expect(queryByRole('menuitemradio', {name: 'Success'})).toBeNull();
        expect(getByRole('menuitemradio', {name: /Alert/})).toBeInTheDocument();
    });
    it('edits the title and body without replacing note syntax', () => {
        const source = '{% note info "Title" %}\n\nBody [[Note]]\n\n{% endnote %}';
        const onChange = vi.fn();
        render(<Editor value={source} onChange={onChange} />);
        const contents = document.querySelectorAll<HTMLElement>('.content');
        expect(contents).toHaveLength(2);
        contents[0].textContent = 'New title';
        fireEvent.input(contents[0]);
        contents[1].append(' edited');
        fireEvent.input(contents[1]);
        expect(onChange.mock.calls.at(-1)?.[0]).toBe(
            source.replace('Title', 'New title').replace('Body [[Note]]', 'Body [[Note]] edited'),
        );
    });

    it('keeps a YFM cut when it is expanded and edited', () => {
        const source = '{% cut "Title" %}\n\nBody\n\n{% endcut %}';
        const onChange = vi.fn();
        const {getByRole} = render(<Editor value={source} onChange={onChange} />);
        expect(document.querySelectorAll('.content')).toHaveLength(1);
        fireEvent.click(getByRole('button', {name: 'Expand toggle'}));
        expect(onChange).not.toHaveBeenCalled();
        const contents = document.querySelectorAll<HTMLElement>('.content');
        contents[1].append(' edited');
        fireEvent.input(contents[1]);
        expect(onChange.mock.calls.at(-1)?.[0]).toBe(source.replace('Body', 'Body edited'));
    });
});
