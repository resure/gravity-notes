import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {CircleQuestion, Folder} from '@gravity-ui/icons';
import {Button, Icon, Label, Text, useToaster} from '@gravity-ui/uikit';

import {useNoteNavigation} from '../hooks/useNoteNavigation';
import {useNoteSearch} from '../hooks/useNoteSearch';
import {type SaveState, useNotes} from '../hooks/useNotes';
import {useShortcuts} from '../hooks/useShortcuts';
import {FileSystemNoteStore} from '../storage/fileSystemStore';
import {orderNotes} from '../storage/metadata';

import {ConflictBanner} from './ConflictBanner';
import {EditorPane, type EditorPaneHandle} from './EditorPane';
import {NoteList, type NoteListHandle} from './NoteList';
import {ShortcutsDialog} from './ShortcutsDialog';
import {type ThemePref, ThemeSwitcher} from './ThemeSwitcher';

import './Workspace.css';

interface WorkspaceProps {
    dir: FileSystemDirectoryHandle;
    folderName: string | null;
    themePref: ThemePref;
    onChangeThemePref: (pref: ThemePref) => void;
    onChangeFolder: () => void;
}

const SAVE_LABEL: Record<SaveState, string> = {
    idle: '',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
    conflict: 'Changed on disk',
};

export function Workspace({
    dir,
    folderName,
    themePref,
    onChangeThemePref,
    onChangeFolder,
}: WorkspaceProps) {
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
    const listRef = useRef<NoteListHandle>(null);
    const [helpOpen, setHelpOpen] = useState(false);

    const nav = useNoteNavigation({
        activeId: notes.activeId,
        open: notes.open,
        close: notes.close,
        editorRef,
        listRef,
        searchInputRef,
    });

    // Land in the search box on first load (nvALT: ready to type); a restored note is previewed unfocused.
    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    const handleCreate = useCallback(() => {
        nav.prepareCommit(); // arm autofocus so the new note mounts focused
        void (async () => {
            const id = await notes.create();
            if (id) nav.setSelected(id);
        })();
    }, [notes, nav]);

    const handleDelete = useCallback(
        (id: string) => {
            const ids = filteredNotes.map((n) => n.id);
            const idx = ids.indexOf(id);
            const neighbor = ids[idx + 1] ?? ids[idx - 1] ?? null;
            const wasActive = notes.activeId === id;
            void (async () => {
                await notes.remove(id);
                if (wasActive) {
                    if (neighbor) nav.browse(neighbor);
                    else nav.setSelected(null);
                }
            })();
        },
        // eslint wants the whole `notes`/`nav` objects here, not their members.
        [filteredNotes, notes, nav],
    );

    useShortcuts({
        focusSearch: () => searchInputRef.current?.focus(),
        createNote: handleCreate,
        toggleEditorMode: () => editorRef.current?.toggleMode(),
        openHelp: () => setHelpOpen(true),
        renameSelected: () => {
            if (nav.selectedId) listRef.current?.startRename(nav.selectedId);
        },
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
                    <ThemeSwitcher pref={themePref} onChange={onChangeThemePref} />
                </div>
            </header>

            <div className="workspace__body">
                <aside className="workspace__sidebar">
                    <NoteList
                        ref={listRef}
                        notes={filteredNotes}
                        selectedId={nav.selectedId}
                        query={query}
                        onQueryChange={setQuery}
                        searchInputRef={searchInputRef}
                        onBrowse={nav.browse}
                        onCommit={nav.commit}
                        onEscapeList={nav.escapeList}
                        onCreate={handleCreate}
                        onRename={(id, title) => void notes.rename(id, title)}
                        onDelete={handleDelete}
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
                                        onSaveAsCopy={() =>
                                            void notes.saveAsCopy().then((id) => {
                                                if (id) nav.setSelected(id);
                                            })
                                        }
                                        onDiscard={() => {
                                            nav.setSelected(null);
                                            notes.discard();
                                        }}
                                    />
                                </div>
                            ) : null}
                            <div className="workspace__panes">
                                <EditorPane
                                    ref={editorRef}
                                    key={`${notes.note.id}:${notes.note.updatedAt}`}
                                    note={notes.note}
                                    autofocus={nav.editorAutofocus}
                                    onChange={notes.edit}
                                    onEscape={nav.escapeEditor}
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
