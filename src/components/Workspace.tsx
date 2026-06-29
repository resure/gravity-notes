import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {Text, useToaster} from '@gravity-ui/uikit';

import {AttachmentUrlCache, AttachmentsContext} from '../attachments';
import {useBacklinks} from '../hooks/useBacklinks';
import {useCorpus} from '../hooks/useCorpus';
import {useDebouncedValue} from '../hooks/useDebouncedValue';
import {useNoteHistory} from '../hooks/useNoteHistory';
import {useNoteNavigation} from '../hooks/useNoteNavigation';
import {useNoteSearch} from '../hooks/useNoteSearch';
import {useNotes} from '../hooks/useNotes';
import {useShortcuts} from '../hooks/useShortcuts';
import {orderNotes} from '../storage/metadata';
import {dirname, sanitizeTitle, titleFromFileName} from '../storage/noteText';
import {exportNotes, importNotes} from '../storage/transfer';
import type {NoteStore} from '../storage/types';
import {type FolderRow, buildFolderTree, notesInFolder} from '../tree';
import {resolveWikiLink} from '../wikiLinks';

import {AttachmentsDialog} from './AttachmentsDialog';
import {BacklinksPanel} from './BacklinksPanel';
import {ConflictBanner} from './ConflictBanner';
import {EditorPane, type EditorPaneHandle} from './EditorPane';
import {FolderRail, type FolderRailHandle} from './FolderRail';
import {MoveToDialog} from './MoveToDialog';
import {NoteList, type NoteListHandle} from './NoteList';
import {ShortcutsDialog} from './ShortcutsDialog';
import {TopBar} from './TopBar';
import {TrashDialog} from './TrashDialog';
import {type ThemePref} from './theme';

import './Workspace.css';

interface WorkspaceProps {
    store: NoteStore;
    /** Label for the active storage (folder name, or "In this browser"). */
    storageLabel: string | null;
    themePref: ThemePref;
    onChangeThemePref: (pref: ThemePref) => void;
    onChangeStorage: () => void;
}

/**
 * Above this many notes, the search query is debounced by {@link SEARCH_DEBOUNCE_MS} before it drives
 * re-scoring + the (large) result-list re-render; at or below it, search stays instant (no debounce).
 * Keeps small vaults snappy-as-you-type while sparing a huge vault a full re-score + list reconcile on
 * every keystroke of a fast typist.
 */
const SEARCH_DEBOUNCE_THRESHOLD = 500;
const SEARCH_DEBOUNCE_MS = 120;

const SIDEBAR_KEY = 'gravity-notes:sidebar-collapsed';
const COLLAPSED_FOLDERS_KEY = 'gravity-notes:collapsed-folders';
const SELECTED_FOLDER_KEY = 'gravity-notes:selected-folder';
const RAIL_OPEN_KEY = 'gravity-notes:rail-open';

function loadSelectedFolder(): string | null {
    return localStorage.getItem(SELECTED_FOLDER_KEY);
}

/** Re-prefix a folder path (or note id) when its `from` ancestor folder moves/renames to `to`. */
function reprefixPath(path: string, from: string, to: string): string {
    return path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}

function loadCollapsedFolders(): Set<string> {
    try {
        const raw = JSON.parse(localStorage.getItem(COLLAPSED_FOLDERS_KEY) ?? '[]');
        return new Set(
            Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [],
        );
    } catch {
        return new Set();
    }
}

/**
 * Monotonic counter for toast names, so two toasts fired in the same tick don't collide on the
 * Toaster's name key (Date.now() alone can repeat within one millisecond).
 */
let toastSeq = 0;

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
                name: `notes-error-${toastSeq++}`,
                title: 'Something went wrong',
                content: message,
                theme: 'danger',
                autoHiding: 5000,
            });
        },
        [add],
    );

    const notes = useNotes(store, onError);

    // One attachment URL cache per store: resolves `Attachments/…` refs to object URLs for the
    // editor NodeView and preview. `useMemo` keeps a stable cache per store; the previous cache's
    // object URLs are revoked when a new store mints a new one. That retirement happens in render
    // (NOT an unmount effect): React StrictMode (active in dev) mount→unmount→mount's every effect,
    // so an unmount cleanup would retire the still-live cache, after which every resolve()
    // short-circuits to '' and every attachment renders as "not found". Render-side retirement only
    // fires when `useMemo` actually produced a new instance, which a spurious StrictMode unmount never
    // does. Blob URLs die with the page on exit, so no unmount revoke is needed beyond this.
    const attachmentCache = useMemo(() => new AttachmentUrlCache(store), [store]);
    const prevAttachmentCacheRef = useRef(attachmentCache);
    if (prevAttachmentCacheRef.current !== attachmentCache) {
        prevAttachmentCacheRef.current.dispose();
        prevAttachmentCacheRef.current = attachmentCache;
    }
    // Persist a dropped/pasted/inserted image, then seed its object URL so it renders instantly.
    const handleUploadFile = useCallback(
        async (file: File): Promise<string> => {
            const ref = await store.writeAttachment(file);
            attachmentCache.seed(ref, file);
            return ref;
        },
        [store, attachmentCache],
    );

    // "Reveal in Finder" — present only on the native desktop backend (the others have no real file
    // to reveal). `undefined` here hides the affordance in the note/folder menus. Takes a store id,
    // folder path, or `Attachments/<name>` ref.
    const handleReveal = useMemo(() => {
        if (!store.reveal) return undefined;
        // Bind to the store: a bare `store.reveal` reference would lose `this` when invoked, and
        // TauriNoteStore.reveal reads `this.dir`.
        const reveal = store.reveal.bind(store);
        return (relPath: string) => {
            reveal(relPath).catch((err) =>
                onError(err instanceof Error ? err.message : 'Failed to reveal in Finder'),
            );
        };
    }, [store, onError]);

    // Ordering depends only on these metadata fields — never on `active`, which gets a fresh
    // `metadata` identity on every note browse/open (each arrow-key preview). Keying the memo on the
    // whole object would re-sort the entire list on every cursor move; key on just the fields that
    // affect order so browsing a big folder doesn't re-sort thousands of notes per keypress.
    const orderedNotes = useMemo(
        () => orderNotes(notes.notes, notes.metadata),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [notes.notes, notes.metadata.pinned, notes.metadata.sort, notes.metadata.created],
    );
    // The nvALT search query. Owned here (not inside useNoteSearch) so the corpus's load trigger can
    // see "a query is active" alongside "a note is open" — both consumers then share one corpus load.
    // `query` is the live text in the box (instant); `debouncedQuery` is what actually drives scoring +
    // the result-list render, debounced only on a large vault (see SEARCH_DEBOUNCE_THRESHOLD).
    const [query, setQuery] = useState('');
    const debouncedQuery = useDebouncedValue(
        query,
        notes.notes.length > SEARCH_DEBOUNCE_THRESHOLD ? SEARCH_DEBOUNCE_MS : 0,
    );
    // Load the body corpus once a query is live OR a note is open, and share it between full-text
    // search and backlinks — so getAll() runs once (one big IPC on desktop) and bodies are held once.
    // Gate on the live `query` so the (lazy) corpus read starts on the first keystroke, not after the
    // debounce settles.
    const corpusActive = notes.activeId !== null || query.trim().length > 0;
    const corpus = useCorpus(store, orderedNotes, corpusActive);
    const {
        filteredNotes,
        snippetById,
        loading: searchLoading,
    } = useNoteSearch(orderedNotes, debouncedQuery, corpus);

    // Backlinks for the open note ("linked references"), from the shared corpus.
    const {backlinks} = useBacklinks(orderedNotes, notes.activeId, corpus);

    // Which folders are collapsed in the tree (persisted). A toggle rebuilds the set immutably.
    const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(loadCollapsedFolders);
    useEffect(() => {
        localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...collapsedFolders]));
    }, [collapsedFolders]);
    const toggleCollapse = useCallback((path: string) => {
        setCollapsedFolders((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }, []);

    // The folder selected in the rail (null = All Notes), persisted across reloads.
    const [selectedFolder, setSelectedFolder] = useState<string | null>(loadSelectedFolder);
    useEffect(() => {
        if (selectedFolder === null) localStorage.removeItem(SELECTED_FOLDER_KEY);
        else localStorage.setItem(SELECTED_FOLDER_KEY, selectedFolder);
    }, [selectedFolder]);
    // A selected folder that no longer exists (deleted, or renamed elsewhere) falls back to All Notes.
    useEffect(() => {
        if (selectedFolder !== null && !notes.folders.includes(selectedFolder)) {
            setSelectedFolder(null);
        }
    }, [notes.folders, selectedFolder]);

    // Whether the folder rail is shown. Off by default, so the app stays a 2-pane nvALT view
    // until you reach for folders; persisted across reloads.
    const [railOpen, setRailOpen] = useState(() => localStorage.getItem(RAIL_OPEN_KEY) === 'true');
    useEffect(() => {
        localStorage.setItem(RAIL_OPEN_KEY, String(railOpen));
    }, [railOpen]);
    const toggleRail = useCallback(() => setRailOpen((open) => !open), []);

    // Drive list MODE (ranked search vs folder scope) off the debounced query, so the list flips in
    // step with the results it shows — not a keystroke ahead of them.
    const searching = debouncedQuery.trim().length > 0;
    // The rail's folder tree (folders only).
    // The tree depends only on folders/notes/pins + the collapse set — not on `active` (which
    // changes on every browse). Key on `pinned` rather than the whole `metadata` so the tree isn't
    // rebuilt on each cursor move.
    const folderRows = useMemo<FolderRow[]>(
        () => buildFolderTree(notes.folders, notes.notes, notes.metadata, collapsedFolders),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [notes.folders, notes.notes, notes.metadata.pinned, collapsedFolders],
    );
    // The middle pane: a global ranked list while searching (folders never hide a match), otherwise
    // the selected folder's direct notes ('All Notes' = everything). Both stay ordered.
    const listNotes = useMemo(
        () => (searching ? filteredNotes : notesInFolder(orderedNotes, selectedFolder)),
        [searching, filteredNotes, orderedNotes, selectedFolder],
    );
    // The note ids the cursor moves over (⌘J/⌘K, delete-neighbor).
    const visibleIds = useMemo(() => listNotes.map((note) => note.id), [listNotes]);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<EditorPaneHandle>(null);
    const listRef = useRef<NoteListHandle>(null);
    const railRef = useRef<FolderRailHandle>(null);
    // When the rail is opened via the keyboard (⌘⇧\), move focus into it once it has mounted.
    const [pendingRailFocus, setPendingRailFocus] = useState(false);
    useEffect(() => {
        if (railOpen && pendingRailFocus) {
            railRef.current?.focusSelected();
            setPendingRailFocus(false);
        }
    }, [railOpen, pendingRailFocus]);
    const [helpOpen, setHelpOpen] = useState(false);
    const [attachmentsOpen, setAttachmentsOpen] = useState(false);
    const [trashOpen, setTrashOpen] = useState(false);
    const [pendingListFocus, setPendingListFocus] = useState(false);
    // Set after following a wiki link to a freshly-created note, to land the caret in its body once
    // the new editor has mounted (a brand-new note has no body yet, so there's nothing else to focus).
    const [pendingEditorFocus, setPendingEditorFocus] = useState(false);
    // The note whose "Move to…" picker is open (null = closed). Lifted here, where the full
    // folder/notes/metadata the tree picker needs already live.
    const [movingNoteId, setMovingNoteId] = useState<string | null>(null);
    const movingNote = useMemo(
        () => (movingNoteId ? (notes.notes.find((n) => n.id === movingNoteId) ?? null) : null),
        [movingNoteId, notes.notes],
    );
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

    // Browser-style ⌘[/⌘] back/forward across visited notes. Records every note that becomes active;
    // navigation commits the note (opens + focuses it, like clicking it open), and a deleted note in
    // the trail is skipped. `exists` reads a Set so a long trail stays cheap to validate.
    const noteIdSet = useMemo(() => new Set(notes.notes.map((n) => n.id)), [notes.notes]);
    const historyExists = useCallback((id: string) => noteIdSet.has(id), [noteIdSet]);
    const historyNavigate = useCallback(
        (id: string) => {
            nav.commit(id);
            setPeeked(false);
        },
        [nav],
    );
    const history = useNoteHistory({
        activeId: notes.activeId,
        exists: historyExists,
        navigate: historyNavigate,
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
                name: `notes-info-${toastSeq++}`,
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
            // If the flush couldn't land (an unresolved conflict still holds the edit), switching
            // stores would silently discard that content — mirror the rename/move/trash conflict
            // guards and make the user confirm the loss first. Use flush()'s return value, not the
            // `notes.conflict` state, which is stale in this closure right after the await (it would
            // miss a conflict first surfaced BY this very flush).
            const unresolvedConflict = await notes.flushPending();
            if (
                unresolvedConflict &&
                !window.confirm(
                    'This note has an unresolved conflict with unsaved changes that will be lost if you switch storage. Continue?',
                )
            ) {
                return;
            }
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

    // Flush any pending edit before opening the attachments manager, so a just-pasted image's
    // reference is already on disk — otherwise it reads as "Unused" and is bulk-deletable.
    const handleManageAttachments = useCallback(() => {
        void (async () => {
            await notes.flushPending();
            setAttachmentsOpen(true);
        })();
    }, [notes]);

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
                    // The import may have written some notes before throwing — refresh so those
                    // become visible, and word the error as a possible partial import.
                    await notes.refresh();
                    onError(
                        err instanceof Error
                            ? `Import failed (some notes may have been imported): ${err.message}`
                            : 'Import failed; some notes may have been imported',
                    );
                }
            })();
        },
        [store, notes, notify, onError],
    );

    const handleCreate = useCallback(
        (title?: string, parentPath?: string) => {
            nav.prepareCreate(); // arm the title to focus + select on the new note's mount
            // ⌘N / the New button create into the selected folder; an explicit parentPath (the
            // search box's root '') overrides that.
            const dest = parentPath ?? selectedFolder ?? '';
            void (async () => {
                const id = await notes.create(title, dest);
                if (id) nav.setSelected(id);
            })();
        },
        [notes, nav, selectedFolder],
    );

    // Duplicate a note: copy it (shared attachments), then select the copy with its title armed for
    // focus, so the user can immediately rename it.
    const handleDuplicate = useCallback(
        (id: string) => {
            nav.prepareCreate();
            void (async () => {
                const newId = await notes.duplicate(id);
                if (newId) nav.setSelected(newId);
            })();
        },
        [notes, nav],
    );

    // Follow a [[wiki link]] (⌘/Ctrl-click in the editor): resolve the title to a note and open it.
    // If nothing matches, create the note (Obsidian-style) in the current note's folder and open it
    // with the caret in the body. The title is the link's leaf, stripped of any |alias / #heading.
    const handleOpenWikiLink = useCallback(
        (target: string) => {
            const fromId = notes.activeId ?? '';
            const existing = resolveWikiLink(target, fromId, notes.notes);
            if (existing) {
                nav.commit(existing);
                setPeeked(false);
                return;
            }
            const ref = target.split('|', 1)[0].split('#', 1)[0].trim();
            const title = sanitizeTitle(titleFromFileName(ref));
            if (!ref || title === 'Untitled') return; // nothing meaningful to create
            void (async () => {
                const newId = await notes.create(title, dirname(fromId));
                if (newId) {
                    nav.setSelected(newId);
                    setPendingEditorFocus(true);
                    setPeeked(false);
                }
            })();
        },
        [notes, nav],
    );

    // Land focus in the editor body after a wiki link created + opened a new note (its session bumped).
    useEffect(() => {
        if (!pendingEditorFocus) return;
        editorRef.current?.focus();
        setPendingEditorFocus(false);
    }, [pendingEditorFocus, notes.sessionId]);

    // Enter the list from the search box (↓/↑): preview the row and move DOM focus onto it.
    const enterList = useCallback(
        (id: string) => {
            nav.browse(id);
            listRef.current?.focusRow(id);
        },
        [nav],
    );

    // Selecting a folder previews its first note in the editor (nvALT-style), without taking focus
    // off the rail — so arrowing through folders flips through their leads. Skipped while searching
    // (the list is global then); an empty folder leaves the editor as-is.
    const handleSelectFolder = useCallback(
        (folder: string | null) => {
            setSelectedFolder(folder);
            if (searching) return;
            const first = notesInFolder(orderedNotes, folder)[0];
            if (first) nav.browse(first.id);
        },
        [searching, orderedNotes, nav],
    );

    // ⌘J / ⌘K: browse to the next / previous note in the current list, from anywhere. Mirrors
    // ↓/↑ in the list (preview + focus the row); clamps at the ends; picks the first/last when
    // nothing is selected yet.
    const browseRelative = useCallback(
        (delta: number) => {
            const ids = visibleIds;
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
        [visibleIds, nav, enterList],
    );

    // ⌘J/⌘K: move the folder cursor when the rail is focused, otherwise the notes cursor.
    const moveCursor = useCallback(
        (delta: number) => {
            const el = document.activeElement;
            const inRail =
                railOpen && el instanceof HTMLElement && Boolean(el.closest('.folder-rail'));
            if (inRail) railRef.current?.selectRelative(delta);
            else browseRelative(delta);
        },
        [railOpen, browseRelative],
    );

    // Delete = move to Trash (recoverable). Keep selection on a neighbor when the open note goes, and
    // confirm the move with a toast so the user knows where it went (the confirm dialog lives in the list).
    const handleDelete = useCallback(
        (id: string) => {
            const ids = visibleIds;
            const idx = ids.indexOf(id);
            const neighbor = ids[idx + 1] ?? ids[idx - 1] ?? null;
            const wasActive = notes.activeId === id;
            const title = notes.notes.find((n) => n.id === id)?.title ?? titleFromFileName(id);
            void (async () => {
                // Only confirm + move the cursor when the trash actually succeeded — trash() returns
                // false (and has already surfaced an error toast) on a conflict/failure.
                const ok = await notes.trash(id);
                if (!ok) return;
                if (wasActive) {
                    if (neighbor) nav.browse(neighbor);
                    else nav.setSelected(null);
                }
                notify(`Moved “${title}” to Trash`);
            })();
        },
        // eslint wants the whole `notes`/`nav` objects here, not their members.
        [visibleIds, notes, nav, notify],
    );

    const handleMoveFolder = useCallback(
        (from: string, to: string) => {
            // Optimistically follow the move with the rail's local state, so the moved/renamed
            // folder keeps its selection and expand state instead of the list-validation effect
            // racing the refresh and snapping back to All Notes.
            setSelectedFolder((cur) => (cur ? reprefixPath(cur, from, to) : cur));
            setCollapsedFolders((prev) => new Set([...prev].map((p) => reprefixPath(p, from, to))));
            // Return the promise (resolving to `moved`) so the rail only commits its select-after-rename
            // once the move actually succeeds — a rejected move (collision) resolves false, so the rail
            // doesn't dangle pendingRenameToRef on a path that was never created.
            return notes.moveFolder(from, to).then((moved) => {
                // The move was rejected (collision) or a no-op: the folders never changed, so undo
                // the optimistic re-prefix (inverse: to → from) instead of leaving selection on a
                // path that doesn't exist.
                if (!moved) {
                    setSelectedFolder((cur) => (cur ? reprefixPath(cur, to, from) : cur));
                    setCollapsedFolders(
                        (prev) => new Set([...prev].map((p) => reprefixPath(p, to, from))),
                    );
                }
                return moved;
            });
        },
        [notes],
    );

    // Commit the move picker: move the note, then keep it selected at its new id (it may have left
    // the folder-scoped list) and restore list focus — mirroring rename.
    const handleMoveTo = useCallback(
        (dest: string) => {
            const id = movingNoteId;
            setMovingNoteId(null);
            if (!id) return;
            void (async () => {
                const newId = await notes.move(id, dest);
                if (newId) {
                    nav.setSelected(newId);
                    setPendingListFocus(true);
                }
            })();
        },
        [movingNoteId, notes, nav],
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
        (id: string, title: string): Promise<boolean> => {
            const wasActive = notes.activeId === id;
            return (async () => {
                const newId = await notes.rename(id, title);
                if (wasActive && newId && newId !== id) nav.setSelected(newId);
                // null ⇒ the rename was rejected (collision / error) and the file is unchanged.
                return newId !== null;
            })();
        },
        [notes, nav],
    );

    // After a rename settles (list + selection updated), return focus to the selected row.
    useEffect(() => {
        if (!pendingListFocus) return;
        listRef.current?.focusSelected();
        setPendingListFocus(false);
    }, [pendingListFocus, listNotes, nav.selectedId]);

    useShortcuts({
        createNote: handleCreate,
        focusSearch: () => {
            searchInputRef.current?.focus();
            searchInputRef.current?.select(); // select any existing query so typing replaces it
        },
        selectNextNote: () => moveCursor(1),
        selectPrevNote: () => moveCursor(-1),
        historyBack: history.goBack,
        historyForward: history.goForward,
        toggleSidebar: toggleCollapsed,
        toggleFolderRail: () => {
            const inRail =
                document.activeElement instanceof HTMLElement &&
                Boolean(document.activeElement.closest('.folder-rail'));
            if (!railOpen) {
                // Closed → open and move focus into it.
                setRailOpen(true);
                setPendingRailFocus(true);
            } else if (inRail) {
                // Open and focused → close, returning focus to the list.
                setRailOpen(false);
                listRef.current?.focusSelected();
            } else {
                // Open but focus elsewhere → step into the rail.
                railRef.current?.focusSelected();
            }
        },
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
            // F2 fires even while typing. Context-aware: a focused folder row → rename the folder;
            // the in-editor title handles F2 itself; otherwise rename the selected note.
            const el = document.activeElement;
            if (el instanceof HTMLElement) {
                const folderRow = el.closest('.folder-rail__row[data-path]');
                if (folderRow) {
                    railRef.current?.startRename(folderRow.getAttribute('data-path') ?? '');
                    return;
                }
                if (el.closest('.note-title')) return;
            }
            if (nav.selectedId) listRef.current?.startRename(nav.selectedId);
        },
        moveSelected: () => {
            if (nav.selectedId) setMovingNoteId(nav.selectedId);
        },
        duplicateSelected: () => {
            if (nav.selectedId) handleDuplicate(nav.selectedId);
        },
        deleteSelected: () => {
            if (nav.selectedId) listRef.current?.requestDelete(nav.selectedId);
        },
    });

    return (
        <AttachmentsContext.Provider value={attachmentCache}>
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
                    onManageAttachments={handleManageAttachments}
                    onOpenTrash={() => setTrashOpen(true)}
                    trashCount={notes.trashCount}
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
                    onCreate={(title) => handleCreate(title, '')}
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
                        {railOpen ? (
                            <FolderRail
                                ref={railRef}
                                rows={folderRows}
                                selectedFolder={selectedFolder}
                                allNotesCount={notes.notes.length}
                                onSelectFolder={handleSelectFolder}
                                onToggleCollapse={toggleCollapse}
                                onCreateFolder={(parent, name) =>
                                    void notes.createFolder(parent, name)
                                }
                                onRemoveFolder={(path) => void notes.removeFolder(path)}
                                onMoveFolder={handleMoveFolder}
                                onTogglePin={notes.togglePin}
                                onMoveTo={(id, dest) => void notes.move(id, dest)}
                                onReveal={handleReveal}
                                onFocusList={() => listRef.current?.focusSelected()}
                            />
                        ) : null}
                        <NoteList
                            ref={listRef}
                            notes={listNotes}
                            selectedId={nav.selectedId}
                            query={debouncedQuery}
                            scopeLabel={
                                selectedFolder ? (selectedFolder.split('/').pop() ?? null) : null
                            }
                            showCrumbs={searching || selectedFolder === null}
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
                            onRequestMove={setMovingNoteId}
                            onDuplicate={handleDuplicate}
                            onReveal={handleReveal}
                            onRename={handleRename}
                            onDelete={handleDelete}
                            sortMode={notes.metadata.sort}
                            onSortChange={notes.setSortMode}
                            pinnedIds={notes.metadata.pinned}
                            onTogglePin={notes.togglePin}
                            railOpen={railOpen}
                            onToggleRail={toggleRail}
                            onFocusRail={() => railRef.current?.focusSelected()}
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
                                        onUploadFile={handleUploadFile}
                                        wikiNotes={notes.notes}
                                        onOpenWikiLink={handleOpenWikiLink}
                                    />
                                </div>
                                <BacklinksPanel
                                    backlinks={backlinks}
                                    onOpen={(id) => {
                                        nav.commit(id);
                                        setPeeked(false);
                                    }}
                                />
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

                <AttachmentsDialog
                    open={attachmentsOpen}
                    store={store}
                    cache={attachmentCache}
                    onClose={() => setAttachmentsOpen(false)}
                    onError={onError}
                />

                <TrashDialog
                    open={trashOpen}
                    notes={notes.trashedNotes}
                    onRefresh={notes.refreshTrash}
                    onRestore={(id) =>
                        void notes.restoreFromTrash(id).then((newId) => {
                            // Select the restored note so it's focused once the dialog closes.
                            if (newId) nav.setSelected(newId);
                        })
                    }
                    onPurge={(id) => void notes.purgeFromTrash(id)}
                    onEmpty={() => void notes.emptyTrash()}
                    onClose={() => setTrashOpen(false)}
                />

                <MoveToDialog
                    open={movingNote !== null}
                    note={movingNote ? {id: movingNote.id, title: movingNote.title} : null}
                    folders={notes.folders}
                    notes={notes.notes}
                    metadata={notes.metadata}
                    onMove={handleMoveTo}
                    onClose={() => setMovingNoteId(null)}
                />
            </div>
        </AttachmentsContext.Provider>
    );
}
