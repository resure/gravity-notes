import {fireEvent, render} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {openExternalUrl} from '../../openExternal';

import Editor from './Editor';

vi.mock('../../openExternal', () => ({openExternalUrl: vi.fn()}));

describe('link destinations', () => {
    it('keeps a link title when another part of the note is edited', () => {
        const source = '[docs](https://example.com "Documentation")\n\nOther paragraph';
        const onChange = vi.fn();
        render(<Editor value={source} onChange={onChange} />);
        const paragraph = document.querySelectorAll<HTMLElement>('.content')[1];
        paragraph.append(' edited');
        fireEvent.input(paragraph);
        expect(onChange.mock.calls.at(-1)?.[0]).toBe(`${source} edited`);
    });
    it('passes a relative destination unchanged to the external URL policy', () => {
        render(<Editor value="[note](Other.md)" onChange={vi.fn()} />);
        fireEvent.click(document.querySelector('.content a')!, {metaKey: true});
        expect(openExternalUrl).toHaveBeenCalledWith('Other.md');
    });

    it('allows a literal percent in an external URL', () => {
        render(<Editor value="[search](https://example.com/100%)" onChange={vi.fn()} />);
        fireEvent.click(document.querySelector('.content a')!, {metaKey: true});
        expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/100%');
    });
});
