import {act, fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {openExternalUrl} from '../../openExternal';

import Editor from './Editor';
import {linkHref} from './SelectionToolbar';

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

describe('linkHref', () => {
    it.each([
        ['example.com', 'https://example.com'],
        ['example.com/path?q=1', 'https://example.com/path?q=1'],
        ['mailto:me@example.com', 'mailto:me@example.com'],
        ['Attachments/report.pdf', 'Attachments/report.pdf'],
        ['#usage', '#usage'],
        ['../Other.md', '../Other.md'],
    ])('reads %s as %s', (typed, href) => {
        expect(linkHref(typed)).toBe(href);
    });
});

describe('link popup', () => {
    async function caretInLink() {
        const content = document.querySelector<HTMLElement>('.content')!;
        const link = content.querySelector('a')!;
        await act(async () => {
            content.focus();
            const range = document.createRange();
            range.setStart(link.firstChild!, 2);
            range.collapse(true);
            window.getSelection()!.removeAllRanges();
            window.getSelection()!.addRange(range);
            document.dispatchEvent(new Event('selectionchange'));
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
        });
        return {content, link};
    }

    it('shows where the link points, and opens it', async () => {
        render(<Editor value="see [docs](https://example.com) here" onChange={vi.fn()} />);
        await caretInLink();
        const tip = screen.getByRole('toolbar', {name: 'Link to https://example.com'});
        expect(tip).toHaveTextContent('https://example.com');
        act(() => {
            fireEvent.click(screen.getByRole('button', {name: 'Open'}));
        });
        expect(openExternalUrl).toHaveBeenCalledWith('https://example.com');
    });

    it('Enter in the link box is consumed, so it cannot split the paragraph it links', async () => {
        render(<Editor value="see [docs](https://example.com) here" onChange={vi.fn()} />);
        await caretInLink();
        act(() => {
            fireEvent.click(screen.getByRole('button', {name: 'Edit'}));
        });
        const input = screen.getByRole('textbox', {name: 'Link URL'});
        let notPrevented = true;
        Object.defineProperty(document, 'execCommand', {value: () => true, configurable: true});
        try {
            act(() => {
                notPrevented = fireEvent.keyDown(input, {key: 'Enter'});
            });
        } finally {
            delete (document as Partial<Document>).execCommand;
        }
        expect(notPrevented).toBe(false);
    });

    it('Edit opens the link box on the whole link', async () => {
        render(<Editor value="see [docs](https://example.com) here" onChange={vi.fn()} />);
        await caretInLink();
        act(() => {
            fireEvent.click(screen.getByRole('button', {name: 'Edit'}));
        });
        expect(screen.getByRole('textbox', {name: 'Link URL'})).toHaveValue('https://example.com');
    });

    it('Unlink keeps the words and drops the link', async () => {
        const original = document.execCommand;
        document.execCommand = ((command: string) => {
            if (command !== 'unlink') return false;
            const node = window.getSelection()!.getRangeAt(0).commonAncestorContainer;
            const link = (node instanceof Element ? node : node.parentElement)!.closest('a')!;
            link.replaceWith(...link.childNodes);
            return true;
        }) as typeof document.execCommand;
        try {
            const onChange = vi.fn();
            render(<Editor value="see [docs](https://example.com) here" onChange={onChange} />);
            await caretInLink();
            act(() => {
                fireEvent.click(screen.getByRole('button', {name: 'Unlink'}));
            });
            expect(onChange.mock.calls.at(-1)?.[0]).toBe('see docs here');
        } finally {
            document.execCommand = original;
        }
    });
});
