import {forwardRef, useEffect, useImperativeHandle} from 'react';

import {MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';

import type {Note} from '../storage/types';

import './EditorPane.css';

export interface EditorPaneHandle {
    /** Flip between the WYSIWYG and Markup editing modes. */
    toggleMode(): void;
    /** Move keyboard focus into the editor. */
    focus(): void;
}

interface EditorPaneProps {
    note: Note;
    /** Focus the editor on (re)mount — true only when opened to edit (a "commit"); false for a browse preview. */
    autofocus: boolean;
    onChange: (markup: string) => void;
    /** Fired when an otherwise-unhandled Escape bubbles out of the editor (exit to the list). */
    onEscape: () => void;
}

/**
 * Wraps the Gravity markdown editor for the single open note. The editor instance is
 * re-created whenever the note id changes (via the `deps` argument), loading that note's
 * markup. It focuses on (re)mount only when `autofocus` is set (a commit open); a browse
 * preview mounts unfocused, leaving focus on the note list. Same-note commits focus via
 * the `focus()` handle. An Escape that the editor itself does not consume bubbles to the
 * wrapper and calls `onEscape`.
 */
export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane(
    {note, autofocus, onChange, onEscape},
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
            focus() {
                editor.focus();
            },
        }),
        [editor],
    );

    useEffect(() => {
        const handleChange = () => {
            const value = editor.getValue();
            // Ignore the no-op change emitted while the initial markup loads, so we don't
            // rewrite the file (and bump it to the top of the list) on open.
            if (value !== note.content) {
                onChange(value);
            }
        };
        editor.on('change', handleChange);
        return () => {
            editor.off('change', handleChange);
        };
    }, [editor, note.content, onChange]);

    // Focus only on (re)mount when this open was a commit. `editor` changes per note id.
    useEffect(() => {
        if (autofocus) editor.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- focus only on (re)mount; same-note commits use the focus() handle
    }, [editor]);

    return (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the wrapper captures Escape that bubbles out of the richtext editor; the editor itself is the interactive element
        <div
            className="editor-pane"
            onKeyDown={(event) => {
                if (event.key === 'Escape') onEscape();
            }}
        >
            <MarkdownEditorView
                settingsVisible={false}
                stickyToolbar={false}
                autofocus={autofocus}
                editor={editor}
            />
        </div>
    );
});
