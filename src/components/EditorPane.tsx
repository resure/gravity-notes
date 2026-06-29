import {forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';

import {MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';
import type {EditorView} from 'prosemirror-view';

import type {Note, NoteMeta} from '../storage/types';

import {NotePreview} from './NotePreview';
import {NoteTitle, type NoteTitleHandle} from './NoteTitle';
import {WikiLinkSuggest} from './editor/WikiLinkSuggest';
import {WikiLinkTooltip} from './editor/WikiLinkTooltip';
import {attachmentImageExtension} from './editor/attachmentImageExtension';
import {openLinkExtension} from './editor/openLinkExtension';
import {
    type WikiLinkSuggestState,
    type WikiLinkTooltipState,
    refreshWikiLinks,
    wikiLinkExtension,
} from './editor/wikiLinkExtension';
import {atEmptyFirstLine, openLineAbove, removeEmptyFirstLine} from './editorBody';
import {isCaretOnFirstLine} from './editorCaret';

import './EditorPane.css';

export interface EditorPaneHandle {
    /** Flip between the WYSIWYG and Markup editing modes. */
    toggleMode(): void;
    /** Move keyboard focus into the editor body (mounting it first if only a preview is shown). */
    focus(): void;
}

interface EditorPaneProps {
    note: Note;
    /** Focus intent on (re)mount: the body (a commit), the title (a new note), or none (a browse). */
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
    /** Every note (id + title), for `[[wiki link]]` resolution, the `[[` picker, and broken-state styling. */
    wikiNotes: NoteMeta[];
    /** Follow a `[[link]]` (⌘/Ctrl-click): resolve the title to a note and open it, creating it if missing. */
    onOpenWikiLink: (target: string) => void;
}

/** Imperative surface the shell uses to drive the (lazily-mounted) editor body. */
interface EditorBodyHandle {
    focus(): void;
    toggleMode(): void;
    moveCursorToStart(): void;
    moveCursorEnd(): void;
    /** Open a fresh empty line at the top of the body; false when the view isn't reachable (Markup mode). */
    openLineAbove(): boolean;
    atEmptyFirstLine(): boolean;
    removeEmptyFirstLine(): void;
    /** Focus the read-only preview surface shown in preview mode (the Esc ladder's target). */
    focusPreview(): void;
}

interface EditorBodyProps {
    note: Note;
    /** Focus the body once, on mount (a commit / click-to-edit / follow-link). */
    focusBody: boolean;
    /** Read-only preview mode (⌘⇧P) within an editing session — renders the LIVE buffer, not disk. */
    preview: boolean;
    onChange: (markup: string) => void;
    onUploadFile: (file: File) => Promise<string>;
    wikiNotes: NoteMeta[];
    onOpenWikiLink: (target: string) => void;
}

/**
 * The heavy WYSIWYG/Markdown editor, split out so the shell can leave it UNMOUNTED while a note is
 * merely browsed (a `NotePreview` is shown instead — far cheaper than rebuilding ProseMirror). It
 * mounts the moment the user commits to editing (Enter / click-into-body / follow-link). Created
 * once per editing session; the shell keys the whole pane by `useNotes.sessionId`, so switching
 * notes remounts the shell (and drops this editor) — exactly the cost we now skip while browsing.
 *
 * In `preview` mode the body is a read-only render of the editor's CURRENT (possibly unsaved) value
 * (not the on-disk `note.content`), so previewing mid-edit shows the live buffer.
 */
const EditorBody = forwardRef<EditorBodyHandle, EditorBodyProps>(function EditorBody(
    {note, focusBody, preview, onChange, onUploadFile, wikiNotes, onOpenWikiLink},
    ref,
) {
    // Stable across the editor's life; read latest via a ref so the upload handler — captured once in
    // useMarkdownEditor's []-deps — always calls the current one.
    const uploadRef = useRef(onUploadFile);
    uploadRef.current = onUploadFile;

    // Same trick for the wiki-link extension (also captured once): the notes list, the open note's id
    // (which can change in place on rename), and the follow-link handler are all read live via refs.
    const wikiNotesRef = useRef(wikiNotes);
    wikiNotesRef.current = wikiNotes;
    const noteIdRef = useRef(note.id);
    noteIdRef.current = note.id;
    const onOpenWikiLinkRef = useRef(onOpenWikiLink);
    onOpenWikiLinkRef.current = onOpenWikiLink;
    const wikiViewRef = useRef<EditorView | null>(null);
    const [wikiSuggest, setWikiSuggest] = useState<WikiLinkSuggestState | null>(null);
    const [wikiTooltip, setWikiTooltip] = useState<WikiLinkTooltipState | null>(null);

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
                    wikiLinkExtension(builder, {
                        getNotes: () => wikiNotesRef.current,
                        getCurrentId: () => noteIdRef.current,
                        onOpen: (target) => onOpenWikiLinkRef.current(target),
                        viewRef: wikiViewRef,
                        onSuggest: setWikiSuggest,
                        onTooltip: setWikiTooltip,
                    });
                },
            },
        },
        [],
    );

    const previewRef = useRef<HTMLDivElement>(null);
    // The editor emits a no-op 'change' as the initial markup loads; suppress only that FIRST emit,
    // not every value that equals the original — otherwise undoing back to the loaded content within
    // the autosave window leaves a stale pending edit that writes the pre-undo value to disk.
    const settledRef = useRef(false);

    useImperativeHandle(
        ref,
        () => ({
            focus() {
                editor.focus();
            },
            toggleMode() {
                editor.setEditorMode(editor.currentMode === 'wysiwyg' ? 'markup' : 'wysiwyg');
            },
            moveCursorToStart() {
                editor.moveCursor('start');
            },
            moveCursorEnd() {
                editor.moveCursor('end');
            },
            openLineAbove() {
                return openLineAbove(editor);
            },
            atEmptyFirstLine() {
                return atEmptyFirstLine(editor);
            },
            removeEmptyFirstLine() {
                removeEmptyFirstLine(editor);
            },
            focusPreview() {
                previewRef.current?.focus();
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

    // A link's broken state depends on the notes list and this note's id, neither of which is a doc
    // edit — so nudge the editor to re-evaluate them whenever that set changes (e.g. the target note
    // is created or renamed). Cheap: it only re-scans this note's own `[[links]]`.
    //
    // Fingerprint the id set, but key the memo on `wikiNotes` ALONE (not `note.id`): the list array
    // gets a fresh identity only when notes are actually created/renamed/moved/deleted, so the O(N)
    // join runs then — never on a plain note switch (which changes `note.id`, not the list). The effect
    // still re-runs on a switch via its own `note.id` dep, reusing the already-built signature.
    const wikiIdsSignature = useMemo(() => wikiNotes.map((n) => n.id).join('\n'), [wikiNotes]);
    useEffect(() => {
        refreshWikiLinks(wikiViewRef.current);
    }, [note.id, wikiIdsSignature]);

    // Focus on mount per the focus intent: the body, or (in preview mode) the preview surface. The
    // title-focus case is handled by the shell (the title lives there); here `focusBody` is false for
    // a title autofocus, so the body is left unfocused.
    useEffect(() => {
        if (!focusBody) return;
        if (preview) previewRef.current?.focus();
        else editor.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- focus only on mount
    }, [editor]);

    // Move focus when preview is toggled within a note: onto the preview on enter, back to the
    // body on exit, so the Esc ladder keeps working.
    const prevPreviewRef = useRef(preview);
    useEffect(() => {
        if (preview === prevPreviewRef.current) return;
        prevPreviewRef.current = preview;
        if (preview) previewRef.current?.focus();
        else editor.focus();
    }, [preview, editor]);

    return (
        <>
            {preview ? (
                <NotePreview ref={previewRef} markup={editor.getValue()} />
            ) : (
                <MarkdownEditorView
                    settingsVisible={false}
                    stickyToolbar={false}
                    autofocus={focusBody}
                    editor={editor}
                />
            )}
            <WikiLinkSuggest state={wikiSuggest} />
            <WikiLinkTooltip state={wikiTooltip} notes={wikiNotes} currentId={note.id} />
        </>
    );
});

/**
 * The open-note surface: an editable title above either the Gravity markdown editor body (while
 * editing) or a cheap read-only `NotePreview` (while merely browsing). The editor is the expensive
 * part — parsing the note into a ProseMirror doc and rendering a DOM node per block — so it's mounted
 * ONLY when the user is actually editing: on a commit (Enter / ⌘J-in), a click-into-body, or a
 * follow-link. Browsing (arrows / single click / scope-flip) shows `NotePreview` from `note.content`
 * instead, so flying through a large vault no longer rebuilds the editor per note.
 *
 * `autofocus` drives the initial mode: `'body'`/`'title'` (a commit / new note) mounts the editor at
 * once; `null` (a browse) shows the preview. The shell is keyed by `useNotes.sessionId`, so a real
 * note switch remounts it (re-deriving the mode) — but a rename, which changes `note.id` in place,
 * does not, keeping the caret during the title→body handoff. `preview` (⌘⇧P) renders the editor's
 * LIVE buffer read-only; while browsing it just keeps the preview.
 */
export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane(
    {
        note,
        autofocus,
        preview = false,
        onChange,
        onRename,
        onEscape,
        onUploadFile,
        wikiNotes,
        onOpenWikiLink,
    },
    ref,
) {
    // Editing = the heavy editor is mounted. Derived from the focus intent on (re)mount: a commit or
    // new note mounts it at once; a browse (null) shows the preview until the user starts editing.
    const [editing, setEditing] = useState(autofocus !== null);
    // Whether to focus the body once the editor mounts (a commit, a click-into-body, a follow-link).
    const [focusBody, setFocusBody] = useState(autofocus === 'body');

    const titleRef = useRef<NoteTitleHandle>(null);
    const bodyRef = useRef<EditorBodyHandle>(null);
    const bodyWrapRef = useRef<HTMLDivElement>(null);
    // The preview surface shown while browsing (focus target for the title→body handoff in preview).
    const browsePreviewRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(
        ref,
        () => ({
            toggleMode() {
                bodyRef.current?.toggleMode();
            },
            focus() {
                // Already editing: focus the live body. Browsing: mount the editor (focused) on demand —
                // this is the path a commit-on-the-already-open note and a follow-link-to-a-new-note take.
                if (editing) bodyRef.current?.focus();
                else {
                    setFocusBody(true);
                    setEditing(true);
                }
            },
        }),
        [editing],
    );

    // Focus the title on mount when the intent was a new note (the body editor mounts unfocused).
    useEffect(() => {
        if (autofocus === 'title') {
            titleRef.current?.focus();
            titleRef.current?.select();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- focus only on mount
    }, []);

    /** Mount the editor (focused at the body start) — used when the user starts editing a browsed note. */
    const startEditing = () => {
        setFocusBody(true);
        setEditing(true);
    };

    /** Focus the read-only preview surface currently shown (EditorBody's in an edit session, the
     * browse preview otherwise) — the target of the title→body handoff while previewing. */
    const focusPreviewSurface = () => {
        if (editing) bodyRef.current?.focusPreview();
        else browsePreviewRef.current?.focus();
    };

    // Title → body: put the caret at the start of the body and focus it. While browsing, enter edit
    // mode first (the body editor isn't mounted yet). In preview mode, focus the preview surface.
    const goToBody = () => {
        if (preview) {
            focusPreviewSurface();
            return;
        }
        if (!editing) {
            startEditing();
            return;
        }
        bodyRef.current?.moveCursorToStart();
        bodyRef.current?.focus();
    };

    // Enter from the title: open a fresh empty line at the top of the body and land on it. While
    // browsing, just enter edit mode at the body start (no line to open above yet). In preview, focus
    // the preview surface. Falls back to the body start when the ProseMirror view isn't reachable.
    const enterToBody = () => {
        if (preview) {
            focusPreviewSurface();
            return;
        }
        if (!editing) {
            startEditing();
            return;
        }
        if (!bodyRef.current?.openLineAbove()) {
            bodyRef.current?.moveCursorToStart();
            bodyRef.current?.focus();
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
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- captures ArrowUp/Backspace handoffs and empty-area clicks; the editor inside is the interactive element */}
            <div
                ref={bodyWrapRef}
                className="editor-pane__body"
                onMouseDown={(event) => {
                    // Preview mode is read-only — no click handling (the editor/preview isn't editable).
                    if (preview) return;
                    // Browsing: a click anywhere in the body area enters edit mode (mounts the editor).
                    if (!editing) {
                        event.preventDefault();
                        startEditing();
                        return;
                    }
                    // Editing: a click in the empty area around/below the editor (its bottom padding, or
                    // the body grown taller than a short note) drops the caret at the very end. Clicks on
                    // the editable content itself fall through to the editor.
                    // The selection formatting toolbar renders in a portal (outside this subtree), but its
                    // mousedown still bubbles here via React's portal event propagation. Only act on clicks
                    // that are real DOM descendants of the body wrapper; otherwise the moveCursor('end')
                    // below would collapse the active selection and the toolbar's formatting buttons would
                    // do nothing.
                    if (!(event.currentTarget as HTMLElement).contains(event.target as Node))
                        return;
                    if ((event.target as HTMLElement).closest('.g-md-editor')) return;
                    event.preventDefault();
                    bodyRef.current?.moveCursorEnd();
                    bodyRef.current?.focus();
                }}
                onKeyDown={(event) => {
                    // Body → title handoffs. Ignore preview, browse (no editor mounted), and the editor's
                    // own modifier combos.
                    if (preview || !editing || event.metaKey || event.ctrlKey || event.altKey)
                        return;
                    const body = bodyWrapRef.current;
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
                    if (event.key === 'Backspace' && bodyRef.current?.atEmptyFirstLine()) {
                        event.preventDefault();
                        bodyRef.current?.removeEmptyFirstLine();
                        titleRef.current?.focusAtEnd();
                    }
                }}
            >
                {editing ? (
                    <EditorBody
                        ref={bodyRef}
                        note={note}
                        focusBody={focusBody}
                        preview={preview}
                        onChange={onChange}
                        onUploadFile={onUploadFile}
                        wikiNotes={wikiNotes}
                        onOpenWikiLink={onOpenWikiLink}
                    />
                ) : (
                    <NotePreview ref={browsePreviewRef} markup={note.content} />
                )}
            </div>
        </div>
    );
});
