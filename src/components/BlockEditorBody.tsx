import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';

import {isRoundTripStable} from '../markdown';
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

/**
 * The last place in the document a caret can go. Tables and images render no `.content`, so a note
 * ending in one has to fall back to its last table cell — otherwise "click below the note" landed
 * the caret at the end of the last paragraph, in the middle of the document.
 */
function lastEditable(root: HTMLElement | null): HTMLElement | null {
    const candidates = root?.querySelectorAll<HTMLElement>('.block .content, .table-cell-content');
    return candidates?.[candidates.length - 1] ?? null;
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
        /**
         * Set when a hand-edit in the raw view made the note unrepresentable, so the blocks surface
         * stays shut even though `forceSource` (computed from the file as loaded) says otherwise.
         * Released as soon as the buffer round-trips again, and reset on a note switch — by hand,
         * because this component is NOT keyed and outlives one (same reason `markup` persists).
         */
        const [stuckOnSource, setStuckOnSource] = useState(false);
        const source = markup || forceSource || stuckOnSource;

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
            // Per-note, unlike `markup`: the next note's representability is decided by its own
            // `forceSource`. This component is NOT keyed, so it has to be cleared by hand — guarded
            // because a render-phase dispatch has no eager bailout and would re-render every open.
            if (stuckOnSource) setStuckOnSource(false);
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

        /**
         * Grow the source textarea to its content, so the PANE scrolls it — exactly as it scrolls
         * the blocks.
         *
         * A textarea doesn't size itself, and a fixed box inside a scrolling pane gives a long note
         * two scrollbars and one usable screenful: flipping to source on a 180-line note showed its
         * first 20 lines with the rest reachable only by scrolling inside the box, while the pane
         * below it sat empty. The two surfaces read as different notes.
         */
        const autosize = useCallback(() => {
            const element = markupRef.current;
            if (!element) return;
            // Both writes are load-bearing: `auto` is what lets the box SHRINK, so the measurement
            // that follows has to be written back even when it matches — skipping it leaves the
            // textarea at its default two rows.
            element.style.height = 'auto';
            element.style.height = `${element.scrollHeight}px`;
        }, []);

        // On the way in, and whenever the box's WIDTH changes — a resized window, a dragged divider
        // or a different text width all re-wrap the text, which is what decides the height.
        useLayoutEffect(() => {
            if (!source) return undefined;
            autosize();
            const element = markupRef.current;
            if (!element?.parentElement || typeof ResizeObserver === 'undefined') return undefined;
            let lastWidth = element.clientWidth;
            // The PARENT is observed, never the textarea: observing the element whose height this
            // callback sets is a feedback loop.
            const observer = new ResizeObserver(() => {
                const width = element.clientWidth;
                if (width === lastWidth) return;
                lastWidth = width;
                autosize();
            });
            observer.observe(element.parentElement);
            return () => observer.disconnect();
        }, [source, sessionId, autosize]);

        const toggleSourceMode = () => {
            if (forceSource) return;
            if (markup && !isRoundTripStable(bufferRef.current)) {
                setStuckOnSource(true);
                return;
            }
            // Representable again — release the latch, or `source` would stay true underneath a
            // flipped `markup` and the blocks surface would never come back.
            setStuckOnSource(false);
            setMarkup((on) => !on);
        };

        useImperativeHandle(ref, () => ({
            focus() {
                // In preview the editor is still MOUNTED (so it keeps its undo history) but hidden,
                // and a hidden element cannot take focus — `focus()` was therefore a silent no-op
                // and committing a note while previewing left focus on the list. The preview
                // surface is what is on screen, so that is what gets it.
                if (preview) {
                    previewRef.current?.focus({preventScroll: true});
                    return;
                }
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
             *
             * The way BACK is guarded separately. `forceSource` is decided once per load, from the
             * file on disk, but the textarea is fully editable — so a note that loaded clean can be
             * given frontmatter, an H4 or a fenced language here, and re-entering blocks would parse
             * that, drop what it can't hold, and autosave the loss. Re-check the LIVE buffer (the
             * exact bytes about to reach the parser) and latch onto source when it won't survive.
             *
             * Deliberately checked HERE rather than by re-keying the pane's memo on `note.content`:
             * that would re-run a full parse + re-serialize on every autosave, still miss an edit
             * made inside the 500 ms debounce, and — because the blocks surface can itself emit
             * text the guard rejects (a soft break before a line starting `---`, `- `, `#`) — could
             * flip the surface out from under a caret mid-typing.
             */
            toggleMode: toggleSourceMode,
            moveCursorToStart() {
                // Source mode is a textarea, not blocks — without this branch every caret handoff
                // silently did nothing for exactly the notes that fall back to it, which is the
                // largest group of all. Arrowing down from the title left the caret wherever the
                // browser had last put it.
                const markup = markupRef.current;
                if (source && markup) {
                    markup.setSelectionRange(0, 0);
                    return;
                }
                const target = firstContent(rootRef.current);
                if (target) placeCaret(target, 'start');
            },
            moveCursorEnd() {
                const markup = markupRef.current;
                if (source && markup) {
                    markup.setSelectionRange(markup.value.length, markup.value.length);
                    return;
                }
                // The LAST block, not the last `.content`: a table renders `.table-cell-content` and
                // an image renders a `<figure>`, so a note ending in either put the caret at the end
                // of the last PARAGRAPH — above them — when the user clicked below the note.
                const last = lastEditable(rootRef.current);
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
                const markup = markupRef.current;
                if (source && markup) {
                    // In source mode the equivalent is the caret at the very start of an empty
                    // first line, which is what makes Backspace mean "leave for the title".
                    if (document.activeElement !== markup) return false;
                    // Collapsed, or ⌘A on a note whose first line is blank also starts at 0 — and
                    // the pane would then hand Backspace to the title instead of deleting the
                    // selection, swallowing a select-all-and-delete entirely.
                    if (markup.selectionStart !== markup.selectionEnd) return false;
                    return markup.selectionStart === 0 && markup.value.split('\n')[0] === '';
                }
                const first = firstContent(rootRef.current);
                if (!first || document.activeElement !== first) return false;
                if (window.getSelection()?.isCollapsed === false) return false;
                return (first.textContent ?? '') === '';
            },
            removeEmptyFirstLine() {
                // The first line is empty and the caret is leaving for the title; both surfaces keep
                // their content, so there is nothing to remove — blur so the caret does not linger
                // in a surface the user has left.
                if (source) markupRef.current?.blur();
                else firstContent(rootRef.current)?.blur();
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

        // Raw Markdown: a plain textarea over the same buffer. Deliberately not CodeMirror — this is
        // the "just let me see the file" escape hatch (and the safe surface for a note the block
        // model can't hold), so being dependency-free outweighs syntax highlighting.
        if (source) {
            return (
                <div ref={rootRef} className="block-editor-source">
                    {forceSource || stuckOnSource ? (
                        <p className="block-editor-source__notice">
                            {stuckOnSource
                                ? 'Your edits here are Markdown the block editor can’t represent — staying on source, so nothing else in the file is rewritten.'
                                : 'This note contains Markdown the block editor can’t represent — editing as source, so nothing else in the file is rewritten.'}
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
                        // Unset so it inherits Settings › Check spelling from the pane wrapper,
                        // the way the blocks surface does — the setting covers both modes.
                        defaultValue={bufferRef.current}
                        onChange={(event) => {
                            handleChange(event.target.value);
                            autosize();
                        }}
                    />
                </div>
            );
        }

        // Preview renders the LIVE buffer (what is on screen), not what is on disk, so ⌘⇧P shows
        // unsaved edits — and the editor stays MOUNTED behind it, merely hidden.
        //
        // Replacing it outright cost the whole undo history: ⌘⇧P and back unmounted the editor, so
        // ⌘Z no longer undid anything typed before the toggle, and the caret was restored from
        // whatever `initialCaret` held at the last note switch rather than from where the user
        // actually was. Preview is read-only, so the buffer cannot move underneath it and the
        // mounted editor stays correct. The SOURCE view above is different and still remounts: the
        // textarea can rewrite the buffer, and the editor only reads `value` at mount.
        return (
            <>
                {preview ? <NotePreview ref={previewRef} markup={bufferRef.current} /> : null}
                <div ref={rootRef} style={preview ? {display: 'none'} : undefined}>
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
                        scrollContainerRef={scrollContainerRef}
                        // `display: none` hides the editor's own subtree, but its menus portal to
                        // `<body>` — they need telling.
                        hidden={preview}
                    />
                </div>
            </>
        );
    },
);
