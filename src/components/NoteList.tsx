import {useState} from 'react';

import {Ellipsis, Pencil, Plus, TrashBin} from '@gravity-ui/icons';
import {Button, Dialog, DropdownMenu, Icon, Text, TextInput} from '@gravity-ui/uikit';

import type {NoteMeta} from '../storage/types';

import './NoteList.css';

interface NoteListProps {
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
    const [renaming, setRenaming] = useState<NoteMeta | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [deleting, setDeleting] = useState<NoteMeta | null>(null);

    const startRename = (note: NoteMeta) => {
        setRenameValue(note.title);
        setRenaming(note);
    };

    const submitRename = () => {
        const next = renameValue.trim();
        if (renaming && next && next !== renaming.title) {
            onRename(renaming.id, next);
        }
        setRenaming(null);
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

            <div className="note-list__items">
                {notes.length === 0 ? (
                    <div className="note-list__empty">
                        <Text color="secondary">No notes yet. Create your first one.</Text>
                    </div>
                ) : (
                    notes.map((note) => (
                        <div
                            key={note.id}
                            className={
                                'note-list__item' +
                                (note.id === selectedId ? ' note-list__item_selected' : '')
                            }
                            onClick={() => onSelect(note.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') onSelect(note.id);
                            }}
                        >
                            <Text className="note-list__title" ellipsis>
                                {note.title}
                            </Text>
                            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- wrapper only stops click propagation to the note item; proper a11y rework lands in the Core UX slice */}
                            <div
                                className="note-list__actions"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <DropdownMenu
                                    renderSwitcher={(props) => (
                                        <Button {...props} view="flat" size="s">
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
                        </div>
                    ))
                )}
            </div>

            <Dialog open={renaming !== null} onClose={() => setRenaming(null)} size="s">
                <Dialog.Header caption="Rename note" />
                <Dialog.Body>
                    <TextInput
                        // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: focus the title input when the rename dialog opens
                        autoFocus
                        value={renameValue}
                        onUpdate={setRenameValue}
                        placeholder="Note title"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') submitRename();
                        }}
                    />
                </Dialog.Body>
                <Dialog.Footer
                    textButtonApply="Rename"
                    textButtonCancel="Cancel"
                    onClickButtonApply={submitRename}
                    onClickButtonCancel={() => setRenaming(null)}
                    propsButtonApply={{disabled: !renameValue.trim()}}
                />
            </Dialog>

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
