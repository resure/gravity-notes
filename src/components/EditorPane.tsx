import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';

import {MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';

import type {Note} from '../storage/types';

import {NotePreview} from './NotePreview';

import './EditorPane.css';

export interface EditorPaneHandle {
    /** Flip between the WYSIWYG and Markup editing modes. */
    toggleMode(): void;
    /** Toggle a read-only rendered preview of the current markup. */
    togglePreview(): void;
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

    // Non-null while in read-only preview mode; holds the markup snapshot being previewed.
    const [previewMarkup, setPreviewMarkup] = useState<string | null>(null);
    const previewRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(
        ref,
        () => ({
            toggleMode() {
                editor.setEditorMode(editor.currentMode === 'wysiwyg' ? 'markup' : 'wysiwyg');
            },
            togglePreview() {
                // Snapshot the live markup on the way in (includes unsaved edits); clear on the way out.
                setPreviewMarkup((cur) => (cur === null ? editor.getValue() : null));
            },
            focus() {
                editor.focus();
            },
        }),
        [editor],
    );

    // Move focus across the edit/preview transition: into the preview on enter, back to the
    // editor on exit, so the Esc ladder keeps working from wherever you are.
    const wasPreviewingRef = useRef(false);
    useEffect(() => {
        const previewing = previewMarkup !== null;
        const changed = previewing !== wasPreviewingRef.current;
        wasPreviewingRef.current = previewing;
        if (!changed) return;
        if (previewing) previewRef.current?.focus();
        else editor.focus();
    }, [previewMarkup, editor]);

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
                if (event.key !== 'Escape') return;
                // Esc steps out of preview first (back to editing), then out to the list.
                if (previewMarkup === null) onEscape();
                else setPreviewMarkup(null);
            }}
        >
            {previewMarkup === null ? (
                <MarkdownEditorView
                    settingsVisible={false}
                    stickyToolbar={false}
                    autofocus={autofocus}
                    editor={editor}
                />
            ) : (
                <NotePreview ref={previewRef} markup={previewMarkup} />
            )}
        </div>
    );
});
