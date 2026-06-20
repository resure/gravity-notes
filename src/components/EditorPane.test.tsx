import {createRef} from 'react';

import {fireEvent, render} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {fakeEditor, setEditorMode, focus} = vi.hoisted(() => {
    const setEditorMode = vi.fn();
    const focus = vi.fn();
    return {
        setEditorMode,
        focus,
        fakeEditor: {
            currentMode: 'wysiwyg' as 'wysiwyg' | 'markup',
            setEditorMode,
            focus,
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

import {EditorPane, type EditorPaneHandle} from './EditorPane';

const NOTE = {id: 'a.md', title: 'a', content: 'hello', updatedAt: 1};

describe('EditorPane — toggleMode', () => {
    beforeEach(() => {
        fakeEditor.currentMode = 'wysiwyg';
        setEditorMode.mockClear();
    });

    it('switches to markup when currently in wysiwyg', () => {
        const ref = createRef<EditorPaneHandle>();
        render(
            <EditorPane
                ref={ref}
                note={NOTE}
                autofocus={false}
                onChange={() => {}}
                onEscape={() => {}}
            />,
        );
        ref.current?.toggleMode();
        expect(setEditorMode).toHaveBeenCalledWith('markup');
    });
});

describe('EditorPane — focus', () => {
    beforeEach(() => focus.mockClear());

    it('focuses on mount when autofocus is true (a commit open)', () => {
        render(<EditorPane note={NOTE} autofocus={true} onChange={() => {}} onEscape={() => {}} />);
        expect(focus).toHaveBeenCalled();
    });

    it('does not focus on mount when autofocus is false (a preview open)', () => {
        render(
            <EditorPane note={NOTE} autofocus={false} onChange={() => {}} onEscape={() => {}} />,
        );
        expect(focus).not.toHaveBeenCalled();
    });

    it('focuses via the imperative handle', () => {
        const ref = createRef<EditorPaneHandle>();
        render(
            <EditorPane
                ref={ref}
                note={NOTE}
                autofocus={false}
                onChange={() => {}}
                onEscape={() => {}}
            />,
        );
        expect(focus).not.toHaveBeenCalled();
        ref.current?.focus();
        expect(focus).toHaveBeenCalledTimes(1);
    });
});

describe('EditorPane — escape', () => {
    it('fires onEscape when Escape bubbles out of the editor', () => {
        const onEscape = vi.fn();
        const {container} = render(
            <EditorPane note={NOTE} autofocus={false} onChange={() => {}} onEscape={onEscape} />,
        );
        fireEvent.keyDown(container.querySelector('.editor-pane')!, {key: 'Escape'});
        expect(onEscape).toHaveBeenCalledTimes(1);
    });
});
