import {fireEvent, render} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import Editor from './Editor';

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
