import {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';

import {MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';

import type {Note} from '../storage/types';

import {NotePreview} from './NotePreview';
import {NoteTitle, type NoteTitleHandle} from './NoteTitle';
import {attachmentImageExtension} from './editor/attachmentImageExtension';
import {openLinkExtension} from './editor/openLinkExtension';
import {atEmptyFirstLine, openLineAbove, removeEmptyFirstLine} from './editorBody';
import {isCaretOnFirstLine} from './editorCaret';

import './EditorPane.css';

export interface EditorPaneHandle {
    /** Flip between the WYSIWYG and Markup editing modes. */
    toggleMode(): void;
    /** Move keyboard focus into the editor body. */
    focus(): void;
}

interface EditorPaneProps {
    note: Note;
    /** Focus intent on (re)mount: the body (a commit), the title (a new note), or none (preview). */
    autofocus: 'body' | 'title' | null;
    /** Read-only preview mode. Owned by Workspace so it persists across note switches. */
    preview?: boolean;
    onChange: (markup: string) => void;
    /**
     * Commit a title edit (renames the file). Carries the note id it applies to. May resolve
     * `false` when the rename was rejected (e.g. a name collision), so the title field can revert.
     */
    onRename: (id: string, nextTitle: string) => void | Promise<boolean>;
    /** Fired when an otherwise-unhandled Escape bubbles out of the editor (exit to the list). */
    onEscape: () => void;
    /**
     * Persist a dropped/pasted/inserted image to the active store and return its stable
     * `Attachments/…` reference (written into the Markdown as the image `src`). Wired to the editor's
     * upload handler, which drives drag-drop, paste, and the image command alike.
     */
    onUploadFile: (file: File) => Promise<string>;
}

/**
 * The open-note surface: an editable title above the Gravity markdown editor body. The
 * editor instance is created once per mount; EditorPane is keyed by `useNotes.sessionId`,
 * so a real note switch / disk reload remounts it, but a rename — which changes `note.id`
 * in place — does not, keeping the caret during the title→body handoff. In `preview` mode
 * the body is a read-only render and the title is read-only.
 */
export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane(
    {note, autofocus, preview = false, onChange, onRename, onEscape, onUploadFile},
    ref,
) {
    // Stable across the editor's life (EditorPane remounts per session); read latest via a ref so the
    // upload handler — captured once in useMarkdownEditor's []-deps — always calls the current one.
    const uploadRef = useRef(onUploadFile);
    uploadRef.current = onUploadFile;

    const editor = useMarkdownEditor(
        {
            md: {html: false},
            initial: {markup: note.content, mode: 'wysiwyg'},
            // Keep intentionally-blank lines through the WYSIWYG round-trip. Without this the
            // serializer drops empty paragraphs (Markdown can't represent a bare blank line), so
            // saving a note strips the blank lines the user typed for spacing. With it, an empty
            // row is serialized as a `&nbsp;` line so the gap survives save/reload.
            experimental: {preserveEmptyRows: true},
            // Persist dropped/pasted/inserted images under Attachments/ and return their stable ref
            // as the image src (drives drag-drop, paste, and the image command via one handler).
            handlers: {
                uploadFile: async (file) => {
                    const url = await uploadRef.current(file);
                    return {url, name: file.name};
                },
            },
            wysiwygConfig: {
                // Move insert-link off ⌘K to ⇧⌘K so ⌘K is free for global note navigation.
                extensionOptions: {link: {linkKey: 'Mod-Shift-k'}},
                // Resolve Attachments/ image srcs to displayable object URLs (keeps Markdown clean),
                // and let ⌘/Ctrl-click on a link open it instead of opening the link-edit tooltip.
                extensions: (builder) => {
                    attachmentImageExtension(builder);
                    openLinkExtension(builder);
                },
            },
        },
        [],
    );

    const previewRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<NoteTitleHandle>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    // The editor emits a no-op 'change' as the initial markup loads; suppress only that FIRST emit,
    // not every value that equals the original — otherwise undoing back to the loaded content within
    // the autosave window leaves a stale pending edit that writes the pre-undo value to disk.
    const settledRef = useRef(false);

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
            // Ignore only the first emit if it just echoes the loaded content (the no-op fired while
            // the initial markup loads), so we don't rewrite the file on open. Every later change —
            // including an undo back to the original — flows through so disk matches the screen.
            if (!settledRef.current) {
                settledRef.current = true;
                if (value === note.content) return;
            }
            onChange(value);
        };
        editor.on('change', handleChange);
        return () => {
            editor.off('change', handleChange);
        };
    }, [editor, note.content, onChange]);

    // Focus on (re)mount per the autofocus intent: the title for a new note, else the body
    // (the preview surface when previewing). `editor` changes per mount (sessionId key).
    useEffect(() => {
        if (autofocus === 'title') {
            titleRef.current?.focus();
            titleRef.current?.select();
        } else if (autofocus === 'body') {
            if (preview) previewRef.current?.focus();
            else editor.focus();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- focus only on (re)mount
    }, [editor]);

    // Move focus when preview is toggled within a note: onto the preview on enter, back to
    // the body on exit, so the Esc ladder keeps working.
    const prevPreviewRef = useRef(preview);
    useEffect(() => {
        if (preview === prevPreviewRef.current) return;
        prevPreviewRef.current = preview;
        if (preview) previewRef.current?.focus();
        else editor.focus();
    }, [preview, editor]);

    // Title → body: put the caret at the start of the body and focus it (the preview surface
    // when previewing). Blurring the title here also commits the rename via NoteTitle.onBlur.
    const goToBody = () => {
        if (preview) {
            previewRef.current?.focus();
            return;
        }
        editor.moveCursor('start');
        editor.focus();
    };

    // Enter from the title: open a fresh empty line at the top of the body and land on it.
    // Falls back to the body start when the ProseMirror view isn't reachable (Markup mode).
    const enterToBody = () => {
        if (preview) {
            previewRef.current?.focus();
            return;
        }
        if (!openLineAbove(editor)) {
            editor.moveCursor('start');
            editor.focus();
        }
    };

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
            <NoteTitle
                ref={titleRef}
                title={note.title}
                readOnly={preview}
                onCommit={(nextTitle) => onRename(note.id, nextTitle)}
                onLeaveToBody={goToBody}
                onEnter={enterToBody}
                onEscape={onEscape}
            />
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the wrapper captures ArrowUp/Backspace handoffs and empty-area clicks; the editor inside is the interactive element */}
            <div
                ref={bodyRef}
                className="editor-pane__body"
                onMouseDown={(event) => {
                    // Click in the empty area around/below the editor (its bottom padding, or the
                    // body grown taller than a short note) → drop the caret at the very end.
                    // Clicks on the editable content itself fall through to the editor.
                    if (preview) return;
                    // The selection formatting toolbar renders in a portal (outside this subtree),
                    // but its mousedown still bubbles here via React's portal event propagation. Only
                    // act on clicks that are real DOM descendants of the body wrapper; otherwise the
                    // moveCursor('end') below would collapse the active selection and the toolbar's
                    // formatting buttons would do nothing.
                    if (!(event.currentTarget as HTMLElement).contains(event.target as Node))
                        return;
                    if ((event.target as HTMLElement).closest('.g-md-editor')) return;
                    event.preventDefault();
                    editor.moveCursor('end');
                    editor.focus();
                }}
                onKeyDown={(event) => {
                    // Body → title handoffs. Ignore preview and the editor's own modifier combos.
                    if (preview || event.metaKey || event.ctrlKey || event.altKey) return;
                    const body = bodyRef.current;
                    // ArrowUp on the first visual line → caret to the end of the title.
                    if (
                        event.key === 'ArrowUp' &&
                        !event.shiftKey &&
                        body &&
                        isCaretOnFirstLine(body)
                    ) {
                        event.preventDefault();
                        titleRef.current?.focusAtEnd();
                        return;
                    }
                    // Backspace on the empty line opened by Enter → remove it and go up to the title.
                    if (event.key === 'Backspace' && atEmptyFirstLine(editor)) {
                        event.preventDefault();
                        removeEmptyFirstLine(editor);
                        titleRef.current?.focusAtEnd();
                    }
                }}
            >
                {preview ? (
                    <NotePreview ref={previewRef} markup={editor.getValue()} />
                ) : (
                    <MarkdownEditorView
                        settingsVisible={false}
                        stickyToolbar={false}
                        autofocus={autofocus === 'body'}
                        editor={editor}
                    />
                )}
            </div>
        </div>
    );
});
