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
import type {KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject} from 'react';

import {
    Copy,
    Ellipsis,
    Folder,
    FolderOpen,
    Folders,
    Pencil,
    Pin,
    PinFill,
    PinSlash,
    Plus,
    TrashBin,
} from '@gravity-ui/icons';
import {Button, Dialog, DropdownMenu, Icon, Select, Text, TextInput} from '@gravity-ui/uikit';
import {defaultRangeExtractor, useVirtualizer} from '@tanstack/react-virtual';

import {useHeldValue} from '../hooks/useHeldValue';
import {escapeRegExp, tokenizeQuery} from '../search';
import {dirname, formatCrumb} from '../storage/noteText';
import type {NoteMeta, SortMode} from '../storage/types';

import {IconPicker} from './IconPicker';

import './NoteList.css';

/**
 * dataTransfer type carrying a dragged note's id; the folder rail gates note drops on it so foreign
 * `text/plain` drags can't be moved into a folder. Must match `NOTE_MIME` in FolderRail.
 */
const NOTE_MIME = 'application/x-gravity-note';

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
    /** Esc on a focused row: close the open note and return to search. */
    onEscapeList: () => void;
    /** Create a note in the currently-selected folder. */
    onCreate: () => void;
    /** Ask to move a note — opens the "Move to…" picker (owned by the workspace). */
    onRequestMove: (id: string) => void;
    /** Duplicate a note (shares its attachments). */
    onDuplicate: (id: string) => void;
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
    /** Whether the folder rail is shown (drives the toggle button state + ← behavior). */
    railOpen: boolean;
    /** Show / hide the folder rail. */
    onToggleRail: () => void;
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
    icon?: string;
    onSetIcon: (id: string, icon: string) => void;
    onClickRow: (id: string) => void;
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
    icon,
    onSetIcon,
    onClickRow,
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
            onClick={() => onClickRow(note.id)}
            onContextMenu={(e) => {
                e.preventDefault();
                onContextMenuRow(note, e.clientX, e.clientY);
            }}
            onKeyDown={(e) => onKeyDownRow(e, note.id)}
        >
            {editing ? (
                <TextInput
                    className="note-list__edit"
                    controlRef={editInputRef}
                    value={editValue}
                    onUpdate={onEditChange}
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
                    <div className="note-list__row">
                        <IconPicker
                            className="note-list__icon"
                            size="s"
                            value={icon}
                            onChange={(name) => onSetIcon(note.id, name)}
                        />
                        {pinned ? (
                            <Icon className="note-list__pin" data={PinFill} size={14} aria-hidden />
                        ) : null}
                        <Text className="note-list__title" ellipsis>
                            {highlightTerms(note.title, terms)}
                        </Text>
                        <div className="note-list__actions">
                            <Button
                                view="flat"
                                size="s"
                                aria-label="Note actions"
                                onClick={(e) => {
                                    // Don't browse the row; open the one shared menu anchored to
                                    // this button (the parent toggles it off if it's already this row's).
                                    e.stopPropagation();
                                    onOpenMenu(note, e.currentTarget);
                                }}
                            >
                                <Icon data={Ellipsis} />
                            </Button>
                        </div>
                    </div>
                    <div className="note-list__meta">
                        <Text variant="caption-2" color="secondary" className="note-list__date">
                            {formatNoteDate(note.updatedAt)}
                        </Text>
                        {previewText ? (
                            <Text
                                variant="caption-2"
                                color="secondary"
                                className="note-list__preview"
                                ellipsis
                            >
                                {highlightTerms(previewText, terms)}
                            </Text>
                        ) : null}
                    </div>
                    {crumb ? (
                        // Apple-Notes-style folder chip: which folder this note lives in, shown
                        // when the list spans folders (All Notes / search). Its own line below.
                        <div className="note-list__folder">
                            <Icon
                                data={Folder}
                                size={12}
                                className="note-list__folder-icon"
                                aria-hidden
                            />
                            <Text
                                variant="caption-2"
                                color="secondary"
                                className="note-list__folder-name"
                                ellipsis
                            >
                                {crumb}
                            </Text>
                        </div>
                    ) : null}
                </>
            )}
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
        onEscapeList,
        onCreate,
        onRequestMove,
        onDuplicate,
        onReveal,
        onRename,
        onDelete,
        sortMode,
        onSortChange,
        pinnedIds,
        onTogglePin,
        icons,
        onSetIcon,
        railOpen,
        onToggleRail,
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
        onEscapeList,
        onFocusRail,
        onRename,
    });
    live.current = {
        noteIds,
        editingId,
        editValue,
        railOpen,
        onBrowse,
        onCommit,
        onEscapeList,
        onFocusRail,
        onRename,
    };

    // Virtualize the rows: a folder can hold thousands of notes, and mounting every row (each a few
    // Gravity components) blows out first-paint, memory, and scroll. The virtualizer renders only the
    // visible window (+overscan) and grows the scroll area to the full measured height. Rows are
    // variable-height (the folder crumb adds a line), so heights are measured per row.
    const scrollRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
        count: notes.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 56,
        overscan: 8,
        getItemKey: (index) => notes[index].id,
        // Always render the roving-tabindex (selected) row, even when it's scrolled out of the window,
        // so the list always has a keyboard-focusable element and focusing it never needs an async
        // scroll-then-mount. A fresh closure per render keeps the forced index current.
        rangeExtractor: (range) => {
            const indexes = defaultRangeExtractor(range);
            if (focusableIndex >= 0 && !indexes.includes(focusableIndex)) {
                indexes.push(focusableIndex);
                indexes.sort((a, b) => a - b);
            }
            return indexes;
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
            const index = live.current.noteIds.indexOf(id);
            if (index === -1) return;
            pendingFocusRef.current = id;
            rowVirtualizer.scrollToIndex(index);
        },
        [rowVirtualizer],
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
        if (editingId) editInputRef.current?.focus();
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
        (id: string) => {
            if (live.current.editingId !== id) browseRow(id);
        },
        [browseRow],
    );

    const onContextMenuRow = useCallback(
        (note: NoteMeta, x: number, y: number) => {
            if (live.current.editingId === note.id) return;
            browseRow(note.id);
            setMenu({note, anchor: {getBoundingClientRect: () => new DOMRect(x, y, 0, 0)}});
        },
        [browseRow],
    );

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
                case 'Enter':
                    if (!bare) break; // ⌘/Ctrl+Enter is the global new-note shortcut — let it bubble
                    event.preventDefault();
                    commit(id);
                    break;
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

    // The per-note action list, shared by the row's ⋯ menu and the right-click context menu.
    const noteMenuItems = (note: NoteMeta) => {
        const pinned = pinnedSet.has(note.id);
        return [
            {
                text: pinned ? 'Unpin' : 'Pin to top',
                iconStart: <Icon data={pinned ? PinSlash : Pin} />,
                action: () => onTogglePin(note.id),
            },
            {
                text: 'Rename',
                iconStart: <Icon data={Pencil} />,
                action: () => beginRename(note.id, note.title),
            },
            {
                text: 'Move to…',
                iconStart: <Icon data={Folder} />,
                action: () => onRequestMove(note.id),
            },
            {
                text: 'Duplicate',
                iconStart: <Icon data={Copy} />,
                action: () => onDuplicate(note.id),
            },
            // Desktop only: revealed in Finder when the backend supports it.
            ...(onReveal
                ? [
                      {
                          text: 'Reveal in Finder',
                          iconStart: <Icon data={FolderOpen} />,
                          action: () => onReveal(note.id),
                      },
                  ]
                : []),
            {
                text: 'Delete',
                theme: 'danger' as const,
                iconStart: <Icon data={TrashBin} />,
                action: () => setDeleting({id: note.id, title: note.title}),
            },
        ];
    };

    // Empty-state copy, tailored to context: a no-match search, an empty selected folder, or a
    // truly empty store. A quiet second line points at the way to add a note.
    const renderEmpty = () => {
        const q = query.trim();
        if (q) return <Text color="secondary">No match — press Enter to create “{q}”</Text>;
        if (scopeLabel) {
            return (
                <>
                    <Text color="secondary">No notes in “{scopeLabel}”</Text>
                    <Text color="hint" variant="caption-2">
                        “New” adds a note here
                    </Text>
                </>
            );
        }
        return (
            <>
                <Text color="secondary">No notes yet</Text>
                <Text color="hint" variant="caption-2">
                    Type to search, or press Enter to create
                </Text>
            </>
        );
    };

    return (
        <div className="note-list">
            <div className="note-list__toolbar">
                <Button
                    view="flat"
                    size="m"
                    selected={railOpen}
                    aria-label={railOpen ? 'Hide folders' : 'Show folders'}
                    aria-pressed={railOpen}
                    onClick={onToggleRail}
                >
                    <Icon data={Folders} />
                </Button>
                <Select
                    className="note-list__sort"
                    aria-label="Sort notes"
                    size="m"
                    width="max"
                    value={[sortMode]}
                    onUpdate={([next]) => {
                        if (next) onSortChange(next as SortMode);
                    }}
                    options={[
                        {value: 'updated', content: 'Updated'},
                        {value: 'title', content: 'Title (A→Z)'},
                        {value: 'title-desc', content: 'Title (Z→A)'},
                        {value: 'created', content: 'Created'},
                    ]}
                />
                <Button view="normal" size="m" onClick={() => onCreate()}>
                    <Icon data={Plus} />
                    New
                </Button>
            </div>

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
                    // measured offset. Only the windowed rows (getVirtualItems) are mounted.
                    <div style={{height: rowVirtualizer.getTotalSize(), position: 'relative'}}>
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            const note = notes[virtualRow.index];
                            return (
                                <div
                                    key={virtualRow.key}
                                    data-index={virtualRow.index}
                                    ref={rowVirtualizer.measureElement}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    <NoteRow
                                        note={note}
                                        selected={note.id === selectedId}
                                        editing={note.id === editingId}
                                        tabbable={note.id !== editingId && note.id === focusableId}
                                        pinned={pinnedSet.has(note.id)}
                                        previewText={
                                            snippetById?.get(note.id) ?? note.preview ?? ''
                                        }
                                        crumb={showCrumbs ? formatCrumb(dirname(note.id)) : ''}
                                        terms={terms}
                                        editValue={note.id === editingId ? editValue : ''}
                                        editInputRef={editInputRef}
                                        registerRef={registerRef}
                                        icon={icons[note.id]}
                                        onSetIcon={onSetIcon}
                                        onClickRow={onClickRow}
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
                )}
            </div>

            <Dialog
                open={deleting !== null}
                onClose={() => setDeleting(null)}
                onEnterKeyDown={confirmDelete}
                size="s"
                disableBodyScrollLock
            >
                <Dialog.Header caption="Move to Trash" />
                <Dialog.Body>
                    <Text>
                        {deletingView
                            ? `Move "${deletingView.title}" to the Trash? You can restore it later from the Trash.`
                            : ''}
                    </Text>
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
                popupProps={{anchorElement: menu?.anchor}}
                items={menu ? noteMenuItems(menu.note) : []}
            />
        </div>
    );
});
