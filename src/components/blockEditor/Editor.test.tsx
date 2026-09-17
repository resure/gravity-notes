import {createEvent, fireEvent, render, screen} from '@testing-library/react';
import {act} from 'react-dom/test-utils';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {openExternalUrl} from '../../openExternal';

import Editor from './Editor';
import {setCaret} from './caret';

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

describe('[[wiki links]] in the body', () => {
    const NOTES = [
        {id: 'Daily log.md', title: 'Daily log', preview: '', updatedAt: 3},
        {id: 'Work/Spec.md', title: 'Spec', preview: '', updatedAt: 2},
    ];

    function renderWithNotes(value: string, onChange = vi.fn()) {
        render(<Editor value={value} notes={NOTES} noteId="Home.md" onChange={onChange} />);
        return onChange;
    }

    /**
     * jsdom has no `document.execCommand`, which is how the editor inserts text at the caret
     * (`insertPlainTextAtCaret`). A minimal `insertText` over the live Range is enough to exercise
     * the commit path.
     */
    beforeEach(() => {
        document.execCommand = ((command: string, _ui?: boolean, value = '') => {
            if (command !== 'insertText') return false;
            const selection = window.getSelection();
            if (!selection?.rangeCount) return false;
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const node = document.createTextNode(value);
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            return true;
        }) as typeof document.execCommand;
    });

    /**
     * Replace a block's text and fire the input the editor listens for, with the caret parked at the
     * end — which is what the `[[` trigger reads. jsdom keeps no caret of its own, so a test that
     * only sets `textContent` looks to the editor like a caret at offset 0.
     */
    function type(el: HTMLElement, text: string) {
        el.textContent = text;
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        act(() => {
            el.dispatchEvent(new Event('input', {bubbles: true}));
        });
    }

    it('wraps a link for styling without changing a byte of the text', () => {
        renderWithNotes('Look at [[Daily log]].');
        const link = document.querySelector<HTMLElement>('.content .wiki-link')!;
        expect(link.textContent).toBe('[[Daily log]]');
        expect(link.classList.contains('wiki-link_broken')).toBe(false);
    });

    it('marks a link with no target broken', () => {
        renderWithNotes('Look at [[Nothing here]].');
        expect(document.querySelector('.content .wiki-link_broken')).toBeInTheDocument();
    });

    /**
     * The trap the whole design exists to avoid: the editor re-serializes the WHOLE note on every
     * keystroke, so a decoration that changed the text would rewrite every link in the file the
     * first time any character changed. Type one character; the links must come back untouched.
     */
    it('does not rewrite links when an unrelated character is typed', () => {
        const onChange = renderWithNotes('See [[Daily log]] and [[Nothing here]].');
        const paragraph = document.querySelector<HTMLElement>('.content')!;
        act(() => {
            paragraph.innerHTML = `${paragraph.innerHTML}!`;
            paragraph.dispatchEvent(new Event('input', {bubbles: true}));
        });
        expect(onChange.mock.calls.at(-1)![0]).toBe('See [[Daily log]] and [[Nothing here]].!');
    });

    it('decorates a link the moment it is completed, keeping the caret where it was', () => {
        renderWithNotes('See ');
        const paragraph = document.querySelector<HTMLElement>('.content')!;
        act(() => {
            paragraph.innerHTML = 'See [[Daily log]]';
            paragraph.dispatchEvent(new Event('input', {bubbles: true}));
        });
        expect(document.querySelector('.content .wiki-link')?.textContent).toBe('[[Daily log]]');
    });

    it('opens the picker on `[[` and commits the picked note as a literal link', () => {
        const onChange = renderWithNotes('');
        const paragraph = document.querySelector<HTMLElement>('.content')!;
        paragraph.focus();
        type(paragraph, '[[');

        const picker = screen.getByRole('listbox', {name: 'Link to a note'});
        expect(picker).toBeInTheDocument();
        act(() => {
            fireEvent.click(screen.getByText('Daily log'));
        });
        expect(onChange.mock.calls.at(-1)![0]).toBe('[[Daily log]]');
    });

    /** §06: the last row always offers to link a note that doesn't exist yet (D19: insert-only). */
    it('always offers a "Create …" row for a query that names no note', () => {
        renderWithNotes('');
        const paragraph = document.querySelector<HTMLElement>('.content')!;
        paragraph.focus();
        type(paragraph, '[[');
        type(paragraph, '[[Brand new');
        expect(screen.getByText('Create “Brand new”')).toBeInTheDocument();
    });

    it('closes the picker once the link is closed', () => {
        renderWithNotes('');
        const paragraph = document.querySelector<HTMLElement>('.content')!;
        paragraph.focus();
        type(paragraph, '[[');
        expect(screen.queryByRole('listbox', {name: 'Link to a note'})).toBeInTheDocument();
        type(paragraph, '[[Daily log]]');
        expect(screen.queryByRole('listbox', {name: 'Link to a note'})).not.toBeInTheDocument();
    });
});

/**
 * Each of these pins a defect that reached the user's `.md` file. They are grouped because they
 * share one theme: a keystroke or a pointer gesture that quietly rewrote the note.
 */
describe('regressions: edits that silently reached disk', () => {
    it('keeps the paragraph when Backspace lands on one after an image', () => {
        const onChange = vi.fn();
        renderEditor('![dot](Attachments/red-dot.png)\n\nkeep me', onChange);
        const paragraph = screen.getByText('keep me', {selector: '.content'});
        paragraph.focus();
        setCaret(paragraph, 'start');
        act(() => {
            fireEvent.keyDown(paragraph, {key: 'Backspace'});
        });
        // The image block holds no editable text and its serializer never reads `html`, so merging
        // into it wrote the paragraph into a field nothing writes out — the text just vanished.
        expect(screen.getByText('keep me', {selector: '.content'})).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps the paragraph when Backspace lands on one after a table', () => {
        const onChange = vi.fn();
        renderEditor('| a | b |\n| --- | --- |\n| 1 | 2 |\n\nkeep me', onChange);
        const paragraph = screen.getByText('keep me', {selector: '.content'});
        paragraph.focus();
        setCaret(paragraph, 'start');
        act(() => {
            fireEvent.keyDown(paragraph, {key: 'Backspace'});
        });
        expect(screen.getByText('keep me', {selector: '.content'})).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not merge a paragraph into a block hidden inside a collapsed toggle', () => {
        const onChange = vi.fn();
        renderEditor(
            '<details>\n<summary>Summary</summary>\n\nhidden child\n\n</details>\n\ntail text',
            onChange,
        );
        const tail = screen.getByText('tail text', {selector: '.content'});
        tail.focus();
        setCaret(tail, 'start');
        act(() => {
            fireEvent.keyDown(tail, {key: 'Backspace'});
        });
        // Merging into the hidden child moved the text where the user cannot see it, which reads
        // as a deletion — and autosaved it inside the collapsed section.
        expect(screen.getByText('tail text', {selector: '.content'})).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('yields ⌘⇧⌫ to the app (trash the note) instead of deleting the selected blocks', () => {
        const onChange = vi.fn();
        renderEditor(NOTE, onChange);
        const paragraph = document.querySelectorAll<HTMLElement>('.content')[1];
        act(() => {
            fireEvent.keyDown(paragraph, {key: 'Escape'});
        });
        expect(document.querySelectorAll('.block.selected')).toHaveLength(1);

        act(() => {
            fireEvent.keyDown(document.body, {key: 'Backspace', metaKey: true, shiftKey: true});
        });
        // The chord opens the app's trash-confirm dialog. Removing the blocks here too meant
        // CANCELLING that dialog still lost them.
        expect(document.querySelectorAll('.block')).toHaveLength(6);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('stops a block-selection chord from also reaching the app', () => {
        renderEditor(NOTE);
        const paragraph = document.querySelectorAll<HTMLElement>('.content')[1];
        act(() => {
            fireEvent.keyDown(paragraph, {key: 'Escape'});
        });
        // The app's global handler listens on `document` in the BUBBLE phase. With a block
        // selected the contentEditable is blurred, so the target is <body> — outside React's root,
        // where `claimChord` can't help. ⌘D used to duplicate the block AND write a stray copy of
        // the whole note into the vault.
        const reachedApp = vi.fn();
        document.addEventListener('keydown', reachedApp);
        act(() => {
            fireEvent.keyDown(document.body, {key: 'd', metaKey: true});
        });
        document.removeEventListener('keydown', reachedApp);
        expect(document.querySelectorAll('.block')).toHaveLength(7);
        expect(reachedApp).not.toHaveBeenCalled();
    });
});

describe('regressions: the refused merge must not become a dead key', () => {
    it('still removes an EMPTY block sitting after an image', () => {
        renderEditor('![dot](Attachments/red-dot.png)\n\nscratch');
        const paragraph = screen.getByText('scratch', {selector: '.content'});
        paragraph.focus();
        act(() => {
            paragraph.innerHTML = '';
            paragraph.dispatchEvent(new Event('input', {bubbles: true}));
        });
        setCaret(paragraph, 'start');
        act(() => {
            fireEvent.keyDown(paragraph, {key: 'Backspace'});
        });
        // Refusing the merge protects TEXT; with nothing to lose, "Enter after an image, changed my
        // mind, Backspace" has to keep working rather than silently doing nothing.
        expect(document.querySelectorAll('.block')).toHaveLength(1);
    });
});

describe('⌘[ / ⌘] indent and outdent', () => {
    const LIST = ['- one', '- two'].join('\n');

    it('indents a list item on ⌘] and outdents it on ⌘[', () => {
        const onChange = vi.fn();
        renderEditor(LIST, onChange);
        const second = screen.getByText('two', {selector: '.content'});
        second.focus();

        act(() => {
            fireEvent.keyDown(second, {key: ']', code: 'BracketRight', metaKey: true});
        });
        expect(onChange).toHaveBeenLastCalledWith('- one\n  - two');

        act(() => {
            fireEvent.keyDown(second, {key: '[', code: 'BracketLeft', metaKey: true});
        });
        expect(onChange).toHaveBeenLastCalledWith(LIST);
    });

    it('leaves ⌘⌥[ / ⌘⌥] to the app (back / forward through notes)', () => {
        const onChange = vi.fn();
        renderEditor(LIST, onChange);
        const second = screen.getByText('two', {selector: '.content'});
        second.focus();

        // Option is what tells the two chords apart, so the editor must not claim these — and must
        // not stop them reaching the global handler on `document`.
        const reachedApp = vi.fn();
        document.addEventListener('keydown', reachedApp);
        act(() => {
            fireEvent.keyDown(second, {
                key: '“',
                code: 'BracketLeft',
                metaKey: true,
                altKey: true,
            });
        });
        document.removeEventListener('keydown', reachedApp);
        expect(onChange).not.toHaveBeenCalled();
        expect(reachedApp).toHaveBeenCalledTimes(1);
    });
});

describe('arrow keys while blocks are selected', () => {
    const selectedIds = () => [...document.querySelectorAll('.block.selected')].map((el) => el.id);

    function selectFirstBlockViaEscape() {
        const first = document.querySelectorAll<HTMLElement>('.content')[0];
        first.focus();
        act(() => {
            fireEvent.keyDown(first, {key: 'Escape'});
        });
    }

    it('moves the selection down and up instead of scrolling the page', () => {
        renderEditor(NOTE);
        selectFirstBlockViaEscape();
        const ids = [...document.querySelectorAll('.block')].map((el) => el.id);
        expect(selectedIds()).toEqual([ids[0]]);

        act(() => {
            fireEvent.keyDown(document.body, {key: 'ArrowDown'});
        });
        expect(selectedIds()).toEqual([ids[1]]);

        act(() => {
            fireEvent.keyDown(document.body, {key: 'ArrowUp'});
        });
        expect(selectedIds()).toEqual([ids[0]]);
    });

    it('claims the arrow so the browser does not scroll', () => {
        renderEditor(NOTE);
        selectFirstBlockViaEscape();
        const event = createEvent.keyDown(document.body, {key: 'ArrowDown'});
        act(() => {
            fireEvent(document.body, event);
        });
        expect(event.defaultPrevented).toBe(true);
    });

    it('stays put at the ends rather than falling through to a page scroll', () => {
        renderEditor(NOTE);
        selectFirstBlockViaEscape();
        const ids = [...document.querySelectorAll('.block')].map((el) => el.id);

        act(() => {
            fireEvent.keyDown(document.body, {key: 'ArrowUp'});
        });
        expect(selectedIds()).toEqual([ids[0]]);
    });

    it('still extends the selection with ⇧, rather than moving it', () => {
        renderEditor(NOTE);
        selectFirstBlockViaEscape();
        const ids = [...document.querySelectorAll('.block')].map((el) => el.id);

        act(() => {
            fireEvent.keyDown(document.body, {key: 'ArrowDown', shiftKey: true});
        });
        expect(selectedIds()).toEqual([ids[0], ids[1]]);
    });
});

describe('⌘⌥↑ / ⌘⌥↓ reorder the selected block', () => {
    const LIST = ['- one', '- two', '- three'].join('\n');

    function selectBlock(text: string) {
        const el = screen.getByText(text, {selector: '.content'});
        el.focus();
        act(() => {
            fireEvent.keyDown(el, {key: 'Escape'});
        });
    }

    function moveSelected(key: 'ArrowUp' | 'ArrowDown') {
        act(() => {
            fireEvent.keyDown(document.body, {key, metaKey: true, altKey: true});
        });
    }

    it('moves a block up and back down', () => {
        const onChange = vi.fn();
        renderEditor(LIST, onChange);

        selectBlock('two');
        moveSelected('ArrowUp');
        expect(onChange).toHaveBeenLastCalledWith(['- two', '- one', '- three'].join('\n'));

        moveSelected('ArrowDown');
        expect(onChange).toHaveBeenLastCalledWith(LIST);
    });

    it('keeps the moved block selected so it can be moved again', () => {
        renderEditor(LIST);
        selectBlock('three');
        moveSelected('ArrowUp');
        moveSelected('ArrowUp');
        const texts = [...document.querySelectorAll('.block .content')].map((el) => el.textContent);
        expect(texts).toEqual(['three', 'one', 'two']);
    });

    it('does nothing at the ends', () => {
        const onChange = vi.fn();
        renderEditor(LIST, onChange);
        selectBlock('one');
        moveSelected('ArrowUp');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('claims the chord so the app does not also act on it', () => {
        renderEditor(LIST);
        selectBlock('two');
        const reachedApp = vi.fn();
        document.addEventListener('keydown', reachedApp);
        moveSelected('ArrowUp');
        document.removeEventListener('keydown', reachedApp);
        expect(reachedApp).not.toHaveBeenCalled();
    });
});
