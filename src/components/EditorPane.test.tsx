import {type ComponentPropsWithRef, createRef} from 'react';

import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {fakeEditor, setEditorMode, focus, moveCursor, isCaretOnFirstLine} = vi.hoisted(() => {
    const setEditorMode = vi.fn();
    const focus = vi.fn();
    const moveCursor = vi.fn();
    const isCaretOnFirstLine = vi.fn(() => true);
    return {
        setEditorMode,
        focus,
        moveCursor,
        isCaretOnFirstLine,
        fakeEditor: {
            currentMode: 'wysiwyg' as 'wysiwyg' | 'markup',
            setEditorMode,
            focus,
            moveCursor,
            getValue: () => '',
            on: () => {},
            off: () => {},
        },
    };
});

vi.mock('@gravity-ui/markdown-editor', () => ({
    useMarkdownEditor: () => fakeEditor,
    MarkdownEditorView: () => null,
}));

vi.mock('./editorCaret', () => ({isCaretOnFirstLine}));

import {EditorPane, type EditorPaneHandle} from './EditorPane';

const NOTE = {id: 'a.md', title: 'a', content: 'hello', updatedAt: 1};

function renderPane(props: Partial<ComponentPropsWithRef<typeof EditorPane>> = {}) {
    return render(
        <EditorPane
            note={NOTE}
            autofocus={null}
            onChange={() => {}}
            onRename={() => {}}
            onEscape={() => {}}
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
    });

    it('Enter in the title moves the caret to the start of the body', () => {
        renderPane();
        fireEvent.keyDown(screen.getByLabelText('Note title'), {key: 'Enter'});
        expect(moveCursor).toHaveBeenCalledWith('start');
        expect(focus).toHaveBeenCalled();
    });

    it('ArrowDown in the title moves the caret to the body', () => {
        renderPane();
        fireEvent.keyDown(screen.getByLabelText('Note title'), {key: 'ArrowDown'});
        expect(moveCursor).toHaveBeenCalledWith('start');
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

    it('commits a title edit on blur, tagged with the note id', async () => {
        const user = userEvent.setup();
        const onRename = vi.fn();
        renderPane({onRename});
        const input = screen.getByLabelText('Note title');
        await user.clear(input);
        await user.type(input, 'Renamed');
        await user.tab();
        expect(onRename).toHaveBeenCalledWith('a.md', 'Renamed');
    });
});
