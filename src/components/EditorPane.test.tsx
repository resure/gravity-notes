import {type ComponentPropsWithRef, createRef} from 'react';

import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {
    fakeEditor,
    editorState,
    portalState,
    setEditorMode,
    focus,
    moveCursor,
    isCaretOnFirstLine,
    openLineAbove,
    atEmptyFirstLine,
    removeEmptyFirstLine,
} = vi.hoisted(() => {
    const setEditorMode = vi.fn();
    const focus = vi.fn();
    const moveCursor = vi.fn();
    const isCaretOnFirstLine = vi.fn(() => true);
    const openLineAbove = vi.fn(() => true);
    const atEmptyFirstLine = vi.fn(() => false);
    const removeEmptyFirstLine = vi.fn();
    // Controllable editor value + captured 'change' handler, so tests can simulate edits.
    const editorState = {value: '', changeHandler: null as null | (() => void)};
    // When enabled, the mocked editor view renders a portal button (to document.body) standing in
    // for the real selection formatting toolbar, which is a portaled Gravity Popup.
    const portalState = {enabled: false};
    return {
        setEditorMode,
        focus,
        moveCursor,
        isCaretOnFirstLine,
        openLineAbove,
        atEmptyFirstLine,
        removeEmptyFirstLine,
        editorState,
        portalState,
        fakeEditor: {
            currentMode: 'wysiwyg' as 'wysiwyg' | 'markup',
            setEditorMode,
            focus,
            moveCursor,
            // Mimic the real editor: replace() re-parses + re-serializes, so the value it emits can
            // differ from the markup passed in (trailing newline, etc.) — and it fires 'change'.
            replace: vi.fn((markup: string) => {
                editorState.value = `${markup}\n`;
                editorState.changeHandler?.();
            }),
            getValue: () => editorState.value,
            on: (event: string, cb: () => void) => {
                if (event === 'change') editorState.changeHandler = cb;
            },
            off: () => {
                editorState.changeHandler = null;
            },
        },
    };
});

vi.mock('@gravity-ui/markdown-editor', async () => {
    const {createElement} = await import('react');
    const {createPortal} = await import('react-dom');
    return {
        useMarkdownEditor: () => fakeEditor,
        // The selection-toolbar config EditorPane derives at module load (only needs `.full` to map over).
        wSelectionMenuConfigByPreset: {full: []},
        // Renders nothing by default. With the portal enabled, it emits a button into document.body
        // (a React portal child of this view) to mimic the selection toolbar's DOM placement.
        MarkdownEditorView: () =>
            portalState.enabled
                ? createPortal(
                      createElement('button', {'data-testid': 'sel-toolbar-btn'}, 'Bold'),
                      document.body,
                  )
                : null,
    };
});

vi.mock('./editorCaret', () => ({isCaretOnFirstLine}));

vi.mock('./editorBody', () => ({openLineAbove, atEmptyFirstLine, removeEmptyFirstLine}));

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

describe('EditorPane — toggleMode', () => {
    beforeEach(() => {
        fakeEditor.currentMode = 'wysiwyg';
        setEditorMode.mockClear();
    });

    it('switches to markup when currently in wysiwyg', () => {
        const ref = createRef<EditorPaneHandle>();
        renderPane({ref});
        ref.current?.toggleMode();
        expect(setEditorMode).toHaveBeenCalledWith('markup');
    });
});

describe('EditorPane — focus', () => {
    beforeEach(() => focus.mockClear());

    it('focuses the body on mount when autofocus is "body"', () => {
        renderPane({autofocus: 'body'});
        expect(focus).toHaveBeenCalled();
    });

    it('does not focus the body on mount when autofocus is null (a preview open)', () => {
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
});

describe('EditorPane — preview', () => {
    it('renders the read-only preview when preview is true', () => {
        const {container} = renderPane({preview: true});
        expect(container.querySelector('.note-preview')).toBeTruthy();
    });

    it('goes to the list (keeping preview) on Escape while previewing', () => {
        const onEscape = vi.fn();
        const {container} = renderPane({preview: true, onEscape});
        const pane = container.querySelector('.editor-pane');
        if (!pane) throw new Error('editor-pane not rendered');
        fireEvent.keyDown(pane, {key: 'Escape'});
        expect(onEscape).toHaveBeenCalledTimes(1);
    });
});

describe('EditorPane — title ↔ body handoff', () => {
    beforeEach(() => {
        focus.mockClear();
        moveCursor.mockClear();
        isCaretOnFirstLine.mockReturnValue(true);
        openLineAbove.mockClear().mockReturnValue(true);
        atEmptyFirstLine.mockClear().mockReturnValue(false);
        removeEmptyFirstLine.mockClear();
    });

    it('Enter in the title opens a line at the top of the body', () => {
        renderPane();
        fireEvent.keyDown(screen.getByLabelText('Note title'), {key: 'Enter'});
        expect(openLineAbove).toHaveBeenCalled();
        // openLineAbove handled it (returned true) → no plain move-to-start fallback.
        expect(moveCursor).not.toHaveBeenCalled();
    });

    it('Enter falls back to the body start when the view is unreachable', () => {
        openLineAbove.mockReturnValue(false);
        renderPane();
        fireEvent.keyDown(screen.getByLabelText('Note title'), {key: 'Enter'});
        expect(moveCursor).toHaveBeenCalledWith('start');
        expect(focus).toHaveBeenCalled();
    });

    it('ArrowDown in the title moves the caret to the body start (no new line)', () => {
        renderPane();
        fireEvent.keyDown(screen.getByLabelText('Note title'), {key: 'ArrowDown'});
        expect(moveCursor).toHaveBeenCalledWith('start');
        expect(openLineAbove).not.toHaveBeenCalled();
    });

    it('ArrowUp on the first body line focuses the title', () => {
        isCaretOnFirstLine.mockReturnValue(true);
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
        isCaretOnFirstLine.mockReturnValue(true);
        const {container} = renderPane();
        const body = container.querySelector('.editor-pane__body');
        if (!body) throw new Error('body not rendered');
        fireEvent.keyDown(body, {key: 'ArrowUp', shiftKey: true});
        expect(screen.getByLabelText('Note title')).not.toHaveFocus();
    });

    it('Backspace on the empty first line removes it and focuses the title', () => {
        atEmptyFirstLine.mockReturnValue(true);
        const {container} = renderPane();
        const body = container.querySelector('.editor-pane__body');
        if (!body) throw new Error('body not rendered');
        fireEvent.keyDown(body, {key: 'Backspace'});
        expect(removeEmptyFirstLine).toHaveBeenCalled();
        expect(screen.getByLabelText('Note title')).toHaveFocus();
    });

    it('Backspace elsewhere in the body is left to the editor', () => {
        atEmptyFirstLine.mockReturnValue(false);
        const {container} = renderPane();
        const body = container.querySelector('.editor-pane__body');
        if (!body) throw new Error('body not rendered');
        fireEvent.keyDown(body, {key: 'Backspace'});
        expect(removeEmptyFirstLine).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Note title')).not.toHaveFocus();
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
    beforeEach(() => {
        moveCursor.mockClear();
        focus.mockClear();
    });

    it('drops the caret at the end when clicking the empty body padding', () => {
        const {container} = renderPane();
        const body = container.querySelector('.editor-pane__body');
        if (!body) throw new Error('body not rendered');
        // A mousedown on the body wrapper itself (its padding/empty space) moves the caret to the end.
        fireEvent.mouseDown(body);
        expect(moveCursor).toHaveBeenCalledWith('end');
        expect(focus).toHaveBeenCalled();
    });

    it('ignores a mousedown from the portaled selection toolbar (keeps the selection intact)', () => {
        portalState.enabled = true;
        try {
            renderPane();
            // The toolbar button is portaled to document.body; its mousedown bubbles to the body
            // handler via React's portal propagation. The handler must NOT moveCursor('end') — doing
            // so would collapse the selection and the formatting command would apply to nothing.
            const toolbarButton = screen.getByTestId('sel-toolbar-btn');
            moveCursor.mockClear();
            fireEvent.mouseDown(toolbarButton);
            expect(moveCursor).not.toHaveBeenCalled();
        } finally {
            portalState.enabled = false;
        }
    });
});

describe('EditorPane — change emission', () => {
    beforeEach(() => {
        editorState.value = '';
        editorState.changeHandler = null;
    });

    it('suppresses only the initial load no-op, then emits every change — including a revert', () => {
        const onChange = vi.fn();
        renderPane({onChange}); // NOTE.content === 'hello'

        // The first emit just echoes the loaded content (the open-time no-op): suppressed.
        editorState.value = 'hello';
        editorState.changeHandler?.();
        expect(onChange).not.toHaveBeenCalled();

        // A real edit flows through.
        editorState.value = 'hellox';
        editorState.changeHandler?.();
        expect(onChange).toHaveBeenLastCalledWith('hellox');

        // Undoing back to the original within the session must STILL emit, so the autosave writes
        // 'hello' (matching the screen) rather than leaving the stale 'hellox' in the buffer.
        editorState.value = 'hello';
        editorState.changeHandler?.();
        expect(onChange).toHaveBeenLastCalledWith('hello');
    });
});

describe('EditorPane — note switch', () => {
    it('re-homes scroll to the top on a switch to a different note with an IDENTICAL body', () => {
        // Regression: the content-swap used to be keyed on `note.content` alone, so switching between
        // two DIFFERENT notes whose bodies are byte-identical (two empty notes, a duplicate, a
        // template) never ran — the incoming note kept the OUTGOING one's scroll position. Keying on
        // `sessionId` (bumped on a real switch, never on a rename) fires the swap even when the body
        // string is unchanged. We assert the real user-facing effect (scroll re-homed to the top of a
        // first-time-opened note) AND that the byte-identical body is NOT needlessly re-`replace()`d.
        editorState.value = '';
        editorState.changeHandler = null;
        const {container, rerender} = renderPane(); // a.md / 'hello'
        const pane = container.querySelector('.editor-pane') as HTMLElement;
        pane.scrollTop = 120; // the user scrolled note A down
        // Make the editor buffer byte-identical to the incoming note so this exercises the
        // identical-content path (contentChanged === false → replace() is skipped), the exact case
        // the old `[note.content]` key silently ignored.
        editorState.value = 'hello';
        fakeEditor.replace.mockClear();

        rerender(
            <EditorPane
                note={{id: 'b.md', title: 'b', content: 'hello', updatedAt: 2}} // SAME body, new id + session
                autofocus={null}
                sessionId={1}
                onChange={() => {}}
                onRename={() => {}}
                onEscape={() => {}}
                onUploadFile={async () => 'Attachments/x.png'}
                wikiNotes={[]}
                onOpenWikiLink={() => {}}
                onSetIcon={() => {}}
            />,
        );
        // The swap fired on the session bump and re-homed the (first-time-opened) note to the top…
        expect(pane.scrollTop).toBe(0);
        // …without rebuilding an identical doc.
        expect(fakeEditor.replace).not.toHaveBeenCalled();
    });

    it('does NOT fire the content swap on an in-place rename (id changes, session + body do not)', () => {
        // A rename/move re-keys the open note WITHOUT bumping the session or touching the body, so the
        // swap effect (keyed on [sessionId, note.content]) must stay dormant — no replace(), no history
        // reset. (The re-key effect carries the saved view-state to the new id instead.) Firing the swap
        // on a rename would wipe the undo stack every rename and re-emit the body as a load echo. The
        // swap and re-key effects share `prevNoteIdRef`, so this also pins that they cooperate without
        // a spurious swap on an id-only change.
        editorState.value = 'hello';
        editorState.changeHandler = null;
        const {rerender} = renderPane(); // a.md / 'hello', sessionId 0
        fakeEditor.replace.mockClear(); // ignore the mount-time load

        rerender(
            <EditorPane
                note={
                    {id: 'a-renamed.md', title: 'a-renamed', content: 'hello', updatedAt: 1} // rename: new id, SAME body + session
                }
                autofocus={null}
                sessionId={0} // unchanged — that's what makes it a rename, not a switch
                onChange={() => {}}
                onRename={() => {}}
                onEscape={() => {}}
                onUploadFile={async () => 'Attachments/x.png'}
                wikiNotes={[]}
                onOpenWikiLink={() => {}}
                onSetIcon={() => {}}
            />,
        );
        // No swap fired: the editor buffer is untouched (no replace) on a rename.
        expect(fakeEditor.replace).not.toHaveBeenCalled();
    });

    it('does not emit a change when switching notes, even though replace() round-trips the content', () => {
        // Regression: editor.replace() re-parses + re-serializes, so the 'change' it fires can carry a
        // value that differs from the on-disk content (trailing newline, &nbsp;, …). That load echo
        // must be suppressed — otherwise it reaches the autosave, re-serializing the note to disk AND
        // bumping its updatedAt, which reorders the note list under the "Updated" sort.
        const onChange = vi.fn();
        const {rerender} = renderPane({onChange});
        onChange.mockClear(); // ignore any mount-time activity

        rerender(
            <EditorPane
                note={{id: 'b.md', title: 'b', content: 'world', updatedAt: 2}}
                autofocus={null}
                sessionId={1}
                onChange={onChange}
                onRename={() => {}}
                onEscape={() => {}}
                onUploadFile={async () => 'Attachments/x.png'}
                wikiNotes={[]}
                onOpenWikiLink={() => {}}
                onSetIcon={() => {}}
            />,
        );
        expect(onChange).not.toHaveBeenCalled();
    });
});
