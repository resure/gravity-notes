import {type ComponentPropsWithRef, createRef} from 'react';

import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

/**
 * The pane's own contracts are what this suite is about — the focus ladder, the Esc exit, the
 * title ↔ body handoffs, the empty-area click, and which surface a note opens on. The body itself
 * is stubbed: what it does with a keystroke is `blockEditor/Editor.test.tsx`'s business, and driving
 * a real contentEditable through jsdom would only test jsdom.
 */
const {bodyProps, focus, toggleMode, moveCursorToStart, moveCursorEnd, openLineAbove, atEmpty} =
    vi.hoisted(() => ({
        /** The props of the most recent body render, so the pane's wiring can be asserted. */
        bodyProps: {current: null as null | Record<string, unknown>},
        focus: vi.fn(),
        toggleMode: vi.fn(),
        moveCursorToStart: vi.fn(),
        moveCursorEnd: vi.fn(),
        openLineAbove: vi.fn(() => true),
        atEmpty: vi.fn(() => false),
    }));

const removeEmptyFirstLine = vi.fn();
const focusPreview = vi.fn();
const isCaretOnFirstLine = vi.hoisted(() => vi.fn(() => true));

vi.mock('./editorCaret', () => ({isCaretOnFirstLine}));

vi.mock('./BlockEditorBody', async () => {
    const {forwardRef, useImperativeHandle} = await import('react');
    const {createPortal} = await import('react-dom');
    return {
        BlockEditorBody: forwardRef(function FakeBody(props: Record<string, unknown>, ref) {
            bodyProps.current = props;
            useImperativeHandle(ref, () => ({
                focus,
                toggleMode,
                moveCursorToStart,
                moveCursorEnd,
                openLineAbove,
                atEmptyFirstLine: atEmpty,
                removeEmptyFirstLine,
                focusPreview,
            }));
            return (
                <div className="gn-block-editor" data-testid="fake-body">
                    {/* Stands in for the slash menu / selection toolbar, which are `position: fixed`
                        and portaled to <body> — see OverlayPortal. */}
                    {createPortal(
                        <button type="button" data-testid="fake-overlay">
                            Bold
                        </button>,
                        document.body,
                    )}
                </div>
            );
        }),
    };
});

import {EditorPane, type EditorPaneHandle} from './EditorPane';

const NOTE = {id: 'a.md', title: 'a', content: 'hello', updatedAt: 1};

function renderPane(props: Partial<ComponentPropsWithRef<typeof EditorPane>> = {}) {
    return render(
        <EditorPane
            note={NOTE}
            autofocus={null}
            sessionId={0}
            onChange={() => {}}
            onRename={() => {}}
            onEscape={() => {}}
            onUploadFile={async () => 'Attachments/x.png'}
            wikiNotes={[]}
            onOpenWikiLink={() => {}}
            onSetIcon={() => {}}
            {...props}
        />,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    openLineAbove.mockReturnValue(true);
    atEmpty.mockReturnValue(false);
    isCaretOnFirstLine.mockReturnValue(true);
});

describe('EditorPane — the surface a note opens on', () => {
    it('hands the body a plain note as blocks', () => {
        renderPane();
        expect(bodyProps.current?.forceSource).toBe(false);
    });

    /**
     * The safety property (see markdown/roundTrip.ts): the block engine re-serializes the whole note
     * on every keystroke, so a note whose Markdown it cannot reproduce byte-for-byte must never
     * reach it. Frontmatter is the everyday case — an Obsidian vault is full of it.
     */
    it('forces source mode for a note the block model cannot hold', () => {
        renderPane({
            note: {...NOTE, content: '---\ntags: [a]\n---\n\n# Title\n\n#### Deep heading'},
        });
        expect(bodyProps.current?.forceSource).toBe(true);
    });

    it('passes the notes list through for [[wiki link]] resolution', () => {
        const wikiNotes = [{id: 'b.md', title: 'b', preview: '', updatedAt: 1}];
        renderPane({wikiNotes});
        expect(bodyProps.current?.wikiNotes).toBe(wikiNotes);
    });

    it('forwards ⌘⇧; to the body', () => {
        const ref = createRef<EditorPaneHandle>();
        renderPane({ref});
        ref.current?.toggleMode();
        expect(toggleMode).toHaveBeenCalled();
    });
});

describe('EditorPane — focus', () => {
    it('focuses the body on mount when autofocus is "body"', () => {
        renderPane({autofocus: 'body'});
        expect(focus).toHaveBeenCalled();
    });

    it('does not focus the body on mount when autofocus is null (a browse)', () => {
        renderPane({autofocus: null});
        expect(focus).not.toHaveBeenCalled();
    });

    it('focuses via the imperative handle', () => {
        const ref = createRef<EditorPaneHandle>();
        renderPane({ref});
        expect(focus).not.toHaveBeenCalled();
        ref.current?.focus();
        expect(focus).toHaveBeenCalledTimes(1);
    });

    it('focuses the title on mount when autofocus is "title"', () => {
        renderPane({autofocus: 'title'});
        expect(screen.getByLabelText('Note title')).toHaveFocus();
        expect(focus).not.toHaveBeenCalled();
    });
});

describe('EditorPane — escape', () => {
    it('fires onEscape when Escape bubbles out of the editor', () => {
        const onEscape = vi.fn();
        const {container} = renderPane({onEscape});
        const pane = container.querySelector('.editor-pane');
        if (!pane) throw new Error('editor-pane not rendered');
        fireEvent.keyDown(pane, {key: 'Escape'});
        expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it('hands the body its own onEscape, for the two-step block-selection ladder', () => {
        const onEscape = vi.fn();
        renderPane({onEscape});
        expect(bodyProps.current?.onEscape).toBe(onEscape);
    });
});

describe('EditorPane — preview', () => {
    it('tells the body to render read-only', () => {
        renderPane({preview: true});
        expect(bodyProps.current?.preview).toBe(true);
    });

    it('goes to the list (keeping preview) on Escape while previewing', () => {
        const onEscape = vi.fn();
        const {container} = renderPane({preview: true, onEscape});
        const pane = container.querySelector('.editor-pane');
        if (!pane) throw new Error('editor-pane not rendered');
        fireEvent.keyDown(pane, {key: 'Escape'});
        expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it('sends the title ↔ body handoffs to the preview surface instead', () => {
        renderPane({preview: true});
        fireEvent.keyDown(screen.getByLabelText('Note title'), {key: 'ArrowDown'});
        expect(focusPreview).toHaveBeenCalled();
        expect(moveCursorToStart).not.toHaveBeenCalled();
    });
});

describe('EditorPane — title ↔ body handoff', () => {
    it('Enter in the title opens a block at the top of the body', () => {
        renderPane();
        fireEvent.keyDown(screen.getByLabelText('Note title'), {key: 'Enter'});
        expect(openLineAbove).toHaveBeenCalled();
        // openLineAbove handled it (returned true) → no plain move-to-start fallback.
        expect(moveCursorToStart).not.toHaveBeenCalled();
    });

    it('Enter falls back to the body start when the body cannot open one (source mode)', () => {
        openLineAbove.mockReturnValue(false);
        renderPane();
        fireEvent.keyDown(screen.getByLabelText('Note title'), {key: 'Enter'});
        expect(moveCursorToStart).toHaveBeenCalled();
        expect(focus).toHaveBeenCalled();
    });

    it('ArrowDown in the title moves the caret to the body start (no new block)', () => {
        renderPane();
        fireEvent.keyDown(screen.getByLabelText('Note title'), {key: 'ArrowDown'});
        expect(moveCursorToStart).toHaveBeenCalled();
        expect(openLineAbove).not.toHaveBeenCalled();
    });

    it('ArrowUp on the first body line focuses the title', () => {
        const {container} = renderPane();
        const body = container.querySelector('.editor-pane__body');
        if (!body) throw new Error('body not rendered');
        fireEvent.keyDown(body, {key: 'ArrowUp'});
        expect(screen.getByLabelText('Note title')).toHaveFocus();
    });

    it('ArrowUp below the first body line does not focus the title', () => {
        isCaretOnFirstLine.mockReturnValue(false);
        const {container} = renderPane();
        const body = container.querySelector('.editor-pane__body');
        if (!body) throw new Error('body not rendered');
        fireEvent.keyDown(body, {key: 'ArrowUp'});
        expect(screen.getByLabelText('Note title')).not.toHaveFocus();
    });

    it('ArrowUp with a modifier (e.g. ⌘↑/⇧↑) does not hand off to the title', () => {
        // Even on the first line, a modified ArrowUp is the editor's own navigation/selection —
        // it must not be hijacked into the title.
        const {container} = renderPane();
        const body = container.querySelector('.editor-pane__body');
        if (!body) throw new Error('body not rendered');
        fireEvent.keyDown(body, {key: 'ArrowUp', shiftKey: true});
        expect(screen.getByLabelText('Note title')).not.toHaveFocus();
    });

    it('Backspace on the empty first block removes it and focuses the title', () => {
        atEmpty.mockReturnValue(true);
        const {container} = renderPane();
        const body = container.querySelector('.editor-pane__body');
        if (!body) throw new Error('body not rendered');
        fireEvent.keyDown(body, {key: 'Backspace'});
        expect(removeEmptyFirstLine).toHaveBeenCalled();
        expect(screen.getByLabelText('Note title')).toHaveFocus();
    });

    it('Backspace elsewhere in the body is left to the editor', () => {
        const {container} = renderPane();
        const body = container.querySelector('.editor-pane__body');
        if (!body) throw new Error('body not rendered');
        fireEvent.keyDown(body, {key: 'Backspace'});
        expect(removeEmptyFirstLine).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Note title')).not.toHaveFocus();
    });

    it('ArrowUp off the top of the BODY is handed back by the body itself', () => {
        renderPane();
        (bodyProps.current?.onLeaveTop as () => void)();
        expect(screen.getByLabelText('Note title')).toHaveFocus();
    });

    it('commits a title edit on blur, tagged with the note id', async () => {
        const user = userEvent.setup();
        const onRename = vi.fn();
        renderPane({onRename});
        const input = screen.getByLabelText('Note title');
        await user.clear(input);
        await user.type(input, 'Renamed');
        fireEvent.blur(input);
        expect(onRename).toHaveBeenCalledWith('a.md', 'Renamed');
    });
});

describe('EditorPane — empty-area click', () => {
    it('drops the caret at the end when clicking the empty body padding', () => {
        const {container} = renderPane();
        const body = container.querySelector('.editor-pane__body');
        if (!body) throw new Error('body not rendered');
        fireEvent.mouseDown(body);
        expect(moveCursorEnd).toHaveBeenCalled();
        expect(focus).toHaveBeenCalled();
    });

    it('leaves a mousedown inside the editor content to the editor (no caret yank)', () => {
        // The block editor owns its own empty-space click (clicking under the last block appends
        // one there). Without `.gn-block-editor` in the guard, EVERY click inside it fell through
        // here and pinned the caret to the first block — the surface was unusable with a mouse.
        renderPane();
        fireEvent.mouseDown(screen.getByTestId('fake-body'));
        expect(moveCursorEnd).not.toHaveBeenCalled();
    });

    it('ignores a mousedown from a portaled overlay (keeps the selection intact)', () => {
        // The slash menu / selection toolbar portal to <body>, but their mousedown still bubbles
        // here through React's portal propagation. Collapsing the selection then would make every
        // formatting button a no-op.
        renderPane();
        fireEvent.mouseDown(screen.getByTestId('fake-overlay'));
        expect(moveCursorEnd).not.toHaveBeenCalled();
    });

    it('does nothing in preview mode (it is read-only)', () => {
        const {container} = renderPane({preview: true});
        const body = container.querySelector('.editor-pane__body');
        if (!body) throw new Error('body not rendered');
        fireEvent.mouseDown(body);
        expect(moveCursorEnd).not.toHaveBeenCalled();
    });
});
