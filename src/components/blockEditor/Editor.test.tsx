import {StrictMode, createRef} from 'react';

import {createEvent, fireEvent, render, screen} from '@testing-library/react';
import {act} from 'react-dom/test-utils';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {markdownToBlocks} from '../../markdown';
import {openExternalUrl} from '../../openExternal';

import Editor from './Editor';
import type {EditorHandle} from './Editor';
import {filterMenuItems} from './blockConfig';
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

/** Announce a caret move the way a browser does; the overlays that follow it react a frame later. */
async function selectionChanged() {
    await act(async () => {
        document.dispatchEvent(new Event('selectionchange'));
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
}

function renderEditor(value: string, onChange = vi.fn()) {
    render(<Editor value={value} onChange={onChange} />);
    return onChange;
}

beforeEach(() => {
    vi.mocked(openExternalUrl).mockClear();
});

/**
 * jsdom has no `document.execCommand`, which is how the editor inserts text at the caret
 * (`insertPlainTextAtCaret`). A minimal `insertText` over the live Range is enough to exercise the
 * commit path. Installed per describe that needs it — leaning on another describe's `beforeEach`
 * works right up until the suite is filtered or reordered, and then fails as a silent no-op that
 * looks like the feature being broken.
 */
function useInsertTextStub() {
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
}

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

    it('goes back to editing the block on Enter, caret at its end', () => {
        renderEditor(['first', 'second'].join('\n\n'));
        const paragraph = document.querySelectorAll<HTMLElement>('.content')[0];
        act(() => {
            fireEvent.keyDown(paragraph, {key: 'Escape'});
        });
        act(() => {
            fireEvent.keyDown(document.body, {key: 'ArrowDown', shiftKey: true});
        });
        expect(document.querySelectorAll('.block.selected')).toHaveLength(2);

        act(() => {
            fireEvent.keyDown(document.body, {key: 'Enter'});
        });
        // The moving end of the selection, so ⇧↓ then Enter carries on where the extension stopped.
        const second = document.querySelectorAll<HTMLElement>('.content')[1];
        expect(document.activeElement).toBe(second);
        expect(document.querySelectorAll('.block.selected')).toHaveLength(0);
        const range = window.getSelection()!.getRangeAt(0);
        expect(range.collapsed).toBe(true);
        expect(range.endOffset).toBe(second.childNodes.length);
    });

    it('leaves no caret or highlighted text behind when blocks take over', () => {
        renderEditor(['first block', 'second block'].join('\n\n'));
        const paragraph = document.querySelectorAll<HTMLElement>('.content')[0];
        paragraph.focus();
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);

        act(() => {
            fireEvent.keyDown(paragraph, {key: 'Escape'});
        });

        // A caret blinking inside a highlighted block says the next keystroke will type there,
        // when Backspace would in fact delete the whole block.
        expect(document.activeElement).not.toBe(paragraph);
        expect(window.getSelection()?.rangeCount ?? 0).toBe(0);
        expect(document.querySelectorAll('.block.selected')).toHaveLength(1);
    });

    it('indents and outdents the selected blocks with Tab', () => {
        const onChange = vi.fn();
        renderEditor(['- A', '- B', '- C'].join('\n'), onChange);
        act(() => {
            fireEvent.keyDown(document.querySelectorAll<HTMLElement>('.content')[1], {
                key: 'Escape',
            });
        });
        act(() => {
            fireEvent.keyDown(document.body, {key: 'ArrowDown', shiftKey: true});
        });
        expect(document.querySelectorAll('.block.selected')).toHaveLength(2);

        act(() => {
            fireEvent.keyDown(document.body, {key: 'Tab'});
        });
        expect(onChange.mock.calls.at(-1)![0]).toBe(['- A', '  - B', '  - C'].join('\n'));
        // The blocks the reader highlighted are still the selected ones, so a second Tab goes on
        // indenting them rather than acting on whatever the keyboard happened to land in.
        expect(document.querySelectorAll('.block.selected')).toHaveLength(2);

        act(() => {
            fireEvent.keyDown(document.body, {key: 'Tab', shiftKey: true});
        });
        expect(onChange.mock.calls.at(-1)![0]).toBe(['- A', '- B', '- C'].join('\n'));
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

        // ⌘D is "duplicate selected note" globally and "duplicate block" here — it used to run
        // BOTH handlers. (⌘K was the same story until stepping notes moved to ⌘⇧K.)
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

    useInsertTextStub();

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

    it('points the textbox at the picker row it would commit, for assistive tech', () => {
        renderWithNotes('');
        const paragraph = document.querySelector<HTMLElement>('.content')!;
        paragraph.focus();
        type(paragraph, '[[');
        const picker = screen.getByRole('listbox', {name: 'Link to a note'});
        const active = paragraph.getAttribute('aria-activedescendant');
        expect(paragraph.getAttribute('aria-controls')).toBe(picker.id);
        expect(active && document.getElementById(active)).toHaveAttribute('aria-selected', 'true');
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

    /**
     * The editor's own table normaliser rebuilt the block from `cells`/`headerRow`/`headerColumn`
     * alone, dropping the alignment and the written layout the parser had just read. The note
     * passes the round-trip check (which runs on the RAW parse, where they still exist) and so
     * opens in blocks — and the first keystroke anywhere in it then rewrote every table
     * left-aligned and re-spaced. That is exactly the churn those fields were added to prevent.
     */
    it('keeps a table’s alignment and written layout through an edit', () => {
        const table = ['| name  | qty |', '| ----- | --: |', '| bolt  | 12  |'].join('\n');
        const onChange = vi.fn();
        renderEditor(`${table}\n\nkeep me`, onChange);

        const paragraph = screen.getByText('keep me', {selector: '.content'});
        act(() => {
            paragraph.textContent = 'keep me now';
            paragraph.dispatchEvent(new Event('input', {bubbles: true}));
        });

        expect(onChange.mock.calls.at(-1)![0]).toBe(`${table}\n\nkeep me now`);
    });

    /**
     * `|-|-|` is legal GFM and common in hand-written notes, but the parser demanded two dashes
     * while the serializer's escape check accepted one — so the note opened as paragraphs AND the
     * first edit wrote `\|` into the user's file, breaking the header row in every other tool.
     */
    it('reads a single-dash delimiter row as a table', () => {
        const table = ['| Key | Value |', '|-|-|', '| a | b |'].join('\n');
        const onChange = vi.fn();
        renderEditor(table, onChange);

        expect(document.querySelectorAll('.table-cell-content').length).toBeGreaterThan(0);
        const cell = document.querySelector<HTMLElement>('.table-cell-content')!;
        act(() => {
            cell.textContent = 'Key!';
            cell.dispatchEvent(new Event('input', {bubbles: true}));
        });
        expect(onChange.mock.calls.at(-1)![0]).not.toContain('\\|');
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

describe('⌘⌥↑ / ⌘⌥↓ reorder the selected blocks', () => {
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

    it('moves several selected blocks together', () => {
        const onChange = vi.fn();
        renderEditor(['- one', '- two', '- three', '- four'].join('\n'), onChange);
        selectBlock('two');
        act(() => {
            fireEvent.keyDown(document.body, {key: 'ArrowDown', shiftKey: true});
        });

        moveSelected('ArrowDown');
        expect(onChange).toHaveBeenLastCalledWith(
            ['- one', '- four', '- two', '- three'].join('\n'),
        );

        moveSelected('ArrowUp');
        moveSelected('ArrowUp');
        expect(onChange).toHaveBeenLastCalledWith(
            ['- two', '- three', '- one', '- four'].join('\n'),
        );
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

describe('[[ picker commits against the trigger, not the live caret', () => {
    const NOTES = [{id: 'Daily log.md', title: 'Daily log', preview: '', updatedAt: 3}];

    /** Type into a contentEditable the way the editor sees it: text set, caret at the end, input. */
    function type(el: HTMLElement, text: string) {
        el.textContent = text;
        setCaret(el, 'end');
        act(() => {
            el.dispatchEvent(new Event('input', {bubbles: true}));
        });
    }

    /** Move the caret to an absolute offset and announce it the way a browser would. */
    async function caretTo(el: HTMLElement, offset: number) {
        setCaret(el, offset);
        await selectionChanged();
    }

    useInsertTextStub();

    it('dismisses the picker when the caret moves out of the trigger', async () => {
        const onChange = vi.fn();
        render(<Editor value="" notes={NOTES} noteId="Home.md" onChange={onChange} />);
        const block = document.querySelector<HTMLElement>('.content')!;
        block.focus();
        // Incrementally: the picker opens on the `[[` transition, as a real typist produces it.
        type(block, 'Hello [[');
        type(block, 'Hello [[Dai');
        expect(screen.queryByRole('listbox', {name: 'Link to a note'})).toBeInTheDocument();

        // Arrow keys type nothing, so `input` never fires — `selectionchange` is what has to notice.
        await caretTo(block, 3);
        expect(screen.queryByRole('listbox', {name: 'Link to a note'})).not.toBeInTheDocument();
    });

    it('dismisses the picker when the caret leaves the block entirely', async () => {
        render(<Editor value={'one\n\ntwo'} notes={NOTES} noteId="Home.md" onChange={vi.fn()} />);
        const [first, second] = [...document.querySelectorAll<HTMLElement>('.content')];
        first.focus();
        type(first, 'one [[');
        type(first, 'one [[Dai');
        expect(screen.queryByRole('listbox', {name: 'Link to a note'})).toBeInTheDocument();

        // The caret moves to another block. Committing from here used to compute an offset that
        // overshot block one and deleted it from `[[` to its end, while the inserted link went into
        // block two's DOM and was then dropped on the next render.
        setCaret(second, 'end');
        await selectionChanged();
        expect(screen.queryByRole('listbox', {name: 'Link to a note'})).not.toBeInTheDocument();
        expect(first.textContent).toBe('one [[Dai');
    });

    it('replaces the trigger run even if the caret drifted inside it', () => {
        const onChange = vi.fn();
        render(<Editor value="" notes={NOTES} noteId="Home.md" onChange={onChange} />);
        const block = document.querySelector<HTMLElement>('.content')!;
        block.focus();
        type(block, 'Hello [[');
        type(block, 'Hello [[Dai');

        // One step left, still inside the query, so the picker stays open. Committing used to read
        // the LIVE caret and leave the tail behind: `Hello [[Dai]]i`.
        act(() => {
            setCaret(block, 10);
        });
        act(() => {
            fireEvent.keyDown(block, {key: 'Enter'});
        });
        expect(block.textContent).toBe('Hello [[Daily log]]');
        expect(onChange).toHaveBeenLastCalledWith('Hello [[Daily log]]');
    });
});

describe('navigation across a collapsed toggle', () => {
    const COLLAPSED = [
        '<details>',
        '<summary>Summary</summary>',
        '',
        'hidden child',
        '',
        '</details>',
        '',
        'tail text',
    ].join('\n');

    it('steps over the hidden child instead of dead-ending on it', () => {
        renderEditor(COLLAPSED);
        // The child is inside a collapsed toggle, so it renders no element at all.
        expect(screen.queryByText('hidden child', {selector: '.content'})).toBeNull();

        const summary = screen.getByText('Summary', {selector: '.content'});
        summary.focus();
        setCaret(summary, 'end');
        const event = createEvent.keyDown(summary, {key: 'ArrowDown'});
        act(() => {
            fireEvent(summary, event);
        });

        // Resolving to the hidden child found no ref, so the caret never moved — while the
        // keystroke had already been consumed. Arrows simply stopped at a collapsed toggle.
        expect(document.activeElement).toBe(screen.getByText('tail text', {selector: '.content'}));
    });

    /**
     * Enter in the summary used to wedge a sibling between the toggle and its children, cutting
     * them loose: the `<details>` reached disk with an empty body and both hidden paragraphs
     * spilled out below it. Re-parsing that gives a document that RENDERS the same, so nothing in
     * the app ever showed the damage — only the file, and only in other Markdown tools.
     */
    it('puts what Enter creates inside the toggle, not between it and its children', () => {
        const onChange = vi.fn();
        renderEditor(COLLAPSED, onChange);
        const summary = screen.getByText('Summary', {selector: '.content'});
        summary.focus();
        setCaret(summary, 'end');
        act(() => {
            fireEvent.keyDown(summary, {key: 'Enter'});
        });

        const markdown = onChange.mock.calls.at(-1)![0] as string;
        expect(markdown).toContain('hidden child');
        expect(markdown.indexOf('hidden child')).toBeLessThan(markdown.indexOf('</details>'));
        // …and the toggle opens, so the new block is somewhere the user can see it.
        expect(screen.getByText('hidden child', {selector: '.content'})).toBeInTheDocument();
    });

    /** Duplicating a collapsed toggle aimed the caret at the copy of its HIDDEN child. */
    it('puts the caret on the copy the reader can see', () => {
        renderEditor(COLLAPSED);
        act(() => {
            fireEvent.click(document.querySelector<HTMLElement>('.drag-btn')!);
        });
        act(() => {
            fireEvent.click(screen.getByText('Duplicate'));
        });

        const summaries = screen.getAllByText('Summary', {selector: '.content'});
        expect(summaries).toHaveLength(2);
        expect(document.activeElement).toBe(summaries[1]);
    });

    /**
     * ⇧↑ used to extend onto the hidden child, which shows nothing (it renders no element and
     * `revealBlock` is a silent no-op on it) — so the keystroke looked like it had done nothing,
     * and the Delete that followed took a paragraph the user had never seen highlighted.
     */
    it('extends the block selection to the next VISIBLE block', () => {
        renderEditor(COLLAPSED);
        const tail = screen.getByText('tail text', {selector: '.content'});
        tail.focus();
        act(() => {
            fireEvent.keyDown(tail, {key: 'Escape'});
        });
        act(() => {
            fireEvent.keyDown(document.body, {key: 'ArrowUp', shiftKey: true});
        });

        // The toggle joins the selection; its hidden child comes along as part of that subtree,
        // which is what deleting a toggle has always meant.
        expect(document.querySelectorAll('.block.selected')).toHaveLength(2);
        act(() => {
            fireEvent.keyDown(document.body, {key: 'Backspace'});
        });
        expect(document.querySelectorAll('.content')).toHaveLength(1);
    });

    /**
     * Tab on the paragraph after a collapsed toggle used to nest it INSIDE the toggle, where it
     * renders no element — the text vanished, the caret request found nothing, and focus fell to
     * `<body>` with no block selected, so the keyboard did nothing until the user clicked.
     */
    it('opens the toggle rather than indenting a block into hiding', () => {
        renderEditor(COLLAPSED);
        const tail = screen.getByText('tail text', {selector: '.content'});
        tail.focus();
        setCaret(tail, 'end');
        act(() => {
            fireEvent.keyDown(tail, {key: ']', code: 'BracketRight', metaKey: true});
        });

        expect(screen.getByText('tail text', {selector: '.content'})).toBeInTheDocument();
        expect(screen.getByText('hidden child', {selector: '.content'})).toBeInTheDocument();
    });

    /**
     * Deleting the last visible block used to aim the caret at whatever editable block came before
     * it in the ARRAY — which can be one hidden inside a collapsed toggle. The request found no
     * element, the block selection had already been cleared, and the editor was left with focus on
     * `<body>` and no way back but the mouse.
     */
    it('puts the caret on a block the reader can see after a delete', () => {
        renderEditor(COLLAPSED);
        const tail = screen.getByText('tail text', {selector: '.content'});
        tail.focus();
        act(() => {
            fireEvent.keyDown(tail, {key: 'Escape'});
        });
        act(() => {
            fireEvent.keyDown(document.body, {key: 'Backspace'});
        });

        expect(document.activeElement).toBe(screen.getByText('Summary', {selector: '.content'}));
    });
});

describe('clipboard: Markdown out, plain text in', () => {
    /** Select the whole of a block's content, which is what ⌘C acts on. */
    function selectAll(el: HTMLElement) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    }

    function clipboardEvent(type: 'copy' | 'cut') {
        const data: Record<string, string> = {};
        const event = createEvent(type, document.querySelector('.content')!, {
            bubbles: true,
            cancelable: true,
        }) as Event & {clipboardData: {setData: (k: string, v: string) => void}};
        Object.defineProperty(event, 'clipboardData', {
            value: {
                setData: (k: string, v: string) => {
                    data[k] = v;
                },
            },
        });
        return {event, data};
    }

    it('copies a selection as Markdown, not as rendered text', () => {
        renderEditor('Ship the **port** now');
        const block = document.querySelector<HTMLElement>('.content')!;
        selectAll(block);

        const {event, data} = clipboardEvent('copy');
        act(() => {
            fireEvent(block, event);
        });

        // The browser's own text/plain is the RENDERED text, so this used to yield `Ship the port
        // now` — the README backlog's "copy pasting should copy markdown".
        expect(data['text/plain']).toBe('Ship the **port** now');
    });

    it('leaves an empty selection to the browser', () => {
        renderEditor('Ship the **port** now');
        const block = document.querySelector<HTMLElement>('.content')!;
        window.getSelection()?.removeAllRanges();

        const {event, data} = clipboardEvent('copy');
        act(() => {
            fireEvent(block, event);
        });
        expect(data['text/plain']).toBeUndefined();
        expect(event.defaultPrevented).toBe(false);
    });

    /** Select from inside the first `.content` to inside the last one — a mouse drag down the page. */
    function selectAcross(from: HTMLElement, to: HTMLElement) {
        const range = document.createRange();
        range.setStart(from.firstChild ?? from, 5);
        range.setEnd(to.firstChild ?? to, 3);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    }

    /**
     * Each block is its own contentEditable, but one document selection drags right across them.
     * The partial path cannot serve that: `deleteFromDocument()` rips nodes out of the OTHER
     * blocks' React-owned DOM while only the event's own block is committed to state, so the cut
     * text reappears on the next render. Across blocks the cut is a WHOLE-BLOCK operation instead,
     * matching what the equivalent block selection does.
     */
    it('cuts whole blocks when the selection crosses them', () => {
        const onChange = vi.fn();
        renderEditor('first paragraph\n\nsecond paragraph\n\nthird paragraph', onChange);
        const contents = document.querySelectorAll<HTMLElement>('.content');
        selectAcross(contents[0], contents[1]);

        const {event, data} = clipboardEvent('cut');
        act(() => {
            fireEvent(contents[0], event);
        });

        expect(event.defaultPrevented).toBe(true);
        // Real Markdown, spacing included — the two paragraphs are a document, not two strings
        // glued together.
        expect(data['text/plain']).toBe('first paragraph\n\nsecond paragraph');
        // Both blocks gone — not one edited block and one that silently grew its text back.
        expect([...document.querySelectorAll('.content')].map((el) => el.textContent)).toEqual([
            'third paragraph',
        ]);
        expect(onChange.mock.calls.at(-1)![0]).toBe('third paragraph');
    });

    /**
     * A multi-block copy is serialized as ONE document: per-block at depth 0 flattened a copied
     * nested list to a single level, so pasting it anywhere else gave something the copy never
     * showed.
     */
    it('keeps a copied list nested on the plain-text clipboard', () => {
        renderEditor('- Parent\n  - Child');
        const contents = document.querySelectorAll<HTMLElement>('.content');
        selectAcross(contents[0], contents[1]);

        const {event, data} = clipboardEvent('copy');
        act(() => {
            fireEvent(contents[0], event);
        });

        expect(data['text/plain']).toBe('- Parent\n  - Child');
    });

    /**
     * A divider (and an uncaptioned image, and an empty paragraph) holds no text for a range to
     * cover, so measuring coverage by text alone dropped it: a drag across three blocks deleted the
     * two paragraphs and left the rule sitting on its own in the middle.
     */
    it('takes the textless blocks between the ends too', () => {
        const onChange = vi.fn();
        renderEditor('para A\n\n---\n\npara B', onChange);
        const contents = document.querySelectorAll<HTMLElement>('.content');
        selectAcross(contents[0], contents[1]);

        act(() => {
            fireEvent.keyDown(contents[0], {key: 'Backspace'});
        });

        expect(document.querySelector('hr')).toBeNull();
        expect(onChange.mock.calls.at(-1)![0]).toBe('');
    });

    /** And ⌘X over that same selection — the cut path had to be told the scope as well. */
    it('cuts only the blocks the selection reached', () => {
        const onChange = vi.fn();
        renderEditor('Intro paragraph\n\n- Parent\n  - Child A\n  - Child B', onChange);
        const contents = document.querySelectorAll<HTMLElement>('.content');
        selectAcross(contents[0], contents[1]);

        const {event, data} = clipboardEvent('cut');
        act(() => {
            fireEvent(contents[0], event);
        });

        expect(data['text/plain']).toBe('Intro paragraph\n\n- Parent');
        expect([...document.querySelectorAll('.content')].map((el) => el.textContent)).toEqual([
            'Child A',
            'Child B',
        ]);
    });

    /**
     * A cut's two halves have to agree. The clipboard wrote exactly the blocks the selection
     * covered while the removal ALSO took each one's hidden descendants, so ⌘X ending on a
     * collapsed toggle destroyed its children and put them on no clipboard — the paste could not
     * bring them back.
     */
    it('cuts and copies the same blocks, hidden children included', () => {
        renderEditor(
            [
                'Intro paragraph',
                '',
                '<details>',
                '<summary>Summary</summary>',
                '',
                'hidden child',
                '',
                '</details>',
                '',
                'tail text',
            ].join('\n'),
        );
        const contents = document.querySelectorAll<HTMLElement>('.content');
        selectAcross(contents[0], contents[1]);

        const {event, data} = clipboardEvent('cut');
        act(() => {
            fireEvent(contents[0], event);
        });

        expect(data['text/plain']).toContain('hidden child');
        expect(data['application/x-notion-editor-blocks']).toContain('hidden child');
    });
    /** Backspace over the same selection has the same problem, and the same answer. */
    it('deletes whole blocks when Backspace lands on a selection crossing them', () => {
        renderEditor('first paragraph\n\nsecond paragraph\n\nthird paragraph');
        const contents = document.querySelectorAll<HTMLElement>('.content');
        selectAcross(contents[0], contents[1]);

        act(() => {
            fireEvent.keyDown(contents[0], {key: 'Backspace'});
        });

        expect([...document.querySelectorAll('.content')].map((el) => el.textContent)).toEqual([
            'third paragraph',
        ]);
    });

    /**
     * …but only the blocks the selection actually covers. A BLOCK selection is a selection of
     * subtrees, so deleting one takes its children; a TEXT selection is exactly what is
     * highlighted. Expanding it swallowed the list items below — select a paragraph and the first
     * line of a list, press Backspace, and the whole list went with it.
     */
    it('leaves the children the selection did not reach', () => {
        const onChange = vi.fn();
        renderEditor('Intro paragraph\n\n- Parent\n  - Child A\n  - Child B', onChange);
        const contents = document.querySelectorAll<HTMLElement>('.content');
        selectAcross(contents[0], contents[1]);

        act(() => {
            fireEvent.keyDown(contents[0], {key: 'Backspace'});
        });

        expect([...document.querySelectorAll('.content')].map((el) => el.textContent)).toEqual([
            'Child A',
            'Child B',
        ]);
        // …and they are promoted, not left at an indent their parent no longer supports: Markdown
        // cannot write an orphaned level, so the file would come back flatter than the screen.
        expect(onChange.mock.calls.at(-1)![0]).toBe('- Child A\n- Child B');
    });

    /**
     * ⌘⇧V reads the OS clipboard, which is async — and the host can switch to read-only preview
     * while that read is in flight. The insert's own guard (is the caret still in this block?) does
     * not catch it: preview moves FOCUS, and the document SELECTION stays exactly where it was, so
     * the clipboard landed in the note behind a surface the UI calls read-only, and autosaved.
     */
    it('drops a pasted clipboard read that resolves after the editor went off screen', async () => {
        // The insert itself is `document.execCommand('insertText')`, which jsdom does not implement
        // — so the assertion is on the ATTEMPT. That is the honest observable anyway: in a browser
        // this call is the edit.
        const insert = vi.fn();
        Object.defineProperty(document, 'execCommand', {value: insert, configurable: true});
        let resolveRead: (text: string) => void = () => {};
        // jsdom ships no `navigator.clipboard` at all, so this is a definition, not a spy.
        const read = vi.fn(
            () =>
                new Promise<string>((resolve) => {
                    resolveRead = resolve;
                }),
        );
        Object.defineProperty(navigator, 'clipboard', {
            value: {readText: read},
            configurable: true,
        });

        async function pasteWhile(hidden: boolean) {
            const {rerender, unmount} = render(<Editor value="body" onChange={vi.fn()} />);
            const block = document.querySelector<HTMLElement>('.content')!;
            block.focus();
            selectAll(block);
            fireEvent.keyDown(block, {key: 'v', metaKey: true, shiftKey: true});
            // The helper reaches `navigator.clipboard` a microtask later.
            await act(async () => {});
            expect(read).toHaveBeenCalled();

            if (hidden) rerender(<Editor value="body" onChange={vi.fn()} hidden />);
            await act(async () => {
                resolveRead('pasted');
            });
            unmount();
        }

        try {
            await pasteWhile(true);
            expect(insert).not.toHaveBeenCalled();

            // Control: the same sequence with the editor on screen DOES insert, so the assertion
            // above is about the hidden guard and not about the chord being inert under jsdom.
            read.mockClear();
            await pasteWhile(false);
            expect(insert).toHaveBeenCalledWith('insertText', false, 'pasted');
        } finally {
            Reflect.deleteProperty(navigator as object, 'clipboard');
            Reflect.deleteProperty(document as object, 'execCommand');
        }
    });
});

describe('pasting a grid into a table', () => {
    /**
     * Excel, Sheets and most web tables end a copied range with a newline. Reading that as an extra
     * empty ROW wrote a blank over the cell below the paste — and then parked the caret in the cell
     * it had just wiped.
     */
    it('reads a trailing newline as a terminator, not an empty row', () => {
        const onChange = vi.fn();
        renderEditor(['| a1 | b1 |', '| --- | --- |', '| a2 | b2 |'].join('\n'), onChange);
        const cell = document.querySelector<HTMLElement>('.table-cell-content')!;
        cell.focus();

        const event = createEvent.paste(cell, {bubbles: true, cancelable: true});
        Object.defineProperty(event, 'clipboardData', {
            value: {getData: () => 'X\tY\n', files: []},
        });
        act(() => {
            fireEvent(cell, event);
        });

        expect(onChange.mock.calls.at(-1)![0]).toBe(
            ['| X | Y |', '| --- | --- |', '| a2 | b2 |'].join('\n'),
        );
    });
});

describe('the selection toolbar across a preview toggle', () => {
    /**
     * The toolbar is told to stand down rather than unmounted. Unmounting replayed its `linkRequest`
     * effect on the way back — the counter is monotonic and lives for the whole note session, so a
     * remount read a ⌘K from minutes ago as a fresh one, opened the "Paste link" box over a stale
     * rect and took the caret with it (`autoFocus`).
     */
    it('does not reopen the link box on the way back', () => {
        const props = {value: 'some text here', onChange: vi.fn()};
        const {rerender} = render(<Editor {...props} />);
        const block = document.querySelector<HTMLElement>('.content')!;
        const range = document.createRange();
        range.selectNodeContents(block);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);

        act(() => {
            fireEvent.keyDown(block, {key: 'k', metaKey: true});
        });
        const linkInput = () => document.querySelector('.tb-link-input');
        expect(linkInput()).not.toBeNull();

        act(() => {
            fireEvent.keyDown(linkInput()!, {key: 'Escape'});
        });
        expect(linkInput()).toBeNull();

        rerender(<Editor {...props} hidden />);
        expect(document.querySelector('.sel-toolbar')).toBeNull();
        rerender(<Editor {...props} />);
        expect(linkInput()).toBeNull();
    });

    /**
     * The same, without the Escape: going off screen has to put the link editor away itself.
     * Telling the bar to stand down rather than unmounting it fixed the effect replay but left
     * `linkMode` set across the toggle, so the box came back on its own over a stale rect — the
     * very thing being off screen has to prevent, reached through a different door.
     */
    it('does not leave the link box open across the toggle either', () => {
        const props = {value: 'some text here', onChange: vi.fn()};
        const {rerender} = render(<Editor {...props} />);
        const block = document.querySelector<HTMLElement>('.content')!;
        const range = document.createRange();
        range.selectNodeContents(block);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);

        act(() => {
            fireEvent.keyDown(block, {key: 'k', metaKey: true});
        });
        expect(document.querySelector('.tb-link-input')).not.toBeNull();

        rerender(<Editor {...props} hidden />);
        rerender(<Editor {...props} />);
        expect(document.querySelector('.tb-link-input')).toBeNull();
    });
});

describe('overlays follow the view when it scrolls', () => {
    const NOTES = [{id: 'Daily log.md', title: 'Daily log', preview: '', updatedAt: 3}];

    function type(el: HTMLElement, text: string) {
        el.textContent = text;
        setCaret(el, 'end');
        act(() => {
            el.dispatchEvent(new Event('input', {bubbles: true}));
        });
    }

    it('re-measures the [[ picker instead of leaving it behind', () => {
        render(<Editor value="" notes={NOTES} noteId="Home.md" onChange={vi.fn()} />);
        const block = document.querySelector<HTMLElement>('.content')!;
        block.focus();
        type(block, '[[');
        type(block, '[[Dai');
        const menu = () => document.querySelector<HTMLElement>('.overlay-menu');
        expect(menu()).not.toBeNull();

        // jsdom reports a zero rect, so assert the re-measure RAN rather than a pixel value: the
        // menu is still mounted and still anchored, where before it kept a rect from open time
        // with no listener able to notice the pane had moved under it.
        const before = menu()!.style.top;
        act(() => {
            window.dispatchEvent(new Event('scroll'));
        });
        expect(menu()).not.toBeNull();
        expect(menu()!.style.top).toBe(before);
    });

    it('opens the block menu on its first row, and walks it with the arrows', async () => {
        renderEditor(NOTE);
        act(() => {
            fireEvent.click(document.querySelector<HTMLElement>('.drag-btn')!);
        });
        // The first row is focused a frame after the menu measures itself.
        await act(async () => {
            await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        });
        const rows = () => [...document.querySelectorAll<HTMLElement>('.block-menu .menu-item')];
        expect(document.activeElement).toBe(rows()[0]);

        act(() => {
            fireEvent.keyDown(rows()[0], {key: 'ArrowDown'});
        });
        expect(document.activeElement).toBe(rows()[1]);

        // …and it wraps, so ArrowUp from the top reaches the last row rather than stalling.
        act(() => {
            fireEvent.keyDown(rows()[1], {key: 'ArrowUp'});
            fireEvent.keyDown(rows()[0], {key: 'ArrowUp'});
        });
        expect(document.activeElement).toBe(rows()[rows().length - 1]);
    });

    it('closes a submenu on Escape without stepping out of the editor', () => {
        const onEscape = vi.fn();
        // A plain paragraph, so the "Turn into" row is labelled with the type it currently is.
        render(<Editor value={'one\n\ntwo'} onChange={vi.fn()} onEscape={onEscape} />);
        act(() => {
            fireEvent.click(document.querySelector<HTMLElement>('.drag-btn')!);
        });
        act(() => {
            fireEvent.click(screen.getByText('Text'));
        });
        expect(screen.getByText('Turn into')).toBeInTheDocument();

        act(() => {
            fireEvent.keyDown(document.querySelector('.block-menu .menu-item')!, {key: 'Escape'});
        });
        // Back to the menu's first page, and the editor's own Esc ladder never saw the key — it
        // used to, because the selection listener captures on document, so one Escape closed the
        // submenu AND walked focus out to the note list.
        expect(screen.queryByText('Turn into')).not.toBeInTheDocument();
        expect(screen.getByRole('menu', {name: 'Block actions'})).toBeInTheDocument();
        expect(onEscape).not.toHaveBeenCalled();
    });

    it('dismisses the block menu, which has nothing to follow', () => {
        renderEditor(NOTE);
        const handle = document.querySelectorAll<HTMLElement>('.drag-btn')[1];
        act(() => {
            fireEvent.click(handle);
        });
        expect(screen.queryByRole('menu', {name: 'Block actions'})).toBeInTheDocument();

        act(() => {
            window.dispatchEvent(new Event('scroll'));
        });
        expect(screen.queryByRole('menu', {name: 'Block actions'})).not.toBeInTheDocument();
    });

    /**
     * …but not on its OWN scroll. The menu is `max-height: 320px; overflow-y: auto` and "Turn into"
     * lists every block type, well past that — so scrolling down to Heading 6, or merely arrowing
     * onto it (focus scrolls it into view), closed the menu the user was reading.
     */
    it('survives scrolling its own list', () => {
        renderEditor(NOTE);
        act(() => {
            fireEvent.click(document.querySelectorAll<HTMLElement>('.drag-btn')[1]);
        });
        const menu = screen.getByRole('menu', {name: 'Block actions'});

        act(() => {
            fireEvent.scroll(menu);
        });
        expect(screen.queryByRole('menu', {name: 'Block actions'})).toBeInTheDocument();
    });
});

describe('colours', () => {
    it('renders a colour from the file and writes an applied one back', () => {
        const onChange = vi.fn();
        renderEditor('a {red}(warm) word', onChange);
        // The sanitizer keeps the colour span — every other span is unwrapped, so this is the one
        // thing standing between a colour and being stripped on the way in.
        expect(document.querySelector('.gn-color--red')?.textContent).toBe('warm');

        act(() => {
            fireEvent.click(document.querySelector<HTMLElement>('.drag-btn')!);
        });
        act(() => {
            // The row is labelled with the block's CURRENT colour, which is Default here.
            fireEvent.click(screen.getByText('Default'));
        });
        act(() => {
            fireEvent.click(screen.getByRole('button', {name: 'Yellow background'}));
        });
        // The whole block is coloured, so the wrapper covers the whole line — which is exactly what
        // the reader lifts back to a block colour.
        expect(onChange.mock.calls.at(-1)![0]).toBe('{bg:yellow}(a {red}(warm) word)');
    });

    it('refuses a colour on a block with no text to carry it', () => {
        const onChange = vi.fn();
        renderEditor('```\nconst a = 1;\n```', onChange);
        act(() => {
            fireEvent.click(document.querySelector<HTMLElement>('.drag-btn')!);
        });
        act(() => {
            // The row is labelled with the block's CURRENT colour, which is Default here.
            fireEvent.click(screen.getByText('Default'));
        });
        act(() => {
            fireEvent.click(screen.getByRole('button', {name: 'Red text'}));
        });
        // It used to colour the block on screen and lose it on reopen, which is the one outcome a
        // note-taking app cannot have.
        expect(screen.getByText('A code block can’t carry a colour')).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('code blocks', () => {
    it('shows the language from the file and writes a picked one back to the fence', async () => {
        const onChange = vi.fn();
        renderEditor(['```ts', 'const a = 1;', '```'].join('\n'), onChange);
        const languageButton = () => screen.getByRole('button', {name: /TypeScript|Plain text|Go/});
        expect(languageButton()).toHaveTextContent('TypeScript');

        act(() => {
            fireEvent.click(languageButton());
        });
        const filter = screen.getByLabelText('Search languages');
        act(() => {
            fireEvent.change(filter, {target: {value: 'go'}});
        });
        act(() => {
            fireEvent.keyDown(filter, {key: 'Enter'});
        });

        // The fence's info string is the only place a language lives, so picking one is an edit.
        expect(onChange.mock.calls.at(-1)![0]).toBe(['```go', 'const a = 1;', '```'].join('\n'));
        expect(languageButton()).toHaveTextContent('Go');
    });

    it('keeps a language it does not offer rather than resetting the block', () => {
        renderEditor(['```jsonc', '{}', '```'].join('\n'));
        // An unlisted token is still the note's, and showing it verbatim is how you can tell it
        // survived — the alternative (falling back to "Plain text") looks like the file lost it.
        expect(screen.getByRole('button', {name: 'jsonc'})).toBeInTheDocument();
    });
});

describe('the [[wiki link]] actions', () => {
    useInsertTextStub();
    const NOTES = [{id: 'Daily log.md', title: 'Daily log', preview: '', updatedAt: 3}];

    /** Put the caret inside the link's decoration span, as a click or an arrow key would. */
    async function caretInLink() {
        const span = document.querySelector<HTMLElement>('.wiki-link')!;
        const range = document.createRange();
        range.setStart(span.firstChild!, 2);
        range.collapse(true);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        await selectionChanged();
    }

    it('offers Open / Edit / Unlink for the link the caret is in', async () => {
        const onWikiLinkNavigate = vi.fn();
        render(
            <Editor
                value="see [[Daily log]] now"
                notes={NOTES}
                noteId="Home.md"
                onChange={vi.fn()}
                onWikiLinkNavigate={onWikiLinkNavigate}
            />,
        );
        expect(screen.queryByRole('toolbar', {name: /Link to/})).not.toBeInTheDocument();

        await caretInLink();
        expect(screen.getByRole('toolbar', {name: 'Link to Daily log'})).toBeInTheDocument();

        act(() => {
            fireEvent.click(screen.getByText('Open'));
        });
        expect(onWikiLinkNavigate).toHaveBeenCalledWith('Daily log');
    });

    it('unlinks to the bare title, leaving the words behind', async () => {
        const onChange = vi.fn();
        render(
            <Editor
                value="see [[Daily log]] now"
                notes={NOTES}
                noteId="Home.md"
                onChange={onChange}
            />,
        );
        await caretInLink();
        act(() => {
            fireEvent.click(screen.getByText('Unlink'));
        });
        expect(onChange.mock.calls.at(-1)![0]).toBe('see Daily log now');
    });
});

describe('attaching files', () => {
    it('writes a non-image file as an ordinary Markdown link', async () => {
        const onChange = vi.fn();
        const onAttachFile = vi.fn().mockResolvedValue('Attachments/q3-report.pdf');
        render(<Editor value={'a note'} onChange={onChange} onAttachFile={onAttachFile} />);

        const block = document.querySelector<HTMLElement>('.block')!;
        const file = new File(['%PDF-1.7'], 'q3 report.pdf', {type: 'application/pdf'});
        await act(async () => {
            const event = createEvent.drop(block, {
                dataTransfer: {files: [file], getData: () => '', setData: vi.fn()},
            });
            fireEvent(block, event);
            await Promise.resolve();
        });

        // A link, not a block type only this app understands — Obsidian and GitHub render it too.
        expect(onAttachFile).toHaveBeenCalledWith(file);
        expect(onChange.mock.calls.at(-1)![0]).toBe(
            'a note\n\n[q3 report.pdf](Attachments/q3-report.pdf)',
        );
    });
});

describe('callouts', () => {
    it('draws the icon the file’s own kind names, and writes a picked kind back', () => {
        const onChange = vi.fn();
        renderEditor('> [!warning] Mind the gap', onChange);
        // Every callout used to be 💡 on screen no matter what `[!kind]` said.
        const icon = () => screen.getByRole('button', {name: /callout — change kind/});
        expect(icon()).toHaveTextContent('⚠️');

        act(() => {
            fireEvent.click(icon());
        });
        act(() => {
            fireEvent.click(screen.getByRole('menuitemradio', {name: /Danger/}));
        });
        expect(onChange.mock.calls.at(-1)![0]).toBe('> [!danger] Mind the gap');
        expect(icon()).toHaveTextContent('🛑');
    });

    it('keeps a kind it does not offer, aliases included', () => {
        // Obsidian allows any word, and its aliases are common — `caution` is a warning there.
        renderEditor('> [!caution] Careful');
        expect(screen.getByRole('button', {name: /callout — change kind/})).toHaveTextContent('⚠️');
    });
});

describe('dragging a block', () => {
    const blocks = () => [...document.querySelectorAll<HTMLElement>('.block')];

    function dropOn(sourceIndex: number, targetIndex: number, edge: 'before' | 'after') {
        // A real DataTransfer: the editor writes the ids it is carrying on dragstart and reads them
        // back on drop, which is the path a fast drag takes (the state behind it is deferred a tick).
        const store = new Map<string, string>();
        const dataTransfer = {
            files: [],
            getData: (type: string) => store.get(type) ?? '',
            setData: (type: string, value: string) => store.set(type, value),
            setDragImage: vi.fn(),
        };
        const target = blocks()[targetIndex];
        act(() => {
            fireEvent.dragStart(blocks()[sourceIndex].querySelector('.drag-btn')!, {dataTransfer});
        });
        act(() => {
            // The handler picks the edge by comparing the pointer against the target's midpoint,
            // which jsdom reports as 0 — and a `clientY` passed in the event init never reaches the
            // event, so it has to be defined on it.
            const event = createEvent.drop(target, {dataTransfer});
            Object.defineProperty(event, 'clientY', {value: edge === 'before' ? -1 : 1});
            fireEvent(target, event);
        });
    }

    it('carries the whole block selection, not just the handle’s block', () => {
        const onChange = vi.fn();
        renderEditor(['- A', '- B', '- C', '- D'].join('\n'), onChange);
        // Select B and C (Esc selects the caret's block, ⇧↓ extends).
        act(() => {
            fireEvent.keyDown(document.querySelectorAll<HTMLElement>('.content')[1], {
                key: 'Escape',
            });
        });
        act(() => {
            fireEvent.keyDown(document.body, {key: 'ArrowDown', shiftKey: true});
        });
        expect(document.querySelectorAll('.block.selected')).toHaveLength(2);

        // Drag from B's handle onto D. Dragging one of several selected blocks and watching the
        // others stay put is what this is here to stop.
        dropOn(1, 3, 'after');
        expect(onChange.mock.calls.at(-1)![0]).toBe(['- A', '- D', '- B', '- C'].join('\n'));
    });

    it('marks the dragged block once the drag is under way', () => {
        vi.useFakeTimers();
        try {
            renderEditor(['- A', '  - A1', '- B'].join('\n'));
            const dataTransfer = {files: [], setData: vi.fn(), setDragImage: vi.fn()};
            act(() => {
                fireEvent.dragStart(blocks()[0].querySelector('.drag-btn')!, {dataTransfer});
            });
            act(() => {
                vi.runAllTimers();
            });
            expect(blocks().map((block) => block.classList.contains('dragging'))).toEqual([
                true,
                true,
                false,
            ]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('lands at the level the drop indicator marks, leaving the target’s children alone', () => {
        // Dropping between a parent and its children used to keep the dragged block's own depth and
        // adopt them: `B` landed at depth 0 and `A1`/`A2` became its children rather than A's.
        const onChange = vi.fn();
        renderEditor(['- A', '  - A1', '  - A2', '- B'].join('\n'), onChange);

        dropOn(3, 1, 'before');

        const shape = blocks().map((block) => [
            block.querySelector('.content')?.textContent,
            block.dataset.depth,
        ]);
        expect(shape).toEqual([
            ['A', '0'],
            ['B', '1'],
            ['A1', '1'],
            ['A2', '1'],
        ]);
        expect(onChange.mock.calls.at(-1)![0]).toBe(
            ['- A', '  - B', '  - A1', '  - A2'].join('\n'),
        );
    });
});

describe('undo history survives StrictMode', () => {
    function duplicateViaMenu(index: number) {
        act(() => {
            fireEvent.click(document.querySelectorAll<HTMLElement>('.drag-btn')[index]);
        });
        act(() => {
            fireEvent.click(screen.getByText('Duplicate'));
        });
    }

    it('records one entry per structural edit, even when React runs the updater twice', () => {
        // StrictMode double-invokes a state updater dispatched AFTER a sibling setState on the same
        // component — the shape of every block-menu action, since they all close the menu first.
        // The history push lived INSIDE the updater, so each of those edits recorded TWICE. The
        // first undo still worked; the second was a no-op against an identical snapshot, so you
        // could never step back past the most recent edit, and the 100-entry cap held half the
        // depth it advertised.
        render(
            <StrictMode>
                <Editor value={'one\n\ntwo'} onChange={vi.fn()} />
            </StrictMode>,
        );
        expect(document.querySelectorAll('.block')).toHaveLength(2);

        duplicateViaMenu(1);
        expect(document.querySelectorAll('.block')).toHaveLength(3);
        duplicateViaMenu(1);
        expect(document.querySelectorAll('.block')).toHaveLength(4);

        const undo = () => {
            const block = document.querySelector<HTMLElement>('.content')!;
            block.focus();
            act(() => {
                fireEvent.keyDown(block, {key: 'z', metaKey: true});
            });
        };
        undo();
        expect(document.querySelectorAll('.block')).toHaveLength(3);
        // The one that used to be swallowed by the duplicate entry.
        undo();
        expect(document.querySelectorAll('.block')).toHaveLength(2);
    });
});

describe('toolbar commands', () => {
    function renderWithHandle(value: string) {
        const onChange = vi.fn();
        const ref = createRef<EditorHandle>();
        render(<Editor ref={ref} value={value} onChange={onChange} />);
        const first = document.querySelector<HTMLElement>('.content')!;
        act(() => {
            first.focus();
            setCaret(first, 'end');
        });
        return {ref, onChange};
    }

    it('toggles the focused block between a type and text', () => {
        const {ref, onChange} = renderWithHandle('one\n\ntwo');
        act(() => ref.current!.setBlockType('bulleted'));
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('- one\n\ntwo');
        act(() => ref.current!.setBlockType('bulleted'));
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('one\n\ntwo');
    });

    it('inserts a divider after a block that has text', () => {
        const {ref, onChange} = renderWithHandle('one\n\ntwo');
        act(() => ref.current!.setBlockType('divider'));
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('one\n\n---\n\ntwo');
    });

    it('wraps the selection in inline code, and undoes it', () => {
        const {ref, onChange} = renderWithHandle('one two');
        const first = document.querySelector<HTMLElement>('.content')!;
        act(() => {
            const range = document.createRange();
            range.setStart(first.firstChild!, 4);
            range.setEnd(first.firstChild!, 7);
            window.getSelection()!.removeAllRanges();
            window.getSelection()!.addRange(range);
        });
        act(() => ref.current!.format('code'));
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('one `two`');
        act(() => ref.current!.undo());
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('one two');
    });
});

describe('keyboard block commands', () => {
    useInsertTextStub();

    function focusFirst(position: 'start' | 'end' | number = 'end') {
        const first = document.querySelector<HTMLElement>('.content')!;
        act(() => {
            first.focus();
            setCaret(first, position);
        });
        return first;
    }

    it.each([
        ['Digit1', '# one'],
        ['Digit4', '- [ ] one'],
        ['Digit6', '1. one'],
        ['Digit8', '```\none\n```'],
    ])('⌘⌥ %s turns the block into its type', (code, written) => {
        const onChange = renderEditor('one');
        const first = focusFirst();
        act(() => {
            fireEvent.keyDown(first, {key: '¡', code, metaKey: true, altKey: true});
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe(written);
    });

    it('⌘↵ ticks a to-do instead of splitting it', () => {
        const onChange = renderEditor('- [ ] task');
        const first = focusFirst();
        act(() => {
            fireEvent.keyDown(first, {key: 'Enter', metaKey: true});
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('- [x] task');
    });

    it('keeps the line indent on Enter in a code block and dedents on ⇧Tab', () => {
        const onChange = renderEditor('```\n    indented\n```');
        const first = focusFirst('end');
        act(() => {
            fireEvent.keyDown(first, {key: 'Enter'});
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('```\n    indented\n    \n```');
        act(() => {
            fireEvent.keyDown(first, {key: 'Tab', shiftKey: true});
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('```\n    indented\n  \n```');
    });

    it('⌘K with the caret inside a link selects it for editing', () => {
        renderEditor('see [docs](https://example.com) here');
        const link = document.querySelector('.content a')!;
        const first = document.querySelector<HTMLElement>('.content')!;
        act(() => {
            first.focus();
            const range = document.createRange();
            range.setStart(link.firstChild!, 2);
            range.collapse(true);
            window.getSelection()!.removeAllRanges();
            window.getSelection()!.addRange(range);
        });
        act(() => {
            fireEvent.keyDown(first, {key: 'k', metaKey: true});
        });
        expect(screen.getByRole('textbox', {name: 'Link URL'})).toHaveValue('https://example.com');
    });
});

describe('structural edits keep the file and the screen in step', () => {
    function caretIn(index: number, position: 'start' | 'end' | number) {
        const el = document.querySelectorAll<HTMLElement>('.content')[index];
        act(() => {
            el.focus();
            setCaret(el, position);
        });
        return el;
    }

    function press(el: HTMLElement, key: string, init: Record<string, unknown> = {}) {
        act(() => {
            fireEvent.keyDown(el, {key, ...init});
        });
    }

    it('Enter over a selection writes the remaining text, not the old one', () => {
        const onChange = renderEditor('hello world');
        const el = caretIn(0, 'start');
        act(() => {
            const range = document.createRange();
            range.setStart(el.firstChild!, 0);
            range.setEnd(el.firstChild!, 5);
            window.getSelection()!.removeAllRanges();
            window.getSelection()!.addRange(range);
        });
        press(el, 'Enter');
        const written = onChange.mock.calls.at(-1)?.[0] as string;
        expect(written).not.toContain('hello');
        expect(written).toContain('world');
    });

    it('a merge keeps the children one level under their new parent', () => {
        const onChange = renderEditor('- a\n  - b\n    - c');
        const el = caretIn(1, 'start');
        press(el, 'Backspace');
        press(document.querySelectorAll<HTMLElement>('.content')[1], 'Backspace');
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('- ab\n  - c');
    });

    it('Enter at the start of a list item keeps one list', () => {
        const onChange = renderEditor('1. one\n2. two\n3. three');
        press(caretIn(1, 'start'), 'Enter');
        expect(onChange.mock.calls.at(-1)?.[0]).toMatch(/^1\. one\n2\.\s*\n3\. two\n4\. three$/);
    });

    it('a list item turned into a paragraph is separated from the list', () => {
        const onChange = renderEditor('- a\n- b\n- c');
        press(caretIn(1, 'start'), 'Backspace');
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('- a\n\nb\n- c');
    });

    it('⇧Enter in a heading starts a new block rather than a second heading line', () => {
        const onChange = renderEditor('# Title');
        press(caretIn(0, 'end'), 'Enter', {shiftKey: true});
        expect(document.querySelectorAll('.block')).toHaveLength(2);
        expect(onChange.mock.calls.at(-1)?.[0]).toMatch(/^# Title\n\n/);
    });

    it('turning two lines into a heading joins them', () => {
        const onChange = renderEditor('one\ntwo');
        const el = caretIn(0, 'end');
        act(() => {
            fireEvent.keyDown(el, {key: '¡', code: 'Digit1', metaKey: true, altKey: true});
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('# one two');
    });

    it('forward Delete at the end of a block pulls the next one up', () => {
        const onChange = renderEditor('hello\n\nworld');
        press(caretIn(0, 'end'), 'Delete');
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('helloworld');
    });

    it('Enter on an empty block mid-list keeps the items after it in place', () => {
        const onChange = renderEditor('- a\n  - b\n  - x\n  - d');
        const el = caretIn(2, 'end');
        act(() => {
            el.textContent = '';
            fireEvent.input(el);
        });
        press(el, 'Enter');
        const written = onChange.mock.calls.at(-1)?.[0] as string;
        expect(written).toMatch(/\n {2}- d$/);
        expect(written).not.toMatch(/\n {4}- d/);
    });

    it('an item stepping out of a toggle is not written tight against its closing tag', () => {
        const onChange = renderEditor(
            '<details open>\n<summary>T</summary>\n\n- [ ] a\n- [ ] b\n\n</details>\n\nafter',
        );
        const el = caretIn(2, 'end');
        act(() => {
            el.textContent = '';
            fireEvent.input(el);
        });
        press(el, 'Enter');
        expect(onChange.mock.calls.at(-1)?.[0]).toContain('</details>\n\n- [ ]');
    });

    it('Delete pulling a two-line paragraph into a heading keeps the heading one line', () => {
        const onChange = renderEditor('# Title\n\nline1\nline2');
        press(caretIn(0, 'end'), 'Delete');
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('# Titleline1 line2');
    });

    it('Enter at the start of a numbered list keeps its start number', () => {
        const onChange = renderEditor('5. a\n6. b');
        press(caretIn(0, 'start'), 'Enter');
        expect(onChange.mock.calls.at(-1)?.[0]).toMatch(/^5\.\s*\n6\. a\n7\. b$/);
    });

    it('a numbered list keeps counting from its old number when its first item is retyped', () => {
        const onChange = renderEditor('5. a\n6. b\n7. c');
        press(caretIn(0, 'start'), 'Backspace');
        expect(onChange.mock.calls.at(-1)?.[0]).toMatch(/^a\n\n6\. b\n7\. c$/);
    });

    it('a numbered list keeps counting from its old number when its first item is deleted', () => {
        const onChange = renderEditor('5. a\n6. b\n7. c');
        const first = caretIn(0, 'end');
        act(() => {
            fireEvent.keyDown(first, {key: 'Escape'});
        });
        act(() => {
            fireEvent.keyDown(document.body, {key: 'Backspace'});
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('6. b\n7. c');
        expect(
            [...document.querySelectorAll('.list-marker')].map((marker) => marker.textContent),
        ).toEqual(['6.', '7.']);
    });

    it('forward Delete does not pull a collapsed toggle’s hidden children out', () => {
        const onChange = renderEditor(
            'before\n\n<details>\n<summary>T</summary>\n\nhidden\n\n</details>',
        );
        press(caretIn(0, 'end'), 'Delete');
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.queryByText('hidden', {selector: '.content'})).toBeNull();
    });

    it('forward Delete on an empty line before a collapsed toggle removes the line', () => {
        const onChange = renderEditor(
            '&nbsp;\n\n<details>\n<summary>T</summary>\n\nhidden\n\n</details>',
        );
        press(caretIn(0, 'end'), 'Delete');
        expect(onChange.mock.calls.at(-1)?.[0]).toBe(
            '<details>\n<summary>T</summary>\n\nhidden\n\n</details>',
        );
    });

    it('AltGr (Ctrl+Alt on Windows and Linux) types its character instead of a chord', () => {
        const onChange = renderEditor('one');
        const el = caretIn(0, 'end');
        act(() => {
            fireEvent.keyDown(el, {
                key: '{',
                code: 'Digit7',
                ctrlKey: true,
                altKey: true,
                modifierAltGraph: true,
            });
        });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('Enter on an empty nested item steps out a level', () => {
        const onChange = renderEditor('- a\n  - b');
        const el = caretIn(1, 'end');
        act(() => {
            el.textContent = '';
            fireEvent.input(el);
        });
        press(el, 'Enter');
        expect(onChange.mock.calls.at(-1)?.[0]).toMatch(/^- a\n-\s*$/);
    });
});

describe('slash menu items', () => {
    it('offers /image only where files can be stored', () => {
        expect(filterMenuItems('ima', true)[0]?.type).toBe('image');
        expect(filterMenuItems('', false).some((item) => item.type === 'image')).toBe(false);
    });
});

describe('selection, clipboard and table edges', () => {
    function blockPaste(target: HTMLElement, blocks: object[]) {
        act(() => {
            target.focus();
            setCaret(target, 'end');
            fireEvent.paste(target, {
                clipboardData: {
                    files: [],
                    getData: (type: string) =>
                        type === 'application/x-notion-editor-blocks' ? JSON.stringify(blocks) : '',
                },
            });
        });
    }

    it('pasted blocks land relative to the host, not at the depth they were copied from', () => {
        const onChange = renderEditor('- A\n\ntail');
        const tail = document.querySelectorAll<HTMLElement>('.content')[1];
        act(() => {
            tail.textContent = '';
            fireEvent.input(tail);
        });
        blockPaste(tail, [
            {type: 'bulleted', html: 'a1', depth: 1},
            {type: 'bulleted', html: 'a2', depth: 1},
        ]);
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('- A\n- a1\n- a2');
    });

    it('a paste at the end of a block with children leaves them under it', () => {
        const onChange = renderEditor('- a\n  - b\n- c');
        const a = document.querySelector<HTMLElement>('.content')!;
        act(() => {
            a.focus();
            setCaret(a, 'end');
            fireEvent.paste(a, {
                clipboardData: {
                    files: [],
                    getData: (type: string) => (type === 'text/plain' ? 'x\n- y\n  - z' : ''),
                },
            });
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('- ax\n  - b\n- y\n  - z\n- c');
    });

    it('undo after a block-selection edit keeps the keyboard, so undo can repeat', () => {
        const onChange = renderEditor('- A\n- B\n- C');
        const b = document.querySelectorAll<HTMLElement>('.content')[1];
        act(() => {
            b.focus();
            fireEvent.keyDown(b, {key: 'Escape'});
        });
        act(() => {
            fireEvent.keyDown(document.body, {key: 'ArrowDown', shiftKey: true});
        });
        act(() => {
            fireEvent.keyDown(document.body, {key: 'Tab'});
        });
        act(() => {
            fireEvent.keyDown(document.body, {key: 'Tab'});
        });
        act(() => {
            fireEvent.keyDown(document.body, {key: 'z', metaKey: true});
        });
        act(() => {
            fireEvent.keyDown(document.body, {key: 'z', metaKey: true});
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('- A\n- B\n- C');
    });

    it('turning a selection into a heading is one undo step', () => {
        const onChange = renderEditor('A\n\nB\n\nC');
        const first = document.querySelector<HTMLElement>('.content')!;
        act(() => {
            first.focus();
            fireEvent.keyDown(first, {key: 'Escape'});
        });
        act(() => {
            fireEvent.keyDown(document.body, {key: 'ArrowDown', shiftKey: true});
        });
        act(() => {
            fireEvent.keyDown(document.body, {key: 'ArrowDown', shiftKey: true});
        });
        act(() => {
            fireEvent.keyDown(document.body, {
                key: '¡',
                code: 'Digit1',
                metaKey: true,
                altKey: true,
            });
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('# A\n\n# B\n\n# C');
        act(() => {
            fireEvent.keyDown(document.body, {key: 'z', metaKey: true});
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('A\n\nB\n\nC');
    });

    it('keeps a header row whose cells are all empty through a reload', () => {
        const onChange = renderEditor('|  |\n| --- |\n|  |\n| c |');
        act(() => {
            fireEvent.click(screen.getByRole('button', {name: 'Header row'}));
        });
        const written = onChange.mock.calls.at(-1)?.[0] as string;
        expect(written).toBe('| &nbsp; |\n| --- |\n| c |');
        expect(markdownToBlocks(written)[0].table).toMatchObject({
            cells: [[''], ['c']],
            headerRow: true,
        });
    });

    it('a selection ending on the table toolbar does not take the table with it', () => {
        const onChange = renderEditor('para\n\n| a |\n| --- |\n| c |');
        const para = document.querySelector<HTMLElement>('.content')!;
        const label = screen.getByRole('button', {name: 'Header row'}).firstChild!;
        act(() => {
            para.focus();
            const range = document.createRange();
            range.setStart(para.firstChild!, 2);
            range.setEnd(label, 3);
            window.getSelection()!.removeAllRanges();
            window.getSelection()!.addRange(range);
        });
        act(() => {
            fireEvent.keyDown(para, {key: 'Backspace'});
        });
        expect(document.querySelector('.simple-table')).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('Enter in a table cell moves to the cell below', () => {
        renderEditor('| a | b |\n| --- | --- |\n| c | d |');
        const cell = document.querySelector<HTMLElement>('.table-cell-content')!;
        act(() => {
            cell.focus();
            setCaret(cell, 'end');
        });
        act(() => {
            fireEvent.keyDown(cell, {key: 'Enter'});
        });
        expect(document.activeElement?.textContent).toBe('c');
    });
});

describe('hover handles', () => {
    it('a key press hides them until the mouse really moves', () => {
        renderEditor('one\n\ntwo');
        const root = document.querySelector<HTMLElement>('.gn-block-editor')!;
        const first = document.querySelector<HTMLElement>('.content')!;
        act(() => {
            fireEvent.mouseMove(document, {clientX: 10, clientY: 10});
            fireEvent.keyDown(first, {key: 'ArrowDown'});
        });
        expect(root).toHaveClass('gn-block-editor_keyboard');
        act(() => {
            fireEvent.mouseMove(document, {clientX: 10, clientY: 10});
        });
        expect(root).toHaveClass('gn-block-editor_keyboard');
        act(() => {
            fireEvent.mouseMove(document, {clientX: 12, clientY: 10});
        });
        expect(root).not.toHaveClass('gn-block-editor_keyboard');
    });

    it('a long note mounts one only where the pointer, the caret or the keyboard is', () => {
        renderEditor(Array.from({length: 250}, (_, at) => `paragraph ${at}`).join('\n\n'));
        const blocks = document.querySelectorAll<HTMLElement>('.blocks > .block');
        const handles = () => document.querySelectorAll('.drag-btn');
        expect(handles()).toHaveLength(0);
        act(() => {
            fireEvent.mouseMove(blocks[10].querySelector('.content')!);
        });
        expect(handles()).toHaveLength(1);
        expect(blocks[10].querySelector('.drag-btn')).not.toBeNull();
        act(() => {
            fireEvent.mouseMove(document.querySelector('.blocks')!);
        });
        expect(blocks[10].querySelector('.drag-btn')).not.toBeNull();
        const handle = blocks[10].querySelector<HTMLElement>('.drag-btn')!;
        act(() => {
            handle.focus();
            fireEvent.mouseMove(blocks[20].querySelector('.content')!);
        });
        expect(blocks[10].querySelector('.drag-btn')).toBe(handle);
        expect(blocks[20].querySelector('.drag-btn')).not.toBeNull();
        act(() => {
            blocks[30].querySelector<HTMLElement>('.content')!.focus();
        });
        expect(blocks[10].querySelector('.drag-btn')).toBeNull();
        expect(blocks[30].querySelector('.drag-btn')).not.toBeNull();
    });

    it('a bare modifier does not hide them', () => {
        renderEditor('one');
        const root = document.querySelector<HTMLElement>('.gn-block-editor')!;
        act(() => {
            fireEvent.keyDown(document.querySelector<HTMLElement>('.content')!, {key: 'Meta'});
        });
        expect(root).not.toHaveClass('gn-block-editor_keyboard');
    });
});

describe('block menu', () => {
    it('Add block below inserts after the block’s children and opens the slash menu', () => {
        renderEditor('- a\n  - b\n\nc');
        act(() => {
            fireEvent.click(document.querySelector<HTMLElement>('.drag-btn')!);
        });
        act(() => {
            fireEvent.click(screen.getByRole('menuitem', {name: 'Add block below'}));
        });
        const texts = [...document.querySelectorAll('.block')].map(
            (block) => block.querySelector('.content')?.textContent,
        );
        expect(texts).toEqual(['a', 'b', '', 'c']);
        expect(screen.getByRole('listbox', {name: 'Block types'})).toBeInTheDocument();
    });
});

describe('turn into', () => {
    it.each(['Quote', 'Heading 2', 'Bulleted list', 'Toggle list'])(
        'shows the text once after turning a paragraph into %s',
        (label) => {
            renderEditor('Some **bold** text');
            act(() => {
                fireEvent.click(document.querySelector<HTMLElement>('.drag-btn')!);
            });
            act(() => {
                fireEvent.click(screen.getByText('Text'));
            });
            act(() => {
                fireEvent.click(screen.getByText(label));
            });
            const body = document.querySelector('.block-body')!;
            expect(body.querySelector('.content')!.textContent).toBe('Some bold text');
            expect(body.textContent!.match(/Some bold text/g)).toHaveLength(1);
        },
    );
});

describe('heading anchors', () => {
    const SOURCE = '## Computer usage {#Computer_usage}\n\nBody';

    function openBlockMenu(index: number) {
        act(() => {
            fireEvent.click(document.querySelectorAll<HTMLElement>('.drag-btn')[index]);
        });
    }

    it('keeps the anchor out of the editable title and through a title edit', () => {
        const onChange = renderEditor(SOURCE);
        const heading = document.querySelector<HTMLElement>('.content');
        if (!heading) throw new Error('no heading block');
        expect(heading.textContent).toBe('Computer usage');
        act(() => {
            heading.innerHTML = 'Computer use';
            heading.dispatchEvent(new Event('input', {bubbles: true}));
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('## Computer use {#Computer_usage}\n\nBody');
    });

    it('copies the anchor with a duplicated heading', () => {
        const onChange = renderEditor(SOURCE);
        openBlockMenu(0);
        act(() => {
            fireEvent.click(screen.getByText('Duplicate'));
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe(
            '## Computer usage {#Computer_usage}\n\n## Computer usage {#Computer_usage}\n\nBody',
        );
    });

    function editAnchor(value: string, key = 'Enter') {
        const input = screen.getByRole('textbox', {name: 'Anchor id'});
        act(() => {
            fireEvent.change(input, {target: {value}});
        });
        act(() => {
            fireEvent.keyDown(input, {key});
        });
    }

    it('edits the anchor from its chip', () => {
        const onChange = renderEditor(SOURCE);
        act(() => {
            fireEvent.click(screen.getByRole('button', {name: '#Computer_usage'}));
        });
        expect(screen.getByRole('textbox', {name: 'Anchor id'})).toHaveValue('Computer_usage');
        editAnchor('usage');
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('## Computer usage {#usage}\n\nBody');
    });

    it('removes the anchor when its id is cleared, and keeps it on Escape', () => {
        const onChange = renderEditor(SOURCE);
        act(() => {
            fireEvent.click(screen.getByRole('button', {name: '#Computer_usage'}));
        });
        editAnchor('other', 'Escape');
        expect(screen.queryByRole('textbox', {name: 'Anchor id'})).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
        act(() => {
            fireEvent.click(screen.getByRole('button', {name: '#Computer_usage'}));
        });
        editAnchor('');
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('## Computer usage\n\nBody');
    });

    it('adds an anchor from the block menu', () => {
        const onChange = renderEditor('## Plain\n\nBody');
        openBlockMenu(0);
        act(() => {
            fireEvent.click(screen.getByText('Add anchor'));
        });
        editAnchor('#plain');
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('## Plain {#plain}\n\nBody');
    });

    it('stops writing the anchor once the heading is turned into text', () => {
        const onChange = renderEditor(SOURCE);
        openBlockMenu(0);
        act(() => {
            fireEvent.click(screen.getByText('Heading 2'));
        });
        act(() => {
            fireEvent.click(screen.getByText('Text'));
        });
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('Computer usage\n\nBody');
    });
});

describe('bare URLs', () => {
    it('show as links without touching the file, and ⌘-click opens them', async () => {
        const onChange = renderEditor('see https://example.com/a_b now');
        const url = document.querySelector<HTMLElement>('.url-link')!;
        expect(url.textContent).toBe('https://example.com/a_b');
        expect(onChange).not.toHaveBeenCalled();

        act(() => {
            fireEvent.click(url, {metaKey: true});
        });
        expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/a_b');

        const range = document.createRange();
        range.setStart(url.firstChild!, 5);
        range.collapse(true);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        await selectionChanged();
        const tip = screen.getByRole('toolbar', {name: 'Link to https://example.com/a_b'});
        expect(tip.querySelectorAll('button')).toHaveLength(1);
    });

    it('become links as they are typed, and the note is written back as typed', () => {
        const onChange = renderEditor('');
        const block = document.querySelector<HTMLElement>('.content')!;
        block.focus();
        block.textContent = 'read https://example.com/x, later';
        setCaret(block, 'end');
        act(() => {
            block.dispatchEvent(new Event('input', {bubbles: true}));
        });
        expect(block.querySelector('.url-link')?.textContent).toBe('https://example.com/x');
        expect(onChange).toHaveBeenLastCalledWith('read https://example.com/x, later');
    });

    it('stay plain text inside a code block', () => {
        renderEditor('```\nhttps://example.com\n```');
        expect(document.querySelector('.url-link')).toBeNull();
    });
});

describe('a click beside the text', () => {
    function gapPress(modifiers: {metaKey?: boolean} = {}, moveTo?: number) {
        const page = document.querySelector<HTMLElement>('.page')!;
        page.setPointerCapture = () => {};
        page.hasPointerCapture = () => false;
        const gap = document.querySelector<HTMLElement>('.blocks')!;
        const at = {button: 0, pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 62};
        act(() => {
            fireEvent.pointerDown(gap, {...at, ...modifiers});
            if (moveTo !== undefined) fireEvent.pointerMove(gap, {...at, clientY: moveTo});
            fireEvent.pointerUp(gap, {...at, ...modifiers});
        });
    }

    it('keeps the caret where it was on a ⌘-press, and drops it once a marquee is dragged', () => {
        renderEditor('one\n\ntwo');
        const first = document.querySelector<HTMLElement>('.content')!;
        act(() => first.focus());
        gapPress({metaKey: true});
        expect(document.activeElement).toBe(first);
        gapPress({}, 140);
        expect(document.activeElement).not.toBe(first);
    });

    it('puts the caret in the nearest line instead of nowhere', () => {
        renderEditor('one\n\n&nbsp;\n\nthree');
        const blocks = [...document.querySelectorAll<HTMLElement>('.blocks > .block')];
        const contents = blocks.map((block) => block.querySelector<HTMLElement>('.content')!);
        // Three 24px lines, 12px apart: the empty middle one spans 36..60.
        blocks.forEach((block, index) => {
            const top = index * 36;
            const rect = {top, bottom: top + 24, left: 0, right: 600, height: 24, width: 600};
            block.getBoundingClientRect = () => rect as DOMRect;
            contents[index].getBoundingClientRect = () => rect as DOMRect;
        });
        const page = document.querySelector<HTMLElement>('.page')!;
        page.setPointerCapture = () => {};
        page.hasPointerCapture = () => false;
        const gap = document.querySelector<HTMLElement>('.blocks')!;
        act(() => {
            fireEvent.pointerDown(gap, {
                button: 0,
                pointerType: 'mouse',
                pointerId: 1,
                clientX: 50,
                clientY: 62,
            });
            fireEvent.pointerUp(gap, {
                button: 0,
                pointerType: 'mouse',
                pointerId: 1,
                clientX: 50,
                clientY: 62,
            });
        });
        expect(document.activeElement).toBe(contents[1]);
    });
});
