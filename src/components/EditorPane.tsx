import {forwardRef, useEffect, useImperativeHandle} from 'react';

import {MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';

import type {Note} from '../storage/types';

export interface EditorPaneHandle {
    /** Flip between the WYSIWYG and Markup editing modes. */
    toggleMode(): void;
}

interface EditorPaneProps {
    note: Note;
    /** Whether this pane is the visible/active tab. Only the active pane autofocuses. */
    active: boolean;
    onChange: (markup: string) => void;
}

/**
 * Wraps the Gravity markdown editor for a single note.
 *
 * One pane is mounted per open tab; inactive panes are hidden by the parent but
 * stay mounted to preserve their cursor/scroll/undo state. The editor instance is
 * re-created whenever the note id (or its on-disk `updatedAt`) changes via the
 * `deps` argument, loading that note's markup as the initial value. Only the active
 * pane autofocuses, and it refocuses whenever it becomes active.
 */
export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane(
    {note, active, onChange},
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

    // Focus when this pane becomes the active tab (and on initial mount-as-active).
    useEffect(() => {
        if (active) editor.focus();
    }, [active, editor]);

    return <MarkdownEditorView stickyToolbar autofocus={active} editor={editor} />;
});
