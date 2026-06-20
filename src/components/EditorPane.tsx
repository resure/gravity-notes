import {forwardRef, useEffect, useImperativeHandle} from 'react';

import {MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';

import type {Note} from '../storage/types';

export interface EditorPaneHandle {
    /** Flip between the WYSIWYG and Markup editing modes. */
    toggleMode(): void;
}

interface EditorPaneProps {
    note: Note;
    onChange: (markup: string) => void;
}

/**
 * Wraps the Gravity markdown editor for a single note.
 *
 * The editor instance is re-created whenever the note id changes (the `deps`
 * argument), loading that note's markup as the initial value. Content edits are
 * reported back via the `change` event, serialized with `getValue()`. The parent
 * can flip editing modes through the imperative `toggleMode` handle.
 */
export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane(
    {note, onChange},
    ref,
) {
    const editor = useMarkdownEditor(
        {
            md: {html: false},
            initial: {markup: note.content, mode: 'wysiwyg'},
        },
        [note.id],
    );

    useImperativeHandle(
        ref,
        () => ({
            toggleMode() {
                editor.setEditorMode(editor.currentMode === 'wysiwyg' ? 'markup' : 'wysiwyg');
            },
        }),
        [editor],
    );

    useEffect(() => {
        const handleChange = () => {
            const value = editor.getValue();
            // Ignore the no-op change emitted while the initial markup is loaded, so we
            // don't rewrite the file (and bump it to the top of the list) on open.
            if (value !== note.content) {
                onChange(value);
            }
        };
        editor.on('change', handleChange);
        return () => {
            editor.off('change', handleChange);
        };
    }, [editor, note.content, onChange]);

    return <MarkdownEditorView stickyToolbar autofocus editor={editor} />;
});
