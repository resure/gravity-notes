import {createRef} from 'react';

import {render} from '@testing-library/react';
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

describe('EditorPane.toggleMode', () => {
    beforeEach(() => {
        fakeEditor.currentMode = 'wysiwyg';
        setEditorMode.mockClear();
    });

    it('switches to markup when currently in wysiwyg', () => {
        const ref = createRef<EditorPaneHandle>();
        render(<EditorPane ref={ref} note={NOTE} active={true} onChange={() => {}} />);
        ref.current?.toggleMode();
        expect(setEditorMode).toHaveBeenCalledWith('markup');
    });

    it('switches to wysiwyg when currently in markup', () => {
        fakeEditor.currentMode = 'markup';
        const ref = createRef<EditorPaneHandle>();
        render(<EditorPane ref={ref} note={NOTE} active={true} onChange={() => {}} />);
        ref.current?.toggleMode();
        expect(setEditorMode).toHaveBeenCalledWith('wysiwyg');
    });
});

describe('EditorPane focus', () => {
    beforeEach(() => focus.mockClear());

    it('focuses the editor when mounted active', () => {
        render(<EditorPane note={NOTE} active={true} onChange={() => {}} />);
        expect(focus).toHaveBeenCalled();
    });

    it('does not focus the editor when mounted inactive', () => {
        render(<EditorPane note={NOTE} active={false} onChange={() => {}} />);
        expect(focus).not.toHaveBeenCalled();
    });

    it('focuses when the active prop flips from false to true', () => {
        const {rerender} = render(<EditorPane note={NOTE} active={false} onChange={() => {}} />);
        expect(focus).not.toHaveBeenCalled();
        rerender(<EditorPane note={NOTE} active={true} onChange={() => {}} />);
        expect(focus).toHaveBeenCalledTimes(1);
    });
});
