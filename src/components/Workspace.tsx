import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {Text, useToaster} from '@gravity-ui/uikit';

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
import {type ThemePref} from './ThemeSwitcher';
import {TopBar} from './TopBar';

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
    const [pendingListFocus, setPendingListFocus] = useState(false);

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

    // Global Esc fallback: when focus is somewhere that doesn't handle Esc itself (the top
    // bar, the document body), send it back to the note list so keyboard nav resumes.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            const el = document.activeElement;
            // The editor, the list (rows + search), and open dialogs handle Esc themselves.
            if (
                el instanceof HTMLElement &&
                el.closest('.editor-pane, .note-list, [role="dialog"]')
            ) {
                return;
            }
            event.preventDefault();
            listRef.current?.focusSelected();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    const handleCreate = useCallback(
        (title?: string) => {
            nav.prepareCommit(); // arm autofocus so the new note mounts focused
            void (async () => {
                const id = await notes.create(title);
                if (id) nav.setSelected(id);
            })();
        },
        [notes, nav],
    );

    // Enter the list from the search box (↓/↑): preview the row and move DOM focus onto it.
    const enterList = useCallback(
        (id: string) => {
            nav.browse(id);
            listRef.current?.focusRow(id);
        },
        [nav],
    );

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

    const handleRename = useCallback(
        (id: string, title: string) => {
            void (async () => {
                const newId = await notes.rename(id, title);
                // Re-select the resulting id and flag a focus restore — the rename input
                // unmounted (and the row may have remounted under a new id), so without this
                // keyboard focus is stranded on <body>.
                nav.setSelected(newId ?? id);
                setPendingListFocus(true);
            })();
        },
        [notes, nav],
    );

    // After a rename settles (list + selection updated), return focus to the selected row.
    useEffect(() => {
        if (!pendingListFocus) return;
        listRef.current?.focusSelected();
        setPendingListFocus(false);
    }, [pendingListFocus, filteredNotes, nav.selectedId]);

    useShortcuts({
        createNote: handleCreate,
        toggleEditorMode: () => editorRef.current?.toggleMode(),
        togglePreview: () => editorRef.current?.togglePreview(),
        openHelp: () => setHelpOpen(true),
        renameSelected: () => {
            if (nav.selectedId) listRef.current?.startRename(nav.selectedId);
        },
    });

    return (
        <div className="workspace">
            <TopBar
                folderName={folderName}
                onChangeFolder={onChangeFolder}
                onOpenHelp={() => setHelpOpen(true)}
                themePref={themePref}
                onChangeThemePref={onChangeThemePref}
                saveLabel={SAVE_LABEL[notes.saveState]}
                query={query}
                onQueryChange={setQuery}
                searchInputRef={searchInputRef}
                notes={filteredNotes}
                selectedId={nav.selectedId}
                onCommit={nav.commit}
                onCreate={handleCreate}
                onClose={nav.closeFromSearch}
                onEnterList={enterList}
                onFocusList={() => listRef.current?.focusSelected()}
            />

            <div className="workspace__body">
                <aside className="workspace__sidebar">
                    <NoteList
                        ref={listRef}
                        notes={filteredNotes}
                        selectedId={nav.selectedId}
                        query={query}
                        searchInputRef={searchInputRef}
                        onBrowse={nav.browse}
                        onCommit={nav.commit}
                        onEscapeList={nav.escapeToSearch}
                        onCreate={handleCreate}
                        onRename={handleRename}
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
