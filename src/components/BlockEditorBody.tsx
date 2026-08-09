import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';

import type {Note, NoteMeta} from '../storage/types';

import {NotePreview} from './NotePreview';
import BlockEditor, {type EditorCaret, type EditorHandle} from './blockEditor/Editor';

/**
 * The Notion-style block editor as `EditorPane`'s note body. It implements the imperative contract
 * the pane drives — title, preview badge, Esc ladder, backlinks are all the pane's business, not
 * this component's.
 *
 * The editor reads its document once per editing session, so this component is keyed on `sessionId`
 * by its parent and simply remounts on a note switch: a fresh document, caret, and undo history per
 * note. What a remount would otherwise lose — where you were in the note — is carried across in
 * {@link viewStateByIdRef}.
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
    /** Every note (id + title), for `[[wiki link]]` resolution, the `[[` picker, and broken styling. */
    wikiNotes: NoteMeta[];
    /** Follow a `[[wiki link]]` (⌘↵ on the caret, or ⌘-click) — the shell resolves the title. */
    onOpenWikiLink: (target: string) => void;
    /** Focus the body on this session's first mount (the pane's focus ladder). */
    autofocus?: 'body' | 'title' | null;
    /** ArrowUp / Backspace off the top of the body — hand focus to the note title above. */
    onLeaveTop?: () => void;
    /** Escape with nothing left in the editor to dismiss — the pane walks focus back to the list. */
    onEscape?: () => void;
    /**
     * This note's Markdown holds something the block model can't reproduce byte-for-byte (see
     * `isRoundTripStable`). The session opens on the raw source instead, with a one-line notice:
     * still fully editable, but nothing is re-serialized, so the file is left exactly as it is.
     */
    forceSource?: boolean;
    /**
     * The pane's scroll container, so a note switch can save and restore where in the note you
     * were. The pane scrolls, not the editor, so this can't be read from inside.
     */
    scrollContainerRef?: React.RefObject<HTMLElement>;
}

/** Where the reader was in a note, restored when they come back to it. */
interface ViewState {
    scrollTop: number;
    caret: EditorCaret | null;
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
        {
            note,
            sessionId,
            preview,
            autofocus,
            wikiNotes,
            onChange,
            onUploadFile,
            onOpenWikiLink,
            onLeaveTop,
            onEscape,
            forceSource = false,
            scrollContainerRef,
        },
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
        // the hand-edited text through its `value` initializer — on the way back. The flag is the
        // USER's choice and deliberately survives a note switch; `forceSource` is orthogonal and
        // wins, so a note the block model can't hold is never shown in blocks whatever the flag says.
        const [markup, setMarkup] = useState(false);
        const source = markup || forceSource;

        // Per-note scroll + caret, keyed by note id: the editor is REBUILT per note (see the class
        // comment), so without this every switch back to a note reopened it at the top with the
        // caret in block one. Kept in a ref — UI-restoration state, never rendered.
        const viewStateByIdRef = useRef<Map<string, ViewState>>(new Map());
        const restoreRef = useRef<ViewState | null>(viewStateByIdRef.current.get(note.id) ?? null);

        // This component outlives a note switch (the pane is not keyed), so the buffer has to be
        // re-seeded when the session changes — otherwise the editor, the preview, and the markup
        // textarea would all open on the PREVIOUS note's text. Done in render, BEFORE the keyed
        // child unmounts, which is also the only moment the outgoing note's caret is still readable.
        const sessionRef = useRef(sessionId);
        const noteIdRef = useRef(note.id);
        if (sessionRef.current !== sessionId) {
            viewStateByIdRef.current.set(noteIdRef.current, {
                scrollTop: scrollContainerRef?.current?.scrollTop ?? 0,
                caret: editorRef.current?.getCaret() ?? null,
            });
            sessionRef.current = sessionId;
            restoreRef.current = viewStateByIdRef.current.get(note.id) ?? null;
            bufferRef.current = note.content;
        } else if (noteIdRef.current !== note.id) {
            // A rename/move re-keys the open note in place (id changes, session doesn't) — carry
            // its saved position to the new id so a later switch-and-back still restores it.
            const saved = viewStateByIdRef.current.get(noteIdRef.current);
            if (saved) {
                viewStateByIdRef.current.set(note.id, saved);
                viewStateByIdRef.current.delete(noteIdRef.current);
            }
        }
        noteIdRef.current = note.id;

        // Restore the scroll after the remounted editor has laid out. The caret is restored by the
        // editor itself (it owns focus), from `initialCaret` below.
        useLayoutEffect(() => {
            const container = scrollContainerRef?.current;
            if (container) container.scrollTop = restoreRef.current?.scrollTop ?? 0;
            // eslint-disable-next-line react-hooks/exhaustive-deps -- once per editing session
        }, [sessionId]);

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
                if (source) markupRef.current?.focus();
                else editorRef.current?.focus();
            },
            /**
             * ⌘⇧; — swap the blocks for the raw Markdown they serialize to, and back. A no-op while
             * `forceSource` holds: that note is on source precisely because the block surface would
             * rewrite it.
             */
            toggleMode() {
                if (!forceSource) setMarkup((on) => !on);
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
            /** Enter from the title: open a fresh empty block above everything and land on it. */
            openLineAbove() {
                if (source || !editorRef.current) return false;
                editorRef.current.insertBlockAtTop();
                return true;
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

        // Move focus when preview is toggled, the same handoff the pane expects. Leaving preview has
        // to put the caret back or the user must click before they can type. `preventScroll` is
        // load-bearing for the same reason it is in EditorPane.
        const prevPreviewRef = useRef(preview);
        useEffect(() => {
            if (preview === prevPreviewRef.current) return;
            prevPreviewRef.current = preview;
            if (preview) previewRef.current?.focus({preventScroll: true});
            else if (source) markupRef.current?.focus();
            else editorRef.current?.focus();
        }, [preview, source]);

        // Preview renders the LIVE buffer (what is on screen), not what is on disk, so ⌘⇧P shows
        // unsaved edits.
        if (preview) {
            return <NotePreview ref={previewRef} markup={bufferRef.current} />;
        }

        // Raw Markdown: a plain textarea over the same buffer. Deliberately not CodeMirror — this is
        // the "just let me see the file" escape hatch (and the safe surface for a note the block
        // model can't hold), so being dependency-free outweighs syntax highlighting.
        if (source) {
            return (
                <div ref={rootRef} className="block-editor-source">
                    {forceSource ? (
                        <p className="block-editor-source__notice">
                            This note contains Markdown the block editor can’t represent — editing
                            as source, so nothing else in the file is rewritten.
                        </p>
                    ) : null}
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
                    initialCaret={restoreRef.current?.caret ?? null}
                    notes={wikiNotes}
                    noteId={note.id}
                    onChange={handleChange}
                    onWikiLinkNavigate={onOpenWikiLink}
                    // Swallowing to null keeps the insert loop simple (it skips the file), and is
                    // only acceptable because `Workspace.handleUploadFile` has already surfaced the
                    // failure through the toaster — without that, a failed drop was completely silent.
                    onAttachFile={(file) => onUploadFile(file).catch(() => null)}
                    onLeaveTop={onLeaveTop}
                    onEscape={onEscape}
                />
            </div>
        );
    },
);
