import {forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject} from 'react';

import {
    Ellipsis,
    Folder,
    Folders,
    Pencil,
    Pin,
    PinFill,
    PinSlash,
    Plus,
    TrashBin,
} from '@gravity-ui/icons';
import {Button, Dialog, DropdownMenu, Icon, Select, Text, TextInput} from '@gravity-ui/uikit';

import {escapeRegExp, tokenizeQuery} from '../search';
import {dirname} from '../storage/noteText';
import type {NoteMeta, SortMode} from '../storage/types';

import './NoteList.css';

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
    onRename: (id: string, nextTitle: string) => void;
    onDelete: (id: string) => void;
    sortMode: SortMode;
    onSortChange: (mode: SortMode) => void;
    pinnedIds: readonly string[];
    onTogglePin: (id: string) => void;
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
            <mark key={i} className="note-list__match">
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

/** Folder path as a readable crumb: "Work/Sub" → "Work / Sub". */
function folderCrumb(id: string): string {
    return dirname(id).split('/').join(' / ');
}

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
        onRename,
        onDelete,
        sortMode,
        onSortChange,
        pinnedIds,
        onTogglePin,
        railOpen,
        onToggleRail,
        onFocusRail,
    },
    ref,
) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [deleting, setDeleting] = useState<{id: string; title: string} | null>(null);
    // Tokenized here (not threaded as a prop) so highlighting stays self-contained.
    const terms = useMemo(() => tokenizeQuery(query), [query]);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const editInputRef = useRef<HTMLInputElement>(null);

    const noteIds = useMemo(() => notes.map((note) => note.id), [notes]);

    // Focus the rename field when inline editing begins.
    useEffect(() => {
        if (editingId) editInputRef.current?.focus();
    }, [editingId]);

    // The note row that is tabbable: the selected one if visible, else the first note.
    const focusableId =
        selectedId && noteIds.includes(selectedId) ? selectedId : (noteIds[0] ?? null);

    // When an inline rename ends (commit or cancel), return keyboard focus to the list so
    // arrow-nav continues — the input unmounts first, otherwise focus is stranded on <body>.
    const wasEditingRef = useRef(false);
    useEffect(() => {
        if (wasEditingRef.current && editingId === null && focusableId) {
            itemRefs.current.get(focusableId)?.focus();
        }
        wasEditingRef.current = editingId !== null;
    }, [editingId, focusableId]);

    const beginRename = (id: string, title: string) => {
        setEditValue(title);
        setEditingId(id);
    };

    useImperativeHandle(
        ref,
        () => ({
            focusSelected() {
                const row = focusableId ? itemRefs.current.get(focusableId) : undefined;
                // Fall back to the search box when there's no visible note row (e.g. an empty
                // result set), so Esc from a lost-focus spot still lands somewhere useful.
                if (row) row.focus();
                else searchInputRef.current?.focus();
            },
            focusRow(id: string) {
                itemRefs.current.get(id)?.focus();
            },
            startRename(id: string) {
                const note = notes.find((n) => n.id === id);
                if (note) beginRename(id, note.title);
            },
        }),
        [focusableId, notes, searchInputRef],
    );

    const confirmDelete = () => {
        if (deleting) onDelete(deleting.id);
        setDeleting(null);
    };

    const commitRename = (id: string, title: string) => {
        const next = editValue.trim();
        setEditingId(null);
        if (next && next !== title) onRename(id, next);
    };

    /** Move the highlight to a row, preview it, and keep DOM focus on the list. */
    const browseRow = (id: string) => {
        onBrowse(id);
        itemRefs.current.get(id)?.focus();
    };

    const moveSelection = (fromId: string, delta: number) => {
        const index = noteIds.indexOf(fromId);
        if (index === -1) return;
        const next = noteIds[Math.min(Math.max(index + delta, 0), noteIds.length - 1)];
        if (next && next !== fromId) browseRow(next);
    };

    const onItemKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, id: string) => {
        if (editingId === id) return;
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
                if (railOpen) {
                    event.preventDefault();
                    onFocusRail();
                }
                break;
            case 'Enter':
                if (!bare) break; // ⌘/Ctrl+Enter is the global new-note shortcut — let it bubble
                event.preventDefault();
                onCommit(id);
                break;
            case 'Escape':
                event.preventDefault();
                onEscapeList();
                break;
        }
    };

    const renderNote = (note: NoteMeta) => {
        const selected = note.id === selectedId;
        const editing = note.id === editingId;
        const tabbable = !editing && note.id === focusableId;
        const pinned = pinnedIds.includes(note.id);
        // A full-text body match shows its surrounding snippet in place of the head-of-note preview.
        const previewText = snippetById?.get(note.id) ?? note.preview;
        const crumb = showCrumbs ? folderCrumb(note.id) : '';
        return (
            <div
                key={note.id}
                ref={(el) => {
                    if (el) itemRefs.current.set(note.id, el);
                    else itemRefs.current.delete(note.id);
                }}
                className={'note-list__item' + (selected ? ' note-list__item_selected' : '')}
                role="option"
                aria-selected={selected}
                tabIndex={tabbable ? 0 : -1}
                draggable={!editing}
                onDragStart={(e) => e.dataTransfer.setData('text/plain', note.id)}
                onClick={() => !editing && browseRow(note.id)}
                onKeyDown={(e) => onItemKeyDown(e, note.id)}
            >
                {editing ? (
                    <TextInput
                        className="note-list__edit"
                        controlRef={editInputRef}
                        value={editValue}
                        onUpdate={setEditValue}
                        onBlur={() => commitRename(note.id, note.title)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                                e.preventDefault();
                                commitRename(note.id, note.title);
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingId(null);
                            }
                        }}
                    />
                ) : (
                    <>
                        <div className="note-list__row">
                            {pinned ? (
                                <Icon
                                    className="note-list__pin"
                                    data={PinFill}
                                    size={14}
                                    aria-hidden
                                />
                            ) : null}
                            <Text className="note-list__title" ellipsis>
                                {highlightTerms(note.title, terms)}
                            </Text>
                            <div className="note-list__actions">
                                <DropdownMenu
                                    renderSwitcher={(props) => (
                                        <Button
                                            {...props}
                                            view="flat"
                                            size="s"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                props.onClick?.(e);
                                            }}
                                        >
                                            <Icon data={Ellipsis} />
                                        </Button>
                                    )}
                                    items={[
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
                                            text: 'Delete',
                                            theme: 'danger',
                                            iconStart: <Icon data={TrashBin} />,
                                            action: () =>
                                                setDeleting({id: note.id, title: note.title}),
                                        },
                                    ]}
                                />
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

            <div className="note-list__items" role="listbox" aria-label="Notes">
                {notes.length === 0 ? (
                    <div className="note-list__empty">{renderEmpty()}</div>
                ) : null}
                {notes.map(renderNote)}
            </div>

            <Dialog
                open={deleting !== null}
                onClose={() => setDeleting(null)}
                onEnterKeyDown={confirmDelete}
                size="s"
            >
                <Dialog.Header caption="Delete note" />
                <Dialog.Body>
                    <Text>
                        {deleting
                            ? `Delete "${deleting.title}"? This permanently removes the file from your folder.`
                            : ''}
                    </Text>
                </Dialog.Body>
                <Dialog.Footer
                    textButtonApply="Delete"
                    textButtonCancel="Cancel"
                    propsButtonApply={{view: 'outlined-danger'}}
                    onClickButtonApply={confirmDelete}
                    onClickButtonCancel={() => setDeleting(null)}
                />
            </Dialog>
        </div>
    );
});
