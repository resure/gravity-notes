import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {Text, useToaster} from '@gravity-ui/uikit';

import {useNoteNavigation} from '../hooks/useNoteNavigation';
import {useNoteSearch} from '../hooks/useNoteSearch';
import {useNotes} from '../hooks/useNotes';
import {useShortcuts} from '../hooks/useShortcuts';
import {orderNotes} from '../storage/metadata';
import {exportNotes, importNotes} from '../storage/transfer';
import type {NoteStore} from '../storage/types';

import {ConflictBanner} from './ConflictBanner';
import {EditorPane, type EditorPaneHandle} from './EditorPane';
import {NoteList, type NoteListHandle} from './NoteList';
import {ShortcutsDialog} from './ShortcutsDialog';
import {type ThemePref} from './ThemeSwitcher';
import {TopBar} from './TopBar';

import './Workspace.css';

interface WorkspaceProps {
    store: NoteStore;
    /** Label for the active storage (folder name, or "In this browser"). */
    storageLabel: string | null;
    themePref: ThemePref;
    onChangeThemePref: (pref: ThemePref) => void;
    onChangeStorage: () => void;
}

const SIDEBAR_KEY = 'gravity-notes:sidebar-collapsed';

export function Workspace({
    store,
    storageLabel,
    themePref,
    onChangeThemePref,
    onChangeStorage,
}: WorkspaceProps) {
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
    const {
        query,
        setQuery,
        filteredNotes,
        snippetById,
        loading: searchLoading,
    } = useNoteSearch(orderedNotes, store);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<EditorPaneHandle>(null);
    const listRef = useRef<NoteListHandle>(null);
    const [helpOpen, setHelpOpen] = useState(false);
    const [pendingListFocus, setPendingListFocus] = useState(false);
    // Read-only preview mode, kept here so it persists as the open note changes.
    const [previewMode, setPreviewMode] = useState(false);
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'true');
    useEffect(() => {
        localStorage.setItem(SIDEBAR_KEY, String(collapsed));
    }, [collapsed]);
    const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);

    // Transient overlay reveal of the collapsed sidebar (⌘⇧'); not persisted. Only meaningful
    // while collapsed — the invariant effect clears it whenever the sidebar is docked.
    const [peeked, setPeeked] = useState(false);
    useEffect(() => {
        if (!collapsed && peeked) setPeeked(false);
    }, [collapsed, peeked]);
    // When the peek opens, move focus into the list so arrow / ⌘J⌘K nav works immediately.
    useEffect(() => {
        if (peeked) listRef.current?.focusSelected();
    }, [peeked]);
    // While peeked, a pointerdown anywhere outside the sidebar closes it (e.g. clicking the editor).
    // pointerdown (not mousedown) so touch/pen also dismiss the overlay.
    useEffect(() => {
        if (!peeked) return undefined;
        const onPointerDown = (event: Event) => {
            const target = event.target;
            if (
                target instanceof Node &&
                !document.querySelector('.workspace__sidebar')?.contains(target)
            ) {
                setPeeked(false);
            }
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [peeked]);

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
    // bar, the document body), send it back to the note list so keyboard nav resumes. When the
    // sidebar is collapsed the list rows are hidden (unfocusable), so peek it open instead.
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
            if (collapsed) setPeeked(true);
            else listRef.current?.focusSelected();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [collapsed]);

    // Esc out of the editor: focus the selected row, unless the sidebar is collapsed (its rows are
    // hidden) — then peek it open, which moves focus into the list.
    const handleEditorEscape = useCallback(() => {
        if (collapsed) setPeeked(true);
        else nav.escapeEditor();
    }, [collapsed, nav]);

    const notify = useCallback(
        (message: string) =>
            add({
                name: `notes-info-${Date.now()}`,
                title: message,
                theme: 'success',
                autoHiding: 4000,
            }),
        [add],
    );

    // Change storage only after flushing any pending edit, so a keystroke inside the 500 ms
    // autosave window isn't lost when the workspace unmounts.
    const handleChangeStorage = useCallback(() => {
        void (async () => {
            await notes.flushPending();
            onChangeStorage();
        })();
    }, [notes, onChangeStorage]);

    const handleExport = useCallback(() => {
        void (async () => {
            try {
                await notes.flushPending();
                const count = await exportNotes(store);
                notify(count === 1 ? 'Exported 1 note' : `Exported ${count} notes`);
            } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to export notes');
            }
        })();
    }, [notes, store, notify, onError]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const handleImportClick = useCallback(() => fileInputRef.current?.click(), []);
    const handleImportFiles = useCallback(
        (files: FileList | null) => {
            if (!files || files.length === 0) return;
            void (async () => {
                try {
                    const count = await importNotes(store, files);
                    await notes.refresh();
                    notify(count === 1 ? 'Imported 1 note' : `Imported ${count} notes`);
                } catch (err) {
                    onError(err instanceof Error ? err.message : 'Failed to import notes');
                }
            })();
        },
        [store, notes, notify, onError],
    );

    const handleCreate = useCallback(
        (title?: string) => {
            nav.prepareCreate(); // arm the title to focus + select on the new note's mount
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

    // ⌘J / ⌘K: browse to the next / previous note in the current list, from anywhere. Mirrors
    // ↓/↑ in the list (preview + focus the row); clamps at the ends; picks the first/last when
    // nothing is selected yet.
    const browseRelative = useCallback(
        (delta: number) => {
            const ids = filteredNotes.map((n) => n.id);
            if (ids.length === 0) return;
            const current = nav.selectedId;
            let index: number;
            if (current && ids.includes(current)) {
                index = Math.min(Math.max(ids.indexOf(current) + delta, 0), ids.length - 1);
            } else {
                index = delta > 0 ? 0 : ids.length - 1;
            }
            const target = ids[index];
            if (target) enterList(target);
        },
        [filteredNotes, nav, enterList],
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

    // Rename from the in-editor title. Unlike the list rename, focus stays in the editor, so
    // we only move the list cursor to the new id (and only when the renamed note is still the
    // open one — an unmount-time commit of a note we've since left must not hijack selection).
    const handleEditorRename = useCallback(
        (id: string, title: string) => {
            const wasActive = notes.activeId === id;
            void (async () => {
                const newId = await notes.rename(id, title);
                if (wasActive && newId && newId !== id) nav.setSelected(newId);
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
        selectNextNote: () => browseRelative(1),
        selectPrevNote: () => browseRelative(-1),
        toggleSidebar: toggleCollapsed,
        peekSidebar: () => {
            if (!collapsed) return; // docked: no-op
            if (peeked) {
                // Second press mirrors Enter on a focused row: commit the selected note
                // (opens it + moves focus to the editor), then close the overlay.
                if (nav.selectedId) nav.commit(nav.selectedId);
                setPeeked(false);
            } else {
                setPeeked(true);
            }
        },
        toggleEditorMode: () => editorRef.current?.toggleMode(),
        togglePreview: () => setPreviewMode((p) => !p),
        openHelp: () => setHelpOpen(true),
        renameSelected: () => {
            // F2 fires even while typing; ignore it when the in-editor title is focused so it
            // doesn't open a second rename surface in the list instead of acting on the title.
            const el = document.activeElement;
            if (el instanceof HTMLElement && el.closest('.note-title')) return;
            if (nav.selectedId) listRef.current?.startRename(nav.selectedId);
        },
    });

    return (
        <div className="workspace">
            <input
                ref={fileInputRef}
                type="file"
                accept=".md,.zip"
                multiple
                hidden
                onChange={(event) => {
                    handleImportFiles(event.target.files);
                    event.target.value = ''; // allow re-importing the same file
                }}
            />
            <TopBar
                storageLabel={storageLabel}
                onChangeStorage={handleChangeStorage}
                onExport={handleExport}
                onImport={handleImportClick}
                onOpenHelp={() => setHelpOpen(true)}
                themePref={themePref}
                onChangeThemePref={onChangeThemePref}
                onToggleCollapsed={toggleCollapsed}
                saveState={notes.saveState}
                query={query}
                onQueryChange={setQuery}
                searchInputRef={searchInputRef}
                notes={filteredNotes}
                searchLoading={searchLoading}
                selectedId={nav.selectedId}
                onCommit={nav.commit}
                onCreate={handleCreate}
                onClose={nav.closeFromSearch}
                onEnterList={enterList}
                onFocusList={() => listRef.current?.focusSelected()}
            />

            <div
                className={
                    'workspace__body' +
                    (collapsed ? ' workspace__body_collapsed' : '') +
                    (collapsed && peeked ? ' workspace__body_peeked' : '')
                }
            >
                <aside className="workspace__sidebar">
                    <NoteList
                        ref={listRef}
                        notes={filteredNotes}
                        selectedId={nav.selectedId}
                        query={query}
                        snippetById={snippetById}
                        searchInputRef={searchInputRef}
                        onBrowse={nav.browse}
                        onCommit={(id) => {
                            nav.commit(id);
                            setPeeked(false);
                        }}
                        onEscapeList={() => {
                            setPeeked(false);
                            nav.escapeToSearch();
                        }}
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
                                    key={notes.sessionId}
                                    note={notes.note}
                                    autofocus={nav.autofocus}
                                    preview={previewMode}
                                    onChange={notes.edit}
                                    onRename={handleEditorRename}
                                    onEscape={handleEditorEscape}
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
