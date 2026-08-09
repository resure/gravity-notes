import {forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState} from 'react';

import type {Note} from '../storage/types';

import {NotePreview} from './NotePreview';
import BlockEditor, {type EditorHandle} from './blockEditor/Editor';

/**
 * The Notion-style block editor as a drop-in alternative to `EditorPane`'s Gravity-markdown body
 * (Settings › Editor). It implements the same imperative contract, so the surrounding pane — title,
 * icon, preview badge, Esc ladder, backlinks — is unaware of which engine is mounted.
 *
 * The engines differ in one structural way that shapes this adapter. The Gravity editor is a single
 * long-lived instance whose *content* is swapped on a note switch (which is why the pane hands it a
 * `scrollContainerRef` and it saves/restores scroll itself). The block editor instead reads its
 * document once per editing session, so this component is keyed on `sessionId` by its parent and
 * simply remounts — a fresh document, caret, and undo history per note, with no swap machinery and
 * no scroll to restore (a remount starts at the top, which is where a newly opened note belongs).
 */

export interface BlockEditorBodyHandle {
    focus(): void;
    toggleMode(): void;
    moveCursorToStart(): void;
    moveCursorEnd(): void;
    openLineAbove(): boolean;
    atEmptyFirstLine(): boolean;
    removeEmptyFirstLine(): void;
    focusPreview(): void;
}

export interface BlockEditorBodyProps {
    note: Note;
    sessionId: number;
    preview: boolean;
    onChange: (markup: string) => void;
    onUploadFile: (file: File) => Promise<string>;
    /**
     * Follow a `[[wiki link]]` (⌘↵ on the caret, or ⌘-click). The block editor stores links as
     * literal text rather than as markup, so it resolves the target by title through the shell
     * and needs no notes list of its own — unlike the Gravity body, whose extension styles broken
     * links and drives the `[[` picker.
     */
    onOpenWikiLink: (target: string) => void;
    /** Focus the body on this session's first mount (the pane's focus ladder). */
    autofocus?: 'body' | 'title' | null;
    /** ArrowUp / Backspace off the top of the body — hand focus to the note title above. */
    onLeaveTop?: () => void;
}

/** The first editable block's contentEditable, which is what the caret helpers act on. */
function firstContent(root: HTMLElement | null): HTMLElement | null {
    return root?.querySelector<HTMLElement>('.block .content') ?? null;
}

function placeCaret(element: HTMLElement, position: 'start' | 'end'): void {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(position === 'start');
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.focus();
}

export const BlockEditorBody = forwardRef<BlockEditorBodyHandle, BlockEditorBodyProps>(
    function BlockEditorBody(
        {note, sessionId, preview, autofocus, onChange, onUploadFile, onOpenWikiLink, onLeaveTop},
        ref,
    ) {
        const editorRef = useRef<EditorHandle>(null);
        const rootRef = useRef<HTMLDivElement>(null);
        const previewRef = useRef<HTMLDivElement>(null);
        const markupRef = useRef<HTMLTextAreaElement>(null);
        // The live buffer, so preview mode and the raw-Markdown mode both show what is ON SCREEN
        // rather than what is on disk.
        const bufferRef = useRef(note.content);
        // ⌘⇧; flips between the blocks and the raw Markdown behind them. Switching modes swaps the
        // rendered element type, so the block editor unmounts on the way out and remounts — reading
        // the hand-edited text through its `value` initializer — on the way back.
        const [markup, setMarkup] = useState(false);
        // This component outlives a note switch (the pane is not keyed), so the buffer has to be
        // re-seeded when the session changes — otherwise the editor, the preview, and the markup
        // textarea would all open on the PREVIOUS note's text.
        const sessionRef = useRef(sessionId);
        if (sessionRef.current !== sessionId) {
            sessionRef.current = sessionId;
            bufferRef.current = note.content;
        }

        const handleChange = useCallback(
            (markdown: string) => {
                bufferRef.current = markdown;
                onChange(markdown);
            },
            [onChange],
        );

        useImperativeHandle(ref, () => ({
            focus() {
                // Caret-preserving: the pane calls focus() after moveCursorEnd(), and on any
                // click-to-focus path. Moving to the first block whenever focus is ALREADY in the
                // body would undo both. Only place the caret when it isn't here yet.
                if (rootRef.current?.contains(document.activeElement)) return;
                if (markup) markupRef.current?.focus();
                else editorRef.current?.focus();
            },
            /** ⌘⇧; — swap the blocks for the raw Markdown they serialize to, and back. */
            toggleMode() {
                setMarkup((on) => !on);
            },
            moveCursorToStart() {
                const target = firstContent(rootRef.current);
                if (target) placeCaret(target, 'start');
            },
            moveCursorEnd() {
                const blocks = rootRef.current?.querySelectorAll<HTMLElement>('.block .content');
                const last = blocks?.[blocks.length - 1];
                if (last) placeCaret(last, 'end');
            },
            /**
             * Enter from the title. The block editor has no command for "insert a line above block
             * one", so report false and let the pane fall through to `moveCursorToStart()` +
             * `focus()`: the caret lands at the start of the note's existing first block.
             *
             * That is a real difference from the Markdown engine, which opens a FRESH line — type
             * after Enter here and the sentence merges into the first paragraph instead of becoming
             * its own. Closing the gap needs an insert-block command on `EditorHandle`.
             */
            openLineAbove() {
                return false;
            },
            /** Backspace-into-the-title only applies when the caret sits in an empty first block. */
            atEmptyFirstLine() {
                const first = firstContent(rootRef.current);
                if (!first || document.activeElement !== first) return false;
                return (first.textContent ?? '') === '';
            },
            removeEmptyFirstLine() {
                // The first block is empty and the caret is leaving for the title; the block editor
                // keeps at least one block, so there is nothing to remove — blur so the caret does
                // not linger in a surface the user has left.
                firstContent(rootRef.current)?.blur();
            },
            focusPreview() {
                previewRef.current?.focus();
            },
        }));

        // Move focus when preview is toggled, the same handoff the Gravity body does. That effect
        // lives inside `EditorBody`, which blocks mode never mounts, so ⌘⇧P here unmounted the
        // focused contentEditable and dropped focus onto <body>: the preview couldn't be scrolled
        // from the keyboard, and Escape stopped reaching the pane's ladder (falling through to
        // Workspace's activeElement fallback, so on a narrow layout `backToList()` never ran).
        // Leaving preview has to put the caret back or the user must click before they can type.
        // `preventScroll` is load-bearing for the same reason it is there — see EditorPane.
        const prevPreviewRef = useRef(preview);
        useEffect(() => {
            if (preview === prevPreviewRef.current) return;
            prevPreviewRef.current = preview;
            if (preview) previewRef.current?.focus({preventScroll: true});
            else if (markup) markupRef.current?.focus();
            else editorRef.current?.focus();
        }, [preview, markup]);

        // Preview renders the LIVE buffer (what is on screen), not what is on disk — same contract
        // as the Gravity body, and the same read-only surface, so ⌘⇧P behaves identically.
        if (preview) {
            return <NotePreview ref={previewRef} markup={bufferRef.current} />;
        }

        // Raw Markdown: a plain textarea over the same buffer. Deliberately not CodeMirror — the
        // Gravity engine already offers that, and this is the escape hatch for "just let me see the
        // file", so the value of keeping it dependency-free outweighs syntax highlighting.
        if (markup) {
            return (
                <div ref={rootRef}>
                    <textarea
                        // Keyed on the session: this is an UNCONTROLLED input, and once the user has
                        // typed in it the browser sets its dirty-value flag, after which React's
                        // `defaultValue` update is ignored (per the HTML spec). Without the key, a
                        // note switch made in markup mode would leave the PREVIOUS note's source in
                        // the box under the new note's title — and the next keystroke would save
                        // that text into the newly opened note, destroying it.
                        key={sessionId}
                        ref={markupRef}
                        className="block-editor-markup"
                        aria-label="Markdown source"
                        spellCheck={false}
                        defaultValue={bufferRef.current}
                        onChange={(event) => handleChange(event.target.value)}
                    />
                </div>
            );
        }

        return (
            <div ref={rootRef}>
                <BlockEditor
                    ref={editorRef}
                    key={sessionId}
                    value={bufferRef.current}
                    autofocus={autofocus}
                    onChange={handleChange}
                    onWikiLinkNavigate={onOpenWikiLink}
                    // Swallowing to null keeps the insert loop simple (it skips the file), and is
                    // only acceptable because `Workspace.handleUploadFile` has already surfaced the
                    // failure through the toaster — without that, a failed drop was completely silent.
                    onAttachFile={(file) => onUploadFile(file).catch(() => null)}
                    onLeaveTop={onLeaveTop}
                />
            </div>
        );
    },
);
