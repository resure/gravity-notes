import {forwardRef, useEffect, useImperativeHandle, useMemo, useRef} from 'react';

import {isRoundTripStable} from '../markdown';
import type {Note, NoteMeta} from '../storage/types';

import {BlockEditorBody, type BlockEditorBodyHandle} from './BlockEditorBody';
import {NoteTitle, type NoteTitleHandle} from './NoteTitle';
import {isCaretOnFirstLine} from './editorCaret';

import './EditorPane.css';

export interface EditorPaneHandle {
    /** Flip between the blocks and the raw Markdown behind them (⌘⇧;). */
    toggleMode(): void;
    /** Move keyboard focus into the editor body. */
    focus(): void;
    /**
     * Rename the OPEN note: focus its title field and select it. The note-list's inline rename can't
     * serve this — the open note need not be in the (searched, folder-scoped) list at all — and the
     * title is where this note's name already lives.
     */
    renameTitle(): void;
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
}

/**
 * The open-note surface: an editable title above the block editor body. The pane doesn't remount on a
 * note switch — `BlockEditorBody` is keyed on `sessionId` internally, so only the body is rebuilt.
 * `NoteTitle` is keyed the same way, keeping its dirty-draft commit-on-unmount safety net correct (a
 * half-typed rename on the outgoing note is committed to THAT note, and a rename, which doesn't bump
 * the session, doesn't remount it). `preview` (⌘⇧P) renders the editor's LIVE buffer read-only.
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
    },
    ref,
) {
    const titleRef = useRef<NoteTitleHandle>(null);
    const bodyRef = useRef<BlockEditorBodyHandle>(null);
    const bodyWrapRef = useRef<HTMLDivElement>(null);
    /**
     * The block engine re-serializes the WHOLE note on every keystroke, so it may only hold a note
     * whose Markdown survives a parse/serialize cycle byte-for-byte. When it doesn't — Obsidian
     * frontmatter, a heading deeper than H3, a construct the small line-oriented parser reads
     * imperfectly — editing in blocks would rewrite parts of the file the user never touched. Open
     * that note on its raw source instead: still fully editable, but nothing re-serializes it, so
     * the file is left exactly as it is.
     *
     * Keyed on the CONTENT it is checking, not on the session counter: this is the safety property
     * the whole blocks surface rests on, and binding it to a counter meant it held only while every
     * path that replaces `note.content` also happens to bump `sessionId`. Nothing enforced that.
     * Typing doesn't re-run it — keystrokes go to a ref and a timer, never back into `note`.
     */
    const blocksSafe = useMemo(() => isRoundTripStable(note.content), [note.content]);
    // The vertical scroll container (see EditorPane.css); the body saves/restores its scrollTop per
    // note so a switch doesn't carry the previous note's scroll over.
    const paneRef = useRef<HTMLDivElement>(null);
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
            renameTitle() {
                // Focus AND select: `select()` alone highlights the text without claiming focus.
                titleRef.current?.focus();
                titleRef.current?.select();
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

    // Enter from the title: open a fresh empty block at the top of the body and land on it. Falls
    // back to the body start when the block editor isn't reachable (source mode). In preview, focus
    // the preview surface.
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
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the wrapper captures Escape that bubbles out of the editor body; the editor itself is the interactive element
        <div
            ref={paneRef}
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
                // No red squiggles under a note's prose. `spellcheck` INHERITS, so setting it on the
                // wrapper covers every block's contenteditable (and the source textarea) without
                // reaching into the editor itself. Notes are full of names, code and shorthand that a
                // dictionary flags anyway; the title (NoteTitle) already opts out the same way.
                spellCheck={false}
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
                    // Ignore clicks on the editor CONTENT: it lives inside the body but isn't the
                    // empty padding, so without this a click there would fall through to
                    // moveCursorEnd() and yank the caret to the end. `.gn-block-editor` owns its own
                    // empty-space click (clicking under the last block appends/focuses one there) —
                    // without it here EVERY click inside the editor pinned the caret to the first
                    // block, which made the surface unusable with a mouse. Its floating overlays
                    // need no entry: they portal to <body>, so the `contains` guard above has
                    // already returned by the time this runs.
                    if (
                        (event.target as HTMLElement).closest(
                            '.gn-block-editor, .block-editor-source',
                        )
                    )
                        return;
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
                <BlockEditorBody
                    ref={bodyRef}
                    note={note}
                    sessionId={sessionId}
                    preview={preview}
                    autofocus={autofocus}
                    wikiNotes={wikiNotes}
                    forceSource={!blocksSafe}
                    scrollContainerRef={paneRef}
                    onChange={onChange}
                    onUploadFile={onUploadFile}
                    onOpenWikiLink={onOpenWikiLink}
                    onLeaveTop={() => titleRef.current?.focusAtEnd()}
                    onEscape={onEscape}
                />
            </div>
        </div>
    );
});
