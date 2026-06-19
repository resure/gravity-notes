import {useEffect, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent} from 'react';

import {Ellipsis, Pencil, Plus, TrashBin} from '@gravity-ui/icons';
import {Button, Dialog, DropdownMenu, Icon, Text, TextInput} from '@gravity-ui/uikit';

import type {NoteMeta} from '../storage/types';

import './NoteList.css';

export interface NoteListProps {
    notes: NoteMeta[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onCreate: () => void;
    onRename: (id: string, nextTitle: string) => void;
    onDelete: (id: string) => void;
}

export function NoteList({
    notes,
    selectedId,
    onSelect,
    onCreate,
    onRename,
    onDelete,
}: NoteListProps) {
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

    const startRename = (note: NoteMeta) => {
        setEditValue(note.title);
        setEditingId(note.id);
    };

    const commitRename = (note: NoteMeta) => {
        const next = editValue.trim();
        setEditingId(null);
        if (next && next !== note.title) {
            onRename(note.id, next);
        }
    };

    const moveSelection = (fromId: string, delta: number) => {
        const index = notes.findIndex((n) => n.id === fromId);
        if (index === -1) return;
        const next = notes[Math.min(Math.max(index + delta, 0), notes.length - 1)];
        if (next && next.id !== fromId) {
            onSelect(next.id);
            itemRefs.current.get(next.id)?.focus();
        }
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
            case ' ':
                event.preventDefault();
                onSelect(note.id);
                break;
            case 'F2':
                event.preventDefault();
                startRename(note);
                break;
        }
    };

    return (
        <div className="note-list">
            <div className="note-list__header">
                <Text variant="subheader-2">Notes</Text>
                <Button view="action" size="m" onClick={onCreate}>
                    <Icon data={Plus} />
                    New
                </Button>
            </div>

            <div className="note-list__items" role="listbox" aria-label="Notes">
                {notes.length === 0 ? (
                    <div className="note-list__empty">
                        <Text color="secondary">No notes yet. Create your first one.</Text>
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
                                onClick={() => onSelect(note.id)}
                                onDoubleClick={() => startRename(note)}
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
                                        <Text className="note-list__title" ellipsis>
                                            {note.title}
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
                                                        text: 'Rename',
                                                        iconStart: <Icon data={Pencil} />,
                                                        action: () => startRename(note),
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

            <Dialog open={deleting !== null} onClose={() => setDeleting(null)} size="s">
                <Dialog.Header caption="Delete note" />
                <Dialog.Body>
                    <Text>
                        Delete “{deleting?.title}”? This permanently removes the file from your
                        folder.
                    </Text>
                </Dialog.Body>
                <Dialog.Footer
                    textButtonApply="Delete"
                    textButtonCancel="Cancel"
                    propsButtonApply={{view: 'outlined-danger'}}
                    onClickButtonApply={() => {
                        if (deleting) onDelete(deleting.id);
                        setDeleting(null);
                    }}
                    onClickButtonCancel={() => setDeleting(null)}
                />
            </Dialog>
        </div>
    );
}
