import {useCallback, useMemo, useRef, useState} from 'react';

import {CircleQuestion, Folder, Moon, Sun} from '@gravity-ui/icons';
import {Button, Icon, Label, Text, type Theme, useToaster} from '@gravity-ui/uikit';

import {useNoteSearch} from '../hooks/useNoteSearch';
import {type SaveState, useNotes} from '../hooks/useNotes';
import {useShortcuts} from '../hooks/useShortcuts';
import {FileSystemNoteStore} from '../storage/fileSystemStore';
import {orderNotes} from '../storage/metadata';

import {ConflictBanner} from './ConflictBanner';
import {EditorPane, type EditorPaneHandle} from './EditorPane';
import {NoteList} from './NoteList';
import {ShortcutsDialog} from './ShortcutsDialog';

import './Workspace.css';

interface WorkspaceProps {
    dir: FileSystemDirectoryHandle;
    folderName: string | null;
    theme: Theme;
    onToggleTheme: () => void;
    onChangeFolder: () => void;
}

const SAVE_LABEL: Record<SaveState, string> = {
    idle: '',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
    conflict: 'Changed on disk',
};

export function Workspace({dir, folderName, theme, onToggleTheme, onChangeFolder}: WorkspaceProps) {
    const store = useMemo(() => new FileSystemNoteStore(dir), [dir]);
    const {add} = useToaster();

    const onError = useCallback(
        (message: string) => {
            add({
                name: `notes-error-${Date.now()}`,
                title: 'Something went wrong',
                content: message,
                theme: 'danger',
                autoHiding: 5000,
            });
        },
        [add],
    );

    const notes = useNotes(store, onError);
    const orderedNotes = useMemo(
        () => orderNotes(notes.notes, notes.metadata),
        [notes.notes, notes.metadata],
    );
    const {query, setQuery, filteredNotes} = useNoteSearch(orderedNotes);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<EditorPaneHandle>(null);
    const [helpOpen, setHelpOpen] = useState(false);

    useShortcuts({
        focusSearch: () => searchInputRef.current?.focus(),
        createNote: () => void notes.create(),
        toggleEditorMode: () => editorRef.current?.toggleMode(),
        openHelp: () => setHelpOpen(true),
    });

    return (
        <div className="workspace">
            <header className="workspace__header">
                <div className="workspace__brand">
                    <Text variant="subheader-2">Gravity Notes</Text>
                    <Label theme="unknown" icon={<Icon data={Folder} size={14} />}>
                        {folderName ?? 'Folder'}
                    </Label>
                </div>
                <div className="workspace__header-right">
                    <Text color="secondary" className="workspace__save-state">
                        {SAVE_LABEL[notes.saveState]}
                    </Text>
                    <Button
                        view="flat"
                        size="m"
                        onClick={() => setHelpOpen(true)}
                        title="Keyboard shortcuts (?)"
                    >
                        <Icon data={CircleQuestion} />
                    </Button>
                    <Button view="flat" size="m" onClick={onChangeFolder} title="Change folder">
                        Change folder
                    </Button>
                    <Button
                        view="flat"
                        size="m"
                        onClick={onToggleTheme}
                        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                    >
                        <Icon data={theme === 'dark' ? Sun : Moon} />
                    </Button>
                </div>
            </header>

            <div className="workspace__body">
                <aside className="workspace__sidebar">
                    <NoteList
                        notes={filteredNotes}
                        selectedId={notes.activeId}
                        query={query}
                        onQueryChange={setQuery}
                        searchInputRef={searchInputRef}
                        onSelect={(id) => void notes.open(id)}
                        onCreate={() => void notes.create()}
                        onRename={(id, title) => void notes.rename(id, title)}
                        onDelete={(id) => void notes.remove(id)}
                        sortMode={notes.metadata.sort}
                        onSortChange={notes.setSortMode}
                        pinnedIds={notes.metadata.pinned}
                        onTogglePin={notes.togglePin}
                    />
                </aside>

                <main className="workspace__editor">
                    {notes.note ? (
                        <>
                            {notes.conflict ? (
                                <div className="workspace__conflict">
                                    <ConflictBanner
                                        deleted={notes.conflict.deleted}
                                        onReload={() => void notes.reloadDisk()}
                                        onKeepMine={() => void notes.keepMine()}
                                        onSaveAsCopy={() => void notes.saveAsCopy()}
                                        onDiscard={notes.discard}
                                    />
                                </div>
                            ) : null}
                            <div className="workspace__panes">
                                <EditorPane
                                    ref={editorRef}
                                    key={`${notes.note.id}:${notes.note.updatedAt}`}
                                    note={notes.note}
                                    autofocus={true}
                                    onChange={notes.edit}
                                    onEscape={() => void notes.close()}
                                />
                            </div>
                        </>
                    ) : (
                        <div className="workspace__placeholder">
                            <Text variant="body-2" color="secondary">
                                Select a note, or create a new one to start writing.
                            </Text>
                        </div>
                    )}
                </main>
            </div>

            <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
        </div>
    );
}
