import {useCallback, useEffect, useRef, useState} from 'react';

import {isMainWindow, isNoteWindow, isTauri} from '../isTauri';
import {FileSystemNoteStore} from '../storage/fileSystemStore';
import {IndexedDbNoteStore} from '../storage/indexedDbStore';
import {TauriNoteStore} from '../storage/tauriStore';
import type {NoteStore} from '../storage/types';
import {
    type StorageBackend,
    type WorkspaceEntry,
    clearLastActive,
    findFsaEntry,
    folderNameFromPath,
    loadLastActiveId,
    loadWorkspaces,
    queryPermission,
    removeWorkspace as removeWorkspaceEntry,
    requestPermission,
    touchWorkspace,
    workspaceIdForPath,
} from '../storage/workspaceRegistry';
import {TimeoutError, withTimeout} from '../timeout';

export type StorageState =
    | 'loading' // checking for a previously-chosen workspace
    | 'choosing' // no workspace chosen yet — show the first-run choice
    | 'needs-permission' // a folder was remembered, but permission must be re-granted
    | 'ready';

/** Browser File System Access API (Chromium web build). Absent in the WKWebView desktop shell. */
const supportsFileSystem = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
/** Whether folder-on-disk storage is offered at all: native in the app, or FSA in the browser. */
const supportsFolders = isTauri || supportsFileSystem;

const BROWSER_LABEL = isTauri ? 'In this app' : 'In this browser';

/** The registry entry's display name (the in-browser workspace gets a context-aware label). */
function displayName(entry: WorkspaceEntry): string {
    return entry.backend === 'indexeddb' ? BROWSER_LABEL : entry.name;
}

/** A workspace as exposed to the UI: the registry entry sans handle, with a display-ready name. */
export interface WorkspaceInfo {
    id: string;
    backend: StorageBackend;
    name: string;
    /** The folder path (`tauri-fs` only), for disambiguating captions. */
    path?: string;
}

function toInfo(entry: WorkspaceEntry): WorkspaceInfo {
    return {id: entry.id, backend: entry.backend, name: displayName(entry), path: entry.path};
}

/** The registry entry for the in-browser/in-app workspace (created on first use). */
function browserEntry(): WorkspaceEntry {
    return {
        id: 'indexeddb',
        backend: 'indexeddb',
        name: 'Browser storage',
        lastOpenedAt: Date.now(),
    };
}

/**
 * How long the folder probe may run before we give up. The underlying walk can't be cancelled (a
 * Tauri `invoke`), so it keeps running, but the UI moves on.
 */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * How an entry is being opened: `seq` is the supersession ticket; `isBootstrap` distinguishes the
 * launch restore (errors land on the choice screen; no permission prompts — there's no user
 * gesture yet) from a user-initiated switch (failures leave the current workspace mounted).
 */
interface OpenOpts {
    seq: number;
    isBootstrap?: boolean;
    /**
     * Skip the folder liveness probe: the workspace was assigned to this window by the shell
     * moments ago (a fresh ws-/note- window spawned from a LIVE workspace), so the folder was
     * just verified by the opener — re-walking it here only delays the new window's first paint.
     */
    skipProbe?: boolean;
}

/**
 * The desktop shell's per-window assignment: the workspace this window was created for (ws-/note-
 * windows, set before the page loaded), plus — for single-note windows — the note to open. Null
 * when unassigned (the main window at launch) or outside the shell. A failed note read degrades
 * to workspace-only rather than discarding the workspace.
 */
async function readWindowAssignment(): Promise<{
    workspaceId: string;
    noteId: string | null;
} | null> {
    if (!isTauri) return null;
    try {
        const {invoke} = await import('@tauri-apps/api/core');
        const workspaceId = await invoke<string | null>('window_workspace');
        if (!workspaceId) return null;
        let noteId: string | null = null;
        try {
            noteId = await invoke<string | null>('window_note');
        } catch {
            // Without the note assignment this window still opens its workspace normally.
        }
        return {workspaceId, noteId};
    } catch {
        return null;
    }
}

/** The user-facing message for a failed folder probe. */
function probeFailureMessage(err: unknown, timedOut: boolean): string {
    if (timedOut) {
        return (
            'That folder took too long to open — it may be very large or on a disconnected ' +
            'drive. Choose a different folder.'
        );
    }
    return err instanceof Error ? err.message : 'Your notes folder is no longer available.';
}

export interface NotesStorage {
    state: StorageState;
    /** The ready note store (file-system or in-browser), or null until `ready`. */
    store: NoteStore | null;
    backend: StorageBackend | null;
    /** Human label for the active storage (folder name, or "In this browser"). */
    storageLabel: string | null;
    /** The active workspace's registry id, or null until `ready`. */
    activeWorkspaceId: string | null;
    /**
     * This desktop window's note assignment (single-note windows only): the workspace it was
     * created for and the note to open instead of the last-active restore. Read once at bootstrap;
     * null in every other window and on the web.
     */
    windowNote: {workspaceId: string; noteId: string} | null;
    /** Known workspaces, most recently opened first (includes the active one). */
    workspaces: WorkspaceInfo[];
    error: string | null;
    /** Running inside the desktop app (native folder access) rather than a plain browser. */
    isTauri: boolean;
    /** Whether the File System Access API is available (Chromium web build). */
    supportsFileSystem: boolean;
    /** Whether a folder-on-disk option is offered at all (native app, or FSA in the browser). */
    supportsFolders: boolean;
    /** Open the system folder picker (must be triggered by a user gesture). */
    pickFolder(): Promise<void>;
    /**
     * Desktop only: pick a folder and open it as its OWN workspace window, leaving this window
     * untouched (⌘↵/⌘-click on "Open Folder…"). Rejections surface to the caller (toast);
     * dismissing the picker resolves quietly.
     */
    pickFolderForNewWindow(): Promise<void>;
    /** Use in-browser (IndexedDB) storage. */
    useBrowserStorage(): Promise<void>;
    /** Re-request permission for the remembered folder (user gesture). */
    grantPermission(): Promise<void>;
    /** Return to the choice screen (the workspace registry is kept). */
    reset(): Promise<void>;
    /**
     * Switch this window to a known workspace. On desktop, a workspace already shown in another
     * window is focused there instead. Resolves false when the workspace could not be opened (the
     * current one stays mounted).
     */
    openWorkspace(id: string): Promise<boolean>;
    /** Desktop only: open a workspace in its own window (focused if already open somewhere). */
    openInNewWindow(id: string): Promise<void>;
    /**
     * Desktop only: open a note from the ACTIVE workspace in its own single-note window (focused
     * if that note is already open in one). `title` seeds the native window title.
     */
    openNoteInNewWindow(noteId: string, title: string): Promise<void>;
    /** Drop a workspace from the registry (its notes on disk are untouched). */
    removeWorkspace(id: string): Promise<void>;
    /** Re-read the registry (e.g. before showing a recents list — other windows may have written). */
    refreshWorkspaces(): Promise<void>;
}

/**
 * The workspace lifecycle: bootstrap (restore this window's workspace, or the last active one),
 * switching, opening in new desktop windows, and the FSA permission dance — as a backend-agnostic
 * state machine that hands `Workspace` a ready {@link NoteStore}. Every opened workspace is
 * remembered in the registry (IndexedDB), which feeds the recents UI.
 */
export function useNotesStorage(): NotesStorage {
    const [state, setState] = useState<StorageState>('loading');
    const [store, setStore] = useState<NoteStore | null>(null);
    const [backend, setBackend] = useState<StorageBackend | null>(null);
    const [storageLabel, setStorageLabel] = useState<string | null>(null);
    const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
    const [windowNote, setWindowNote] = useState<{workspaceId: string; noteId: string} | null>(
        null,
    );
    const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
    const [error, setError] = useState<string | null>(null);
    // Full registry entries (with handles) backing the exposed WorkspaceInfo list.
    const entriesRef = useRef<WorkspaceEntry[]>([]);
    // The entry awaiting a permission re-grant while in `needs-permission`.
    const pendingRef = useRef<WorkspaceEntry | null>(null);
    // Mirrors activeWorkspaceId for callbacks that must not go stale.
    const activeIdRef = useRef<string | null>(null);
    // Supersession counter: every storage action (and the bootstrap) claims a sequence number, and
    // async continuations bail once a newer action has claimed a higher one — so a slow bootstrap
    // read can't clobber a choice the user just made, and rapid switches can't interleave.
    const opSeqRef = useRef(0);

    const beginOp = useCallback(() => ++opSeqRef.current, []);
    const isStale = useCallback((seq: number) => opSeqRef.current !== seq, []);

    const refreshWorkspaces = useCallback(async () => {
        try {
            const entries = await loadWorkspaces();
            entriesRef.current = entries;
            setWorkspaces(entries.map(toInfo));
        } catch {
            // Registry unavailable (e.g. private mode) — keep whatever list we had.
        }
    }, []);

    /**
     * Post-activation bookkeeping, best-effort: recency, and the desktop shell's window state.
     * Guarded by the activation's `seq`: a newer activation supersedes this one, and its detached
     * writes (last-active pointer, `set_window_workspace`) must not land for a workspace we've
     * already left — otherwise a rapid A→B switch could restore A next launch or register A for a
     * window showing B. Re-checked before each awaited write since supersession can happen mid-way.
     */
    const finalizeActivation = useCallback(
        async (entry: WorkspaceEntry, seq: number) => {
            if (isStale(seq)) return;
            try {
                await touchWorkspace(entry);
            } catch {
                // Recency is best-effort; the workspace itself is already open.
            }
            if (isStale(seq)) return;
            await refreshWorkspaces();
            if (!isTauri || isStale(seq)) return;
            try {
                const {invoke} = await import('@tauri-apps/api/core');
                if (isStale(seq)) return;
                await invoke('set_window_workspace', {wsId: entry.id});
            } catch {
                // Without the registration this window just won't be focus-if-open targetable.
            }
            if (isStale(seq)) return;
            // A single-note window's native title tracks its open NOTE (owned by Workspace's
            // title-sync effect), not the workspace — don't fight over it.
            if (isNoteWindow()) return;
            try {
                const {getCurrentWindow} = await import('@tauri-apps/api/window');
                if (isStale(seq)) return;
                await getCurrentWindow().setTitle(`${displayName(entry)} — Gravity Notes`);
            } catch {
                // Title stays generic.
            }
        },
        [isStale, refreshWorkspaces],
    );

    const activate = useCallback(
        (entry: WorkspaceEntry, noteStore: NoteStore, seq: number) => {
            pendingRef.current = null;
            activeIdRef.current = entry.id;
            setStore(noteStore);
            setBackend(entry.backend);
            setStorageLabel(displayName(entry));
            setActiveWorkspaceId(entry.id);
            setError(null);
            setState('ready');
            void finalizeActivation(entry, seq);
        },
        [finalizeActivation],
    );

    const openTauriEntry = useCallback(
        async (entry: WorkspaceEntry, opts: OpenOpts): Promise<boolean> => {
            const {seq, isBootstrap = false} = opts;
            if (!entry.path) return false;
            const tauriStore = new TauriNoteStore(entry.path);
            // Probe that the folder still exists/reads before landing in the workspace: if it
            // was moved/deleted/unmounted, every fs call there would fail. A failed probe on
            // bootstrap surfaces the error and routes to the choice screen so the user can
            // re-pick, rather than stranding them on a broken workspace. The probe is
            // time-bounded: a huge/strange folder (home dir, a network mount) makes the
            // recursive walk hang instead of throw, which would otherwise leave the app stuck
            // on the loading screen forever. Skipped for shell-assigned windows (see OpenOpts).
            if (!opts.skipProbe) {
                try {
                    await withTimeout(tauriStore.list(), PROBE_TIMEOUT_MS, 'Folder probe');
                } catch (err) {
                    if (isStale(seq)) return false;
                    const timedOut = err instanceof TimeoutError;
                    // A bootstrap timeout means the folder is effectively unusable (too large /
                    // too slow), so forget the launch pointer — otherwise the next launch re-hangs
                    // on the same path. The registry entry itself is kept (removable in the UI).
                    if (timedOut && isBootstrap) await clearLastActive().catch(() => {});
                    if (isStale(seq)) return false;
                    // Surface the error either way: on bootstrap it also routes to the choice
                    // screen; on a switch it stays on the current workspace but the message must
                    // still show (the FolderGate recents list reads `error` and has no toaster of
                    // its own, so without this a click on a gone folder would silently do nothing).
                    setError(probeFailureMessage(err, timedOut));
                    if (isBootstrap) setState('choosing');
                    return false;
                }
                if (isStale(seq)) return false;
            }
            activate(entry, tauriStore, seq);
            return true;
        },
        [activate, isStale],
    );

    const openFsaEntry = useCallback(
        async (entry: WorkspaceEntry, opts: OpenOpts): Promise<boolean> => {
            const {seq, isBootstrap = false} = opts;
            if (!entry.handle) return false;
            let permission: PermissionState;
            try {
                permission = await queryPermission(entry.handle);
            } catch {
                // A dead/detached handle can throw rather than report 'prompt'; treat it as
                // not-granted so we fall through to the re-grant path instead of letting the
                // rejection escape as an unhandled promise (the caller chain is unguarded).
                permission = 'prompt';
            }
            if (isStale(seq)) return false;
            if (permission === 'granted') {
                activate(entry, new FileSystemNoteStore(entry.handle), seq);
                return true;
            }
            if (!isBootstrap) {
                // A switch runs off a click/keypress, so try the permission prompt inline before
                // falling back to the grant screen.
                try {
                    if (await requestPermission(entry.handle)) {
                        if (isStale(seq)) return false;
                        activate(entry, new FileSystemNoteStore(entry.handle), seq);
                        return true;
                    }
                } catch {
                    // Denied/expired activation — the grant screen below handles it.
                }
                if (isStale(seq)) return false;
            }
            pendingRef.current = entry;
            // Set the label so the grant screen can name the folder it's asking about.
            setStorageLabel(entry.name);
            setState('needs-permission');
            return true;
        },
        [activate, isStale],
    );

    /**
     * Open a registry entry in this window. Returns true when handled (ready, or routed to the
     * permission gate) and false when it failed — on a bootstrap that lands on the choice screen
     * with an error; on a switch the current workspace stays mounted untouched.
     */
    const openEntry = useCallback(
        async (entry: WorkspaceEntry, opts: OpenOpts): Promise<boolean> => {
            if (entry.backend === 'indexeddb') {
                if (isStale(opts.seq)) return false;
                activate(entry, new IndexedDbNoteStore(), opts.seq);
                return true;
            }
            if (entry.backend === 'tauri-fs') return openTauriEntry(entry, opts);
            return openFsaEntry(entry, opts);
        },
        [activate, isStale, openTauriEntry, openFsaEntry],
    );

    // On load, restore this window's assigned workspace (desktop ws-windows), else the last active.
    useEffect(() => {
        let cancelled = false;
        const seq = beginOp();
        const bail = () => cancelled || isStale(seq);
        (async () => {
            try {
                const entries = await loadWorkspaces();
                if (bail()) return;
                entriesRef.current = entries;
                setWorkspaces(entries.map(toInfo));
                // A desktop window created via "open in new window" was assigned its workspace
                // before its page loaded; the main window has no assignment at launch. A
                // single-note window additionally carries the note it was opened for — Workspace
                // opens that instead of the sidecar's last-active restore.
                const assignment = await readWindowAssignment();
                if (bail()) return;
                let targetId = assignment?.workspaceId;
                if (assignment?.noteId) {
                    setWindowNote({
                        workspaceId: assignment.workspaceId,
                        noteId: assignment.noteId,
                    });
                }
                if (!targetId) {
                    targetId = await loadLastActiveId();
                    if (bail()) return;
                }
                const entry = targetId
                    ? entries.find((candidate) => candidate.id === targetId)
                    : undefined;
                if (!entry) {
                    setState('choosing');
                    return;
                }
                const opened = await openEntry(entry, {
                    seq,
                    isBootstrap: true,
                    // A shell-assigned ws-/note- window's workspace was verified seconds ago by
                    // the window that spawned it — skip the probe so the new window paints
                    // sooner. NOT for the main window: its assignment is registered on every
                    // in-place open and lives until the window is destroyed, so after a webview
                    // reload (crash recovery, dev ⌘R) it can be hours stale — that path keeps
                    // the timed liveness probe.
                    skipProbe: assignment !== null && !isMainWindow(),
                });
                if (bail()) return;
                // A restored entry that couldn't be opened but set no state itself (e.g. a
                // malformed entry missing its path/handle) must not strand the app on the
                // 'loading' spinner — fall through to the choice screen.
                if (!opened) setState('choosing');
            } catch (err) {
                // IndexedDB blocked (e.g. private mode) — don't hang on the spinner.
                if (bail()) return;
                setError(err instanceof Error ? err.message : 'Could not restore your storage.');
                setState('choosing');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [beginOp, isStale, openEntry]);

    const pickFolder = useCallback(async () => {
        const seq = beginOp();
        setError(null);
        if (isTauri) {
            try {
                // Native folder picker (the File System Access API is unavailable in WKWebView).
                const {open} = await import('@tauri-apps/plugin-dialog');
                const selected = await open({
                    directory: true,
                    multiple: false,
                    title: 'Choose your notes folder',
                });
                if (typeof selected !== 'string') return; // dismissed
                if (isStale(seq)) return;
                activate(
                    {
                        id: workspaceIdForPath(selected),
                        backend: 'tauri-fs',
                        name: folderNameFromPath(selected),
                        lastOpenedAt: Date.now(),
                        path: selected,
                    },
                    new TauriNoteStore(selected),
                    seq,
                );
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not open the folder.');
            }
            return;
        }
        try {
            const handle = await window.showDirectoryPicker({
                id: 'gravity-notes',
                mode: 'readwrite',
            });
            if (!(await requestPermission(handle))) {
                setError('Permission to access the folder was denied.');
                return;
            }
            if (isStale(seq)) return;
            // Re-picking a known folder must not spawn a duplicate entry — handles aren't
            // comparable by value, so ask the registry (freshly read; other windows may write).
            const existing = await findFsaEntry(handle, await loadWorkspaces());
            if (isStale(seq)) return;
            const entry: WorkspaceEntry = existing
                ? {...existing, handle, name: handle.name}
                : {
                      id: `fsa:${crypto.randomUUID()}`,
                      backend: 'filesystem',
                      name: handle.name,
                      lastOpenedAt: Date.now(),
                      handle,
                  };
            activate(entry, new FileSystemNoteStore(handle), seq);
        } catch (err) {
            // The user dismissing the picker throws AbortError — not an error to show.
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : 'Could not open the folder.');
        }
    }, [activate, beginOp, isStale]);

    const pickFolderForNewWindow = useCallback(async () => {
        if (!isTauri) return;
        const {open} = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
            directory: true,
            multiple: false,
            title: 'Choose your notes folder',
        });
        if (typeof selected !== 'string') return; // dismissed
        // Probe the picked folder like every other tauri-fs open path: the new window's bootstrap
        // SKIPS its own probe for shell-assigned workspaces on the premise the opener verified
        // it — this is where that premise is made true. Probe BEFORE touching the registry, so a
        // dead or endless (home-dir) pick never becomes the last-active launch pointer.
        try {
            await withTimeout(
                new TauriNoteStore(selected).list(),
                PROBE_TIMEOUT_MS,
                'Folder probe',
            );
        } catch (err) {
            throw new Error(probeFailureMessage(err, err instanceof TimeoutError));
        }
        const entry: WorkspaceEntry = {
            id: workspaceIdForPath(selected),
            backend: 'tauri-fs',
            name: folderNameFromPath(selected),
            lastOpenedAt: Date.now(),
            path: selected,
        };
        // The new window bootstraps by looking its assigned workspace up in the REGISTRY, so the
        // entry must be persisted before that page loads (deterministic tauri:<path> id — picking
        // an already-known folder just refreshes its entry, and open_workspace_window focuses the
        // window already showing it instead of duplicating).
        await touchWorkspace(entry);
        await refreshWorkspaces();
        const {invoke} = await import('@tauri-apps/api/core');
        await invoke('open_workspace_window', {
            wsId: entry.id,
            title: `${displayName(entry)} — Gravity Notes`,
        });
    }, [refreshWorkspaces]);

    const useBrowserStorage = useCallback(async () => {
        const seq = beginOp();
        setError(null);
        try {
            activate(browserEntry(), new IndexedDbNoteStore(), seq);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not set up in-browser storage.');
        }
    }, [activate, beginOp]);

    const grantPermission = useCallback(async () => {
        const seq = beginOp();
        setError(null);
        try {
            const entry = pendingRef.current;
            if (!entry?.handle) {
                setState('choosing');
                return;
            }
            if (await requestPermission(entry.handle)) {
                if (isStale(seq)) return;
                activate(entry, new FileSystemNoteStore(entry.handle), seq);
            } else {
                setError('Permission to access the folder was denied.');
            }
        } catch (err) {
            // Without this, a thrown requestPermission became a swallowed unhandled rejection,
            // stranding the user on the permission gate. The user dismissing the prompt throws
            // AbortError — not an error to show (mirrors pickFolder).
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : 'Could not grant access.');
        }
    }, [activate, beginOp, isStale]);

    const reset = useCallback(async () => {
        beginOp();
        pendingRef.current = null;
        activeIdRef.current = null;
        setStore(null);
        setBackend(null);
        setStorageLabel(null);
        setActiveWorkspaceId(null);
        setError(null);
        setState('choosing');
        // "Choose different storage" must actually stick: forget the launch pointer so the next
        // relaunch lands on the choice screen instead of re-restoring (and re-gating) the folder
        // the user just stepped away from. The registry (recents) itself is kept.
        await clearLastActive().catch(() => {});
        // The choice screen lists recents — make sure they're fresh.
        await refreshWorkspaces();
    }, [beginOp, refreshWorkspaces]);

    const openWorkspace = useCallback(
        async (id: string): Promise<boolean> => {
            if (id === activeIdRef.current) return true;
            const seq = beginOp();
            setError(null);
            if (isTauri) {
                // Another window already showing this workspace gets focused instead of a
                // second view of the same files.
                try {
                    const {invoke} = await import('@tauri-apps/api/core');
                    if (await invoke<boolean>('focus_workspace_window', {wsId: id})) {
                        // Focusing another window is still "using" that workspace — bump its
                        // recency so the recents/switcher ordering reflects it (this window,
                        // which stays put, is the only place that can record the visit).
                        if (isStale(seq)) return true;
                        const focused = entriesRef.current.find((e) => e.id === id);
                        if (focused) {
                            await touchWorkspace(focused).catch(() => {});
                            await refreshWorkspaces();
                        }
                        return true;
                    }
                } catch {
                    // The shell couldn't answer — in-place switching still works without it.
                }
                if (isStale(seq)) return false;
            }
            let entry = entriesRef.current.find((candidate) => candidate.id === id);
            if (!entry) {
                await refreshWorkspaces();
                if (isStale(seq)) return false;
                entry = entriesRef.current.find((candidate) => candidate.id === id);
            }
            // The in-browser workspace is offered in the switcher even before it exists in the
            // registry — first open creates it.
            if (!entry && id === 'indexeddb') entry = browserEntry();
            if (!entry) return false;
            const opened = await openEntry(entry, {seq});
            // The shell's note assignment is a one-shot for the workspace this window was
            // created for: once the user explicitly switches the window somewhere else, drop it —
            // otherwise a later switch BACK would re-apply the stale assignment and force the
            // originally-assigned note open over the workspace's own last-active restore.
            if (opened) setWindowNote(null);
            return opened;
        },
        [beginOp, isStale, openEntry, refreshWorkspaces],
    );

    const openInNewWindow = useCallback(
        async (id: string) => {
            if (!isTauri) return;
            let entry = entriesRef.current.find((candidate) => candidate.id === id);
            if (!entry) {
                // This window's snapshot may be stale (another window may have just written the
                // entry) — re-read before deciding.
                await refreshWorkspaces();
                entry = entriesRef.current.find((candidate) => candidate.id === id);
            }
            if (!entry) {
                // Fail loudly instead of a silent no-op: this is also the ⌘0 (Main Window) path,
                // and a forced open_workspace_window would only spawn a window whose bootstrap
                // can't resolve the workspace from the registry (it would land on the gate).
                throw new Error(
                    'This workspace is no longer in the recents list — reopen its folder to restore it.',
                );
            }
            const {invoke} = await import('@tauri-apps/api/core');
            await invoke('open_workspace_window', {
                wsId: id,
                title: `${displayName(entry)} — Gravity Notes`,
            });
        },
        [refreshWorkspaces],
    );

    const openNoteInNewWindow = useCallback(async (noteId: string, title: string) => {
        if (!isTauri) return;
        // The note belongs to THIS window's workspace — the shell assigns both to the new window.
        const wsId = activeIdRef.current;
        if (!wsId) return;
        const {invoke} = await import('@tauri-apps/api/core');
        await invoke('open_note_window', {wsId, noteId, title});
    }, []);

    const removeWorkspace = useCallback(
        async (id: string) => {
            await removeWorkspaceEntry(id);
            await refreshWorkspaces();
        },
        [refreshWorkspaces],
    );

    return {
        state,
        store,
        backend,
        storageLabel,
        activeWorkspaceId,
        windowNote,
        workspaces,
        error,
        isTauri,
        supportsFileSystem,
        supportsFolders,
        pickFolder,
        pickFolderForNewWindow,
        useBrowserStorage,
        grantPermission,
        reset,
        openWorkspace,
        openInNewWindow,
        openNoteInNewWindow,
        removeWorkspace,
        refreshWorkspaces,
    };
}
