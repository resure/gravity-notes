import {
    forwardRef,
    memo,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type {
    KeyboardEvent as ReactKeyboardEvent,
    MouseEvent as ReactMouseEvent,
    ReactNode,
    RefObject,
} from 'react';

import {defaultRangeExtractor, useVirtualizer} from '@tanstack/react-virtual';

import {buildListRows} from '../listGroups';
import {escapeRegExp, tokenizeQuery} from '../search';
import {isOpenInNewWindowChord} from '../shortcuts';
import {basename, dirname} from '../storage/noteText';
import type {NoteMeta, SortMode} from '../storage/types';
import {Button} from '../ui/Button';
import {Menu, MenuItem, MenuSeparator} from '../ui/Menu';
import {Select} from '../ui/Select';
import {Chip} from '../ui/bits';
import {
    ArrowRight,
    Copy,
    Ellipsis,
    Folder,
    FolderOpen,
    NewWindow,
    Pencil,
    Pin,
    PinSlash,
    Plus,
    Trash,
} from '../ui/icons';

import './NoteList.css';

/**
 * dataTransfer type carrying a dragged note's id; the folder rail gates note drops on it so foreign
 * `text/plain` drags can't be moved into a folder. Must match `NOTE_MIME` in FolderRail.
 */
const NOTE_MIME = 'application/x-gravity-note';

/** §05's hard numbers: the virtualizer depends on both. */
const ROW_HEIGHT = 58;
const GROUP_HEIGHT = 26;

const SORT_OPTIONS: {value: SortMode; label: string}[] = [
    {value: 'updated', label: 'Updated'},
    {value: 'created', label: 'Created'},
    {value: 'title', label: 'Title (A→Z)'},
    {value: 'title-desc', label: 'Title (Z→A)'},
];

/**
 * Perf-regression seam: counts {@link NoteRow} render-body executions. A folder can hold thousands of
 * notes; the list is virtualized (only visible rows mount), and on top of that a note switch must NOT
 * re-render every mounted row — only the row losing selection and the row gaining it. The memoized
 * `NoteRow` guarantees that; this counter lets a test assert it (and catch a future change that drops
 * the memo / destabilizes a row prop). The cost is one integer increment per actual row render —
 * negligible.
 */
export const noteRowRenders = {count: 0};

export interface NoteListHandle {
    /** Move keyboard focus to the selected row, or the search box if the list is empty. */
    focusSelected(): void;
    /** Move keyboard focus to a specific row (used when ↓/↑ enters the list from search). */
    focusRow(id: string): void;
    /** Begin inline-renaming the given note (used by the global F2 shortcut). */
    startRename(id: string): void;
}

export interface NoteListProps {
    /** The notes to show — already ordered (pins first, active sort), and folder-scoped or ranked. */
    notes: NoteMeta[];
    selectedId: string | null;
    /** The active search query — for match highlighting and the empty-state hint. */
    query: string;
    /** The selected folder's display name (null = All Notes) — the scope header's title. */
    scopeLabel: string | null;
    /** Show each note's folder beside its time (when the list spans folders: All Notes / search). */
    showCrumbs: boolean;
    /** Note id → body snippet around the match (full-text hits); shown in place of the preview. */
    snippetById?: Map<string, string>;
    /** Shared with the top bar's search box; focused when the list is empty. */
    searchInputRef: RefObject<HTMLInputElement>;
    /** Preview a note (move the highlight): arrow/vim nav, single click. */
    onBrowse: (id: string) => void;
    /** Open a note for editing (Enter on a row). */
    onCommit: (id: string) => void;
    /**
     * Mobile single-pane: a single tap on a row OPENS the note (commit) instead of just previewing
     * it (browse) — there's no always-visible editor to preview into, so tap-to-open is the model.
     */
    tapToOpen?: boolean;
    /** Esc on a focused row: close the open note and return to search. */
    onEscapeList: () => void;
    /** Create a note in the currently-selected folder. */
    onCreate: () => void;
    /** Ask to move a note — opens the "Move to…" picker (owned by the workspace). */
    onRequestMove: (id: string) => void;
    /** Duplicate a note (shares its attachments). */
    onDuplicate: (id: string) => void;
    /**
     * Open a note in its own single-note window — desktop shell only (absent = menu item hidden
     * and ⌘↵ on a row inert).
     */
    onOpenInNewWindow?: (id: string) => void;
    /** Reveal a note in Finder — present only on the native desktop backend (else hidden). */
    onReveal?: (id: string) => void;
    onRename: (id: string, nextTitle: string) => void;
    /**
     * ASK to delete a note. The confirmation lives in `Workspace`, not here: it has to be reachable
     * for the OPEN note too, which the list may not be showing (a live search, another folder).
     */
    onDelete: (id: string) => void;
    sortMode: SortMode;
    onSortChange: (mode: SortMode) => void;
    pinnedIds: readonly string[];
    onTogglePin: (id: string) => void;
    /** Creation stamps from the sidecar — the `created` sort's group boundaries. */
    createdById?: Readonly<Record<string, number>>;
    /** Whether the folder rail is shown (drives the scope chip). */
    railOpen: boolean;
    /** Show / hide the folder rail. */
    onToggleRail: () => void;
    /**
     * Back to All Notes (clear the folder scope). Drives the scope chip shown when a folder is
     * selected while the rail is CLOSED — the only state where the scoping is otherwise invisible.
     */
    onClearScope?: () => void;
    /** Move focus into the folder rail (← on a row, when the rail is open). */
    onFocusRail: () => void;
}

/** Wrap every occurrence of any `term` (case-insensitive) in `text` with a highlight `<mark>`. */
function highlightTerms(text: string, terms: string[]): ReactNode {
    if (terms.length === 0 || !text) return text;
    // Longest term first so that when one term is a prefix of another (e.g. "java" vs "javascript"),
    // regex leftmost-alternation still highlights the longer match rather than shadowing it.
    const ordered = [...terms].sort((a, b) => b.length - a.length);
    // A capturing group makes String.split interleave the matched delimiters into the result, so
    // odd indices are the matches to mark and even indices are the surrounding plain text.
    const pattern = new RegExp(`(${ordered.map(escapeRegExp).join('|')})`, 'gi');
    return text.split(pattern).map((part, i) =>
        i % 2 === 1 ? (
            <mark key={`${i}:${part}`} className="note-list__match">
                {part}
            </mark>
        ) : (
            part
        ),
    );
}

/** Compact list date: 24-hour time for today, otherwise `DD.MM.YY`. Exported for unit tests. */
export function formatNoteDate(ts: number | undefined): string {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
    }
    const dd = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear() % 100).padStart(2, '0');
    return `${dd}.${mo}.${yy}`;
}

interface NoteRowProps {
    note: NoteMeta;
    selected: boolean;
    editing: boolean;
    /** The roving-tabindex target (selected row, or the first row as a fallback). */
    tabbable: boolean;
    /** Full-text snippet or head-of-note preview, already resolved by the parent. */
    previewText: string;
    /** Leaf folder name (`''` when the list is already scoped to one folder). */
    folderName: string;
    /** Query terms to highlight in the title/preview (stable identity per query). */
    terms: string[];
    /** Current rename-field value; meaningful only while `editing` ('' for every other row). */
    editValue: string;
    /** Stable ref object for the rename `<input>` (only the editing row attaches it). */
    editInputRef: RefObject<HTMLInputElement>;
    /** Register/unregister this row's element in the parent's id→element map (stable). */
    registerRef: (id: string, el: HTMLDivElement | null) => void;
    onClickRow: (id: string, event: ReactMouseEvent<HTMLDivElement>) => void;
    onDoubleClickRow: (id: string, event: ReactMouseEvent<HTMLDivElement>) => void;
    onContextMenuRow: (note: NoteMeta, x: number, y: number) => void;
    onKeyDownRow: (event: ReactKeyboardEvent<HTMLDivElement>, id: string) => void;
    onOpenMenu: (note: NoteMeta, anchor: HTMLElement) => void;
    onEditChange: (value: string) => void;
    onEditCommit: (id: string, title: string) => void;
    onEditCancel: () => void;
}

/**
 * One note row — 58px fixed, per §05: a title with the time right-aligned beside it, then one line
 * of the note's own first words. The preview is what tells "Sync conflicts — Q1" from
 * "Sync conflicts — Q2" without opening either; it never wraps to a second line, because a row that
 * changes height while scrolling is the fastest way to make an app feel cheap.
 *
 * Memoized so a selection change (or any parent re-render) only re-renders the two rows whose
 * `selected`/`tabbable` flipped — not all N rows in a large folder. Every callback prop is stable
 * (the parent wraps them in `useCallback`, reading live state via refs), and `note` keeps its
 * identity across a switch, so the default shallow prop-compare correctly bails for untouched rows.
 */
const NoteRow = memo(function NoteRow({
    note,
    selected,
    editing,
    tabbable,
    previewText,
    folderName,
    terms,
    editValue,
    editInputRef,
    registerRef,
    onClickRow,
    onDoubleClickRow,
    onContextMenuRow,
    onKeyDownRow,
    onOpenMenu,
    onEditChange,
    onEditCommit,
    onEditCancel,
}: NoteRowProps) {
    noteRowRenders.count += 1;
    return (
        <div
            ref={(el) => registerRef(note.id, el)}
            className={'note-list__item' + (selected ? ' note-list__item_selected' : '')}
            role="option"
            aria-selected={selected}
            tabIndex={tabbable ? 0 : -1}
            draggable={!editing}
            onDragStart={(e) => {
                // Custom MIME gates the rail's note-drop (foreign text/plain can't sneak in);
                // text/plain is kept too for native targets that only read plain text.
                e.dataTransfer.setData(NOTE_MIME, note.id);
                e.dataTransfer.setData('text/plain', note.id);
            }}
            onClick={(e) => onClickRow(note.id, e)}
            onDoubleClick={(e) => onDoubleClickRow(note.id, e)}
            onMouseDown={(e) => {
                // Right-click and ⌘-click act on a row WITHOUT selecting it — block the mousedown
                // default so the focusable row doesn't grab DOM focus either (the context menu /
                // new window works off the row id; a plain-click browse focuses explicitly via
                // focusRowById, so it loses nothing).
                if (e.button === 2 || isOpenInNewWindowChord(e)) e.preventDefault();
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                onContextMenuRow(note, e.clientX, e.clientY);
            }}
            onKeyDown={(e) => onKeyDownRow(e, note.id)}
        >
            <div className="note-list__line">
                {editing ? (
                    // Rename happens in place: no field, no border, no box. The preview line below
                    // does not move, and the selected text takes the accent — one of its five uses.
                    <input
                        ref={editInputRef}
                        className="note-list__edit"
                        aria-label="Note title"
                        value={editValue}
                        onChange={(e) => onEditChange(e.target.value)}
                        onBlur={() => onEditCommit(note.id, note.title)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                                e.preventDefault();
                                onEditCommit(note.id, note.title);
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                onEditCancel();
                            }
                        }}
                    />
                ) : (
                    <>
                        <span className="note-list__title">
                            {highlightTerms(note.title, terms)}
                        </span>
                        {folderName ? (
                            <span className="note-list__folder">{folderName}</span>
                        ) : null}
                        {/* The ⋯ takes the TIME's place on hover — 24px, the same target as every
                            other icon button in the chrome. Both live in one slot, and the time
                            keeps its box (visibility, not display) while the button overlays it:
                            the two are different widths, and letting the slot resize would re-flow
                            the flex-1 title and visibly shift its text under the pointer. */}
                        <span className="note-list__trailing">
                            <span className="note-list__date">
                                {formatNoteDate(note.updatedAt)}
                            </span>
                            <button
                                type="button"
                                className="note-list__actions"
                                aria-label="Note actions"
                                tabIndex={-1}
                                onClick={(e) => {
                                    // Don't browse the row; open the one shared menu anchored to
                                    // this button (the parent toggles it off if it's this row's).
                                    e.stopPropagation();
                                    onOpenMenu(note, e.currentTarget);
                                }}
                            >
                                <Ellipsis size={15} />
                            </button>
                        </span>
                    </>
                )}
            </div>
            <div className="note-list__preview">{highlightTerms(previewText, terms)}</div>
        </div>
    );
});

export const NoteList = forwardRef<NoteListHandle, NoteListProps>(function NoteList(
    {
        notes,
        selectedId,
        query,
        scopeLabel,
        showCrumbs,
        snippetById,
        searchInputRef,
        onBrowse,
        onCommit,
        tapToOpen,
        onEscapeList,
        onCreate,
        onRequestMove,
        onDuplicate,
        onOpenInNewWindow,
        onReveal,
        onRename,
        onDelete,
        sortMode,
        onSortChange,
        pinnedIds,
        onTogglePin,
        createdById,
        railOpen,
        onToggleRail,
        onClearScope,
        onFocusRail,
    },
    ref,
) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    // The note + anchor for the one open action menu (null = closed). A single shared menu serves
    // both the row's ⋯ button and the right-click context menu: mounting a Menu (and building its
    // items) per row would be a large render cost on a folder with thousands of notes. The anchor is
    // the ⋯ button element, or a zero-size virtual element at the cursor for a right-click.
    const [menu, setMenu] = useState<{
        note: NoteMeta;
        anchor: HTMLElement | {getBoundingClientRect: () => DOMRect};
    } | null>(null);
    // Tokenized here (not threaded as a prop) so highlighting stays self-contained.
    const terms = useMemo(() => tokenizeQuery(query), [query]);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const editInputRef = useRef<HTMLInputElement>(null);

    const noteIds = useMemo(() => notes.map((note) => note.id), [notes]);
    const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
    const searching = query.trim().length > 0;

    // Today's local midnight, recomputed every render but only CHANGING once a day — the memo key
    // that keeps "Today" from meaning yesterday. Without it a window left open across midnight kept
    // its labels until something else happened to invalidate the list.
    const dayStart = new Date().setHours(0, 0, 0, 0);

    // Group labels interleaved into the ordered list (Pinned / Today / … , or A B C under a title
    // sort). A live search is ranked rather than sorted, so it gets no labels — see listGroups.ts.
    const rows = useMemo(
        () =>
            buildListRows(notes, {
                sort: sortMode,
                pinned: pinnedSet,
                created: createdById,
                grouped: !searching,
            }),

        // the grouping; `buildListRows` reads the wall clock itself.
        [notes, sortMode, pinnedSet, createdById, searching, dayStart],
    );
    const rowIndexById = useMemo(() => {
        const map = new Map<string, number>();
        rows.forEach((row, index) => {
            if (row.kind === 'note') map.set(row.note.id, index);
        });
        return map;
    }, [rows]);

    // The note row that is tabbable: the selected one if visible, else the first note.
    const focusableId =
        selectedId && noteIds.includes(selectedId) ? selectedId : (noteIds[0] ?? null);
    const focusableIndex = focusableId ? (rowIndexById.get(focusableId) ?? -1) : -1;
    // The open row menu's anchor row (kept mounted below, so a scroll can't tear the anchor out from
    // under its popup); -1 = closed, or the note has left the list.
    const menuIndex = menu ? (rowIndexById.get(menu.note.id) ?? -1) : -1;

    // Close the menu when its note leaves the list (deleted, filtered out by a new search, or
    // renamed to a new id) — its anchor row is then no longer kept mounted, and a popup on a dead
    // anchor just floats stale.
    useEffect(() => {
        if (menu && menuIndex === -1) setMenu(null);
    }, [menu, menuIndex]);

    // Live snapshot read by the stable row callbacks below — so those callbacks never close over a
    // stale value yet keep a constant identity (the key to NoteRow's memo bailing out for untouched
    // rows). Updated on every render; the callbacks read `.current` lazily, at call time.
    const live = useRef({
        noteIds,
        editingId,
        editValue,
        railOpen,
        onBrowse,
        onCommit,
        tapToOpen,
        onEscapeList,
        onFocusRail,
        onOpenInNewWindow,
        onRename,
    });
    live.current = {
        noteIds,
        editingId,
        editValue,
        railOpen,
        onBrowse,
        onCommit,
        tapToOpen,
        onEscapeList,
        onFocusRail,
        onOpenInNewWindow,
        onRename,
    };

    // Virtualize: a folder can hold thousands of notes, and mounting every row blows out first paint,
    // memory, and scroll. Heights are FIXED by §05 (58px rows, 26px group labels) rather than
    // measured — that is exactly what makes the virtualizer's arithmetic exact and the scrollbar
    // honest at three thousand rows.
    const scrollRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: (index) => (rows[index].kind === 'group' ? GROUP_HEIGHT : ROW_HEIGHT),
        overscan: 8,
        getItemKey: (index) => rows[index].key,
        // Always render the roving-tabindex (selected) row, even when it's scrolled out of the window,
        // so the list always has a keyboard-focusable element and focusing it never needs an async
        // scroll-then-mount — plus the open menu's anchor row, so scrolling can't unmount the popup's
        // anchor from under it. A fresh closure per render keeps the forced indexes current; the
        // window is a few dozen sorted indexes, so the sort is free.
        rangeExtractor: (range) => {
            const indexes = defaultRangeExtractor(range);
            for (const forced of [focusableIndex, menuIndex]) {
                if (forced >= 0 && !indexes.includes(forced)) indexes.push(forced);
            }
            return indexes.sort((a, b) => a - b);
        },
    });

    // A row to focus once it has been scrolled into the virtual window (set by focusRowById below).
    const pendingFocusRef = useRef<string | null>(null);

    /**
     * Focus a row by id. If it's currently mounted, focus it directly; otherwise scroll it into the
     * virtual window and focus it once it mounts (a row outside the window has no DOM element). Keeps
     * keyboard nav / focusSelected / focusRow working across the virtualized list.
     */
    const focusRowById = useCallback(
        (id: string) => {
            const el = itemRefs.current.get(id);
            if (el) {
                el.focus();
                return;
            }
            const index = rowIndexById.get(id);
            if (index === undefined) return;
            pendingFocusRef.current = id;
            rowVirtualizer.scrollToIndex(index);
        },
        [rowVirtualizer, rowIndexById],
    );

    // After the window re-renders (e.g. following scrollToIndex), focus the pending row once it mounts.
    useLayoutEffect(() => {
        const id = pendingFocusRef.current;
        if (!id) return;
        const el = itemRefs.current.get(id);
        if (!el) return; // not mounted yet — wait for the next render after scrollToIndex
        // Only claim focus if it's still "loose" (on <body>, or already inside this list). If the user
        // has since clicked/typed into the search box (or anywhere outside the list) while the row was
        // scrolling in, don't yank it back — but consume the request either way so it can't linger and
        // steal focus on some later unrelated render.
        const active = document.activeElement;
        if (!active || active === document.body || scrollRef.current?.contains(active)) el.focus();
        pendingFocusRef.current = null;
    });

    // Focus the rename field when inline editing begins.
    useEffect(() => {
        if (editingId) editInputRef.current?.select();
    }, [editingId]);

    // When an inline rename ends (commit or cancel), return keyboard focus to the list so
    // arrow-nav continues — the input unmounts first, otherwise focus is stranded on <body>.
    const wasEditingRef = useRef(false);
    useEffect(() => {
        if (wasEditingRef.current && editingId === null && focusableId) {
            itemRefs.current.get(focusableId)?.focus();
        }
        wasEditingRef.current = editingId !== null;
    }, [editingId, focusableId]);

    const beginRename = useCallback((id: string, title: string) => {
        setEditValue(title);
        setEditingId(id);
    }, []);

    useImperativeHandle(
        ref,
        () => ({
            focusSelected() {
                // Fall back to the search box when there's no note row at all (an empty result set),
                // so Esc from a lost-focus spot still lands somewhere useful; otherwise focus the
                // roving-tabindex row, scrolling it into the virtual window first if needed.
                if (focusableId) focusRowById(focusableId);
                else searchInputRef.current?.focus();
            },
            focusRow(id: string) {
                focusRowById(id);
            },
            startRename(id: string) {
                const note = notes.find((n) => n.id === id);
                if (note) beginRename(id, note.title);
            },
        }),
        [focusableId, notes, searchInputRef, beginRename, focusRowById],
    );

    // --- Stable per-row callbacks (constant identity; read current state via `live`). ---

    /** Move the highlight to a row, preview it, and keep DOM focus on the list. */
    const browseRow = useCallback(
        (id: string) => {
            live.current.onBrowse(id);
            focusRowById(id);
        },
        [focusRowById],
    );

    const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
        if (el) itemRefs.current.set(id, el);
        else itemRefs.current.delete(id);
    }, []);

    const onClickRow = useCallback(
        (id: string, event: ReactMouseEvent<HTMLDivElement>) => {
            const {editingId: editing, onOpenInNewWindow: openInNew, tapToOpen: tap} = live.current;
            if (editing === id) return;
            // ⌘-click (desktop): open the note in its own window, leaving this window's selection
            // alone — the same modifier convention as ⌘↵ here and ⌘-click in the orb menu. Without
            // the callback (web) the modifier is ignored and the click browses as usual.
            if (openInNew && isOpenInNewWindowChord(event)) {
                openInNew(id);
                return;
            }
            // Mobile single-pane: a plain tap OPENS the note (there's no side-by-side editor to
            // preview into). On desktop it just browses (previews) — Enter/double-click open.
            if (tap) live.current.onCommit(id);
            else browseRow(id);
        },
        [browseRow],
    );

    // Double-click (desktop): open the note in its own window — Apple-Notes-style, matching ⌘↵ /
    // ⌘-click / the ⋯ "Open in New Window" item. The preceding single click already browsed+selected
    // it in this window, which is fine. No-op on web (no callback) — the browser's word-select on
    // double-click is harmless there, so nothing to prevent.
    const onDoubleClickRow = useCallback((id: string, event: ReactMouseEvent<HTMLDivElement>) => {
        const {editingId: editing, onOpenInNewWindow: openInNew} = live.current;
        if (editing === id || !openInNew) return;
        // Suppress the accompanying word-selection so the row doesn't flash a highlighted title.
        event.preventDefault();
        openInNew(id);
    }, []);

    // Deliberately NO browse here: right-click acts on the clicked note via the menu's own
    // `note` payload, without moving the selection/preview off whatever is open (same rule as
    // ⌘-click / ⌘↵ opening a new window).
    const onContextMenuRow = useCallback((note: NoteMeta, x: number, y: number) => {
        if (live.current.editingId === note.id) return;
        setMenu({note, anchor: {getBoundingClientRect: () => new DOMRect(x, y, 0, 0)}});
    }, []);

    const onOpenMenu = useCallback((note: NoteMeta, anchor: HTMLElement) => {
        setMenu((open) => (open?.note.id === note.id ? null : {note, anchor}));
    }, []);

    const moveSelection = useCallback(
        (fromId: string, delta: number) => {
            const {noteIds: ids} = live.current;
            const index = ids.indexOf(fromId);
            if (index === -1) return;
            const next = ids[Math.min(Math.max(index + delta, 0), ids.length - 1)];
            if (next && next !== fromId) browseRow(next);
        },
        [browseRow],
    );

    const onKeyDownRow = useCallback(
        (event: ReactKeyboardEvent<HTMLDivElement>, id: string) => {
            const {
                editingId: editing,
                railOpen: rail,
                onCommit: commit,
                onEscapeList: escape,
                onFocusRail: focusRail,
            } = live.current;
            if (editing === id) return;
            // Bare j/k mirror the arrow keys (vim-style). Guarded against modifiers so ⌘J
            // (new note) still falls through to the global shortcut handler.
            const bare = !event.metaKey && !event.ctrlKey && !event.altKey;
            if (event.key === 'ArrowDown' || (bare && event.key === 'j')) {
                event.preventDefault();
                moveSelection(id, 1);
                return;
            }
            if (event.key === 'ArrowUp' || (bare && event.key === 'k')) {
                event.preventDefault();
                moveSelection(id, -1);
                return;
            }
            switch (event.key) {
                case 'ArrowLeft':
                    // Step left into the folder rail (when it's open).
                    if (rail) {
                        event.preventDefault();
                        focusRail();
                    }
                    break;
                case 'Enter': {
                    if (!bare) {
                        // ⌘↵ (no ⇧): open this row's note in its own desktop window. Everything
                        // else modified — notably ⌘⇧↵, the global new-note chord — still bubbles.
                        const {onOpenInNewWindow: openInNew} = live.current;
                        if (openInNew && isOpenInNewWindowChord(event)) {
                            event.preventDefault();
                            openInNew(id);
                        }
                        break;
                    }
                    // From a focused row-level button (the ⋯ actions), Enter must activate the
                    // button — preventDefault on the bubbled keydown would cancel the button's
                    // click synthesis and open the note instead.
                    if (event.target instanceof Element && event.target.closest('button')) break;
                    event.preventDefault();
                    commit(id);
                    break;
                }
                case 'Escape':
                    event.preventDefault();
                    escape();
                    break;
            }
        },
        [moveSelection],
    );

    const onEditCommit = useCallback((id: string, title: string) => {
        const next = live.current.editValue.trim();
        setEditingId(null);
        if (next && next !== title) live.current.onRename(id, next);
    }, []);

    const onEditCancel = useCallback(() => setEditingId(null), []);

    // Empty-state copy, tailored to context: a no-match search, an empty selected folder, or a
    // truly empty store. §09: per-pane, never full-window, and at most one oversized quiet glyph.
    const renderEmpty = () => {
        const q = query.trim();
        if (q) {
            return <p className="note-list__empty-line">No match — press ⏎ to create “{q}”</p>;
        }
        return (
            <>
                <Folder size={26} className="note-list__empty-glyph" />
                <p className="note-list__empty-line">
                    {scopeLabel ? `No notes in “${scopeLabel}”` : 'No notes yet'}
                </p>
                <p className="note-list__empty-hint">
                    {scopeLabel ? '“New” adds a note here' : 'Type to search, or press ⏎ to create'}
                </p>
            </>
        );
    };

    return (
        <div className="note-list">
            {/* The 38px scope header (§04/§05): the folder's name and count — this is what replaced
                the per-row breadcrumb — then the sort control and the app's ONE raised button. */}
            <div className="note-list__header">
                <span className="note-list__scope-name">{scopeLabel ?? 'All Notes'}</span>
                <span className="note-list__scope-count">{notes.length}</span>
                <div className="note-list__header-gap" />
                <Select
                    aria-label="Sort notes"
                    options={SORT_OPTIONS}
                    value={sortMode}
                    onChange={onSortChange}
                />
                <Button
                    size="s"
                    variant="raised"
                    icon={<Plus size={12} />}
                    onClick={() => onCreate()}
                >
                    New
                </Button>
            </div>

            {/* Scope chip: with the rail closed, a selected folder silently filters the list — name
                the scope, click through to the folder tree, ✕ back to All Notes. Hidden while a
                search is live (the list is global then) and whenever the rail already shows it. */}
            {!railOpen && scopeLabel && !searching && onClearScope ? (
                <div className="note-list__scope">
                    <Chip
                        icon={<Folder size={12} />}
                        onClick={onToggleRail}
                        onDismiss={onClearScope}
                        dismissLabel="Show all notes"
                        title={`Showing “${scopeLabel}” — click to open folders`}
                    >
                        {scopeLabel}
                    </Chip>
                </div>
            ) : null}

            <div
                ref={scrollRef}
                className="note-list__items virtual-scroll"
                role="listbox"
                aria-label="Notes"
            >
                {notes.length === 0 ? (
                    <div className="note-list__empty">{renderEmpty()}</div>
                ) : (
                    // Spacer sized to the full list; each visible row is absolutely positioned at its
                    // offset. Only the windowed rows (getVirtualItems) are mounted.
                    <div style={{height: rowVirtualizer.getTotalSize(), position: 'relative'}}>
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            const row = rows[virtualRow.index];
                            return (
                                <div
                                    key={virtualRow.key}
                                    data-index={virtualRow.index}
                                    // Two washed rows must never touch: if hover landed directly
                                    // above or below the selection they would read as one four-line
                                    // block. The flag lives on this POSITIONING wrapper, not on the
                                    // memoized row — a selection change moves it across up to four
                                    // neighbours, and passing it down would re-render all of them
                                    // for a purely visual rule (the row itself must re-render only
                                    // when it gains or loses selection).
                                    data-no-hover={
                                        focusableIndex >= 0 &&
                                        Math.abs(virtualRow.index - focusableIndex) === 1
                                            ? ''
                                            : undefined
                                    }
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        height: virtualRow.size,
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    {row.kind === 'group' ? (
                                        <div className="note-list__group">{row.label}</div>
                                    ) : (
                                        <NoteRow
                                            note={row.note}
                                            selected={row.note.id === selectedId}
                                            editing={row.note.id === editingId}
                                            tabbable={
                                                row.note.id !== editingId &&
                                                row.note.id === focusableId
                                            }
                                            previewText={
                                                snippetById?.get(row.note.id) ??
                                                row.note.preview ??
                                                ''
                                            }
                                            folderName={
                                                showCrumbs
                                                    ? basename(dirname(row.note.id) || '')
                                                    : ''
                                            }
                                            terms={terms}
                                            editValue={row.note.id === editingId ? editValue : ''}
                                            editInputRef={editInputRef}
                                            registerRef={registerRef}
                                            onClickRow={onClickRow}
                                            onDoubleClickRow={onDoubleClickRow}
                                            onContextMenuRow={onContextMenuRow}
                                            onKeyDownRow={onKeyDownRow}
                                            onOpenMenu={onOpenMenu}
                                            onEditChange={setEditValue}
                                            onEditCommit={onEditCommit}
                                            onEditCancel={onEditCancel}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* The one shared action menu — controlled, anchored to whichever row's ⋯ button (or the
                cursor, for a right-click) opened it, so the list needs no per-row Menu instance.
                §07: file actions only — no appearance, no view state; those belong to the note that
                is OPEN, not to a row you are pointing at. */}
            <Menu
                open={menu !== null}
                onOpenChange={(open) => {
                    if (!open) setMenu(null);
                }}
                anchor={menu?.anchor}
                align="start"
                width={248}
                finalFocus={false}
            >
                {menu ? (
                    <>
                        {onOpenInNewWindow ? (
                            <MenuItem
                                icon={<NewWindow size={16} />}
                                hint="⌘↵"
                                onClick={() => onOpenInNewWindow(menu.note.id)}
                            >
                                Open in New Window
                            </MenuItem>
                        ) : null}
                        <MenuItem
                            icon={
                                pinnedSet.has(menu.note.id) ? (
                                    <PinSlash size={16} />
                                ) : (
                                    <Pin size={16} />
                                )
                            }
                            onClick={() => onTogglePin(menu.note.id)}
                        >
                            {pinnedSet.has(menu.note.id) ? 'Unpin' : 'Pin to top'}
                        </MenuItem>
                        <MenuItem
                            icon={<Pencil size={16} />}
                            hint="F2"
                            onClick={() => beginRename(menu.note.id, menu.note.title)}
                        >
                            Rename
                        </MenuItem>
                        <MenuItem
                            icon={<ArrowRight size={16} />}
                            hint="⌘⇧M"
                            onClick={() => onRequestMove(menu.note.id)}
                        >
                            Move to…
                        </MenuItem>
                        <MenuItem
                            icon={<Copy size={16} />}
                            hint="⌘D"
                            onClick={() => onDuplicate(menu.note.id)}
                        >
                            Duplicate
                        </MenuItem>
                        {onReveal ? (
                            <MenuItem
                                icon={<FolderOpen size={16} />}
                                onClick={() => onReveal(menu.note.id)}
                            >
                                Reveal in Finder
                            </MenuItem>
                        ) : null}
                        <MenuSeparator />
                        <MenuItem
                            icon={<Trash size={16} />}
                            hint="⌘⇧⌫"
                            danger
                            onClick={() => onDelete(menu.note.id)}
                        >
                            Delete
                        </MenuItem>
                    </>
                ) : null}
            </Menu>
        </div>
    );
});
