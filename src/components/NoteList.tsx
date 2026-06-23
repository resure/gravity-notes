import {forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject} from 'react';

import {
    ChevronDown,
    ChevronRight,
    Ellipsis,
    Folder,
    FolderPlus,
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
import type {SortMode} from '../storage/types';
import type {TreeRow} from '../tree';

import './NoteList.css';

export interface NoteListHandle {
    /** Move keyboard focus to the selected row, or the search box if the list is empty. */
    focusSelected(): void;
    /** Move keyboard focus to a specific row (used when ↓/↑ enters the list from search). */
    focusRow(id: string): void;
    /** Begin inline-renaming the given note (used by the global F2 shortcut). */
    startRename(id: string): void;
    /** Open the "Move to…" folder picker for the given note (used by the global ⌘⇧M shortcut). */
    startMove(id: string): void;
}

export interface NoteListProps {
    /** The visible rows: the folder tree, or a flat list of note rows when searching. */
    rows: TreeRow[];
    selectedId: string | null;
    /** The active search query — for match highlighting and the empty-state hint. */
    query: string;
    /** Show each note's folder path as a dimmed crumb (flat search mode, where headers are absent). */
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
    /** Create a note (optionally inside `parentPath`). */
    onCreate: (title?: string, parentPath?: string) => void;
    /** Create an (initially empty) folder. */
    onCreateFolder: (parentPath: string, name: string) => void;
    /** Remove an empty folder. */
    onRemoveFolder: (path: string) => void;
    /** Collapse/expand a folder. */
    onToggleCollapse: (path: string) => void;
    /** All folder paths, for the "Move to…" picker. */
    folderPaths: string[];
    /** Move a note into a folder (`''` = root) — the drag-drop and picker target. */
    onMoveTo: (id: string, destFolder: string) => void;
    onRename: (id: string, nextTitle: string) => void;
    onDelete: (id: string) => void;
    sortMode: SortMode;
    onSortChange: (mode: SortMode) => void;
    pinnedIds: readonly string[];
    /** Toggle a pin — works on a note id or a folder path. */
    onTogglePin: (id: string) => void;
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

/** Left padding (px) for a row at the given tree depth (depth 0 matches the toolbar inset). */
function indentFor(depth: number): number {
    return 16 + depth * 16;
}

export const NoteList = forwardRef<NoteListHandle, NoteListProps>(function NoteList(
    {
        rows,
        selectedId,
        query,
        showCrumbs,
        snippetById,
        searchInputRef,
        onBrowse,
        onCommit,
        onEscapeList,
        onCreate,
        onCreateFolder,
        onRemoveFolder,
        onToggleCollapse,
        folderPaths,
        onMoveTo,
        onRename,
        onDelete,
        sortMode,
        onSortChange,
        pinnedIds,
        onTogglePin,
    },
    ref,
) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [deleting, setDeleting] = useState<{id: string; title: string} | null>(null);
    // The parent path for a pending New-folder dialog (null = closed); '' = create at the root.
    const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
    const [newFolderName, setNewFolderName] = useState('');
    // The note whose "Move to…" picker is open (null = closed); and the folder being dragged over.
    const [movingNote, setMovingNote] = useState<{id: string; title: string} | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    // Tokenized here (not threaded as a prop) so highlighting stays self-contained.
    const terms = useMemo(() => tokenizeQuery(query), [query]);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const editInputRef = useRef<HTMLInputElement>(null);
    const newFolderInputRef = useRef<HTMLInputElement>(null);

    // The note ids the keyboard cursor moves over — visible note rows only (folder headers skipped).
    const noteIds = useMemo(
        () => rows.flatMap((row) => (row.kind === 'note' ? [row.note.id] : [])),
        [rows],
    );

    // Focus the rename field when inline editing begins.
    useEffect(() => {
        if (editingId) editInputRef.current?.focus();
    }, [editingId]);

    useEffect(() => {
        if (newFolderParent !== null) newFolderInputRef.current?.focus();
    }, [newFolderParent]);

    // The note row that is tabbable: the selected one if visible, else the first visible note.
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
                const row = rows.find((r) => r.kind === 'note' && r.note.id === id);
                if (row && row.kind === 'note') beginRename(id, row.note.title);
            },
            startMove(id: string) {
                const row = rows.find((r) => r.kind === 'note' && r.note.id === id);
                if (row && row.kind === 'note') setMovingNote({id, title: row.note.title});
            },
        }),
        [focusableId, rows, searchInputRef],
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

    const submitNewFolder = () => {
        const name = newFolderName.trim();
        const parent = newFolderParent;
        setNewFolderParent(null);
        setNewFolderName('');
        if (parent !== null && name) onCreateFolder(parent, name);
    };

    const cancelNewFolder = () => {
        setNewFolderParent(null);
        setNewFolderName('');
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

    const pinnedSet = new Set(pinnedIds);

    const renderFolder = (row: Extract<TreeRow, {kind: 'folder'}>) => (
        <div
            key={`folder:${row.path}`}
            className={
                'note-list__folder' +
                (dropTarget === row.path ? ' note-list__folder_drop-target' : '')
            }
            style={{paddingInlineStart: indentFor(row.depth)}}
            onDragOver={(e) => {
                e.preventDefault(); // allow drop
                if (dropTarget !== row.path) setDropTarget(row.path);
            }}
            onDragLeave={() => setDropTarget((t) => (t === row.path ? null : t))}
            onDrop={(e) => {
                e.preventDefault();
                setDropTarget(null);
                const id = e.dataTransfer.getData('text/plain');
                if (id) onMoveTo(id, row.path);
            }}
        >
            {/* The whole disclosure (caret + folder icon + name) is one button: keyboard-toggleable
                and avoiding a non-interactive div with a click handler. The ＋/menu are siblings. */}
            <Button
                className="note-list__folder-toggle"
                view="flat"
                size="s"
                width="max"
                aria-expanded={!row.collapsed}
                aria-label={`${row.collapsed ? 'Expand' : 'Collapse'} ${row.name}`}
                onClick={() => onToggleCollapse(row.path)}
            >
                <Icon data={row.collapsed ? ChevronRight : ChevronDown} size={14} />
                <Icon data={Folder} size={14} />
                {pinnedSet.has(row.path) ? (
                    <Icon className="note-list__pin" data={PinFill} size={12} />
                ) : null}
                <span className="note-list__folder-name">{row.name}</span>
            </Button>
            <div className="note-list__actions">
                <Button
                    view="flat"
                    size="s"
                    aria-label={`New note in ${row.name}`}
                    onClick={() => onCreate(undefined, row.path)}
                >
                    <Icon data={Plus} />
                </Button>
                <DropdownMenu
                    renderSwitcher={(props) => (
                        <Button {...props} view="flat" size="s" aria-label="Folder actions">
                            <Icon data={Ellipsis} />
                        </Button>
                    )}
                    items={[
                        {
                            text: pinnedSet.has(row.path) ? 'Unpin' : 'Pin to top',
                            iconStart: <Icon data={pinnedSet.has(row.path) ? PinSlash : Pin} />,
                            action: () => onTogglePin(row.path),
                        },
                        {
                            text: 'New subfolder',
                            iconStart: <Icon data={FolderPlus} />,
                            action: () => setNewFolderParent(row.path),
                        },
                        {
                            text: 'Delete folder',
                            theme: 'danger',
                            iconStart: <Icon data={TrashBin} />,
                            // Only empty folders can be removed (the file delete is per-note).
                            disabled: row.hasChildren,
                            action: () => onRemoveFolder(row.path),
                        },
                    ]}
                />
            </div>
        </div>
    );

    const renderNote = (row: Extract<TreeRow, {kind: 'note'}>) => {
        const note = row.note;
        const selected = note.id === selectedId;
        const editing = note.id === editingId;
        const tabbable = !editing && note.id === focusableId;
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
                style={{paddingInlineStart: indentFor(row.depth)}}
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
                            {row.pinned ? (
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
                                            text: row.pinned ? 'Unpin' : 'Pin to top',
                                            iconStart: <Icon data={row.pinned ? PinSlash : Pin} />,
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
                                            action: () =>
                                                setMovingNote({id: note.id, title: note.title}),
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
                            {crumb ? (
                                <Text
                                    variant="caption-2"
                                    color="secondary"
                                    className="note-list__crumb"
                                    ellipsis
                                >
                                    {crumb}
                                </Text>
                            ) : null}
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
                    </>
                )}
            </div>
        );
    };

    return (
        <div className="note-list">
            <div className="note-list__toolbar">
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
                <Button
                    view="normal"
                    size="m"
                    aria-label="New folder"
                    onClick={() => setNewFolderParent('')}
                >
                    <Icon data={FolderPlus} />
                </Button>
                <Button view="normal" size="m" onClick={() => onCreate()}>
                    <Icon data={Plus} />
                    New
                </Button>
            </div>

            <div className="note-list__items" role="listbox" aria-label="Notes">
                {newFolderParent === null ? null : (
                    <div
                        className="note-list__folder-new"
                        style={{
                            paddingInlineStart: indentFor(
                                newFolderParent ? newFolderParent.split('/').length : 0,
                            ),
                        }}
                    >
                        <Icon
                            className="note-list__folder-icon"
                            data={Folder}
                            size={14}
                            aria-hidden
                        />
                        <TextInput
                            className="note-list__edit"
                            controlRef={newFolderInputRef}
                            placeholder="Folder name"
                            value={newFolderName}
                            onUpdate={setNewFolderName}
                            onBlur={submitNewFolder}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    submitNewFolder();
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancelNewFolder();
                                }
                            }}
                        />
                    </div>
                )}
                {rows.length === 0 && newFolderParent === null ? (
                    <div className="note-list__empty">
                        <Text color="secondary">
                            {query.trim()
                                ? `No match — press Enter to create "${query.trim()}"`
                                : 'No notes yet. Create your first one.'}
                        </Text>
                    </div>
                ) : (
                    rows.map((row) => (row.kind === 'folder' ? renderFolder(row) : renderNote(row)))
                )}
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

            <Dialog open={movingNote !== null} onClose={() => setMovingNote(null)} size="s">
                <Dialog.Header caption={movingNote ? `Move “${movingNote.title}” to…` : 'Move'} />
                <Dialog.Body>
                    <div className="note-list__move-list">
                        <Button
                            view="flat"
                            width="max"
                            onClick={() => {
                                if (movingNote) onMoveTo(movingNote.id, '');
                                setMovingNote(null);
                            }}
                        >
                            <Icon data={Folder} /> Root
                        </Button>
                        {folderPaths.map((path) => (
                            <Button
                                key={path}
                                className="note-list__move-option"
                                view="flat"
                                width="max"
                                onClick={() => {
                                    if (movingNote) onMoveTo(movingNote.id, path);
                                    setMovingNote(null);
                                }}
                            >
                                <Icon data={Folder} /> {path}
                            </Button>
                        ))}
                    </div>
                </Dialog.Body>
                <Dialog.Footer
                    textButtonCancel="Cancel"
                    onClickButtonCancel={() => setMovingNote(null)}
                />
            </Dialog>
        </div>
    );
});
