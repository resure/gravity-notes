import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject} from 'react';

import {Ellipsis, Pencil, Pin, PinFill, PinSlash, Plus, TrashBin} from '@gravity-ui/icons';
import {Button, Dialog, DropdownMenu, Icon, Select, Text, TextInput} from '@gravity-ui/uikit';

import type {NoteMeta, SortMode} from '../storage/types';

import './NoteList.css';

export interface NoteListHandle {
    /** Move keyboard focus to the selected row (used when leaving the editor). */
    focusSelected(): void;
    /** Begin inline-renaming the given note (used by the global F2 shortcut). */
    startRename(id: string): void;
}

export interface NoteListProps {
    notes: NoteMeta[];
    selectedId: string | null;
    query: string;
    onQueryChange: (query: string) => void;
    searchInputRef: RefObject<HTMLInputElement>;
    /** Preview a note (move the highlight): arrow nav, single click, ↓/↑ from the search box. */
    onBrowse: (id: string) => void;
    /** Open a note for editing: Enter on a row, Enter in the search box (top match). */
    onCommit: (id: string) => void;
    /** Esc on a focused row (or in an empty search box): close the open note. */
    onEscapeList: () => void;
    onCreate: () => void;
    onRename: (id: string, nextTitle: string) => void;
    onDelete: (id: string) => void;
    sortMode: SortMode;
    onSortChange: (mode: SortMode) => void;
    pinnedIds: readonly string[];
    onTogglePin: (id: string) => void;
}

function highlightMatch(title: string, query: string): ReactNode {
    const q = query.trim();
    if (!q) return title;
    const idx = title.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return title;
    return (
        <>
            {title.slice(0, idx)}
            <mark className="note-list__match">{title.slice(idx, idx + q.length)}</mark>
            {title.slice(idx + q.length)}
        </>
    );
}

export const NoteList = forwardRef<NoteListHandle, NoteListProps>(function NoteList(
    {
        notes,
        selectedId,
        query,
        onQueryChange,
        searchInputRef,
        onBrowse,
        onCommit,
        onEscapeList,
        onCreate,
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
    const [deleting, setDeleting] = useState<NoteMeta | null>(null);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const editInputRef = useRef<HTMLInputElement>(null);

    // Focus the rename field when inline editing begins.
    useEffect(() => {
        if (editingId) editInputRef.current?.focus();
    }, [editingId]);

    // The item that is tabbable: the selected one, else the first.
    const focusableId =
        selectedId && notes.some((n) => n.id === selectedId) ? selectedId : (notes[0]?.id ?? null);

    // When an inline rename ends (commit or cancel), return keyboard focus to the list so
    // arrow-nav continues — the input unmounts first, otherwise focus is stranded on <body>.
    // Done in an effect (after the unmount), not synchronously, so a cancel doesn't blur-commit.
    const wasEditingRef = useRef(false);
    useEffect(() => {
        if (wasEditingRef.current && editingId === null && focusableId) {
            itemRefs.current.get(focusableId)?.focus();
        }
        wasEditingRef.current = editingId !== null;
    }, [editingId, focusableId]);

    const beginRename = (note: NoteMeta) => {
        setEditValue(note.title);
        setEditingId(note.id);
    };

    useImperativeHandle(
        ref,
        () => ({
            focusSelected() {
                if (focusableId) itemRefs.current.get(focusableId)?.focus();
            },
            startRename(id: string) {
                const note = notes.find((n) => n.id === id);
                if (note) beginRename(note);
            },
        }),
        [focusableId, notes],
    );

    const confirmDelete = () => {
        if (deleting) onDelete(deleting.id);
        setDeleting(null);
    };

    const commitRename = (note: NoteMeta) => {
        const next = editValue.trim();
        setEditingId(null);
        if (next && next !== note.title) {
            onRename(note.id, next);
        }
    };

    /** Move the highlight to a row, preview it, and keep DOM focus on the list. */
    const browseRow = (id: string) => {
        onBrowse(id);
        itemRefs.current.get(id)?.focus();
    };

    const moveSelection = (fromId: string, delta: number) => {
        const index = notes.findIndex((n) => n.id === fromId);
        if (index === -1) return;
        const next = notes[Math.min(Math.max(index + delta, 0), notes.length - 1)];
        if (next && next.id !== fromId) browseRow(next.id);
    };

    const onItemKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, note: NoteMeta) => {
        if (editingId === note.id) return;
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                moveSelection(note.id, 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                moveSelection(note.id, -1);
                break;
            case 'Enter':
                event.preventDefault();
                onCommit(note.id);
                break;
            case 'Escape':
                event.preventDefault();
                onEscapeList();
                break;
        }
    };

    const pinnedSet = new Set(pinnedIds);

    const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && notes.length > 0) {
            event.preventDefault();
            onCommit(notes[0].id);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            if (query) onQueryChange('');
            else onEscapeList();
        } else if (event.key === 'ArrowDown' && notes.length > 0) {
            event.preventDefault();
            const target =
                selectedId && notes.some((n) => n.id === selectedId) ? selectedId : notes[0].id;
            browseRow(target);
        } else if (event.key === 'ArrowUp' && notes.length > 0) {
            event.preventDefault();
            const target =
                selectedId && notes.some((n) => n.id === selectedId)
                    ? selectedId
                    : notes[notes.length - 1].id;
            browseRow(target);
        }
    };

    return (
        <div className="note-list">
            <div className="note-list__header">
                <Text variant="subheader-2">Notes</Text>
                <div className="note-list__header-actions">
                    <Select
                        className="note-list__sort"
                        aria-label="Sort notes"
                        size="m"
                        value={[sortMode]}
                        onUpdate={([next]) => {
                            if (next) onSortChange(next as SortMode);
                        }}
                        options={[
                            {value: 'updated', content: 'Updated'},
                            {value: 'title', content: 'Title (A→Z)'},
                            {value: 'created', content: 'Created'},
                        ]}
                    />
                    <Button view="action" size="m" onClick={onCreate}>
                        <Icon data={Plus} />
                        New
                    </Button>
                </div>
            </div>

            <div className="note-list__search">
                <TextInput
                    controlRef={searchInputRef}
                    value={query}
                    onUpdate={onQueryChange}
                    placeholder="Search"
                    hasClear
                    onKeyDown={onSearchKeyDown}
                />
            </div>

            <div className="note-list__items" role="listbox" aria-label="Notes">
                {notes.length === 0 ? (
                    <div className="note-list__empty">
                        <Text color="secondary">
                            {query
                                ? `No notes match "${query}".`
                                : 'No notes yet. Create your first one.'}
                        </Text>
                    </div>
                ) : (
                    notes.map((note) => {
                        const selected = note.id === selectedId;
                        const editing = note.id === editingId;
                        const tabbable = !editing && note.id === focusableId;
                        return (
                            <div
                                key={note.id}
                                ref={(el) => {
                                    if (el) itemRefs.current.set(note.id, el);
                                    else itemRefs.current.delete(note.id);
                                }}
                                className={
                                    'note-list__item' +
                                    (selected ? ' note-list__item_selected' : '')
                                }
                                role="option"
                                aria-selected={selected}
                                tabIndex={tabbable ? 0 : -1}
                                onClick={() => !editing && browseRow(note.id)}
                                onDoubleClick={() => beginRename(note)}
                                onKeyDown={(e) => onItemKeyDown(e, note)}
                            >
                                {editing ? (
                                    <TextInput
                                        className="note-list__edit"
                                        controlRef={editInputRef}
                                        value={editValue}
                                        onUpdate={setEditValue}
                                        onBlur={() => commitRename(note)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                commitRename(note);
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault();
                                                setEditingId(null);
                                            }
                                        }}
                                    />
                                ) : (
                                    <>
                                        {pinnedSet.has(note.id) ? (
                                            <Icon
                                                className="note-list__pin"
                                                data={PinFill}
                                                size={14}
                                                aria-hidden
                                            />
                                        ) : null}
                                        <Text className="note-list__title" ellipsis>
                                            {highlightMatch(note.title, query)}
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
                                                        text: pinnedSet.has(note.id)
                                                            ? 'Unpin'
                                                            : 'Pin to top',
                                                        iconStart: (
                                                            <Icon
                                                                data={
                                                                    pinnedSet.has(note.id)
                                                                        ? PinSlash
                                                                        : Pin
                                                                }
                                                            />
                                                        ),
                                                        action: () => onTogglePin(note.id),
                                                    },
                                                    {
                                                        text: 'Rename',
                                                        iconStart: <Icon data={Pencil} />,
                                                        action: () => beginRename(note),
                                                    },
                                                    {
                                                        text: 'Delete',
                                                        theme: 'danger',
                                                        iconStart: <Icon data={TrashBin} />,
                                                        action: () => setDeleting(note),
                                                    },
                                                ]}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })
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
        </div>
    );
});
