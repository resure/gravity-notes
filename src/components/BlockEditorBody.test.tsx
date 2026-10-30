import {createRef} from 'react';

import {fireEvent, render, waitFor} from '@testing-library/react';
import {act} from 'react-dom/test-utils';
import {describe, expect, it, vi} from 'vitest';

import type {Note} from '../storage/types';

import {BlockEditorBody, type BlockEditorBodyHandle} from './BlockEditorBody';

function note(id: string, content: string): Note {
    return {id, title: id.replace(/\.md$/, ''), content, updatedAt: 1};
}

describe('BlockEditorBody — ordinary text files', () => {
    const props = {
        preview: false,
        onUploadFile: async () => '',
        onOpenWikiLink: () => {},
        wikiNotes: [],
        showToolbar: true,
    };

    it.each(['memo.txt', 'root'])('renders %s as Markdown when requested', (id) => {
        const onChange = vi.fn();
        render(
            <BlockEditorBody
                note={note(id, '# Heading\n\nbody')}
                textFileMode="markdown"
                sessionId={1}
                onChange={onChange}
                {...props}
            />,
        );
        expect(document.querySelector('[aria-label="Plain text"]')).toBeNull();
        expect(document.querySelector('.block[data-type="heading1"] .content')).toHaveTextContent(
            'Heading',
        );
        expect(document.querySelector('.editor-toolbar')).not.toBeNull();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('preserves unsaved text when switching modes and does not save a setting change', () => {
        const onChange = vi.fn();
        const current = note('memo.txt', '# Original');
        const view = (textFileMode: 'text' | 'markdown') => (
            <BlockEditorBody
                note={current}
                textFileMode={textFileMode}
                sessionId={1}
                onChange={onChange}
                {...props}
            />
        );
        const {rerender} = render(view('text'));
        fireEvent.change(document.querySelector('[aria-label="Plain text"]')!, {
            target: {value: '# Unsaved\n\nbody'},
        });
        onChange.mockClear();
        rerender(view('markdown'));
        expect(document.querySelector('.block[data-type="heading1"] .content')).toHaveTextContent(
            'Unsaved',
        );
        rerender(view('text'));
        expect(document.querySelector('[aria-label="Plain text"]')).toHaveValue(
            '# Unsaved\n\nbody',
        );
        expect(onChange).not.toHaveBeenCalled();
    });

    it('guards the live unsaved text when changing from text to Markdown', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        const onChange = vi.fn();
        const current = note('memo.txt', 'safe original');
        const view = (textFileMode: 'text' | 'markdown') => (
            <BlockEditorBody
                ref={ref}
                note={current}
                textFileMode={textFileMode}
                sessionId={1}
                onChange={onChange}
                {...props}
            />
        );
        const {rerender} = render(view('text'));
        const unsafe = '---\ntitle: Keep me\n---\n\nbody';
        fireEvent.change(document.querySelector('[aria-label="Plain text"]')!, {
            target: {value: unsafe},
        });
        onChange.mockClear();
        rerender(view('markdown'));
        expect(document.querySelector('.gn-block-editor')).toBeNull();
        expect(document.querySelector('[aria-label="Markdown source"]')).toHaveValue(unsafe);
        expect(document.querySelector('.block-editor-source__notice')).not.toBeNull();
        act(() => ref.current!.toggleMode());
        expect(document.querySelector('[aria-label="Markdown source"]')).toHaveValue(unsafe);
        rerender(view('text'));
        expect(document.querySelector('[aria-label="Plain text"]')).toHaveValue(unsafe);
        expect(document.querySelector('.block-editor-source__notice')).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('carries unsaved block edits into text mode and back without saving again', () => {
        const onChange = vi.fn();
        const current = note('memo.txt', 'original');
        const view = (textFileMode: 'text' | 'markdown') => (
            <BlockEditorBody
                note={current}
                textFileMode={textFileMode}
                sessionId={1}
                onChange={onChange}
                {...props}
            />
        );
        const {rerender} = render(view('markdown'));
        const content = document.querySelector<HTMLElement>('.content')!;
        act(() => {
            content.textContent = 'unsaved block';
            content.dispatchEvent(new Event('input', {bubbles: true}));
        });
        expect(onChange).toHaveBeenLastCalledWith('unsaved block');
        onChange.mockClear();
        rerender(view('text'));
        expect(document.querySelector('[aria-label="Plain text"]')).toHaveValue('unsaved block');
        rerender(view('markdown'));
        expect(document.querySelector('.content')).toHaveTextContent('unsaved block');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('opens an unsafe text file in Markdown source without rewriting it', () => {
        const onChange = vi.fn();
        const unsafe = '---\ntitle: Keep me\n---\n\nbody';
        render(
            <BlockEditorBody
                note={note('memo.txt', unsafe)}
                textFileMode="markdown"
                sessionId={1}
                onChange={onChange}
                {...props}
            />,
        );
        expect(document.querySelector('[aria-label="Markdown source"]')).toHaveValue(unsafe);
        expect(document.querySelector('.gn-block-editor')).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('switches a live preview between literal text and rendered Markdown', async () => {
        const onChange = vi.fn();
        const current = note('memo.txt', '# Original');
        const view = (textFileMode: 'text' | 'markdown') => (
            <BlockEditorBody
                note={current}
                textFileMode={textFileMode}
                sessionId={1}
                onChange={onChange}
                {...props}
                preview
            />
        );
        const {rerender} = render(view('text'));
        expect(document.querySelector('.plain-text-preview')).toHaveTextContent('# Original');
        rerender(view('markdown'));
        await waitFor(() =>
            expect(document.querySelector('.note-preview h1')).toHaveTextContent('Original'),
        );
        expect(document.querySelector('.plain-text-preview')).toBeNull();
        rerender(view('text'));
        expect(document.querySelector('.plain-text-preview')).toHaveTextContent('# Original');
        expect(onChange).not.toHaveBeenCalled();
    });

    it.each(['memo.txt', 'root'])(
        'edits %s as literal text and ignores the Markdown toggle',
        (id) => {
            const ref = createRef<BlockEditorBodyHandle>();
            const onChange = vi.fn();
            const value = '# Heading\n\n[[literal]]\n- item\n\n';
            render(
                <BlockEditorBody
                    ref={ref}
                    note={note(id, value)}
                    sessionId={1}
                    onChange={onChange}
                    {...props}
                />,
            );
            const textarea = document.querySelector<HTMLTextAreaElement>(
                '[aria-label="Plain text"]',
            )!;
            expect(textarea.value).toBe(value);
            expect(document.querySelector('.gn-block-editor')).toBeNull();
            expect(document.querySelector('.editor-toolbar')).toBeNull();
            expect(document.querySelector('.block-editor-source__notice')).toBeNull();
            act(() => ref.current!.toggleMode());
            expect(document.querySelector('[aria-label="Plain text"]')).toBe(textarea);
            fireEvent.change(textarea, {target: {value: value + 'tail'}});
            expect(onChange).toHaveBeenLastCalledWith(value + 'tail');
        },
    );

    it('previews the live text literally and restores the editing surface', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        const current = note('memo.txt', '# Original\n[[literal]]');
        const onChange = vi.fn();
        const {rerender} = render(
            <BlockEditorBody
                ref={ref}
                note={current}
                sessionId={1}
                onChange={onChange}
                {...props}
            />,
        );
        const textarea = document.querySelector<HTMLTextAreaElement>('[aria-label="Plain text"]')!;
        fireEvent.change(textarea, {target: {value: '# Unsaved\n**literal**'}});
        rerender(
            <BlockEditorBody
                ref={ref}
                note={current}
                sessionId={1}
                onChange={onChange}
                {...props}
                preview
            />,
        );
        const preview = document.querySelector('[aria-label="Plain text preview"]')!;
        expect(preview.textContent).toBe('# Unsaved\n**literal**');
        expect(preview.querySelector('h1, strong, a')).toBeNull();
        expect(textarea).not.toBeVisible();
        act(() => ref.current!.focus());
        expect(preview).toHaveFocus();
        rerender(
            <BlockEditorBody
                ref={ref}
                note={current}
                sessionId={1}
                onChange={onChange}
                {...props}
            />,
        );
        expect(textarea).toBeVisible();
        expect(textarea.value).toBe('# Unsaved\n**literal**');
    });

    it('keeps surrounding CRLF and trailing newlines in the loading textarea', () => {
        const onChange = vi.fn();
        render(
            <BlockEditorBody
                note={note('memo.txt', '\uFEFFone\r\ntwo\r\n\r\n')}
                sessionId={1}
                onChange={onChange}
                {...props}
            />,
        );
        const textarea = document.querySelector<HTMLTextAreaElement>('[aria-label="Plain text"]')!;
        fireEvent.change(textarea, {target: {value: '\uFEFFONE\ntwo\n\n'}});
        expect(onChange).toHaveBeenLastCalledWith('\uFEFFONE\r\ntwo\r\n\r\n');
    });

    it('switches between Markdown and text without leaking either live buffer', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        const onChange = vi.fn();
        const {rerender} = render(
            <BlockEditorBody
                ref={ref}
                note={note('memo.txt', '# Literal')}
                sessionId={1}
                onChange={onChange}
                {...props}
            />,
        );
        const textarea = document.querySelector<HTMLTextAreaElement>('[aria-label="Plain text"]')!;
        fireEvent.change(textarea, {target: {value: '# Edited'}});
        rerender(
            <BlockEditorBody
                ref={ref}
                note={note('note.md', '# Heading')}
                sessionId={2}
                onChange={onChange}
                {...props}
            />,
        );
        expect(document.querySelector('[aria-label="Plain text"]')).toBeNull();
        expect(document.querySelector('.gn-block-editor')?.textContent).toContain('Heading');
        rerender(
            <BlockEditorBody
                ref={ref}
                note={note('root', '# Other literal')}
                sessionId={3}
                onChange={onChange}
                {...props}
            />,
        );
        expect(
            document.querySelector<HTMLTextAreaElement>('[aria-label="Plain text"]')?.value,
        ).toBe('# Other literal');
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

describe('BlockEditorBody — the raw-Markdown escape hatch', () => {
    it.each([true, false])(
        'previews the live source buffer (forced source: %s)',
        async (forceSource) => {
            const ref = createRef<BlockEditorBodyHandle>();
            const props = {
                note: note('A.md', 'Original'),
                sessionId: 1,
                forceSource,
                onChange: vi.fn(),
                onUploadFile: async () => '',
                onOpenWikiLink: () => {},
                wikiNotes: [],
            };
            const {rerender} = render(<BlockEditorBody ref={ref} {...props} preview={false} />);
            if (!forceSource) act(() => ref.current!.toggleMode());
            const textarea = document.querySelector<HTMLTextAreaElement>('.block-editor-markup')!;
            fireEvent.change(textarea, {target: {value: '# Unsaved title'}});
            rerender(<BlockEditorBody ref={ref} {...props} preview />);
            // The preview is a lazy chunk — wait for it to resolve before asserting.
            await waitFor(() =>
                expect(document.querySelector('.note-preview h1')?.textContent).toContain(
                    'Unsaved title',
                ),
            );
            expect(textarea).not.toBeVisible();
            rerender(<BlockEditorBody ref={ref} {...props} preview={false} />);
            expect(document.querySelector('.block-editor-markup')).toBe(textarea);
            expect(textarea.value).toBe('# Unsaved title');
            expect(textarea).toBeVisible();
        },
    );
    /**
     * The pane is not keyed, so this component (and its ⌘⇧; mode flag) survives a note switch. The
     * textarea is uncontrolled, and once the user has typed in it the browser sets its dirty-value
     * flag — after which the HTML spec says a changed `defaultValue` is IGNORED. So switching notes
     * in markup mode left note A's source on screen under note B's title, and the next keystroke
     * autosaved A's body into B's file. Keying the textarea on the session forces the remount that
     * makes the new note's text actually appear.
     */
    it('shows the new note after a switch made while in markup mode', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        const onChange = vi.fn();
        const props = {
            preview: false,
            onChange,
            onUploadFile: async () => '',
            onOpenWikiLink: () => {},
            wikiNotes: [],
        };

        const {rerender} = render(
            <BlockEditorBody ref={ref} note={note('A.md', 'AAA body')} sessionId={1} {...props} />,
        );

        act(() => ref.current!.toggleMode());
        const textarea = () => document.querySelector<HTMLTextAreaElement>('.block-editor-markup')!;
        expect(textarea().value).toBe('AAA body');

        // Type, so the textarea's dirty-value flag is set — this is what made `defaultValue` inert.
        act(() => {
            textarea().value = 'AAA edited';
            textarea().dispatchEvent(new Event('input', {bubbles: true}));
        });
        onChange.mockClear();

        rerender(
            <BlockEditorBody
                ref={ref}
                note={note('B.md', 'BBB other note')}
                sessionId={2}
                {...props}
            />,
        );

        expect(textarea().value).toBe('BBB other note');
        // …and crucially, the switch itself must not report A's text as an edit to B.
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('BlockEditorBody — the raw view’s height', () => {
    /**
     * A textarea does not size itself, so the raw view used to be a fixed 60vh box inside a
     * scrolling pane: a long note showed its first screenful, the rest was reachable only by
     * scrolling INSIDE the box, and the pane below it was empty — the blocks and the source of the
     * same note read as different documents.
     *
     * jsdom has no layout, so `scrollHeight` is stubbed to stand in for one: what is asserted is
     * that the height is taken from the content on the way in AND after an edit.
     */
    it('grows to its content, so the pane is what scrolls', () => {
        const scrollHeight = vi
            .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
            .mockImplementation(function (this: HTMLTextAreaElement) {
                return this.value.split('\n').length * 20;
            });
        try {
            const ref = createRef<BlockEditorBodyHandle>();
            render(
                <BlockEditorBody
                    ref={ref}
                    note={note('Long.md', 'one\ntwo\nthree')}
                    sessionId={1}
                    preview={false}
                    onChange={vi.fn()}
                    onUploadFile={async () => ''}
                    onOpenWikiLink={() => {}}
                    wikiNotes={[]}
                />,
            );
            act(() => ref.current!.toggleMode());

            const textarea = document.querySelector<HTMLTextAreaElement>('.block-editor-markup')!;
            expect(textarea.style.height).toBe('60px');

            act(() => {
                fireEvent.change(textarea, {target: {value: 'one\ntwo\nthree\nfour\nfive'}});
            });
            expect(textarea.style.height).toBe('100px');
        } finally {
            scrollHeight.mockRestore();
        }
    });
});

describe('BlockEditorBody — leaving the raw view', () => {
    const props = {
        preview: false,
        onUploadFile: async () => '',
        onOpenWikiLink: () => {},
        wikiNotes: [],
    };
    const textarea = () => document.querySelector<HTMLTextAreaElement>('.block-editor-markup');

    /**
     * `forceSource` is decided once per load, from the file on disk — but the textarea is fully
     * editable. A note that loaded clean can be given frontmatter here, and re-entering blocks would
     * parse it, drop what the model can't hold, and autosave the loss. The way back is therefore
     * guarded against the LIVE buffer, not against the note as loaded.
     */
    it('refuses to re-enter blocks when the hand-edited source cannot round-trip', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        const onChange = vi.fn();
        render(
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'plain body')}
                sessionId={1}
                onChange={onChange}
                {...props}
            />,
        );

        act(() => ref.current!.toggleMode());
        expect(textarea()).not.toBeNull();

        // Frontmatter: the parser reads `---` as a divider and the keys as paragraphs.
        // fireEvent.change, not a raw `input`: React 18 tracks the last value it set, so assigning
        // `.value` directly makes it think nothing changed and onChange never runs.
        act(() => {
            fireEvent.change(textarea()!, {target: {value: '---\ntitle: x\n---\n\nplain body'}});
        });

        act(() => ref.current!.toggleMode());
        // Still on source, and now saying why.
        expect(textarea()).not.toBeNull();
        expect(document.querySelector('.block-editor-source__notice')?.textContent).toMatch(
            /can’t represent/,
        );
    });

    it('releases the latch once the source round-trips again', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        render(
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'plain body')}
                sessionId={1}
                onChange={vi.fn()}
                {...props}
            />,
        );

        act(() => ref.current!.toggleMode());
        act(() => {
            fireEvent.change(textarea()!, {
                target: {value: '---\ntitle: frontmatter the model has no block for\n---\n\nbody'},
            });
        });
        act(() => ref.current!.toggleMode()); // refused — latched on source
        expect(textarea()).not.toBeNull();

        // Undo the offending edit: the blocks surface has to come back, or the latch would strand
        // the user on the textarea for the rest of the session.
        act(() => {
            fireEvent.change(textarea()!, {target: {value: 'plain body again'}});
        });
        act(() => ref.current!.toggleMode());
        expect(textarea()).toBeNull();
    });

    it('does not carry the latch into the next note', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        const {rerender} = render(
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'plain body')}
                sessionId={1}
                onChange={vi.fn()}
                {...props}
            />,
        );

        act(() => ref.current!.toggleMode());
        act(() => {
            fireEvent.change(textarea()!, {
                target: {value: '---\ntitle: frontmatter the model has no block for\n---\n\nbody'},
            });
        });
        act(() => ref.current!.toggleMode());
        expect(textarea()).not.toBeNull();

        // This component is NOT keyed, so it outlives the switch — the latch has to be cleared by
        // hand or note B opens on the textarea blaming edits the user never made to it.
        rerender(
            <BlockEditorBody
                ref={ref}
                note={note('B.md', 'a totally clean body')}
                sessionId={2}
                onChange={vi.fn()}
                {...props}
            />,
        );
        // `markup` deliberately survives a switch, so B is on the textarea either way — the thing
        // the reset fixes is the NOTICE, which otherwise blames B for edits made in A.
        expect(document.querySelector('.block-editor-source__notice')).toBeNull();
        act(() => ref.current!.toggleMode()); // B opened in markup (that flag does persist)
        expect(textarea()).toBeNull();
    });

    it('still returns to blocks when the source edit round-trips cleanly', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        render(
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'plain body')}
                sessionId={1}
                onChange={vi.fn()}
                {...props}
            />,
        );

        act(() => ref.current!.toggleMode());
        act(() => {
            fireEvent.change(textarea()!, {target: {value: 'plain body, edited'}});
        });
        act(() => ref.current!.toggleMode());

        expect(textarea()).toBeNull();
        expect(document.querySelector('.gn-block-editor')).not.toBeNull();
    });
});

describe('BlockEditorBody — preview keeps the editor alive', () => {
    const props = {
        onUploadFile: async () => '',
        onOpenWikiLink: () => {},
        wikiNotes: [],
    };

    it('does not remount the editor when preview is toggled', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        const {rerender} = render(
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'body text')}
                sessionId={1}
                preview={false}
                onChange={vi.fn()}
                {...props}
            />,
        );
        const before = document.querySelector('.gn-block-editor .content');
        expect(before).not.toBeNull();

        const view = (preview: boolean) => (
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'body text')}
                sessionId={1}
                preview={preview}
                onChange={vi.fn()}
                {...props}
            />
        );
        rerender(view(true));
        rerender(view(false));

        // The SAME element, not an equivalent one: a remount would take the editor's undo history
        // with it, so ⌘Z stopped undoing anything typed before the toggle.
        expect(document.querySelector('.gn-block-editor .content')).toBe(before);
    });

    it('shows the preview and hides the editor while previewing', async () => {
        const ref = createRef<BlockEditorBodyHandle>();
        render(
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'body text')}
                sessionId={1}
                preview
                onChange={vi.fn()}
                {...props}
            />,
        );
        await waitFor(() => expect(document.querySelector('.note-preview')).not.toBeNull());
        const hidden = document.querySelector<HTMLElement>('.gn-block-editor')?.parentElement;
        expect(hidden?.style.display).toBe('none');
    });

    /**
     * The editor's floating menus PORTAL to `<body>` at `position: fixed`, so the `display: none`
     * that hides the editor does nothing to them: an open block menu stayed drawn over the preview,
     * still clickable, and picking "Turn into ▸ Heading 1" from it restructured the note while the
     * user was in a surface the UI calls read-only.
     */
    it('dismisses an open overlay menu when preview takes over', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        const view = (preview: boolean) => (
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'body text')}
                sessionId={1}
                preview={preview}
                onChange={vi.fn()}
                {...props}
            />
        );
        const {rerender} = render(view(false));

        fireEvent.click(document.querySelector('.drag-btn')!);
        expect(document.querySelector('.overlay-menu')).not.toBeNull();

        rerender(view(true));
        expect(document.querySelector('.overlay-menu')).toBeNull();

        // …and coming back does not restore it: its position was measured from a rect that the
        // preview has since scrolled away.
        rerender(view(false));
        expect(document.querySelector('.overlay-menu')).toBeNull();
    });
});

describe('BlockEditorBody — caret handoffs in source mode', () => {
    const props = {
        preview: false,
        onUploadFile: async () => '',
        onOpenWikiLink: () => {},
        wikiNotes: [],
    };
    const textarea = () => document.querySelector<HTMLTextAreaElement>('.block-editor-markup')!;

    function renderSource(content: string) {
        const ref = createRef<BlockEditorBodyHandle>();
        render(
            <BlockEditorBody
                ref={ref}
                note={note('A.md', content)}
                sessionId={1}
                onChange={vi.fn()}
                forceSource
                {...props}
            />,
        );
        return ref;
    }

    it('puts the caret at the start and end of the source, not nowhere', () => {
        // These drive Enter/Arrow from the note title and the click-below-the-note gesture. They
        // looked for `.block .content`, which source mode has none of, so they did nothing at all —
        // for exactly the notes that fall back to this surface.
        const ref = renderSource('one\ntwo');
        textarea().setSelectionRange(3, 3);

        act(() => ref.current!.moveCursorToStart());
        expect(textarea().selectionStart).toBe(0);

        act(() => ref.current!.moveCursorEnd());
        expect(textarea().selectionStart).toBe('one\ntwo'.length);
    });

    it('hands Backspace back to the title only from an empty first line', () => {
        const ref = renderSource('\nsecond');
        textarea().focus();
        textarea().setSelectionRange(0, 0);
        expect(ref.current!.atEmptyFirstLine()).toBe(true);

        textarea().setSelectionRange(1, 1);
        expect(ref.current!.atEmptyFirstLine()).toBe(false);
    });

    it('does not claim Backspace when the first line has text', () => {
        const ref = renderSource('one\ntwo');
        textarea().focus();
        textarea().setSelectionRange(0, 0);
        expect(ref.current!.atEmptyFirstLine()).toBe(false);
    });

    /**
     * ⌘A on a note that happens to start with a blank line also reports `selectionStart === 0`. The
     * pane reads this as "the caret is leaving for the title", swallows the Backspace and blurs —
     * so select-all-and-delete deleted nothing at all.
     */
    it('does not claim Backspace away from a select-all', () => {
        const ref = renderSource('\nsecond');
        textarea().focus();
        textarea().setSelectionRange(0, textarea().value.length);
        expect(ref.current!.atEmptyFirstLine()).toBe(false);
    });
});

describe('BlockEditorBody — the end of the note', () => {
    it('puts the caret in a trailing table, not in the paragraph above it', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        render(
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'intro paragraph\n\n| a | b |\n| --- | --- |\n| 1 | 2 |')}
                sessionId={1}
                preview={false}
                onChange={vi.fn()}
                onUploadFile={async () => ''}
                onOpenWikiLink={() => {}}
                wikiNotes={[]}
            />,
        );

        act(() => ref.current!.moveCursorEnd());

        // It looked for the last `.block .content`; a table renders `.table-cell-content` and an
        // image a <figure>, so clicking below the note landed the caret at the end of the last
        // PARAGRAPH — in the middle of the document.
        const cells = [...document.querySelectorAll<HTMLElement>('.table-cell-content')];
        const selected = window.getSelection()?.anchorNode ?? null;
        expect(cells[cells.length - 1].contains(selected)).toBe(true);
    });
});

describe('BlockEditorBody — focus while previewing', () => {
    it('focuses the preview surface, not the hidden editor', async () => {
        const ref = createRef<BlockEditorBodyHandle>();
        render(
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'body text')}
                sessionId={1}
                preview
                onChange={vi.fn()}
                onUploadFile={async () => ''}
                onOpenWikiLink={() => {}}
                wikiNotes={[]}
            />,
        );
        await waitFor(() => expect(document.querySelector('.note-preview')).not.toBeNull());
        act(() => ref.current!.focus());
        // The editor is mounted behind the preview so it keeps its undo history — but it is
        // hidden, and a hidden element cannot take focus, so this used to do nothing at all and
        // committing a note while previewing left focus on the list.
        expect(document.activeElement).toBe(document.querySelector('.note-preview'));
    });
});

describe('BlockEditorBody — undo survives a note switch', () => {
    const props = {
        preview: false,
        onUploadFile: async () => '',
        onOpenWikiLink: () => {},
        wikiNotes: [],
    };

    function editAndComeBack(backContent: string) {
        const onChange = vi.fn();
        const {rerender} = render(
            <BlockEditorBody
                note={note('A.md', 'alpha')}
                sessionId={1}
                onChange={onChange}
                {...props}
            />,
        );
        const block = document.querySelector<HTMLElement>('.content')!;
        act(() => {
            block.textContent = 'alpha edited';
            block.dispatchEvent(new Event('input', {bubbles: true}));
        });
        expect(onChange).toHaveBeenLastCalledWith('alpha edited');
        rerender(
            <BlockEditorBody
                note={note('B.md', 'beta')}
                sessionId={2}
                onChange={onChange}
                {...props}
            />,
        );
        rerender(
            <BlockEditorBody
                note={note('A.md', backContent)}
                sessionId={3}
                onChange={onChange}
                {...props}
            />,
        );
        onChange.mockClear();
        act(() => {
            fireEvent.keyDown(document.querySelector<HTMLElement>('.content')!, {
                key: 'z',
                metaKey: true,
            });
        });
        return onChange;
    }

    it('undoes an edit made before switching away', () => {
        expect(editAndComeBack('alpha edited\n')).toHaveBeenLastCalledWith('alpha');
    });

    it('starts afresh when the note changed elsewhere in the meantime', () => {
        expect(editAndComeBack('alpha changed elsewhere')).not.toHaveBeenCalled();
    });
});

describe('BlockEditorBody — focus across a note switch in source mode', () => {
    it('does not carry the old note’s focus into the next note’s source', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        const props = {
            preview: false,
            onChange: vi.fn(),
            onUploadFile: async () => '',
            onOpenWikiLink: () => {},
            wikiNotes: [],
        };
        const {rerender} = render(
            <BlockEditorBody ref={ref} note={note('A.md', 'alpha')} sessionId={1} {...props} />,
        );
        act(() => ref.current!.toggleMode());
        act(() => document.querySelector<HTMLTextAreaElement>('.block-editor-markup')!.focus());
        rerender(
            <BlockEditorBody ref={ref} note={note('B.md', 'beta')} sessionId={2} {...props} />,
        );
        expect(document.querySelector('.block-editor-markup')).not.toBe(document.activeElement);
    });
});
