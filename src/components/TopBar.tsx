import {useLayoutEffect, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent, RefObject} from 'react';

import {useHasHover} from '../hooks/useIsNarrow';
import type {SaveState} from '../hooks/useNotes';
import type {WorkspaceInfo} from '../hooks/useNotesStorage';
import type {EditorFontPref, NoteAppearance, TextWidthPref} from '../hooks/useSettings';
import {isDesktopTauri} from '../isTauri';
import {isOpenInNewWindowChord} from '../shortcuts';
import type {NoteMeta} from '../storage/types';
import {Button} from '../ui/Button';
import {Input} from '../ui/Input';
import {Menu, MenuItem, MenuPanel, MenuSeparator, MenuSub} from '../ui/Menu';
import {ToggleGroup} from '../ui/ToggleGroup';
import {Kbd} from '../ui/bits';
import {
    ArrowRight,
    Check,
    ChevronLeft,
    CircleArrowUp,
    Code,
    Contrast,
    Copy,
    Database,
    Ellipsis,
    Export,
    Eye,
    Folder,
    FolderOpen,
    Gear,
    House,
    Import,
    Keyboard,
    Link,
    NewWindow,
    PaneLeft,
    PaneRight,
    Paperclip,
    Pencil,
    Pin,
    PinSlash,
    Refresh,
    Search,
    Trash,
} from '../ui/icons';

import {THEME_OPTIONS, type ThemePref} from './theme';

import './TopBar.css';

/** How many workspaces the orb menu lists inline; the ⌃R switcher lists them all. */
const MAX_RECENT_MENU = 6;

/** The per-note appearance strips (§07). "Default" means inherit the app setting. */
const NOTE_FONT_OPTIONS: {value: EditorFontPref; content: string}[] = [
    {value: 'default', content: 'Default'},
    {value: 'sans', content: 'Sans'},
    {value: 'serif', content: 'Serif'},
    {value: 'mono', content: 'Mono'},
];

/**
 * Width, per §07's strip — four segments, and `normal` is deliberately not one of them: at note
 * level the choice is "inherit, or one of the three departures from it", and a fifth segment in a
 * 276px menu would be unreadable. An explicit `normal` is still reachable from Settings, which is
 * where the app-wide default is set in the first place.
 */
const NOTE_WIDTH_OPTIONS: {value: TextWidthPref; content: string; label?: string}[] = [
    {value: 'default', content: 'Default'},
    {value: 'narrow', content: 'Narrow'},
    {value: 'wide', content: 'Wide'},
    {value: 'unlimited', content: 'Unlim.', label: 'No limit'},
];

/** Sync state, as §04's dot + word. Amber saved · dim amber writing · red failed. */
const SYNC_TEXT: Record<SaveState, string> = {
    idle: 'Saved',
    saved: 'Saved',
    saving: 'Writing',
    error: 'Failed',
    conflict: 'Conflict',
};

export interface TopBarProps {
    /** Known workspaces, most recently opened first — the top of the orb menu. */
    workspaces: WorkspaceInfo[];
    activeWorkspaceId: string | null;
    /** Desktop shell: ⌘-click on a workspace opens it in a new window. */
    isDesktop: boolean;
    /** Whether folder-on-disk workspaces are available (shows "Open Folder…"). */
    supportsFolders: boolean;
    /** Switch this window to another workspace. */
    onOpenWorkspace: (id: string) => void;
    /** Desktop only: open a workspace in its own window (⌘-click). */
    onOpenWorkspaceInNewWindow: (id: string) => void;
    /** Open the folder picker (adds/opens a workspace in this window). */
    onOpenFolder: () => void;
    /** Desktop only: pick a folder and open it as its own window (⌘-click on "Open Folder…"). */
    onOpenFolderInNewWindow?: () => void;
    /** Open the ⌃R workspace switcher dialog. */
    onOpenSwitcher: () => void;
    /** The orb menu just opened — a chance to refresh the recents it shows. */
    onMenuOpen?: () => void;
    /** Narrow (≤700px) chrome is active — full-width search and safe-area/traffic-light insets. */
    mobile?: boolean;
    /**
     * Active mobile push-navigation pane. Undefined keeps the narrow chrome without list↔editor
     * semantics (notably a narrow single-note desktop window, whose editor is always visible).
     */
    mobilePane?: 'list' | 'editor';
    /** Mobile: return from the editor pane to the notes list (the Back button). */
    onMobileBack?: () => void;
    /** Export all notes as a .md zip. */
    onExport: () => void;
    /** Import .md files / a zip into the current store. */
    onImport: () => void;
    /** Open the media-attachments manager. */
    onManageAttachments: () => void;
    /**
     * Re-read the notes list from the store. The manual lever for picking up external edits on
     * backends without live watching (web FSA), and an escape hatch on the desktop.
     */
    onReload: () => void;
    /** Open the Trash (soft-deleted notes). */
    onOpenTrash: () => void;
    /** Number of notes currently in the Trash, for the menu-item badge. */
    trashCount: number;
    onOpenHelp: () => void;
    /** Open the app settings dialog (⌘,). */
    onOpenSettings: () => void;
    /** Open the About box. */
    onOpenAbout: () => void;
    /** Open the software-update dialog + kick off a check. Native shell only; omit to hide the item. */
    onCheckForUpdates?: () => void;
    /** Whether an update is already known to be available — turns the item into a call to action. */
    updateAvailable?: boolean;
    themePref: ThemePref;
    onChangeThemePref: (pref: ThemePref) => void;
    /** Folder rail shown / hidden (⌘⇧\), and the note list collapsed / docked (⌘\). */
    railOpen: boolean;
    onToggleRail: () => void;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    /** Autosave status — the sync dot at the bar's right edge. */
    saveState: SaveState;
    /** Search box (nvALT find-or-create) and its keyboard coordination with the list. */
    query: string;
    onQueryChange: (query: string) => void;
    searchInputRef: RefObject<HTMLInputElement>;
    /** The filtered, ordered notes — used to target Enter/Arrow from the search box. */
    notes: NoteMeta[];
    /**
     * True while the full-text corpus is still loading for the active query. Enter must not treat an
     * empty `notes` as "no match → create" yet — a body match may still be about to appear.
     */
    searchLoading: boolean;
    /**
     * True while the live box text is ahead of the (debounced) results on a large vault — `notes` still
     * reflects an older query. Enter/autocomplete must not act on that stale list: a quick Enter after
     * typing a new title would otherwise open the vault's top note instead of creating the note.
     */
    searchPending: boolean;
    selectedId: string | null;
    onCommit: (id: string) => void;
    onCreate: (title?: string) => void;
    /** Final Esc in the (empty) search box: close the open note and clear the cursor. */
    onClose: () => void;
    /** Enter the list at a row: preview it and move DOM focus onto it (↓/↑ from search). */
    onEnterList: (id: string) => void;
    /** Enter on an empty box: move focus onto the previously selected note's row. */
    onFocusList: () => void;

    // ── The open note's own menu (the ⋯ at the far right) ────────────────────────────────────────
    /** The open note, or null — the ⋯ menu acts on it. */
    note: NoteMeta | null;
    /** Open state of the note menu (Workspace-owned, so ⌘⇧I can toggle it too). */
    noteMenuOpen: boolean;
    onNoteMenuOpenChange: (open: boolean) => void;
    noteAppearance: NoteAppearance;
    onSetNoteAppearance: <K extends keyof NoteAppearance>(key: K, value: NoteAppearance[K]) => void;
    /** Read-only preview (⌘⇧P) and blocks↔source (⌘⇧;), both toggles on the open note. */
    previewMode: boolean;
    onTogglePreview: () => void;
    onToggleSource: () => void;
    notePinned: boolean;
    onTogglePin: () => void;
    onRenameNote: () => void;
    onMoveNote: () => void;
    onDuplicateNote: () => void;
    /** Reveal in Finder — present only on the native desktop backend (else the row is hidden). */
    onRevealNote?: () => void;
    onExportNote: () => void;
    /** Copy the note's `[[Title]]` wiki link to the clipboard. */
    onCopyNoteLink: () => void;
    onDeleteNote: () => void;
}

/**
 * The 44px title bar (§04). Frameless: the whole strip is the window's drag region except for the
 * controls in it.
 *
 * Its one structural rule is §07's — "what is this app doing" and "what is this note doing" are
 * never in the same list. The **Orb** on the left holds everything app-wide (workspaces, import and
 * export, trash, theme, settings); the **⋯** on the right is the open note's own menu, and nothing
 * else. The search field sits optically centred on the WINDOW, not on the editor, and the sync dot
 * carries the save state that used to fire a toast on every keystroke.
 */
export function TopBar({
    workspaces,
    activeWorkspaceId,
    isDesktop,
    supportsFolders,
    onOpenWorkspace,
    onOpenWorkspaceInNewWindow,
    onOpenFolder,
    onOpenFolderInNewWindow,
    onOpenSwitcher,
    onMenuOpen,
    onExport,
    onImport,
    onManageAttachments,
    onReload,
    onOpenTrash,
    trashCount,
    mobile,
    mobilePane,
    onMobileBack,
    onOpenHelp,
    onOpenSettings,
    onOpenAbout,
    onCheckForUpdates,
    updateAvailable,
    themePref,
    onChangeThemePref,
    railOpen,
    onToggleRail,
    collapsed,
    onToggleCollapsed,
    saveState,
    query,
    onQueryChange,
    searchInputRef,
    notes,
    searchLoading,
    searchPending,
    selectedId,
    onCommit,
    onCreate,
    onClose,
    onEnterList,
    onFocusList,
    note,
    noteMenuOpen,
    onNoteMenuOpenChange,
    noteAppearance,
    onSetNoteAppearance,
    previewMode,
    onTogglePreview,
    onToggleSource,
    notePinned,
    onTogglePin,
    onRenameNote,
    onMoveNote,
    onDuplicateNote,
    onRevealNote,
    onExportNote,
    onCopyNoteLink,
    onDeleteNote,
}: TopBarProps) {
    const inList = (id: string | null): id is string =>
        Boolean(id) && notes.some((n) => n.id === id);

    // nvALT inline autocomplete: as the user types *forward*, the top match's title is appended to
    // the box with the un-typed suffix selected; Tab (or →) accepts it, Backspace removes it. The
    // typed prefix is kept verbatim and only the suffix is adopted from the match, so the match is
    // case-insensitive but the box never rewrites what the user typed (typing "n" against "Node"
    // stays "n", not "N"). `query` stays the real typed text driving the search — `completion` is
    // only what the box displays.
    const [completing, setCompleting] = useState(false);
    const topTitle = notes[0]?.title ?? '';
    const completion =
        completing &&
        // While results lag the typed text (debounce window), `notes[0]` reflects an older query —
        // don't autocomplete against the wrong note.
        !searchPending &&
        query.length > 0 &&
        topTitle.length > query.length &&
        topTitle.toLowerCase().startsWith(query.toLowerCase())
            ? query + topTitle.slice(query.length)
            : '';
    const displayValue = completion || query;

    // After a forward keystroke, select the suffix so the next character replaces it. The box value
    // already shows the full title; this just highlights the part the user hasn't typed yet.
    useLayoutEffect(() => {
        if (!completion) return;
        searchInputRef.current?.setSelectionRange(query.length, completion.length);
    }, [completion, query, searchInputRef]);

    const onSearchUpdate = (next: string) => {
        // A longer value means a forward keystroke → offer a completion. Anything else (delete, clear,
        // or replacing the selected suffix) suppresses completion for this round so deletion works.
        setCompleting(next.length > query.length);
        onQueryChange(next);
    };

    const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Tab' && completion) {
            // Accept the suggestion: commit the full title and collapse the highlighted suffix to a
            // caret at the end (so further typing appends instead of replacing the selection).
            event.preventDefault();
            setCompleting(false);
            onQueryChange(completion);
            searchInputRef.current?.setSelectionRange(completion.length, completion.length);
            return;
        }
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
            if (!query.trim()) {
                // Empty box: step onto the previously selected note's row (don't jump to the
                // editor). Nothing to do when no note is selected.
                if (inList(selectedId)) {
                    event.preventDefault();
                    onFocusList();
                }
            } else if (searchPending) {
                // The (debounced) results haven't caught up to the typed query yet, so `notes` is a
                // stale list. Swallow rather than open the wrong note / fabricate one; the debounce
                // settles in ≤120ms and the next Enter does the right thing.
                event.preventDefault();
            } else if (notes.length > 0) {
                // A query that matches: open the top match (nvALT).
                event.preventDefault();
                onCommit(notes[0].id);
            } else if (searchLoading) {
                // The body corpus is still loading, so an empty list doesn't yet mean "no match" —
                // a full-text hit may be about to appear. Swallow Enter rather than fabricate a note;
                // the user can press it again once matches resolve.
                event.preventDefault();
            } else {
                // A query that matches nothing: create a note titled with it, then clear the
                // search so the new note is visible and the box is ready for the next find.
                event.preventDefault();
                onCreate(query.trim());
                onQueryChange('');
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            setCompleting(false);
            if (query) onQueryChange('');
            else onClose();
        } else if (event.key === 'ArrowDown' && notes.length > 0) {
            event.preventDefault();
            onEnterList(inList(selectedId) ? selectedId : notes[0].id);
        } else if (event.key === 'ArrowUp' && notes.length > 0) {
            event.preventDefault();
            onEnterList(inList(selectedId) ? selectedId : notes[notes.length - 1].id);
        }
    };

    // Drives the keyboard-only menu entries below (see the "Keyboard shortcuts" item).
    const hasHover = useHasHover();
    const themeLabel =
        THEME_OPTIONS.find((option) => option.value === themePref)?.label ?? 'System';
    // On mobile the ⋯ belongs to the editor pane; while browsing the list it is laid out but inert.
    const noteMenuActive = note !== null && mobilePane !== 'list';

    const orbMenu = (
        <>
            {/* Workspaces first: §07 — "switching vaults is the only thing in here you do more than
                once a week". Plain click switches this window; ⌘-click opens a new one. */}
            {workspaces.slice(0, MAX_RECENT_MENU).map((ws) => (
                <MenuItem
                    key={ws.id}
                    icon={
                        ws.id === activeWorkspaceId ? (
                            <span className="topbar__ws-dot topbar__ws-dot_active" />
                        ) : ws.backend === 'indexeddb' ? (
                            <Database size={16} />
                        ) : (
                            <span className="topbar__ws-dot" />
                        )
                    }
                    onClick={(event) => {
                        if (ws.id === activeWorkspaceId) return;
                        if (isDesktop && isOpenInNewWindowChord(event)) {
                            onOpenWorkspaceInNewWindow(ws.id);
                        } else {
                            onOpenWorkspace(ws.id);
                        }
                    }}
                >
                    {ws.name}
                </MenuItem>
            ))}
            {supportsFolders ? (
                <MenuItem
                    icon={<FolderOpen size={16} />}
                    onClick={(event) => {
                        // ⌘-click / ⌘↵ (desktop; Ctrl elsewhere) opens the picked folder in its OWN
                        // window — the same shared chord as the workspaces above.
                        if (isDesktop && isOpenInNewWindowChord(event) && onOpenFolderInNewWindow) {
                            onOpenFolderInNewWindow();
                        } else {
                            onOpenFolder();
                        }
                    }}
                >
                    Open Folder…
                </MenuItem>
            ) : null}
            <MenuItem icon={<NewWindow size={16} />} hint="⌃R" onClick={onOpenSwitcher}>
                Workspaces…
            </MenuItem>

            <MenuSeparator />
            <MenuItem icon={<Export size={16} />} onClick={onExport}>
                Export all notes…
            </MenuItem>
            <MenuItem icon={<Import size={16} />} onClick={onImport}>
                Import .md files…
            </MenuItem>
            <MenuItem icon={<Paperclip size={16} />} onClick={onManageAttachments}>
                Manage attachments…
            </MenuItem>
            <MenuItem
                icon={<Trash size={16} />}
                hint={trashCount > 0 ? String(trashCount) : undefined}
                onClick={onOpenTrash}
            >
                Trash
            </MenuItem>
            <MenuItem icon={<Refresh size={16} />} onClick={onReload}>
                Reload notes
            </MenuItem>

            <MenuSeparator />
            {/* Sidebar collapse is a MULTI-PANE affordance: the mobile layout is a single pane that
                pushes list↔editor, so there's no sidebar to collapse there (and no ⌘\ to press). */}
            {mobile ? null : (
                <MenuItem icon={<PaneRight size={16} />} hint={'⌘\\'} onClick={onToggleCollapsed}>
                    Toggle sidebar
                </MenuItem>
            )}
            <MenuSub icon={<Contrast size={16} />} label="Theme" hint={themeLabel}>
                {THEME_OPTIONS.map((option) => (
                    <MenuItem
                        key={option.value}
                        icon={themePref === option.value ? <Check size={16} /> : undefined}
                        onClick={() => onChangeThemePref(option.value)}
                    >
                        {option.label}
                    </MenuItem>
                ))}
            </MenuSub>
            <MenuItem icon={<Gear size={16} />} hint="⌘," onClick={onOpenSettings}>
                Settings…
            </MenuItem>
            {/* A sheet of keyboard chords is dead weight with no keyboard to press them on. Gated on
                the POINTER, not the width: a narrow desktop window still has a keyboard and would
                lose its only entry point to this dialog, whereas a full-screen phone has neither. */}
            {hasHover ? (
                <MenuItem icon={<Keyboard size={16} />} hint="⌘/" onClick={onOpenHelp}>
                    Keyboard shortcuts
                </MenuItem>
            ) : null}

            <MenuSeparator />
            {onCheckForUpdates ? (
                <MenuItem
                    icon={updateAvailable ? <CircleArrowUp size={16} /> : <Refresh size={16} />}
                    onClick={onCheckForUpdates}
                >
                    {updateAvailable ? 'Install update…' : 'Check for Updates…'}
                </MenuItem>
            ) : null}
            <MenuItem icon={<House size={16} />} onClick={onOpenAbout}>
                About Gravity Notes
            </MenuItem>
        </>
    );

    const noteMenu = note ? (
        <>
            {/* Appearance is an inline strip, not a submenu — two toggle groups inside the popup,
                committing live behind it (§07). `MenuPanel` keeps them out of the arrow-key ring. */}
            <MenuPanel label="Font">
                <ToggleGroup
                    aria-label="Note font"
                    options={NOTE_FONT_OPTIONS}
                    value={noteAppearance.editorFont ?? 'default'}
                    onChange={(value) => onSetNoteAppearance('editorFont', value)}
                />
            </MenuPanel>
            <MenuPanel label="Text width">
                <ToggleGroup
                    aria-label="Note text width"
                    options={NOTE_WIDTH_OPTIONS}
                    value={noteAppearance.textWidth ?? 'default'}
                    onChange={(value) => onSetNoteAppearance('textWidth', value)}
                />
            </MenuPanel>
            <MenuSeparator />
            <MenuItem
                icon={previewMode ? <Check size={16} /> : <Eye size={16} />}
                hint="⌘⇧P"
                onClick={onTogglePreview}
            >
                Read-only preview
            </MenuItem>
            <MenuItem icon={<Code size={16} />} hint="⌘⇧;" onClick={onToggleSource}>
                Markup instead of blocks
            </MenuItem>

            <MenuSeparator />
            <MenuItem
                icon={notePinned ? <PinSlash size={16} /> : <Pin size={16} />}
                onClick={onTogglePin}
            >
                {notePinned ? 'Unpin' : 'Pin to top'}
            </MenuItem>
            <MenuItem icon={<Pencil size={16} />} hint="F2" onClick={onRenameNote}>
                Rename
            </MenuItem>
            <MenuItem icon={<ArrowRight size={16} />} hint="⌘⇧M" onClick={onMoveNote}>
                Move to…
            </MenuItem>
            <MenuItem icon={<Copy size={16} />} hint="⌘D" onClick={onDuplicateNote}>
                Duplicate
            </MenuItem>
            {onRevealNote ? (
                <MenuItem icon={<Folder size={16} />} onClick={onRevealNote}>
                    Reveal in Finder
                </MenuItem>
            ) : null}

            <MenuSeparator />
            <MenuItem icon={<Export size={16} />} onClick={onExportNote}>
                Export this note…
            </MenuItem>
            <MenuItem icon={<Link size={16} />} onClick={onCopyNoteLink}>
                Copy link to note
            </MenuItem>

            <MenuSeparator />
            <MenuItem icon={<Trash size={16} />} hint="⌘⇧⌫" danger onClick={onDeleteNote}>
                Delete
            </MenuItem>
        </>
    ) : null;

    return (
        // `data-tauri-drag-region` makes the empty strip a window-drag handle — a macOS-desktop
        // concept (iOS has no draggable windows). Omitted on iOS so the shell's drag-region pointer
        // handling can't sit between a tap and the controls inside this bar (Back, ⋯, the orb).
        <header
            className={`topbar${mobile ? ' topbar_mobile' : ''}`}
            data-tauri-drag-region={isDesktopTauri ? true : undefined}
        >
            {/* ONE bar in both mobile panes (orb · search, plus the controls below) rather than two
                layouts that swap: the menu and search stay reachable from inside a note, and nothing
                shifts or resizes when you open one. On the editor pane a compact icon-only Back leads
                the row.

                On the LIST pane the button is still laid out, just hidden (see `_placeholder`): its
                slot has to stay reserved or the orb and the search box would slide and resize on
                every pane change. Same for the ⋯ below — together they make the bar's geometry
                identical in both panes by construction rather than by arithmetic. */}
            {mobile ? (
                <Button
                    size="l"
                    icon={<ChevronLeft size={19} />}
                    className={`topbar__back${mobilePane === 'editor' ? '' : ' topbar__back_placeholder'}`}
                    onClick={onMobileBack}
                    aria-label="Back to notes"
                    aria-hidden={mobilePane !== 'editor'}
                    tabIndex={mobilePane === 'editor' ? undefined : -1}
                />
            ) : (
                // Two 26px pane toggles, immediately after the traffic lights (§04).
                <div className="topbar__panes">
                    <Button
                        icon={<PaneLeft size={15} />}
                        aria-label="Folders"
                        pressed={railOpen}
                        onClick={onToggleRail}
                    />
                    <Button
                        icon={<PaneRight size={15} />}
                        aria-label="Notes list"
                        pressed={!collapsed}
                        onClick={onToggleCollapsed}
                    />
                </div>
            )}

            {/* The Orb: the app's own amber disc, flat — no gradient, no bevel. It is the one
                saturated thing in the chrome and it is the app MARK, not an accent, which is why it
                doesn't recolour with the save state (the sync dot at the right does that). */}
            <div className="topbar__orb-slot">
                <Menu
                    onOpenChange={(open) => {
                        if (open) onMenuOpen?.();
                    }}
                    align="start"
                    width={242}
                    trigger={
                        <button type="button" className="topbar__orb" aria-label="Menu">
                            <span className="topbar__orb-disc" />
                        </button>
                    }
                >
                    {orbMenu}
                </Menu>
            </div>

            <Input
                className="topbar__search"
                size={mobile ? 'l' : 'm'}
                ref={searchInputRef}
                value={displayValue}
                onChange={(event) => onSearchUpdate(event.target.value)}
                placeholder="Search or create a note…"
                aria-label="Search or create a note"
                icon={<Search size={12} />}
                trailing={mobile ? undefined : <Kbd>⌘L</Kbd>}
                onClear={() => {
                    setCompleting(false);
                    onQueryChange('');
                }}
                onKeyDown={onSearchKeyDown}
            />

            <div className="topbar__right">
                {/* Sync dot + word — §04's replacement for the toast that used to fire on every
                    save. The spec's grey "offline" state has no source in a local-first app with no
                    server, so it is deliberately omitted. */}
                <div
                    className={`topbar__sync topbar__sync_${saveState}`}
                    role="status"
                    aria-live="polite"
                >
                    <span className="topbar__sync-dot" />
                    <span className="topbar__sync-word">{SYNC_TEXT[saveState]}</span>
                </div>

                {/* The open note's own menu. On mobile it keeps its slot even when inert, so the
                    bar's geometry is identical in both panes; elsewhere it is simply absent. */}
                {mobile || noteMenuActive ? (
                    <Menu
                        open={noteMenuOpen && noteMenuActive}
                        onOpenChange={onNoteMenuOpenChange}
                        align="end"
                        width={276}
                        trigger={
                            <Button
                                icon={<Ellipsis size={15} />}
                                className={`topbar__note-actions${
                                    noteMenuActive ? '' : ' topbar__note-actions_placeholder'
                                }`}
                                aria-label="Note actions"
                                aria-hidden={!noteMenuActive}
                                tabIndex={noteMenuActive ? undefined : -1}
                            />
                        }
                    >
                        {noteMenu}
                    </Menu>
                ) : null}
            </div>
        </header>
    );
}
