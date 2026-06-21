import {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';

import {MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';

import type {Note} from '../storage/types';

import {NotePreview} from './NotePreview';

import './EditorPane.css';

export interface EditorPaneHandle {
    /** Flip between the WYSIWYG and Markup editing modes. */
    toggleMode(): void;
    /** Move keyboard focus into the editor. */
    focus(): void;
}

interface EditorPaneProps {
    note: Note;
    /** Focus on (re)mount — true only when opened to edit (a "commit"); false for a browse preview. */
    autofocus: boolean;
    /** Read-only preview mode. Owned by Workspace so it persists across note switches. */
    preview?: boolean;
    onChange: (markup: string) => void;
    /** Fired when an otherwise-unhandled Escape bubbles out of the editor (exit to the list). */
    onEscape: () => void;
}

/**
 * Wraps the Gravity markdown editor for the single open note. The editor instance is
 * re-created whenever the note id changes, loading that note's markup. It focuses on
 * (re)mount only when `autofocus` is set (a commit open); a browse preview mounts unfocused.
 * In `preview` mode the editor is replaced by a read-only render of its current markup;
 * preview is owned by Workspace so it carries across note switches.
 */
export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane(
    {note, autofocus, preview = false, onChange, onEscape},
    ref,
) {
    const editor = useMarkdownEditor(
        {
            md: {html: false},
            initial: {markup: note.content, mode: 'wysiwyg'},
        },
        [note.id],
    );

    const previewRef = useRef<HTMLDivElement>(null);

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

    // Focus on (re)mount when this open was a commit — the preview surface if previewing,
    // else the editor. `editor` changes per note id.
    useEffect(() => {
        if (!autofocus) return;
        if (preview) previewRef.current?.focus();
        else editor.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- focus only on (re)mount; same-note commits use the focus() handle
    }, [editor]);

    // Move focus when preview is toggled within a note: onto the preview on enter, back to
    // the editor on exit, so the Esc ladder keeps working.
    const prevPreviewRef = useRef(preview);
    useEffect(() => {
        if (preview === prevPreviewRef.current) return;
        prevPreviewRef.current = preview;
        if (preview) previewRef.current?.focus();
        else editor.focus();
    }, [preview, editor]);

    return (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the wrapper captures Escape that bubbles out of the richtext editor; the editor itself is the interactive element
        <div
            className="editor-pane"
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                // Esc always steps out to the list; preview mode stays on (toggle it with ⌘⇧P).
                onEscape();
            }}
        >
            {preview ? (
                <NotePreview ref={previewRef} markup={editor.getValue()} />
            ) : (
                <MarkdownEditorView
                    settingsVisible={false}
                    stickyToolbar={false}
                    autofocus={autofocus}
                    editor={editor}
                />
            )}
        </div>
    );
});
