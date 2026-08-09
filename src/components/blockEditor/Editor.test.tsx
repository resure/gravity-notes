import {createEvent, fireEvent, render, screen} from '@testing-library/react';
import {act} from 'react-dom/test-utils';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {openExternalUrl} from '../../openExternal';

import Editor from './Editor';

vi.mock('../../openExternal', () => ({openExternalUrl: vi.fn()}));

const NOTE = [
    '# Release checklist',
    '',
    'Ship the **port**, then link to [[Daily log]].',
    '',
    '- [x] write the serializer',
    '- [ ] wire the shell',
    '',
    '> [!note] Blocks in, Markdown out.',
    '',
    '![red dot](Attachments/red-dot.png)',
].join('\n');

function renderEditor(value: string, onChange = vi.fn()) {
    render(<Editor value={value} onChange={onChange} />);
    return onChange;
}

beforeEach(() => {
    vi.mocked(openExternalUrl).mockClear();
});

describe('Editor as a per-note surface', () => {
    it('renders a note’s Markdown as blocks', () => {
        renderEditor(NOTE);

        expect(screen.getByText('Release checklist', {selector: '.content'})).toBeInTheDocument();
        expect(screen.getByRole('checkbox', {name: 'Mark as not done'})).toBeInTheDocument();
        // Six blocks: heading, paragraph, two to-dos, callout, image.
        expect(document.querySelectorAll('.block')).toHaveLength(6);
        expect(document.querySelector('.image-wrap')).toBeInTheDocument();
    });

    it('does not report a change on mount (opening a note must not mark it dirty)', () => {
        const onChange = renderEditor(NOTE);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('reports edits back as Markdown, unchanged where the user did not touch it', () => {
        const onChange = vi.fn();
        renderEditor(NOTE, onChange);

        // Simulate the editor's own input path: the contentEditable's HTML changes, then onInput fires.
        const paragraph = document.querySelectorAll<HTMLElement>('.content')[1];
        act(() => {
            paragraph.innerHTML =
                'Ship the <strong>port</strong>, then link to [[Daily log]]. Done.';
            paragraph.dispatchEvent(new Event('input', {bubbles: true}));
        });

        expect(onChange).toHaveBeenCalled();
        const markdown = onChange.mock.calls.at(-1)![0] as string;
        expect(markdown).toBe(NOTE.replace('[[Daily log]].', '[[Daily log]]. Done.'));
    });

    it('keeps a wiki link literal so other Markdown tools still see it', () => {
        const onChange = vi.fn();
        renderEditor('Look at [[Some Note]].', onChange);

        const paragraph = document.querySelector<HTMLElement>('.content')!;
        act(() => {
            paragraph.innerHTML = 'Look at [[Some Note]] now.';
            paragraph.dispatchEvent(new Event('input', {bubbles: true}));
        });

        expect(onChange.mock.calls.at(-1)![0]).toBe('Look at [[Some Note]] now.');
    });
});

describe('links in the body', () => {
    it('never lets a click navigate the app’s own webview', () => {
        renderEditor('Read the [spec](https://example.com/spec).');
        const anchor = document.querySelector<HTMLAnchorElement>('.content a')!;

        const plain = createEvent.click(anchor, {bubbles: true, cancelable: true});
        fireEvent(anchor, plain);
        // Following the link in-place would replace the whole shell; a plain click stays an edit
        // gesture (place the caret), so nothing is opened either.
        expect(plain.defaultPrevented).toBe(true);
        expect(openExternalUrl).not.toHaveBeenCalled();

        const modified = createEvent.click(anchor, {
            bubbles: true,
            cancelable: true,
            metaKey: true,
        });
        fireEvent(anchor, modified);
        expect(modified.defaultPrevented).toBe(true);
        expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/spec');
    });
});

describe('block selection', () => {
    it('acts on the keyboard only while no other surface owns it', () => {
        const onChange = vi.fn();
        renderEditor(NOTE, onChange);
        const paragraph = document.querySelectorAll<HTMLElement>('.content')[1];
        act(() => {
            fireEvent.keyDown(paragraph, {key: 'Escape'});
        });
        expect(document.querySelectorAll('.block.selected')).toHaveLength(1);

        // ⌘L jumps to the app's search box: a KEYBOARD path, so the mousedown clearer never runs
        // and the block stays selected behind it. Backspace there must edit the query, not delete a
        // block from the note (which would autosave the deletion).
        const elsewhere = document.createElement('input');
        document.body.appendChild(elsewhere);
        elsewhere.focus();
        act(() => {
            fireEvent.keyDown(elsewhere, {key: 'Backspace'});
        });
        expect(document.querySelectorAll('.block')).toHaveLength(6);
        expect(onChange).not.toHaveBeenCalled();

        // With the keyboard back on the editor (selecting a block blurs its contentEditable, so
        // these events legitimately land on <body>) the same key still deletes.
        elsewhere.remove();
        act(() => {
            fireEvent.keyDown(document.body, {key: 'Backspace'});
        });
        expect(document.querySelectorAll('.block')).toHaveLength(5);
    });
});

describe('keyboard chords the editor owns', () => {
    /** Records every keydown that survives to `document`, where `useShortcuts` listens. */
    function watchDocumentKeys(): string[] {
        const seen: string[] = [];
        document.addEventListener('keydown', (e) => seen.push(e.key.toLowerCase()));
        return seen;
    }

    it('does not leak them to the app’s global shortcut handler', () => {
        renderEditor(NOTE);
        const seen = watchDocumentKeys();
        const paragraph = document.querySelectorAll<HTMLElement>('.content')[1];

        // ⌘D is "duplicate selected note" globally and "duplicate block" here; ⌘K is "previous
        // note" globally and "insert link" here. Both used to run BOTH handlers.
        act(() => {
            fireEvent.keyDown(paragraph, {key: 'd', metaKey: true});
        });
        act(() => {
            fireEvent.keyDown(paragraph, {key: 'e', metaKey: true});
        });
        expect(seen).toEqual([]);

        // Control: a chord the editor does NOT bind still reaches the global handler, so the
        // assertion above is about stopPropagation and not about the harness never seeing anything.
        act(() => {
            fireEvent.keyDown(paragraph, {key: 'n', metaKey: true});
        });
        expect(seen).toEqual(['n']);
    });

    it('does the same from inside a table cell', () => {
        renderEditor(['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'));
        const seen = watchDocumentKeys();
        const cell = document.querySelector<HTMLElement>('.table-cell-content')!;

        act(() => {
            fireEvent.keyDown(cell, {key: 'd', metaKey: true});
        });
        expect(seen).toEqual([]);
    });
});

describe('the block menu', () => {
    it('offers no "Copy link to block" — a block id cannot survive the note being reopened', () => {
        renderEditor(NOTE);
        act(() => {
            fireEvent.click(document.querySelector<HTMLElement>('.drag-btn')!);
        });

        expect(screen.getByRole('menu', {name: 'Block actions'})).toBeInTheDocument();
        expect(screen.getByText('Duplicate')).toBeInTheDocument();
        expect(screen.queryByText('Copy link to block')).not.toBeInTheDocument();
    });

    it('still honours the Del shortcut it advertises, from its own portaled surface', () => {
        renderEditor(NOTE);
        act(() => {
            fireEvent.click(document.querySelector<HTMLElement>('.drag-btn')!);
        });

        // The menu portals to <body>, outside the editor root — scoping the selection keys must not
        // cut its own overlays off from the selection they act on.
        act(() => {
            fireEvent.keyDown(screen.getByText('Delete'), {key: 'Delete'});
        });
        expect(document.querySelectorAll('.block')).toHaveLength(5);
    });
});
