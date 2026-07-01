import {forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';

import {
    MarkdownEditorView,
    useMarkdownEditor,
    wHeadingListConfig,
    wSelectionMenuConfigByPreset,
} from '@gravity-ui/markdown-editor';
import {Hotkey, Icon, Select} from '@gravity-ui/uikit';
import {EditorState, Selection} from 'prosemirror-state';
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

// The selection (text-format) toolbar's first control is a block-type "Text"/H1–H6 Select. The
// bundle's WToolbarTextSelect renders it via ToolbarSelect, which wires the editor `focus()` to the
// Gravity Select's `onOpenChange` — so opening the dropdown synchronously refocuses the editor
// contenteditable, blurring the Select and snapping its menu shut before it ever shows (portaling the
// dropdown / preventing the blur don't help — the focus() call is the killer). Rather than drop the
// control, we swap in SelectionHeadingSelect below: the same heading Select minus that wiring. The
// dropdown then stays open (no focus steal); focus returns to the editor only once a heading is
// chosen, exactly like the inline Bold/Italic buttons. Rebuilt from the 'full' preset (our editor's
// default `preset`), swapping just the one item so its show/hide `condition` and the rest of the
// toolbar are untouched.
const SELECTION_MENU_CONFIG = wSelectionMenuConfigByPreset.full.map((group) =>
    group.map((item) => {
        // The text/heading Select is a ReactComponent item; narrow to it so we can replace `component`
        // without disturbing the rest of the toolbar (its `condition`, the folding toggle beside it, …).
        if (item.id === 'text' && 'component' in item) {
            return {...item, component: SelectionHeadingSelect};
        }
        return item;
    }),
);

type HeadingSelectItem = (typeof wHeadingListConfig)['data'][number];

/**
 * Block-type "Text"/H1–H6 Select for the floating selection toolbar — a local re-render of the
 * bundle's `WToolbarTextSelect` that does NOT wire the Gravity Select's `onOpenChange` to the
 * editor `focus()` (see SELECTION_MENU_CONFIG for why that wiring made the dropdown unopenable).
 * Rendered by the toolbar, which passes `editor`/`focus`/`onClick` plus the item's `props`
 * (`disablePortal`); `focus()` is invoked only after a heading is chosen, returning focus to the
 * editor so the command lands.
 */
function SelectionHeadingSelect({
    editor,
    focus,
    onClick,
    className,
    disablePortal,
}: {
    editor: Parameters<HeadingSelectItem['isActive']>[0];
    focus: () => void;
    onClick?: (id: string) => void;
    className?: string;
    disablePortal?: boolean;
}) {
    const items = wHeadingListConfig.data;
    const active = items.find((item) => item.isActive(editor));
    return (
        <Select
            qa="g-md-toolbar-text-select"
            size="m"
            view="clear"
            className={className}
            disablePortal={disablePortal}
            value={active ? [active.id] : undefined}
            options={items.map((item) => ({
                value: item.id,
                text: typeof item.title === 'function' ? item.title() : item.title,
                data: item,
            }))}
            // Mirror the bundle's ToolbarSelect option: icon + label + the block's keyboard-shortcut
            // badge, with an `aria-label` for screen readers (dropped when the control was rebuilt).
            // The hover style-preview the bundle also shows needs a bundle-internal import, so it's
            // omitted; the hotkey + aria-label are the accessibility/discoverability essentials.
            renderOption={(option) => (
                <span className="g-md-toolbar-text-select__option" aria-label={option.text}>
                    {option.data?.icon ? (
                        <Icon
                            data={option.data.icon.data}
                            size={Number(option.data.icon.size ?? 16) + 2}
                        />
                    ) : null}
                    <span className="g-md-toolbar-text-select__option-label">{option.text}</span>
                    {option.data?.hotkey ? <Hotkey value={option.data.hotkey} /> : null}
                </span>
            )}
            onUpdate={(ids) => {
                const id = ids[0];
                items.find((item) => item.id === id)?.exec(editor);
                onClick?.(id);
                focus();
            }}
        />
    );
}

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
    /** Show the editor's formatting toolbar (Settings › Show editor toolbar). */
    showToolbar?: boolean;
    /** Show the note's title icon (Settings › Show note icons, experimental). */
    showNoteIcons?: boolean;
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
    /**
     * Bumped by `useNotes` on a real note switch / disk reload (never on an in-place rename/move).
     * Drives the content swap so switching to a different note is distinguished from a rename even
     * when the two bodies are byte-identical (see the swap effect).
     */
    sessionId: number;
    /** Read-only preview mode (⌘⇧P) — renders the LIVE buffer, not disk. */
    preview: boolean;
    /**
     * The scroll container (`.editor-pane`), so a note switch can save/restore the outgoing note's
     * scroll position. The editor is reused across switches, so without this the previous note's
     * scrollTop carries over and the new note opens mid-document.
     */
    scrollContainerRef: React.RefObject<HTMLDivElement>;
    onChange: (markup: string) => void;
    onUploadFile: (file: File) => Promise<string>;
    wikiNotes: NoteMeta[];
    onOpenWikiLink: (target: string) => void;
    /** Show the editor's formatting toolbar (else the surface is markdown-first with no toolbar). */
    showToolbar?: boolean;
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
    {
        note,
        sessionId,
        preview,
        scrollContainerRef,
        onChange,
        onUploadFile,
        wikiNotes,
        onOpenWikiLink,
        showToolbar,
    },
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
                // Move insert-link off ⌘K to ⇧⌘K so ⌘K is free for global note navigation; and use a
                // selection-toolbar config with the block-type "Text"/H1–H6 Select repaired (see
                // SELECTION_MENU_CONFIG). `selectionContext` is read by the bundle preset.
                extensionOptions: {
                    link: {linkKey: 'Mod-Shift-k'},
                    selectionContext: {config: SELECTION_MENU_CONFIG},
                },
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

    // Per-note caret + scroll, so switching away and back lands you where you left off (and a
    // first-time open lands at the TOP, not wherever the previous note was scrolled — the editor is
    // reused, so its scrollTop would otherwise carry over). Keyed by note id; survives a rename/move
    // via the re-key effect below. Kept in a ref (UI-restoration state, never rendered).
    const viewStateByIdRef = useRef<Map<string, {scrollTop: number; selection: unknown}>>(
        new Map(),
    );
    // The id of the note currently loaded in the (reused) editor — lags `note.id` so the swap effect
    // can attribute the outgoing scroll/caret to the right note before the swap. Owned by the swap
    // effect; the rename re-key effect below keeps it current on a rename.
    const prevNoteIdRef = useRef(note.id);
    // The rename re-key effect's OWN previous-state tracker ({id, session}), separate from
    // `prevNoteIdRef` so that effect's carry/no-carry decision doesn't depend on the swap effect
    // having run first (i.e. on the two effects' declaration order).
    const rekeyPrevRef = useRef<{id: string; session: number}>({id: note.id, session: sessionId});

    /** Snapshot a note's scroll position + caret before we swap its content out. */
    const saveViewState = (id: string) => {
        const view = wikiViewRef.current;
        if (!view || !id) return;
        viewStateByIdRef.current.set(id, {
            scrollTop: scrollContainerRef.current?.scrollTop ?? 0,
            selection: view.state.selection.toJSON(),
        });
    };

    // Swap the editor's content on a note switch (or disk reload) — keyed on `sessionId`, which
    // `useNotes` bumps on exactly those (open / reloadDisk), NEVER on an in-place rename/move. That
    // distinction is load-bearing: a rename changes `note.id` while keeping the body, and so does
    // switching to a DIFFERENT note that happens to have byte-identical content (two empty notes, a
    // duplicate, a template) — the two are indistinguishable by id/content alone, but a real switch
    // bumps the session and a rename doesn't. So a real switch always re-homes the caret + scroll
    // (which a `[note.content]` key silently skipped for identical bodies, leaving the new note at the
    // old one's scroll); a rename is left to the re-key effect below. `editor.replace()` is gated on an
    // actual content change (no point rebuilding an identical doc), but the history HARD-RESET (so ⌘Z
    // stays within this note — see the class comment) and the scroll restore run on any switch; the
    // caret restore runs only on a REAL switch (a same-note reload would replay a now-stale caret).
    // `swappingRef` brackets the synchronous emits (replace + state reset + selection restore) so the
    // change handler treats them as a load echo, never a user edit (see handleChange).
    useEffect(() => {
        const prevId = prevNoteIdRef.current;
        prevNoteIdRef.current = note.id;
        const switched = prevId !== note.id;
        const contentChanged = editor.getValue() !== note.content;
        // Nothing to do: initial mount / a no-op reload / a rename (carried by the re-key effect).
        if (!switched && !contentChanged) return;
        saveViewState(prevId); // snapshot the outgoing note (or this note, before a reload)
        swappingRef.current = true;
        // try/finally so a throw in replace()/resetHistory() can't wedge swappingRef true — which
        // would make the change handler swallow every later edit, silently killing autosave.
        try {
            if (contentChanged) editor.replace(note.content);
            resetHistory(); // fresh undo stack; also resets the selection to doc start
            // Restore the saved caret only on a REAL switch — on a same-note disk reload the saved
            // caret came from the pre-reload doc, so replaying it lands at a meaningless offset in the
            // new content; leave the doc-start `resetHistory()` produced instead.
            if (switched) restoreSelection(note.id);
        } finally {
            swappingRef.current = false;
        }
        // Scroll last (a plain scrollTop set emits no transaction), once the new content's layout exists.
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop =
                viewStateByIdRef.current.get(note.id)?.scrollTop ?? 0;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- swap on a real session change / content reload, not on every dep
    }, [sessionId, note.content]);

    // A rename/move re-keys the open note in place (id changes, body + session don't), so the swap
    // effect above (keyed on [sessionId, note.content]) doesn't run. Carry the saved view-state to the
    // new id so a later switch-and-back restores it. This reads its OWN tracker (`rekeyPrevRef`), not
    // the swap effect's `prevNoteIdRef`, so it stays correct regardless of the two effects' run order:
    // a real switch bumps `sessionId` (the swap effect already snapshotted the old note + restored the
    // new one) and is skipped; only a rename (id changed, session unchanged) carries. It still advances
    // `prevNoteIdRef` on a rename so the swap effect's tracker stays current across the rename.
    useEffect(() => {
        const prev = rekeyPrevRef.current;
        rekeyPrevRef.current = {id: note.id, session: sessionId};
        if (prev.id === note.id) return; // no id change (initial mount / a content-only reload)
        if (prev.session !== sessionId) return; // a real switch — the swap effect handled it
        const saved = viewStateByIdRef.current.get(prev.id);
        if (saved) {
            viewStateByIdRef.current.set(note.id, saved);
            viewStateByIdRef.current.delete(prev.id);
        }
        prevNoteIdRef.current = note.id; // keep the swap effect's tracker current (it skips renames)
    }, [note.id, sessionId]);

    /** Drop the whole undo stack by re-creating the EditorState over the current doc + plugins. */
    function resetHistory() {
        const view = wikiViewRef.current;
        if (!view) return;
        view.updateState(EditorState.create({doc: view.state.doc, plugins: view.state.plugins}));
    }

    /** Restore a note's saved caret, clamped to the freshly-loaded doc (no-op for a first open). */
    function restoreSelection(id: string) {
        const view = wikiViewRef.current;
        const saved = viewStateByIdRef.current.get(id);
        if (!view || !saved) return;
        try {
            const selection = Selection.fromJSON(view.state.doc, saved.selection as never);
            view.dispatch(view.state.tr.setSelection(selection));
        } catch {
            // The doc changed since we saved (e.g. an external edit on disk reload) so the positions
            // no longer resolve — leave the default selection (doc start) the history reset produced.
        }
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
    // body on exit, so the Esc ladder keeps working. `preventScroll` on the preview focus is
    // load-bearing: without it, focusing the preview scroll-into-views an ancestor, and the
    // `overflow: hidden` app shell (see index.css) still scrolls PROGRAMMATICALLY in WKWebView —
    // stranding the top bar above the viewport on ⌘⇧P. (The Workspace shell scroll-pin is the
    // belt-and-suspenders catch-all; this just avoids the scroll at its source.)
    const prevPreviewRef = useRef(preview);
    useEffect(() => {
        if (preview === prevPreviewRef.current) return;
        prevPreviewRef.current = preview;
        if (preview) previewRef.current?.focus({preventScroll: true});
        else editor.focus();
    }, [preview, editor]);

    return (
        <>
            {preview ? (
                <NotePreview ref={previewRef} markup={editor.getValue()} />
            ) : (
                <MarkdownEditorView
                    settingsVisible={false}
                    stickyToolbar={Boolean(showToolbar)}
                    editor={editor}
                />
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
        showToolbar,
        showNoteIcons,
    },
    ref,
) {
    const titleRef = useRef<NoteTitleHandle>(null);
    const bodyRef = useRef<EditorBodyHandle>(null);
    const bodyWrapRef = useRef<HTMLDivElement>(null);
    // The vertical scroll container (see EditorPane.css); EditorBody saves/restores its scrollTop per
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
            ref={paneRef}
            className={`editor-pane${showToolbar ? ' editor-pane_toolbar' : ''}`}
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
                showIcon={showNoteIcons}
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
                    sessionId={sessionId}
                    preview={preview}
                    scrollContainerRef={paneRef}
                    onChange={onChange}
                    onUploadFile={onUploadFile}
                    wikiNotes={wikiNotes}
                    onOpenWikiLink={onOpenWikiLink}
                    showToolbar={showToolbar}
                />
            </div>
        </div>
    );
});
