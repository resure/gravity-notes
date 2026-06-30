import {forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';

import {MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';
import {EditorState} from 'prosemirror-state';
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
    /** Move keyboard focus into the editor body. */
    focus(): void;
}

interface EditorPaneProps {
    note: Note;
    /**
     * Focus intent on a note switch: the body (a commit), the title (a new note), or none (a browse).
     * Honored once per {@link sessionId} change (the shell no longer remounts, so focus is driven by
     * an effect rather than a remount).
     */
    autofocus: 'body' | 'title' | null;
    /** Bumped by `useNotes` on a real note switch / disk reload. Keys the title, drives focus. */
    sessionId: number;
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
    /** Gravity icon component name for the open note; absent = default File icon. */
    icon?: string;
    /** Called when the user picks or clears an icon from the title area. */
    onSetIcon: (name: string) => void;
}

/** Imperative surface the shell uses to drive the editor body. */
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
    /** Read-only preview mode (⌘⇧P) — renders the LIVE buffer, not disk. */
    preview: boolean;
    onChange: (markup: string) => void;
    onUploadFile: (file: File) => Promise<string>;
    wikiNotes: NoteMeta[];
    onOpenWikiLink: (target: string) => void;
}

/**
 * The WYSIWYG/Markdown editor, reused across note switches (the perf win: no ProseMirror
 * schema/view/plugin rebuild per note). Created once; on a switch the content is swapped in place via
 * `editor.replace()`, then the undo history is HARD-RESET so ⌘Z can't drag the previous note's text
 * into the new one (which the change handler would then autosave — silent cross-note corruption). The
 * editor's own `replace()`/`clear()` only push a normal transaction, so the reset has to reach into
 * ProseMirror: a fresh `EditorState` over the same doc + plugins gives an empty history. The wiki
 * extension's view ref is the one handle we have on the live `EditorView`.
 *
 * In `preview` mode the body is a read-only render of the editor's CURRENT (possibly unsaved) value
 * (not the on-disk `note.content`), so previewing mid-edit shows the live buffer.
 */
const EditorBody = forwardRef<EditorBodyHandle, EditorBodyProps>(function EditorBody(
    {note, preview, onChange, onUploadFile, wikiNotes, onOpenWikiLink},
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
    // True while a note-switch content swap is in flight (replace + history reset), so the change
    // handler treats the load echo (and any echo from the state reset) as a load, not a user edit.
    const swappingRef = useRef(false);

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
            // A note-switch load echo (the replace, and possibly the history-reset state swap). The
            // editor's serialize(parse(content)) round-trip can legitimately differ from the on-disk
            // content (whitespace / &nbsp; / trailing-newline normalization), so suppress the echo
            // UNCONDITIONALLY during a swap — never let it reach the autosave, or it would re-serialize
            // the note to disk and bump its updatedAt (which reorders the list under "Updated" sort).
            if (swappingRef.current) return;
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

    // Swap the editor's content on a note switch (or disk reload). Skipped when the content is
    // unchanged — a rename rekeys the note in place without touching the body, so the caret/scroll
    // survive. On a real switch: replace, then HARD-RESET the undo history so ⌘Z stays within this
    // note (see the class comment). `swappingRef` brackets the synchronous emits from both so the
    // change handler treats them as a load echo, never a user edit (see handleChange).
    useEffect(() => {
        if (editor.getValue() === note.content) return;
        swappingRef.current = true;
        editor.replace(note.content);
        resetHistory();
        swappingRef.current = false;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- swap only when the body actually changes
    }, [note.content]);

    /** Drop the whole undo stack by re-creating the EditorState over the current doc + plugins. */
    function resetHistory() {
        const view = wikiViewRef.current;
        if (!view) return;
        view.updateState(EditorState.create({doc: view.state.doc, plugins: view.state.plugins}));
    }

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
                <MarkdownEditorView settingsVisible={false} stickyToolbar={false} editor={editor} />
            )}
            <WikiLinkSuggest state={wikiSuggest} />
            <WikiLinkTooltip state={wikiTooltip} notes={wikiNotes} currentId={note.id} />
        </>
    );
});

/**
 * The open-note surface: an editable title above the Gravity markdown editor body. The pane no longer
 * remounts on a note switch (that rebuild was the lag on a large vault); instead the editor instance is
 * reused and its content swapped in place (see {@link EditorBody}). `NoteTitle` is still keyed by
 * `sessionId`, so it remounts on a real switch / disk reload — keeping its dirty-draft commit-on-unmount
 * safety net correct (a half-typed rename on the outgoing note is committed to THAT note, and a rename,
 * which doesn't bump the session, doesn't remount it). `preview` (⌘⇧P) renders the editor's LIVE buffer
 * read-only.
 */
export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane(
    {
        note,
        autofocus,
        sessionId,
        preview = false,
        onChange,
        onRename,
        onEscape,
        onUploadFile,
        wikiNotes,
        onOpenWikiLink,
        icon,
        onSetIcon,
    },
    ref,
) {
    const titleRef = useRef<NoteTitleHandle>(null);
    const bodyRef = useRef<EditorBodyHandle>(null);
    const bodyWrapRef = useRef<HTMLDivElement>(null);
    // Read the latest autofocus inside the session-driven focus effect without re-running it per change.
    const autofocusRef = useRef(autofocus);
    autofocusRef.current = autofocus;

    useImperativeHandle(
        ref,
        () => ({
            toggleMode() {
                bodyRef.current?.toggleMode();
            },
            focus() {
                bodyRef.current?.focus();
            },
        }),
        [],
    );

    // The pane no longer remounts on a switch, so focus intent is honored here, once per session
    // change (a commit → body, a new note → title; a browse → nothing, focus stays in the list).
    // `sessionId` is set by `useNotes.open`/`reloadDisk` right after `autofocus` is armed by navigation.
    useEffect(() => {
        if (autofocusRef.current === 'body') bodyRef.current?.focus();
        else if (autofocusRef.current === 'title') {
            titleRef.current?.focus();
            titleRef.current?.select();
        }
    }, [sessionId]);

    // Title → body: put the caret at the start of the body and focus it. In preview mode, focus the
    // preview surface instead (the body editor isn't shown).
    const goToBody = () => {
        if (preview) {
            bodyRef.current?.focusPreview();
            return;
        }
        bodyRef.current?.moveCursorToStart();
        bodyRef.current?.focus();
    };

    // Enter from the title: open a fresh empty line at the top of the body and land on it. Falls back
    // to the body start when the ProseMirror view isn't reachable (Markup mode). In preview, focus the
    // preview surface.
    const enterToBody = () => {
        if (preview) {
            bodyRef.current?.focusPreview();
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
                key={sessionId}
                title={note.title}
                icon={icon}
                onSetIcon={onSetIcon}
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
                    // Preview mode is read-only — no click handling.
                    if (preview) return;
                    // A click in the empty area around/below the editor (its bottom padding, or the body
                    // grown taller than a short note) drops the caret at the very end. Clicks on the
                    // editable content itself fall through to the editor.
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
                    // Body → title handoffs. Ignore preview and the editor's own modifier combos.
                    if (preview || event.metaKey || event.ctrlKey || event.altKey) return;
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
                <EditorBody
                    ref={bodyRef}
                    note={note}
                    preview={preview}
                    onChange={onChange}
                    onUploadFile={onUploadFile}
                    wikiNotes={wikiNotes}
                    onOpenWikiLink={onOpenWikiLink}
                />
            </div>
        </div>
    );
});
