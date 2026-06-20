import {createRef} from 'react';

import {render} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {fakeEditor, setEditorMode} = vi.hoisted(() => {
    const setEditorMode = vi.fn();
    return {
        setEditorMode,
        fakeEditor: {
            currentMode: 'wysiwyg' as 'wysiwyg' | 'markup',
            setEditorMode,
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
        render(<EditorPane ref={ref} note={NOTE} onChange={() => {}} />);
        ref.current?.toggleMode();
        expect(setEditorMode).toHaveBeenCalledWith('markup');
    });

    it('switches to wysiwyg when currently in markup', () => {
        fakeEditor.currentMode = 'markup';
        const ref = createRef<EditorPaneHandle>();
        render(<EditorPane ref={ref} note={NOTE} onChange={() => {}} />);
        ref.current?.toggleMode();
        expect(setEditorMode).toHaveBeenCalledWith('wysiwyg');
    });
});
