import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';

import {Eye} from '@gravity-ui/icons';
import {Icon, Label, Text, useToaster} from '@gravity-ui/uikit';

import {AttachmentUrlCache, AttachmentsContext} from '../attachments';
import {useAppUpdater} from '../hooks/useAppUpdater';
import {useBacklinks} from '../hooks/useBacklinks';
import {useCorpus} from '../hooks/useCorpus';
import {useDebouncedValue} from '../hooks/useDebouncedValue';
import {useIsNarrow} from '../hooks/useIsNarrow';
import {useNoteHistory} from '../hooks/useNoteHistory';
import {useNoteNavigation} from '../hooks/useNoteNavigation';
import {useNoteSearch} from '../hooks/useNoteSearch';
import {useNotes} from '../hooks/useNotes';
import type {WorkspaceInfo} from '../hooks/useNotesStorage';
import {
    type NoteAppearance,
    clearLegacyNoteAppearanceKeys,
    effectiveAppearance,
    noteAppearanceOf,
    readLegacyNoteAppearances,
    useSettings,
    useWorkspaceSettings,
} from '../hooks/useSettings';
import {useShortcuts} from '../hooks/useShortcuts';
import {useSwipeBack} from '../hooks/useSwipeBack';
import {isDesktopTauri, isMainWindow, isNoteWindow, isTauri} from '../isTauri';
import {orderNotes, trashEntryOriginalId} from '../storage/metadata';
import {dirname, sanitizeTitle, titleFromFileName} from '../storage/noteText';
import {exportNotes, importNotes} from '../storage/transfer';
import type {NoteAppearanceOverride, NoteStore} from '../storage/types';
import {type FolderRow, buildFolderTree, notesInFolder} from '../tree';
import {resolveWikiLink} from '../wikiLinks';

import {AboutDialog} from './AboutDialog';
import {AttachmentsDialog} from './AttachmentsDialog';
import {BacklinksPanel} from './BacklinksPanel';
import {ConflictBanner} from './ConflictBanner';
import {EditorPane, type EditorPaneHandle} from './EditorPane';
import {FolderRail, type FolderRailHandle} from './FolderRail';
import {MoveToDialog} from './MoveToDialog';
import {NoteList, type NoteListHandle} from './NoteList';
import {SettingsDialog} from './SettingsDialog';
import {ShortcutsDialog} from './ShortcutsDialog';
import {TopBar} from './TopBar';
import {TrashDialog} from './TrashDialog';
import {UpdateDialog} from './UpdateDialog';
import {WorkspaceSwitcherDialog} from './WorkspaceSwitcherDialog';
import {type ThemePref} from './theme';

import './Workspace.css';

interface WorkspaceProps {
    store: NoteStore;
    /** The active workspace's registry id (App remounts this component keyed on it). */
    workspaceId: string;
    /** Label for the active storage (folder name, or "In this browser"). */
    storageLabel: string | null;
    /** Known workspaces, most recently opened first — feeds the recents menu + ⌃R switcher. */
    workspaces: WorkspaceInfo[];
    /**
     * A single-note window's assigned note: opened instead of the last-active restore (and the
     * window starts with both side panels closed). Null in every other window and on the web.
     */
    initialNoteId: string | null;
    themePref: ThemePref;
    onChangeThemePref: (pref: ThemePref) => void;
    /** Switch this window to a workspace; false = it could not be opened (we stay put). */
    onOpenWorkspace: (id: string) => Promise<boolean>;
    /** Desktop only: open a workspace in its own window. */
    onOpenWorkspaceInNewWindow: (id: string) => Promise<void>;
    /** Desktop only: open a note from this workspace in its own single-note window. */
    onOpenNoteInNewWindow: (noteId: string, title: string) => Promise<void>;
    /** Drop a workspace from the recents registry. */
    onRemoveWorkspace: (id: string) => Promise<void>;
    /** Re-read the registry (other windows may have opened workspaces since). */
    onRefreshWorkspaces: () => Promise<void>;
    /** Open the folder picker (adds/opens a workspace in this window). */
    onOpenFolder: () => void;
    /** Desktop only: pick a folder and open it as its own window (this window stays put). */
    onOpenFolderInNewWindow: () => Promise<void>;
    /** Whether folder-on-disk workspaces are available (native app, or FSA in the browser). */
    supportsFolders: boolean;
}

/**
 * Above this many notes, the search query is debounced by {@link SEARCH_DEBOUNCE_MS} before it drives
 * re-scoring + the (large) result-list re-render; at or below it, search stays instant (no debounce).
 * Keeps small vaults snappy-as-you-type while sparing a huge vault a full re-score + list reconcile on
 * every keystroke of a fast typist.
 */
const SEARCH_DEBOUNCE_THRESHOLD = 500;
const SEARCH_DEBOUNCE_MS = 120;

// Per-workspace UI state (layout + rail selection) lives under workspace-namespaced keys, so each
// workspace keeps its own sidebar/rail arrangement across switches and windows.
const nsKey = (workspaceId: string, suffix: string) => `gravity-notes:${workspaceId}:${suffix}`;

// The pre-workspace (un-namespaced) UI-state keys. Consumed once — as the defaults for the first
// workspace opened after the upgrade (the migrated one) — then deleted, so a later "set back to
// default" in that workspace can't fall through to a stale global value.
const LEGACY_SIDEBAR_KEY = 'gravity-notes:sidebar-collapsed';
const LEGACY_EXPANDED_FOLDERS_KEY = 'gravity-notes:expanded-folders';
const LEGACY_SELECTED_FOLDER_KEY = 'gravity-notes:selected-folder';
const LEGACY_RAIL_OPEN_KEY = 'gravity-notes:rail-open';
// The pre-inversion key (a *collapsed* set, expanded-by-default). Its meaning flipped, so the old
// value can't be reused; clear it once on load so it doesn't linger as dead localStorage.
const LEGACY_COLLAPSED_FOLDERS_KEY = 'gravity-notes:collapsed-folders';

/**
 * Read a per-workspace UI key, adopting (and consuming) the pre-workspace global value the first
 * time nothing namespaced exists. Runs in state initializers — the write is idempotent, so a
 * StrictMode double-init is harmless.
 */
function readWorkspaceKey(workspaceId: string, suffix: string, legacyKey: string): string | null {
    const key = nsKey(workspaceId, suffix);
    const value = localStorage.getItem(key);
    if (value !== null) return value;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem(legacyKey);
    }
    return legacy;
}

/** Re-prefix a folder path (or note id) when its `from` ancestor folder moves/renames to `to`. */
function reprefixPath(path: string, from: string, to: string): string {
    return path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}

function loadExpandedFolders(workspaceId: string): Set<string> {
    try {
        const raw = JSON.parse(
            readWorkspaceKey(workspaceId, 'expanded-folders', LEGACY_EXPANDED_FOLDERS_KEY) ?? '[]',
        );
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
    workspaceId,
    storageLabel,
    workspaces,
    initialNoteId,
    themePref,
    onChangeThemePref,
    onOpenWorkspace,
    onOpenWorkspaceInNewWindow,
    onOpenNoteInNewWindow,
    onRemoveWorkspace,
    onRefreshWorkspaces,
    onOpenFolder,
    onOpenFolderInNewWindow,
    supportsFolders,
}: WorkspaceProps) {
    const {add} = useToaster();

    // A single-note desktop window (constant for the window's whole life — it's the label).
    // Both side panels start closed there, and its transient layout is never persisted to the
    // workspace-namespaced keys: those belong to the full workspace views, and one localStorage
    // is shared by every window.
    const noteWindow = isNoteWindow();

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

    const notes = useNotes(store, onError, initialNoteId);

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
    // Report the failure HERE rather than leaving it to each editor engine. `writeAttachment` throws
    // by contract (a read-only folder, a full disk, a lapsed FSA grant), and the two bodies handle a
    // rejection differently — the block editor skips the file, so a dropped image simply vanished
    // with no toast and no trace, and the user reads that as the drop not registering. Toasting at
    // the boundary that owns `onError` covers both engines; the rethrow keeps each one free to decide
    // what to do about the missing reference.
    const handleUploadFile = useCallback(
        async (file: File): Promise<string> => {
            try {
                const ref = await store.writeAttachment(file);
                attachmentCache.seed(ref, file);
                return ref;
            } catch (err) {
                onError(
                    `Couldn't attach ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
                );
                throw err;
            }
        },
        [store, attachmentCache, onError],
    );

    // "Reveal in Finder" — present only on the native desktop backend (the others have no real file
    // to reveal). `undefined` here hides the affordance in the note/folder menus. Takes a store id,
    // folder path, or `Attachments/<name>` ref.
    const handleReveal = useMemo(() => {
        // Reveal-in-Finder is macOS-only (`reveal_path` errors on iOS), so gate on the DESKTOP shell —
        // `TauriNoteStore.reveal` is defined on the iOS build too, so `!store.reveal` alone would leak
        // the affordance onto iPhone/iPad where tapping it just raises an error toast.
        if (!isDesktopTauri || !store.reveal) return undefined;
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

    // The tree is collapsed by default; this persists the folders the user has explicitly expanded
    // (the exceptions). A toggle rebuilds the set immutably. Note windows start from the defaults
    // and skip both the read (readWorkspaceKey CONSUMES the legacy un-namespaced keys — a note
    // window must not eat the main window's migration) and the write.
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() =>
        noteWindow ? new Set() : loadExpandedFolders(workspaceId),
    );
    useEffect(() => {
        if (noteWindow) return;
        localStorage.setItem(
            nsKey(workspaceId, 'expanded-folders'),
            JSON.stringify([...expandedFolders]),
        );
    }, [noteWindow, workspaceId, expandedFolders]);
    // One-time cleanup of the orphaned pre-inversion key (its semantics flipped, so it's unusable).
    useEffect(() => localStorage.removeItem(LEGACY_COLLAPSED_FOLDERS_KEY), []);
    const toggleCollapse = useCallback((path: string) => {
        setExpandedFolders((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }, []);

    // The folder selected in the rail (null = All Notes), persisted across reloads. A note window
    // always starts at All Notes (its list is hidden anyway, and ⌘N should create predictably).
    const [selectedFolder, setSelectedFolder] = useState<string | null>(() =>
        noteWindow
            ? null
            : readWorkspaceKey(workspaceId, 'selected-folder', LEGACY_SELECTED_FOLDER_KEY),
    );
    useEffect(() => {
        if (noteWindow) return;
        if (selectedFolder === null) localStorage.removeItem(nsKey(workspaceId, 'selected-folder'));
        else localStorage.setItem(nsKey(workspaceId, 'selected-folder'), selectedFolder);
    }, [noteWindow, workspaceId, selectedFolder]);
    // A selected folder that no longer exists (deleted, or renamed elsewhere) falls back to All Notes.
    useEffect(() => {
        if (selectedFolder !== null && !notes.folders.includes(selectedFolder)) {
            setSelectedFolder(null);
        }
    }, [notes.folders, selectedFolder]);

    // Whether the folder rail is shown. Off by default, so the app stays a 2-pane nvALT view
    // until you reach for folders; persisted across reloads (never in a note window — closed).
    const [railOpen, setRailOpen] = useState(
        () =>
            !noteWindow &&
            readWorkspaceKey(workspaceId, 'rail-open', LEGACY_RAIL_OPEN_KEY) === 'true',
    );
    useEffect(() => {
        if (noteWindow) return;
        localStorage.setItem(nsKey(workspaceId, 'rail-open'), String(railOpen));
    }, [noteWindow, workspaceId, railOpen]);
    const toggleRail = useCallback(() => setRailOpen((open) => !open), []);

    // Drive list MODE (ranked search vs folder scope) off the debounced query, so the list flips in
    // step with the results it shows — not a keystroke ahead of them.
    const searching = debouncedQuery.trim().length > 0;
    // The rail's folder tree (folders only). Collapsed-by-default: `expandedFolders` lists the
    // exceptions, passed straight through (the builder inverts it — no separate universe pass here).
    // The tree depends only on folders/notes/pins + the expand set — not on `active` (which changes
    // on every browse). Key on `pinned` rather than the whole `metadata` so the tree isn't rebuilt
    // on each cursor move.
    const folderRows = useMemo<FolderRow[]>(
        () =>
            buildFolderTree(
                notes.folders,
                notes.notes,
                notes.metadata,
                expandedFolders,
                'expanded-set',
            ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [notes.folders, notes.notes, notes.metadata.pinned, expandedFolders],
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
    const [settingsOpen, setSettingsOpen] = useState(false);
    const {settings, setSetting} = useSettings();
    const {workspaceSettings, setWorkspaceSetting} = useWorkspaceSettings(workspaceId);
    // Per-note overrides for the OPEN note (the innermost appearance layer), read from the metadata
    // sidecar — stored like icons, so a rename/move re-keys them and they travel with the folder.
    // With no note open the override is undefined, so the effective appearance is app+workspace.
    const openNoteId = notes.note?.id ?? null;
    const noteAppearance = useMemo(
        () =>
            noteAppearanceOf(
                openNoteId === null ? undefined : notes.metadata.appearances[openNoteId],
            ),
        [notes.metadata.appearances, openNoteId],
    );
    const setNoteSetting = useCallback(
        <K extends keyof NoteAppearance>(key: K, value: NoteAppearance[K]) => {
            if (openNoteId === null) return;
            // Merge into the RAW stored override, not the validated view: an unknown value a newer
            // build wrote in the OTHER field must survive this edit (the tolerance contract in
            // storage/types.ts) — round-tripping the validated form would degrade it to 'default'
            // and then drop it.
            const next: NoteAppearanceOverride = {...notes.metadata.appearances[openNoteId]};
            if (value === 'default') delete next[key];
            else next[key] = value;
            notes.setNoteAppearance(openNoteId, next);
        },
        [openNoteId, notes.metadata.appearances, notes.setNoteAppearance],
    );
    const resetNoteAppearance = useCallback(() => {
        if (openNoteId !== null) notes.setNoteAppearance(openNoteId, {});
    }, [openNoteId, notes.setNoteAppearance]);

    // One-time migration of the legacy localStorage per-note overrides into the sidecar (they used to
    // strand on every rename/move). Gated on `ready` so it can't race the sidecar's initial load.
    // Live ids adopt into `appearances`; an override whose note sits in the Trash attaches to its
    // TrashEntry (matched by original path) so a restore reinstates it; only truly-gone ids drop.
    // Keys are cleared only when the adoption verifiably LANDED on disk (adopt resolves false on a
    // failed sidecar write), so a crash or write failure mid-way just retries next launch (adoption
    // is idempotent: an existing sidecar entry wins).
    const appearanceMigrationRef = useRef(false);
    useEffect(() => {
        if (!notes.ready || appearanceMigrationRef.current) return;
        appearanceMigrationRef.current = true;
        const legacy = readLegacyNoteAppearances(workspaceId);
        if (legacy.keys.length === 0) return; // pristine (the forever-after case) — nothing to do
        const liveIds = new Set(notes.notes.map((n) => n.id));
        const trashedIds = new Set(notes.metadata.trashed.map(trashEntryOriginalId));
        const live: Record<string, NoteAppearanceOverride> = {};
        const trashed: Record<string, NoteAppearanceOverride> = {};
        for (const [id, override] of Object.entries(legacy.overrides)) {
            if (liveIds.has(id)) live[id] = override;
            else if (trashedIds.has(id)) trashed[id] = override;
        }
        void notes.adoptNoteAppearances(live, trashed).then((landed) => {
            if (landed) clearLegacyNoteAppearanceKeys(legacy.keys);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot: reads notes state at ready-time only
    }, [notes.ready, workspaceId]);
    // The note-appearance popover's open state lives here (its ⋯ trigger is in the TopBar) so the ⌘⇧I
    // shortcut can toggle it too. Closed whenever the editing SESSION changes (another note opened,
    // or the note closed) — keyed on sessionId, NOT note id, because a rename/move re-keys the id in
    // place without ending the session and shouldn't dismiss a popover mid-adjustment.
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const noteClosed = notes.note === null;
    useEffect(() => setAppearanceOpen(false), [notes.sessionId, noteClosed]);

    // Apply the effective appearance (note override → workspace → app) to <html> as data-attributes
    // that index.css reads: `data-editor-font` swaps the editor/preview/title font, `data-accent` the
    // accent trio, `data-text-width` the content column width. useLayoutEffect (not useEffect) so the
    // swap lands before paint — on a workspace switch the tree remounts (keyed in App), so this runs
    // synchronously with the unmount cleanup, avoiding a one-frame flash to the default appearance.
    // Amber is the CSS default, so it clears the attribute rather than stamping it. Deps are the
    // three RESOLVED strings, not the source objects — those change identity on every note switch
    // (and on unrelated settings toggles), and each re-run is a remove+set attribute pair that
    // dirties style for the whole .g-root subtree for a no-op.
    const {editorFont, accentColor, textWidth} = effectiveAppearance(
        settings,
        workspaceSettings,
        noteAppearance,
    );
    useLayoutEffect(() => {
        const root = document.documentElement;
        root.setAttribute('data-editor-font', editorFont);
        root.setAttribute('data-text-width', textWidth);
        if (accentColor === 'amber') root.removeAttribute('data-accent');
        else root.setAttribute('data-accent', accentColor);
        return () => {
            root.removeAttribute('data-editor-font');
            root.removeAttribute('data-accent');
            root.removeAttribute('data-text-width');
        };
    }, [editorFont, accentColor, textWidth]);

    const [aboutOpen, setAboutOpen] = useState(false);
    const [attachmentsOpen, setAttachmentsOpen] = useState(false);
    const [trashOpen, setTrashOpen] = useState(false);

    // Open the About dialog when the native "About Gravity Notes" menu item fires (the Rust menu
    // handler emits `menu:about` to the FOCUSED window). Listen on the current window — a plain
    // `listen()` registers the any-target scope, which also receives events aimed at other windows,
    // so every window would open the dialog at once. Desktop only; the API is dynamically imported
    // so it never enters the web bundle (mirrors the close-request listener in useNotes).
    useEffect(() => {
        if (!isTauri) return undefined;
        let unlisten: (() => void) | undefined;
        let disposed = false;
        void import('@tauri-apps/api/webviewWindow').then(({getCurrentWebviewWindow}) =>
            getCurrentWebviewWindow()
                .listen('menu:about', () => setAboutOpen(true))
                .then((fn) => {
                    if (disposed) fn();
                    else unlisten = fn;
                }),
        );
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);
    // In-app auto-update (native desktop shell only). Checked silently on launch; an available
    // update surfaces as a toast → the update dialog. The menu's "Check for Updates…" opens it on
    // demand. The whole feature no-ops in the browser build (updater.supported === false).
    const updater = useAppUpdater();
    const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
    useEffect(() => {
        // Production-only so `tauri dev` doesn't prompt; manual checks still work in any build.
        // Main-window-only so a workspace window doesn't fire a second concurrent check (each
        // window is its own JS context — the updater's in-flight guard can't see across them).
        if (!updater.supported || !import.meta.env.PROD || !isMainWindow()) return;
        void (async () => {
            const found = await updater.check({silent: true});
            if (!found) return;
            add({
                name: `update-available-${toastSeq++}`,
                title: 'Update available',
                content: `Gravity Notes v${found.version} is ready to install.`,
                theme: 'info',
                autoHiding: false,
                actions: [{label: 'View', onClick: () => setUpdateDialogOpen(true)}],
            });
        })();
        // Run once on mount; updater.check + add are stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
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

    // Keep the app shell pinned home. The shell (html/body/#root) is a fixed layout locked with
    // `overflow: hidden` (index.css) so only the inner panes scroll — but `overflow: hidden` blocks
    // only USER scrolling, not PROGRAMMATIC scrolling. A `.focus()` (e.g. focusing the preview when
    // toggling it with ⌘⇧P) can scroll-into-view an ancestor, and WKWebView (unlike Chromium)
    // scrolls the shell into its momentary overflow — stranding the top bar above the viewport with
    // no way to scroll it back. Snap any shell scroll straight back to 0. Inner-pane scrolls target
    // their own element, so the target check leaves them untouched (no reflow on the hot path).
    useEffect(() => {
        const root = document.getElementById('root');
        const onScroll = (event: Event) => {
            const t = event.target;
            if (
                t !== document &&
                t !== document.documentElement &&
                t !== document.body &&
                t !== root
            )
                return; // an inner pane scrolled — leave it be
            const se = document.scrollingElement;
            if (se && (se.scrollTop !== 0 || se.scrollLeft !== 0)) {
                se.scrollTop = 0;
                se.scrollLeft = 0;
            }
            if (root && (root.scrollTop !== 0 || root.scrollLeft !== 0)) {
                root.scrollTop = 0;
                root.scrollLeft = 0;
            }
        };
        // Capture phase: scroll events don't bubble, so a bubble listener would miss element scrolls.
        window.addEventListener('scroll', onScroll, true);
        return () => window.removeEventListener('scroll', onScroll, true);
    }, []);
    const [collapsed, setCollapsed] = useState(
        () =>
            noteWindow ||
            readWorkspaceKey(workspaceId, 'sidebar-collapsed', LEGACY_SIDEBAR_KEY) === 'true',
    );
    useEffect(() => {
        if (noteWindow) return;
        localStorage.setItem(nsKey(workspaceId, 'sidebar-collapsed'), String(collapsed));
    }, [noteWindow, workspaceId, collapsed]);
    const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);

    // Transient overlay reveal of the collapsed sidebar (⌘⇧'); not persisted. Only meaningful
    // while collapsed — the invariant effect clears it whenever the sidebar is docked.
    const [peeked, setPeeked] = useState(false);
    useEffect(() => {
        if (!collapsed && peeked) setPeeked(false);
    }, [collapsed, peeked]);
    // True while the peek being opened is the automatic search peek below — it must NOT move
    // focus into the list (the user is mid-typing in the search box).
    const autoPeekRef = useRef(false);
    // When the peek opens, move focus into the list so arrow / ⌘J⌘K nav works immediately —
    // except for an auto-peek (see above), which leaves focus in the search box.
    useEffect(() => {
        if (!peeked) return;
        if (autoPeekRef.current) {
            autoPeekRef.current = false;
            return;
        }
        listRef.current?.focusSelected();
    }, [peeked]);
    // Auto-peek while searching with the sidebar collapsed: the results would otherwise render
    // into a hidden list, so typing looked like it did nothing. Opens on a query appearing (or
    // resuming — each keystroke re-opens a dismissed peek, since typing means "show me matches"),
    // closes when the query clears. Keyed on QUERY TRANSITIONS only: re-runs caused by
    // peeked/collapsed flips compare equal and bail, so dismissing the overlay (outside click,
    // committing a note) isn't instantly undone.
    const prevSearchRef = useRef(query);
    useEffect(() => {
        const prev = prevSearchRef.current;
        prevSearchRef.current = query;
        if (query === prev || !collapsed) return;
        const has = query.trim().length > 0;
        if (has && !peeked) {
            autoPeekRef.current = true;
            setPeeked(true);
        } else if (!has && prev.trim().length > 0 && peeked) {
            setPeeked(false);
        }
    }, [query, collapsed, peeked]);
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

    // Mobile single-pane push navigation (≤700px): the sidebar (list) and the editor each fill the
    // full body width, and exactly one is shown at a time. `mobilePane` chooses which — opening a
    // note pushes to 'editor', the top bar's Back button returns to 'list'. Ignored on wider
    // viewports, where the desktop multi-pane layout (collapsed/peeked overlay) applies instead.
    const isNarrow = useIsNarrow();
    const [mobilePane, setMobilePane] = useState<'list' | 'editor'>('list');
    // Reveal-coordination state (see revealNote): the note the mobile pane should push to once it has
    // loaded, plus stable reads of isNarrow / the open note for the callback.
    const pendingMobileOpenRef = useRef<string | null>(null);
    const isNarrowRef = useRef(isNarrow);
    isNarrowRef.current = isNarrow;
    const openNoteRef = useRef(notes.note);
    openNoteRef.current = notes.note;
    // When the open note goes away (deleted/discarded/externally removed) while on the editor pane,
    // fall back to the list instead of stranding the user on the empty-editor placeholder.
    useEffect(() => {
        if (isNarrow && mobilePane === 'editor' && notes.ready && !notes.note) {
            setMobilePane('list');
        }
    }, [isNarrow, mobilePane, notes.ready, notes.note]);

    // The single "open this note" funnel for mobile: push to the editor pane, but only once `id` is
    // the actually-loaded note. Every open site calls this (with the note's id) instead of a bare
    // setMobilePane('editor'), so the synchronous pane flip never races the async load — which used
    // to leave the first tap on the list (the note loading behind it), blink the pane, or slide the
    // list away before the note had switched. No-op on desktop, where the pane is unused.
    const revealNote = useCallback((id: string) => {
        if (!isNarrowRef.current) return;
        if (openNoteRef.current?.id === id) {
            setMobilePane('editor'); // already the loaded note → reveal immediately
            setRailOpen(false); // dismiss any open folder drawer (see the completer effect)
        } else {
            pendingMobileOpenRef.current = id; // reveal once it finishes loading (effect below)
        }
    }, []);

    // Complete a pending reveal once its note has loaded (notes.note caught up to the request).
    useEffect(() => {
        // Leaving narrow mode (e.g. an iPad rotate to a wide layout) abandons any in-flight reveal:
        // drop it so it can't re-fire and yank the user onto a stale note when narrow mode returns.
        if (!isNarrow) {
            pendingMobileOpenRef.current = null;
            return;
        }
        if (
            pendingMobileOpenRef.current !== null &&
            notes.note?.id === pendingMobileOpenRef.current
        ) {
            pendingMobileOpenRef.current = null;
            setMobilePane('editor');
            // Opening a note dismisses any open folder drawer too — otherwise it + its dimmed
            // backdrop would slide back in over the list when the user taps Back to it.
            setRailOpen(false);
        }
    }, [isNarrow, notes.note]);

    // The mobile counterpart of the auto-peek above. The search box lives in BOTH panes now, so a
    // query typed from inside a note would otherwise filter a list the user can't see — show the
    // list while a query is live, and hand the note back when it clears. The box itself is mounted
    // in the shared bar, so the pane swap never costs it focus. Keyed on QUERY TRANSITIONS only
    // (its own prev-ref), and the return leg is gated on having made the outbound switch, so
    // clearing a search the user started ON the list doesn't teleport them into a note.
    const mobileSearchSwitchRef = useRef(false);
    const prevMobileQueryRef = useRef(query);
    useEffect(() => {
        const prev = prevMobileQueryRef.current;
        prevMobileQueryRef.current = query;
        if (query === prev || !isNarrow || noteWindow) return;
        const has = query.trim().length > 0;
        if (has && mobilePane === 'editor') {
            mobileSearchSwitchRef.current = true;
            // A live query supersedes an in-flight reveal; otherwise the note it was waiting on
            // would push the editor back over the results the moment it loaded.
            pendingMobileOpenRef.current = null;
            setMobilePane('list');
        } else if (!has && prev.trim().length > 0 && mobileSearchSwitchRef.current) {
            mobileSearchSwitchRef.current = false;
            if (openNoteRef.current) setMobilePane('editor');
        }
    }, [query, isNarrow, noteWindow, mobilePane]);

    // The body + list-overlay elements, for the swipe-back gesture below (state, not refs: the hook
    // must re-run once the nodes mount).
    const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
    const [sidebarEl, setSidebarEl] = useState<HTMLElement | null>(null);

    // Return to the list from the editor pane (Back button / Escape) and land keyboard focus on the
    // selected row once the list is on screen — mirrors the desktop Esc-out-of-editor behavior. A
    // one-shot flag gates the focus so the recovery effect above (note vanished) doesn't grab it.
    const wantsListFocusRef = useRef(false);
    const backToList = useCallback(() => {
        // Cancel any in-flight reveal — the user chose the list, so a note still loading must not
        // push the editor pane back over it when it lands.
        pendingMobileOpenRef.current = null;
        wantsListFocusRef.current = true;
        setMobilePane('list');
    }, []);
    useEffect(() => {
        if (mobilePane === 'list' && wantsListFocusRef.current) {
            wantsListFocusRef.current = false;
            listRef.current?.focusSelected();
        }
    }, [mobilePane]);

    // Swipe right to go back — the touch equivalent of the Back button, and what a phone user
    // reaches for first. The list overlay tracks the finger and springs back if the drag doesn't
    // commit. Armed only on the mobile EDITOR pane (on the list there's nothing to go back to, and
    // a note window keeps the desktop layout).
    useSwipeBack(bodyEl, sidebarEl, isNarrow && !noteWindow && mobilePane === 'editor', backToList);

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
            revealNote(id); // mobile: ⌘[/⌘] can fire from the list pane — reveal the note
        },
        [nav, revealNote],
    );
    const history = useNoteHistory({
        activeId: notes.activeId,
        exists: historyExists,
        navigate: historyNavigate,
    });

    // Land in the search box on first load (nvALT: ready to type); a restored note is previewed
    // unfocused. A note window exists to edit its one note, so it lands in the editor body instead
    // (below, once the note has loaded and the editor mounted).
    useEffect(() => {
        if (!noteWindow) searchInputRef.current?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only (noteWindow is constant)
    }, []);
    const initialEditorFocusRef = useRef(false);
    useEffect(() => {
        if (!noteWindow || initialEditorFocusRef.current || !notes.ready) return;
        initialEditorFocusRef.current = true;
        // The assigned note failed to load (renamed/trashed since the window was asked for):
        // nothing is focusable in a panels-closed window, so land in the search box — the
        // keyboard stays alive and the placeholder's "create one" is one ⌘N away.
        if (notes.note) editorRef.current?.focus();
        else searchInputRef.current?.focus();
    }, [noteWindow, notes.ready, notes.note]);

    // A note window's native title tracks its open note (rename included), falling back to the
    // workspace label once no note is open; it also keeps the shell's label→note assignment
    // current, so a later "open in new window" for the note now shown here focuses this window
    // instead of duplicating it — and stops matching a note this window has navigated away from.
    // `notes.note` only changes identity on open/reload (edits flow through refs), so it's a
    // stable-enough dep. Gated on `ready`: the mount runs before the assigned note has LOADED,
    // and pushing `set_window_note(null)` then would wipe the label→note entry the shell seeded
    // before this page loaded — leaving per-note focus-if-open blind for the whole load (a second
    // ⌘↵ would duplicate the window) and flashing the native title through the workspace fallback.
    const openNote = notes.note;
    useEffect(() => {
        if (!noteWindow || !notes.ready) return;
        void (async () => {
            try {
                const {invoke} = await import('@tauri-apps/api/core');
                await invoke('set_window_note', {noteId: openNote?.id ?? null});
                const {getCurrentWindow} = await import('@tauri-apps/api/window');
                await getCurrentWindow().setTitle(
                    openNote?.title ??
                        (storageLabel ? `${storageLabel} — Gravity Notes` : 'Gravity Notes'),
                );
            } catch {
                // Best-effort: a failure only leaves the title stale / focus-if-open duplicable.
            }
        })();
    }, [noteWindow, notes.ready, openNote, storageLabel]);

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
        if (isNarrow)
            backToList(); // mobile: pop back to the notes list (+ focus the selected row)
        else if (collapsed) setPeeked(true);
        else nav.escapeEditor();
    }, [isNarrow, backToList, collapsed, nav]);

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

    // Leave the current workspace only after flushing any pending edit, so a keystroke inside the
    // 500 ms autosave window isn't lost when this component unmounts. If the flush couldn't land
    // (an unresolved conflict still holds the edit), switching would silently discard that
    // content — mirror the rename/move/trash conflict guards and make the user confirm the loss
    // first. Uses flush()'s return value, not the `notes.conflict` state, which is stale in this
    // closure right after the await (it would miss a conflict first surfaced BY this very flush).
    const confirmLeaveSafe = useCallback(async () => {
        const unresolvedConflict = await notes.flushPending();
        return (
            !unresolvedConflict ||
            window.confirm(
                'This note has an unresolved conflict with unsaved changes that will be lost if you switch workspaces. Continue?',
            )
        );
    }, [notes]);

    // Switch this window to another workspace (from the recents menu, the ⌃R switcher, or the
    // choice-screen recents). Flush-guarded; a failed open leaves the current workspace mounted.
    const handleOpenWorkspace = useCallback(
        (id: string) => {
            void (async () => {
                if (!(await confirmLeaveSafe())) return;
                // Guard the whole open: a false result means "couldn't open" (folder gone), and a
                // rejection (e.g. a dead permission handle) must surface a toast rather than become
                // an unhandled promise rejection.
                try {
                    const opened = await onOpenWorkspace(id);
                    if (!opened) {
                        onError(
                            'Could not open that workspace — its folder may have moved or be unavailable.',
                        );
                    }
                } catch (err) {
                    onError(err instanceof Error ? err.message : 'Could not open that workspace.');
                }
            })();
        },
        [confirmLeaveSafe, onOpenWorkspace, onError],
    );

    // Opening in a NEW window leaves this one untouched — no flush needed.
    const handleOpenWorkspaceInNewWindow = useCallback(
        (id: string) => {
            onOpenWorkspaceInNewWindow(id).catch((err) =>
                onError(err instanceof Error ? err.message : 'Could not open a new window'),
            );
        },
        [onOpenWorkspaceInNewWindow, onError],
    );

    // ⌘0 / Window ▸ Main Window is handled ONCE PER WINDOW in App (a stable listener there), not
    // here: Workspace is keyed by workspace and remounts on every ⌃R switch, and registering the
    // menu listener per mount leaked duplicates that fired ⌘0 for several workspaces at once.

    // Open a note in its own single-note window (row menu / ⌘↵ in the list). Unlike a workspace
    // window, flush first: the new window reads the note from DISK, so a pending edit here (this
    // note may well be the open one) must land before that page loads. If the flush could NOT
    // land it (an unresolved conflict re-queued the edit) and it's THIS note being opened, refuse:
    // the new window would show the stale disk copy while this one holds a divergent edit — a
    // silent fork where whichever window autosaves last wins.
    const handleOpenNoteInNewWindow = useCallback(
        (id: string) => {
            void (async () => {
                const unresolved = await notes.flushPending();
                if (unresolved && id === notes.activeId) {
                    onError(
                        'This note has an unresolved conflict — resolve it before opening it in a new window.',
                    );
                    return;
                }
                const title = notes.notes.find((n) => n.id === id)?.title ?? titleFromFileName(id);
                try {
                    await onOpenNoteInNewWindow(id, title);
                } catch (err) {
                    onError(err instanceof Error ? err.message : 'Could not open a new window');
                }
            })();
        },
        [notes, onOpenNoteInNewWindow, onError],
    );

    const handleRemoveWorkspace = useCallback(
        (id: string) => {
            onRemoveWorkspace(id).catch((err) =>
                onError(err instanceof Error ? err.message : 'Could not update recent workspaces'),
            );
        },
        [onRemoveWorkspace, onError],
    );

    // "Open Folder…" replaces THIS window's workspace with the picked folder, so it takes the same
    // flush guard as a switch.
    const handleOpenFolder = useCallback(() => {
        void (async () => {
            if (!(await confirmLeaveSafe())) return;
            onOpenFolder();
        })();
    }, [confirmLeaveSafe, onOpenFolder]);

    // ⌘↵ / ⌘-click on "Open Folder…": the picked folder opens in its OWN window, so this one
    // stays put — no flush guard needed (nothing here is left).
    const handleOpenFolderInNewWindow = useCallback(() => {
        onOpenFolderInNewWindow().catch((err) =>
            onError(err instanceof Error ? err.message : 'Could not open the folder'),
        );
    }, [onOpenFolderInNewWindow, onError]);

    // The ⌃R switcher. Refresh the registry BEFORE opening, so recents written by other windows are
    // already in the list when the dialog seeds its pre-highlight — otherwise a late refresh could
    // reorder the rows under a highlight the user already saw (opening the wrong workspace on ↵).
    const [switcherOpen, setSwitcherOpen] = useState(false);
    const openSwitcher = useCallback(() => {
        void (async () => {
            await onRefreshWorkspaces();
            setSwitcherOpen(true);
        })();
    }, [onRefreshWorkspaces]);

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
                    // Hold the watcher/focus pipelines off while the bulk write runs — imports
                    // write below the hook's echo stamps, so every batch would otherwise trigger
                    // a full mid-import re-list. reload() (not refresh()) afterwards: an import
                    // can overwrite the OPEN note, which must surface as a conflict, not a
                    // silent reconcile.
                    const count = await notes.withBulkWrites(() => importNotes(store, files));
                    await notes.reload();
                    notify(count === 1 ? 'Imported 1 note' : `Imported ${count} notes`);
                } catch (err) {
                    // The import may have written some notes before throwing — refresh so those
                    // become visible, and word the error as a possible partial import.
                    await notes.reload();
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
                if (id) {
                    nav.setSelected(id);
                    revealNote(id); // mobile: reveal the new note's editor once it's created + loaded
                }
            })();
        },
        [notes, nav, selectedFolder, revealNote],
    );

    // Duplicate a note: copy it (shared attachments), then select the copy with its title armed for
    // focus, so the user can immediately rename it.
    const handleDuplicate = useCallback(
        (id: string) => {
            nav.prepareCreate();
            void (async () => {
                const newId = await notes.duplicate(id);
                if (newId) {
                    nav.setSelected(newId);
                    revealNote(newId); // mobile: show the copy so its armed title can be renamed
                }
            })();
        },
        [notes, nav, revealNote],
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
                revealNote(existing);
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
                    revealNote(newId);
                }
            })();
        },
        [notes, nav, revealNote],
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
    // (the list is global then); an empty folder leaves the editor as-is. On mobile the preview is
    // skipped too: `browse` mounts the editor for a note the user can't see (the list re-scopes to
    // the folder on its own), wasting a body read and a hidden editor remount.
    const handleSelectFolder = useCallback(
        (folder: string | null) => {
            setSelectedFolder(folder);
            // Mobile: picking a folder dismisses the rail drawer so the filtered list is revealed.
            if (isNarrow) setRailOpen(false);
            if (searching || isNarrow) return;
            const first = notesInFolder(orderedNotes, folder)[0];
            if (first) nav.browse(first.id);
        },
        [isNarrow, searching, orderedNotes, nav],
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
            setExpandedFolders((prev) => new Set([...prev].map((p) => reprefixPath(p, from, to))));
            // Return the promise (resolving to `moved`) so the rail only commits its select-after-rename
            // once the move actually succeeds — a rejected move (collision) resolves false, so the rail
            // doesn't dangle pendingRenameToRef on a path that was never created.
            return notes.moveFolder(from, to).then((moved) => {
                // The move was rejected (collision) or a no-op: the folders never changed, so undo
                // the optimistic re-prefix (inverse: to → from) instead of leaving selection on a
                // path that doesn't exist.
                if (!moved) {
                    setSelectedFolder((cur) => (cur ? reprefixPath(cur, to, from) : cur));
                    setExpandedFolders(
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
                if (nav.selectedId) {
                    nav.commit(nav.selectedId);
                    revealNote(nav.selectedId);
                }
                setPeeked(false);
            } else {
                setPeeked(true);
            }
        },
        toggleEditorMode: () => editorRef.current?.toggleMode(),
        openNoteAppearance: () => {
            // Toggle the TopBar's ⋯ appearance popover — only meaningful with a note open.
            if (notes.note) setAppearanceOpen((open) => !open);
        },
        togglePreview: () => setPreviewMode((p) => !p),
        openHelp: () => setHelpOpen(true),
        openSettings: () => setSettingsOpen(true),
        renameSelected: () => {
            // F2 fires even while typing. Context-aware: a focused folder row → rename the folder;
            // the whole in-editor title row (the title input handles F2 itself; its icon-picker
            // button is a sibling of the input) and any floating layer — every uikit popup renders
            // `.g-popup` (menus, the icon pickers) and every uikit modal `[role="dialog"]` — are
            // no-ops: a list rename from there would yank focus out from under the open layer
            // (and even commit on blur behind a modal); otherwise rename the selected note.
            const el = document.activeElement;
            if (el instanceof HTMLElement) {
                const folderRow = el.closest('.folder-rail__row[data-path]');
                if (folderRow) {
                    railRef.current?.startRename(folderRow.getAttribute('data-path') ?? '');
                    return;
                }
                if (el.closest('.note-title-row, .g-popup, [role="dialog"]')) return;
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
        openWorkspaces: openSwitcher,
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
                    workspaces={workspaces}
                    activeWorkspaceId={workspaceId}
                    isDesktop={isDesktopTauri}
                    supportsFolders={supportsFolders}
                    onOpenWorkspace={handleOpenWorkspace}
                    onOpenWorkspaceInNewWindow={handleOpenWorkspaceInNewWindow}
                    onOpenFolder={handleOpenFolder}
                    // TopBar fires this only on desktop ⌘-click (and the hook no-ops on web).
                    onOpenFolderInNewWindow={handleOpenFolderInNewWindow}
                    onOpenSwitcher={openSwitcher}
                    onMenuOpen={() => void onRefreshWorkspaces()}
                    mobile={isNarrow}
                    mobilePane={isNarrow && !noteWindow ? mobilePane : undefined}
                    onMobileBack={backToList}
                    onExport={handleExport}
                    onImport={handleImportClick}
                    onManageAttachments={handleManageAttachments}
                    onReload={() => {
                        // reload(), not refresh(): the conflict check must run first, or an
                        // externally-deleted open note reloads with no banner (see useNotes).
                        notes.reload().catch((err: unknown) => {
                            onError(err instanceof Error ? err.message : 'Failed to reload notes');
                        });
                    }}
                    onOpenTrash={() => setTrashOpen(true)}
                    trashCount={notes.trashCount}
                    onOpenHelp={() => setHelpOpen(true)}
                    onOpenSettings={() => setSettingsOpen(true)}
                    onCheckForUpdates={
                        updater.supported
                            ? () => {
                                  setUpdateDialogOpen(true);
                                  // Skip a redundant round trip if an update is already known (from
                                  // the launch check) or a check is already in flight.
                                  if (
                                      updater.status !== 'available' &&
                                      updater.status !== 'checking'
                                  ) {
                                      void updater.check();
                                  }
                              }
                            : undefined
                    }
                    updateAvailable={updater.status === 'available'}
                    themePref={themePref}
                    onChangeThemePref={onChangeThemePref}
                    onToggleCollapsed={toggleCollapsed}
                    saveState={notes.saveState}
                    query={query}
                    onQueryChange={setQuery}
                    searchInputRef={searchInputRef}
                    notes={filteredNotes}
                    searchLoading={searchLoading}
                    // On a big vault the box shows the live `query` but `notes`/`searchLoading` lag by
                    // the debounce; flag that gap so the keyboard model doesn't act on a stale list.
                    searchPending={query !== debouncedQuery}
                    selectedId={nav.selectedId}
                    onCommit={(id) => {
                        // Enter on a search match: tuck the (auto-)peeked sidebar back away —
                        // focus moves to the editor, and the overlay has served its purpose.
                        nav.commit(id);
                        setPeeked(false);
                        revealNote(id);
                    }}
                    onCreate={(title) => handleCreate(title, '')}
                    onClose={nav.closeFromSearch}
                    onEnterList={enterList}
                    onFocusList={() => {
                        // Enter on an EMPTY search box: step onto the selected note's row — but
                        // with the sidebar collapsed (and not peeked) there is no visible row to
                        // land on, so return to the editor body instead; the open note is the
                        // only thing on screen.
                        if (collapsed && !peeked && notes.note) editorRef.current?.focus();
                        else listRef.current?.focusSelected();
                    }}
                    noteOpen={notes.note !== null}
                    appearanceOpen={appearanceOpen}
                    onToggleAppearance={() => setAppearanceOpen((open) => !open)}
                    onCloseAppearance={() => setAppearanceOpen(false)}
                    noteAppearance={noteAppearance}
                    onSetNoteAppearance={setNoteSetting}
                    onResetNoteAppearance={resetNoteAppearance}
                />

                <div
                    ref={setBodyEl}
                    className={
                        'workspace__body' +
                        // A single-note window always shows one note with both panels tucked away,
                        // never the list↔editor push nav — so even when it's dragged ≤700px it keeps
                        // the collapsed desktop layout (whose `_collapsed` class hides the sidebar)
                        // instead of overlaying the whole vault.
                        (isNarrow && !noteWindow
                            ? ' workspace__body_mobile' +
                              (mobilePane === 'editor' ? ' workspace__body_mobile-editor' : '')
                            : (collapsed ? ' workspace__body_collapsed' : '') +
                              (collapsed && peeked ? ' workspace__body_peeked' : ''))
                    }
                >
                    <aside ref={setSidebarEl} className="workspace__sidebar">
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
                        {/* Mobile: a dimmed backdrop behind the rail drawer — tap it to dismiss the
                            folder picker without changing the scope (picking a folder also closes
                            it). Desktop keeps the rail docked inline, so no backdrop there. */}
                        {isNarrow && railOpen ? (
                            <div
                                className="workspace__rail-backdrop"
                                onClick={() => setRailOpen(false)}
                                aria-hidden="true"
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
                                revealNote(id);
                            }}
                            tapToOpen={isNarrow}
                            onEscapeList={() => {
                                setPeeked(false);
                                nav.escapeToSearch();
                            }}
                            onCreate={handleCreate}
                            onRequestMove={setMovingNoteId}
                            onDuplicate={handleDuplicate}
                            onOpenInNewWindow={
                                isDesktopTauri ? handleOpenNoteInNewWindow : undefined
                            }
                            onReveal={handleReveal}
                            onRename={handleRename}
                            onDelete={handleDelete}
                            sortMode={notes.metadata.sort}
                            onSortChange={notes.setSortMode}
                            pinnedIds={notes.metadata.pinned}
                            onTogglePin={notes.togglePin}
                            icons={notes.metadata.icons}
                            onSetIcon={notes.setIcon}
                            showIcons={settings.showNoteIcons}
                            railOpen={railOpen}
                            onToggleRail={toggleRail}
                            // Straight setSelectedFolder — unlike rail selection this must NOT
                            // preview the first note (clearing a filter shouldn't switch notes).
                            onClearScope={() => setSelectedFolder(null)}
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
                                    {previewMode ? (
                                        // Floating state chip: read-only preview is otherwise
                                        // invisible (the surface just stops responding to edits).
                                        // Clicking it (or ⌘⇧P) returns to editing.
                                        <Label
                                            className="workspace__preview-badge"
                                            theme="info"
                                            size="s"
                                            icon={<Icon data={Eye} size={13} />}
                                            interactive
                                            onClick={() => setPreviewMode(false)}
                                            title="Read-only preview — click (or ⌘⇧P) to edit"
                                        >
                                            {/* Text swaps to the action on hover (CSS). */}
                                            <span className="workspace__preview-badge-idle">
                                                Preview
                                            </span>
                                            <span className="workspace__preview-badge-hover">
                                                Exit preview
                                            </span>
                                        </Label>
                                    ) : null}
                                    <EditorPane
                                        ref={editorRef}
                                        note={notes.note}
                                        autofocus={nav.autofocus}
                                        sessionId={notes.sessionId}
                                        preview={previewMode}
                                        onChange={notes.edit}
                                        onRename={handleEditorRename}
                                        onEscape={handleEditorEscape}
                                        onUploadFile={handleUploadFile}
                                        wikiNotes={notes.notes}
                                        onOpenWikiLink={handleOpenWikiLink}
                                        icon={notes.metadata.icons[notes.note.id]}
                                        onSetIcon={(name) => notes.setIcon(notes.note!.id, name)}
                                        showNoteIcons={settings.showNoteIcons}
                                    />
                                </div>
                                <BacklinksPanel
                                    backlinks={backlinks}
                                    onOpen={(id) => {
                                        nav.commit(id);
                                        setPeeked(false);
                                        revealNote(id);
                                    }}
                                />
                            </>
                        ) : (
                            // Only once loading settled: flashing the placeholder before the
                            // restored note lands read as a blink on every new window.
                            notes.ready && (
                                <div className="workspace__placeholder">
                                    <Text variant="body-2" color="secondary">
                                        Select a note, or create a new one to start writing.
                                    </Text>
                                </div>
                            )
                        )}
                    </main>
                </div>

                <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
                <SettingsDialog
                    open={settingsOpen}
                    onClose={() => setSettingsOpen(false)}
                    settings={settings}
                    setSetting={setSetting}
                    workspaceSettings={workspaceSettings}
                    setWorkspaceSetting={setWorkspaceSetting}
                    workspaceLabel={storageLabel}
                />

                <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

                <UpdateDialog
                    open={updateDialogOpen}
                    updater={updater}
                    onClose={() => setUpdateDialogOpen(false)}
                />

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

                <WorkspaceSwitcherDialog
                    open={switcherOpen}
                    workspaces={workspaces}
                    currentId={workspaceId}
                    isDesktop={isDesktopTauri}
                    supportsFolders={supportsFolders}
                    onOpen={(id) => {
                        setSwitcherOpen(false);
                        handleOpenWorkspace(id);
                    }}
                    onOpenInNewWindow={(id) => {
                        setSwitcherOpen(false);
                        handleOpenWorkspaceInNewWindow(id);
                    }}
                    onOpenFolder={() => {
                        setSwitcherOpen(false);
                        handleOpenFolder();
                    }}
                    // The dialog routes here only on desktop ⌘↵/⌘-click (its commit gates on
                    // isDesktop); the hook additionally no-ops on web.
                    onOpenFolderInNewWindow={() => {
                        setSwitcherOpen(false);
                        handleOpenFolderInNewWindow();
                    }}
                    onRemove={handleRemoveWorkspace}
                    onClose={() => setSwitcherOpen(false)}
                />
            </div>
        </AttachmentsContext.Provider>
    );
}
