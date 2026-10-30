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

import {Button, Dialog, DropdownMenu, Select} from '@gravity-ui/uikit';
import {defaultRangeExtractor, useVirtualizer} from '@tanstack/react-virtual';
import type {Virtualizer} from '@tanstack/react-virtual';

import {useHeldValue} from '../hooks/useHeldValue';
import {
    ArrowRight,
    Copy,
    Ellipsis,
    FileText,
    Folder,
    FolderOpen,
    NewWindow,
    Pencil,
    Pin,
    PinFill,
    PinSlash,
    Plus,
    Trash,
    Xmark,
} from '../icons/icons';
import {escapeRegExp, tokenizeQuery} from '../search';
import {isOpenInNewWindowChord, shortcutHint} from '../shortcuts';
import {dirname, formatCrumb} from '../storage/noteText';
import type {NoteMeta, OtherFile, SortMode} from '../storage/types';

import {FileTypeBadge} from './FileTypeBadge';
import {IconPickerButton, IconPickerPopup} from './IconPicker';

import './NoteList.css';

/**
 * dataTransfer type carrying a dragged note's id; the folder rail gates note drops on it so foreign
 * `text/plain` drags can't be moved into a folder. Must match `NOTE_MIME` in FolderRail.
 */
const NOTE_MIME = 'application/x-gravity-note';
const NO_FILES: OtherFile[] = [];
/** Fixed row heights: the virtualizer's offsets are computed from them, never measured. */
const ROW_HEIGHT = 48;
/** A row that also names its folder, on a third line (All Notes / search). */
const ROW_WITH_FOLDER_HEIGHT = 64;

function rowHeight(note: NoteMeta, showCrumbs: boolean): number {
    return showCrumbs && dirname(note.id) ? ROW_WITH_FOLDER_HEIGHT : ROW_HEIGHT;
}

const SORT_OPTIONS: {value: SortMode; content: string}[] = [
    {value: 'updated', content: 'Updated'},
    {value: 'created', content: 'Created'},
    {value: 'title', content: 'Title (A→Z)'},
    {value: 'title-desc', content: 'Title (Z→A)'},
];

function menuHint(keys: string) {
    return <span className="gn-menu-hint">{keys}</span>;
}

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
    /** Open the delete-confirmation for the given note (used by the global ⌘⇧⌫ shortcut). */
    requestDelete(id: string): void;
}

export interface NoteListProps {
    /** The notes to show — already ordered (pins first, active sort), and folder-scoped or ranked. */
    notes: NoteMeta[];
    /** Display-only files alongside the notes; never part of note navigation. */
    files?: OtherFile[];
    selectedId: string | null;
    /** The active search query — for match highlighting and the empty-state hint. */
    query: string;
    /** The selected folder's display name (null = All Notes), for the empty-state copy. */
    scopeLabel: string | null;
    /** Show each note's folder as a chip (when the list spans folders: All Notes / flat search). */
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
    onDelete: (id: string) => void;
    sortMode: SortMode;
    onSortChange: (mode: SortMode) => void;
    pinnedIds: readonly string[];
    onTogglePin: (id: string) => void;
    icons: Readonly<Record<string, string>>;
    onSetIcon: (id: string, icon: string) => void;
    /** Show a per-note icon picker on each row (Settings › Show note icons). */
    showIcons: boolean;
    /** Whether the folder rail is shown (drives the toggle button state + ← behavior). */
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

// One compiled pattern per query's term list. `terms` is a stable array per query (memoized in
// NoteList), so this compiles once per keystroke instead of once per visible ROW per field.
const patternByTerms = new WeakMap<string[], RegExp>();
function highlightPattern(terms: string[]): RegExp {
    let pattern = patternByTerms.get(terms);
    if (!pattern) {
        // Longest term first so that when one term is a prefix of another (e.g. "java" vs
        // "javascript"), regex leftmost-alternation still highlights the longer match.
        const ordered = [...terms].sort((a, b) => b.length - a.length);
        // A capturing group makes String.split interleave the matched delimiters into the result,
        // so odd indices are the matches to mark and even indices are the surrounding plain text.
        pattern = new RegExp(`(${ordered.map(escapeRegExp).join('|')})`, 'gi');
        patternByTerms.set(terms, pattern);
    }
    return pattern;
}

/** Wrap every occurrence of any `term` (case-insensitive) in `text` with a highlight `<mark>`. */
function highlightTerms(text: string, terms: string[]): ReactNode {
    if (terms.length === 0 || !text) return text;
    const pattern = highlightPattern(terms);
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
    pinned: boolean;
    /** Full-text snippet or head-of-note preview, already resolved by the parent. */
    previewText: string;
    /** Folder-path crumb (`''` when not shown). */
    crumb: string;
    /** Query terms to highlight in the title/preview (stable identity per query). */
    terms: string[];
    /** Current rename-field value; meaningful only while `editing` ('' for every other row). */
    editValue: string;
    /** Stable ref object for the rename `<input>` (only the editing row attaches it). */
    editInputRef: RefObject<HTMLInputElement>;
    /** Register/unregister this row's element in the parent's id→element map (stable). */
    registerRef: (id: string, el: HTMLDivElement | null) => void;
    /** This row's ⋯ menu is open — keeps the ⋯ shown however far the pointer wanders. */
    menuOpen: boolean;
    icon?: string;
    /** Toggle the list's one shared icon-picker popup, anchored to this row's glyph button. */
    onOpenIconPicker: (id: string, anchor: HTMLElement) => void;
    showIcons: boolean;
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
 * One note row. Memoized so a selection change (or any parent re-render) only re-renders the two rows
 * whose `selected`/`tabbable` flipped — not all N rows in a large folder. Every callback prop is stable
 * (the parent wraps them in `useCallback`, reading live state via refs), and `note` keeps its identity
 * across a switch, so the default shallow prop-compare correctly bails out for the untouched rows.
 */
const NoteRow = memo(function NoteRow({
    note,
    selected,
    editing,
    tabbable,
    pinned,
    previewText,
    crumb,
    terms,
    editValue,
    editInputRef,
    registerRef,
    menuOpen,
    icon,
    onOpenIconPicker,
    showIcons,
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
            className={
                'note-list__item' +
                (selected ? ' note-list__item_selected' : '') +
                (menuOpen ? ' note-list__item_menu-open' : '')
            }
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
            {showIcons ? (
                <span className="note-list__icon-tile">
                    <IconPickerButton
                        className="note-list__icon"
                        size="s"
                        value={icon}
                        onClick={(e) => {
                            // Like the ⋯ button: don't browse the row; toggle the one shared
                            // picker popup anchored to this button.
                            e.stopPropagation();
                            onOpenIconPicker(note.id, e.currentTarget);
                        }}
                    />
                </span>
            ) : null}
            <div className="note-list__text">
                <div className="note-list__line">
                    {editing ? (
                        <input
                            ref={editInputRef}
                            className="note-list__edit"
                            aria-label="Rename note"
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
                            {pinned ? <PinFill size={12} className="note-list__pin" /> : null}
                            <span className="note-list__heading">
                                <span className="note-list__title">
                                    {highlightTerms(note.title, terms)}
                                </span>
                                <FileTypeBadge id={note.id} />
                            </span>
                            <span className="note-list__trailing">
                                <Button
                                    className="note-list__actions"
                                    view="flat"
                                    size="s"
                                    aria-label="Note actions"
                                    // Only the roving row's ⋯ sits in the Tab order, one stop after
                                    // the row itself.
                                    tabIndex={tabbable ? 0 : -1}
                                    onClick={(e) => {
                                        // Don't browse the row; open the one shared menu anchored to
                                        // this button (parent toggles it off if already this row's).
                                        e.stopPropagation();
                                        onOpenMenu(note, e.currentTarget);
                                    }}
                                >
                                    <Button.Icon>
                                        <Ellipsis size={15} />
                                    </Button.Icon>
                                </Button>
                            </span>
                        </>
                    )}
                </div>
                <div className="note-list__meta">
                    <span className="note-list__date">{formatNoteDate(note.updatedAt)}</span>
                    {previewText ? (
                        <span className="note-list__preview">
                            {highlightTerms(previewText, terms)}
                        </span>
                    ) : null}
                </div>
                {crumb ? (
                    <div className="note-list__folder">
                        <Folder size={12} className="note-list__folder-glyph" />
                        <span className="note-list__folder-name">{crumb}</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
});

type NoteListVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>;

interface NoteViewportProps {
    count: number;
    scrollRef: RefObject<HTMLDivElement>;
    rowHeights: number[];
    getItemKey: (index: number) => string;
    focusableIndex: number;
    menuIndex: number;
    iconPickerIndex: number;
    showCrumbs: boolean;
    onItemsRendered: () => void;
    children: (virtualizer: NoteListVirtualizer) => ReactNode;
}

const NoteViewport = forwardRef<NoteListVirtualizer, NoteViewportProps>(function NoteViewportBody(
    {
        count,
        scrollRef,
        rowHeights,
        getItemKey,
        focusableIndex,
        menuIndex,
        iconPickerIndex,
        showCrumbs,
        onItemsRendered,
        children,
    },
    ref,
) {
    const rangeExtractor = useCallback(
        (range: Parameters<typeof defaultRangeExtractor>[0]) => {
            const indexes = defaultRangeExtractor(range);
            for (const forced of [focusableIndex, menuIndex, iconPickerIndex]) {
                if (forced >= 0 && !indexes.includes(forced)) indexes.push(forced);
            }
            return indexes.sort((a, b) => a - b);
        },
        [focusableIndex, menuIndex, iconPickerIndex],
    );
    const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
        count,
        getScrollElement: () => scrollRef.current,
        estimateSize: (index) => rowHeights[index] ?? ROW_HEIGHT,
        overscan: 8,
        getItemKey,
        rangeExtractor,
    });
    useImperativeHandle(ref, () => virtualizer, [virtualizer]);
    useLayoutEffect(() => {
        virtualizer.measure();
    }, [virtualizer, showCrumbs]);
    useLayoutEffect(onItemsRendered);

    return (
        <div ref={scrollRef} className="note-list__items virtual-scroll">
            {children(virtualizer)}
        </div>
    );
});

export const NoteList = forwardRef<NoteListHandle, NoteListProps>(function NoteList(
    {
        notes,
        files = NO_FILES,
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
        icons,
        onSetIcon,
        showIcons,
        railOpen,
        onToggleRail,
        onClearScope,
        onFocusRail,
    },
    ref,
) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [deleting, setDeleting] = useState<{id: string; title: string} | null>(null);
    // The note + anchor for the one open action menu (null = closed). A single shared menu serves
    // both the row's ⋯ button and the right-click context menu: mounting a DropdownMenu (and building
    // its items) per row would be a large render cost on a folder with thousands of notes. The anchor
    // is the ⋯ button element, or a zero-size virtual element at the cursor for a right-click.
    const [menu, setMenu] = useState<{
        note: NoteMeta;
        anchor: {getBoundingClientRect: () => DOMRect};
    } | null>(null);
    // The note + anchor for the one open icon picker (null = closed) — the same shared-instance
    // pattern as the action menu above: a whole IconPicker (popup + its own virtualizer) per row
    // was a large per-row render cost, and an open per-row popup died with its row when it left
    // the virtual window. Rows render only the glyph button; this popup serves them all.
    const [iconPicker, setIconPicker] = useState<{noteId: string; anchor: HTMLElement} | null>(
        null,
    );
    // Tokenized here (not threaded as a prop) so highlighting stays self-contained.
    const terms = useMemo(() => tokenizeQuery(query), [query]);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const editInputRef = useRef<HTMLInputElement>(null);

    const noteIds = useMemo(() => notes.map((note) => note.id), [notes]);
    const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);

    // The note row that is tabbable: the selected one if visible, else the first note.
    const focusableId =
        selectedId && noteIds.includes(selectedId) ? selectedId : (noteIds[0] ?? null);
    const focusableIndex = focusableId ? noteIds.indexOf(focusableId) : -1;
    // The open row popovers' anchor rows (kept mounted below, so a scroll can't tear an anchor out
    // from under its popup); -1 = closed, or the note has left the list.
    const menuIndex = menu ? noteIds.indexOf(menu.note.id) : -1;
    const iconPickerIndex = iconPicker ? noteIds.indexOf(iconPicker.noteId) : -1;

    // Close an open row popover when its note leaves the list (deleted, filtered out by a new
    // search, or renamed to a new id) — its anchor row is then no longer kept mounted, and a popup
    // on a dead anchor just floats stale. Membership is read off the indexes derived above.
    useEffect(() => {
        if (menu && menuIndex === -1) setMenu(null);
        if (iconPicker && iconPickerIndex === -1) setIconPicker(null);
    }, [menu, menuIndex, iconPicker, iconPickerIndex]);

    // Live snapshot read by the stable row callbacks below — so those callbacks never close over a
    // stale value yet keep a constant identity (the key to NoteRow's memo bailing out for untouched
    // rows). Updated on every render; the callbacks read `.current` lazily, at call time.
    const live = useRef({
        noteIds,
        editingId,
        editValue,
        railOpen,
        iconPicker,
        onBrowse,
        onCommit,
        tapToOpen,
        onEscapeList,
        onFocusRail,
        onOpenInNewWindow,
        onRename,
        onSetIcon,
    });
    live.current = {
        noteIds,
        editingId,
        editValue,
        railOpen,
        iconPicker,
        onBrowse,
        onCommit,
        tapToOpen,
        onEscapeList,
        onFocusRail,
        onOpenInNewWindow,
        onRename,
        onSetIcon,
    };

    const scrollRef = useRef<HTMLDivElement>(null);
    const rowVirtualizerRef = useRef<NoteListVirtualizer>(null);
    const rowHeights = useMemo(
        () => notes.map((note) => rowHeight(note, showCrumbs)),
        [notes, showCrumbs],
    );
    // Stable, so the virtualizer recomputes its offsets only when the rows really change.
    const getItemKey = useCallback(
        (index: number) =>
            index < notes.length ? notes[index].id : `file:${files[index - notes.length].id}`,
        [notes, files],
    );
    // A row to focus once it has been scrolled into the virtual window (set by focusRowById below).
    const pendingFocusRef = useRef<string | null>(null);

    /**
     * Focus a row by id. If it's currently mounted, focus it directly; otherwise scroll it into the
     * virtual window and focus it once it mounts (a row outside the window has no DOM element). Keeps
     * keyboard nav / focusSelected / focusRow working across the virtualized list.
     */
    const focusRowById = useCallback((id: string) => {
        const el = itemRefs.current.get(id);
        if (el) {
            el.focus();
            return;
        }
        const index = live.current.noteIds.indexOf(id);
        if (index === -1) return;
        pendingFocusRef.current = id;
        rowVirtualizerRef.current?.scrollToIndex(index);
    }, []);

    // After the window re-renders (e.g. following scrollToIndex), focus the pending row once it mounts.
    const focusPendingRow = useCallback(() => {
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
    }, []);

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
            requestDelete(id: string) {
                const note = notes.find((n) => n.id === id);
                if (note) setDeleting({id, title: note.title});
            },
        }),
        [focusableId, notes, searchInputRef, beginRename, focusRowById],
    );

    const confirmDelete = () => {
        if (deleting) onDelete(deleting.id);
        setDeleting(null);
    };

    // Keep the title rendered through the Dialog's ~150ms close animation: `deleting` clears on
    // confirm/cancel, so reading off it directly would blank the body mid-close. Display-only —
    // confirmDelete still reads live `deleting`.
    const deletingView = useHeldValue(deleting);

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
            // alone — the same modifier convention as ⌘↵ here and ⌘-click in the recents submenu.
            // Without the callback (web) the modifier is ignored and the click browses as usual.
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

    const onOpenIconPicker = useCallback((noteId: string, anchor: HTMLElement) => {
        setIconPicker((open) => (open?.noteId === noteId ? null : {noteId, anchor}));
    }, []);

    // Route a pick to the note whose glyph opened the popup. Skipped — deliberately, instead of
    // writing icon metadata for a dead id — if that note just left the list (e.g. a blur-committed
    // title rename landed between open and pick); the close effect above retires the popup a tick
    // later. Stable identity so the memoized popup skips scroll-driven list re-renders.
    const onPickIcon = useCallback((name: string) => {
        const {iconPicker: open, noteIds: ids, onSetIcon: setIcon} = live.current;
        if (open && ids.includes(open.noteId)) setIcon(open.noteId, name);
    }, []);

    const onIconPickerOpenChange = useCallback((next: boolean) => {
        if (!next) setIconPicker(null);
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
            // Bare j/k mirror the arrow keys (vim-style). Guarded against modifiers so ⌘⇧J
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
                    // From a focused row-level button (icon glyph, ⋯ actions), Enter must activate
                    // the button — preventDefault on the bubbled keydown would cancel the button's
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

    // The per-note action list, shared by the row's ⋯ menu and the right-click context menu. Delete
    // is its own group, so the menu draws its one hairline above it.
    const noteMenuItems = (note: NoteMeta) => {
        const pinned = pinnedSet.has(note.id);
        return [
            [
                // Desktop only: a per-note window. First, like Apple Notes' context menu (⌘↵ too).
                ...(onOpenInNewWindow
                    ? [
                          {
                              text: 'Open in New Window',
                              iconStart: <NewWindow size={16} />,
                              iconEnd: menuHint(shortcutHint('mod+enter')),
                              action: () => onOpenInNewWindow(note.id),
                          },
                      ]
                    : []),
                {
                    text: pinned ? 'Unpin' : 'Pin to top',
                    iconStart: pinned ? <PinSlash size={16} /> : <Pin size={16} />,
                    action: () => onTogglePin(note.id),
                },
                {
                    text: 'Rename',
                    iconStart: <Pencil size={16} />,
                    iconEnd: menuHint('F2'),
                    action: () => beginRename(note.id, note.title),
                },
                {
                    text: 'Move to…',
                    iconStart: <ArrowRight size={16} />,
                    iconEnd: menuHint(shortcutHint('mod+shift+m')),
                    action: () => onRequestMove(note.id),
                },
                {
                    text: 'Duplicate',
                    iconStart: <Copy size={16} />,
                    iconEnd: menuHint(shortcutHint('mod+d')),
                    action: () => onDuplicate(note.id),
                },
                // Desktop only: revealed in Finder when the backend supports it.
                ...(onReveal
                    ? [
                          {
                              text: 'Reveal in Finder',
                              iconStart: <FolderOpen size={16} />,
                              action: () => onReveal(note.id),
                          },
                      ]
                    : []),
            ],
            [
                {
                    text: 'Delete',
                    theme: 'danger' as const,
                    iconStart: <Trash size={16} />,
                    iconEnd: menuHint(shortcutHint('mod+shift+backspace')),
                    action: () => setDeleting({id: note.id, title: note.title}),
                },
            ],
        ];
    };

    // Empty-state copy, tailored to context: a no-match search, an empty selected folder, or a
    // truly empty store.
    const renderEmpty = () => {
        const q = query.trim();
        if (q) {
            return (
                <>
                    <p className="note-list__empty-line">Nothing matches “{q}”</p>
                    <p className="note-list__empty-hint">
                        Search covers titles and bodies across every folder.
                    </p>
                    <p className="note-list__empty-create">
                        Create “{q}” <kbd className="note-list__kbd">↵</kbd>
                    </p>
                </>
            );
        }
        return (
            <>
                <Folder size={26} className="note-list__empty-glyph" />
                <p className="note-list__empty-line">
                    {scopeLabel ? `No notes in “${scopeLabel}”` : 'No notes yet'}
                </p>
                <p className="note-list__empty-hint">
                    {scopeLabel ? '“New” adds a note here' : 'Type to search, or press ↵ to create'}
                </p>
            </>
        );
    };

    return (
        <div className="note-list">
            <div className="note-list__toolbar">
                {/* `selected` doubles as the state signal: Gravity renders it as `aria-pressed`
                    (a raw aria-pressed prop would be clobbered), plus the pressed look. */}
                <Button
                    className="note-list__folders-toggle"
                    view="flat"
                    size="m"
                    aria-label="Folders"
                    title={railOpen ? 'Hide folders (⌘⇧\\)' : 'Show folders (⌘⇧\\)'}
                    selected={railOpen}
                    onClick={onToggleRail}
                >
                    <Button.Icon>
                        <Folder size={15} />
                    </Button.Icon>
                </Button>
                <Select
                    className="note-list__sort"
                    aria-label="Sort notes"
                    view="clear"
                    size="s"
                    value={[sortMode]}
                    onUpdate={([next]) => {
                        if (next) onSortChange(next as SortMode);
                    }}
                    options={SORT_OPTIONS}
                />
                <div className="note-list__toolbar-gap" />
                {/* aria-label keeps the name stable when the tight-width container query (see
                    NoteList.css) hides the text and leaves the icon. */}
                <Button
                    className="note-list__new"
                    view="raised"
                    size="s"
                    aria-label="New"
                    onClick={() => onCreate()}
                >
                    <Button.Icon>
                        <Plus size={12} />
                    </Button.Icon>
                    New
                </Button>
            </div>

            {files.length > 0 ? (
                <div className="note-list__counts">
                    {notes.length} {notes.length === 1 ? 'note' : 'notes'} · {files.length}{' '}
                    {files.length === 1 ? 'file' : 'files'}
                </div>
            ) : null}

            {/* Scope chip: with the rail closed, a selected folder silently filters the list — name
                the scope, click-through to the folder tree, × back to All Notes. Hidden while a
                search is live (the list is global then) and whenever the rail already shows it. */}
            {!railOpen && scopeLabel && !query.trim() && onClearScope ? (
                <div className="note-list__scope">
                    <span
                        className="note-list__chip"
                        title={`Showing “${scopeLabel}” — click to open folders`}
                    >
                        <button
                            type="button"
                            className="note-list__chip-body"
                            onClick={onToggleRail}
                        >
                            <Folder size={12} className="note-list__chip-icon" />
                            <span className="note-list__chip-label">{scopeLabel}</span>
                        </button>
                        <button
                            type="button"
                            className="note-list__chip-dismiss"
                            aria-label="Show all notes"
                            onClick={onClearScope}
                        >
                            <Xmark size={10} />
                        </button>
                    </span>
                </div>
            ) : null}

            <NoteViewport
                ref={rowVirtualizerRef}
                count={notes.length + files.length}
                scrollRef={scrollRef}
                rowHeights={rowHeights}
                getItemKey={getItemKey}
                focusableIndex={focusableIndex}
                menuIndex={menuIndex}
                iconPickerIndex={iconPickerIndex}
                showCrumbs={showCrumbs}
                onItemsRendered={focusPendingRow}
            >
                {(rowVirtualizer) =>
                    rowVirtualizer.options.count === 0 ? (
                        <div role="listbox" aria-label="Notes" className="note-list__empty">
                            {renderEmpty()}
                        </div>
                    ) : (
                        // Spacer sized to the full list; each visible row is absolutely positioned at its
                        // offset. Only the windowed rows (getVirtualItems) are mounted.
                        <div style={{height: rowVirtualizer.getTotalSize(), position: 'relative'}}>
                            <div role="listbox" aria-label="Notes">
                                {rowVirtualizer
                                    .getVirtualItems()
                                    .filter((row) => row.index < notes.length)
                                    .map((virtualRow) => {
                                        const note = notes[virtualRow.index];
                                        return (
                                            <div
                                                key={virtualRow.key}
                                                data-index={virtualRow.index}
                                                style={{
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: 0,
                                                    width: '100%',
                                                    height: virtualRow.size,
                                                    transform: `translateY(${virtualRow.start}px)`,
                                                }}
                                            >
                                                <NoteRow
                                                    note={note}
                                                    selected={note.id === selectedId}
                                                    editing={note.id === editingId}
                                                    tabbable={
                                                        note.id !== editingId &&
                                                        note.id === focusableId
                                                    }
                                                    pinned={pinnedSet.has(note.id)}
                                                    previewText={
                                                        snippetById?.get(note.id) ??
                                                        note.preview ??
                                                        ''
                                                    }
                                                    crumb={
                                                        showCrumbs
                                                            ? formatCrumb(dirname(note.id))
                                                            : ''
                                                    }
                                                    terms={terms}
                                                    editValue={
                                                        note.id === editingId ? editValue : ''
                                                    }
                                                    editInputRef={editInputRef}
                                                    registerRef={registerRef}
                                                    menuOpen={menu?.note.id === note.id}
                                                    icon={icons[note.id]}
                                                    onOpenIconPicker={onOpenIconPicker}
                                                    showIcons={showIcons}
                                                    onClickRow={onClickRow}
                                                    onDoubleClickRow={onDoubleClickRow}
                                                    onContextMenuRow={onContextMenuRow}
                                                    onKeyDownRow={onKeyDownRow}
                                                    onOpenMenu={onOpenMenu}
                                                    onEditChange={setEditValue}
                                                    onEditCommit={onEditCommit}
                                                    onEditCancel={onEditCancel}
                                                />
                                            </div>
                                        );
                                    })}
                            </div>
                            {files.length > 0 ? (
                                <div role="list" aria-label="Other files">
                                    {rowVirtualizer
                                        .getVirtualItems()
                                        .filter((row) => row.index >= notes.length)
                                        .map((row) => {
                                            const file = files[row.index - notes.length];
                                            return (
                                                <div
                                                    key={row.key}
                                                    role="listitem"
                                                    data-index={row.index}
                                                    style={{
                                                        position: 'absolute',
                                                        top: 0,
                                                        left: 0,
                                                        width: '100%',
                                                        height: row.size,
                                                        transform: `translateY(${row.start}px)`,
                                                    }}
                                                >
                                                    <div
                                                        className="note-list__file"
                                                        title={`${file.name} — not a Markdown note`}
                                                    >
                                                        <FileText
                                                            size={15}
                                                            className="note-list__file-glyph"
                                                        />
                                                        <div className="note-list__file-info">
                                                            <span className="note-list__file-name">
                                                                {file.name}
                                                            </span>
                                                            <span className="note-list__file-meta">
                                                                {showCrumbs && dirname(file.id)
                                                                    ? `${formatCrumb(dirname(file.id))} · `
                                                                    : ''}
                                                                Not editable
                                                            </span>
                                                        </div>
                                                        {onReveal ? (
                                                            <Button
                                                                className="note-list__file-reveal"
                                                                view="flat"
                                                                size="s"
                                                                aria-label={`Reveal ${file.name} in Finder`}
                                                                onClick={() => onReveal(file.id)}
                                                                onKeyDown={(event) =>
                                                                    event.stopPropagation()
                                                                }
                                                            >
                                                                <Button.Icon>
                                                                    <FolderOpen size={15} />
                                                                </Button.Icon>
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            ) : null}
                        </div>
                    )
                }
            </NoteViewport>

            <Dialog
                open={deleting !== null}
                onClose={() => setDeleting(null)}
                onEnterKeyDown={confirmDelete}
                size="s"
                disableBodyScrollLock
            >
                <Dialog.Header caption="Move to Trash" />
                <Dialog.Body>
                    {deletingView
                        ? `Move "${deletingView.title}" to the Trash? You can restore it later from the Trash.`
                        : ''}
                </Dialog.Body>
                <Dialog.Footer
                    textButtonApply="Move to Trash"
                    textButtonCancel="Cancel"
                    propsButtonApply={{view: 'action'}}
                    onClickButtonApply={confirmDelete}
                    onClickButtonCancel={() => setDeleting(null)}
                />
            </Dialog>

            {/* The one shared action menu — controlled, anchored to whichever row's ⋯ button (or the
                cursor, for a right-click) opened it, so the list needs no per-row DropdownMenu. Gravity
                substitutes its default ⋯ switcher when renderSwitcher returns null/undefined, so return
                a hidden element instead — otherwise that kebab leaks in as a stray bottom-left button. */}
            <DropdownMenu
                open={menu !== null}
                onOpenToggle={(open: boolean) => {
                    if (!open) setMenu(null);
                }}
                renderSwitcher={() => <span hidden />}
                popupProps={{anchorElement: menu?.anchor, className: 'note-list__menu'}}
                items={menu ? noteMenuItems(menu.note) : []}
            />

            {/* The one shared icon picker — controlled, anchored to whichever row's glyph button
                opened it (see the `iconPicker` state above for why it isn't per-row). Handlers are
                stable and the popup memoized, so scroll-driven list re-renders skip it. */}
            <IconPickerPopup
                anchorElement={iconPicker?.anchor ?? null}
                value={iconPicker ? icons[iconPicker.noteId] : undefined}
                onChange={onPickIcon}
                onOpenChange={onIconPickerOpenChange}
            />
        </div>
    );
});
