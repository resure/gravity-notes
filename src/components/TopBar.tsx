import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {
    KeyboardEvent as ReactKeyboardEvent,
    MouseEvent as ReactMouseEvent,
    ReactNode,
    RefObject,
} from 'react';

import {Button, DropdownMenu, Menu, Popup, SegmentedRadioGroup, TextInput} from '@gravity-ui/uikit';

import {useHasHover} from '../hooks/useIsNarrow';
import type {SaveState} from '../hooks/useNotes';
import type {WorkspaceInfo} from '../hooks/useNotesStorage';
import {type NoteAppearance, isNoteAppearanceOverridden} from '../hooks/useSettings';
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
    Paperclip,
    Pencil,
    Pin,
    PinSlash,
    Refresh,
    Search,
    Trash,
} from '../icons/icons';
import {isDesktopTauri} from '../isTauri';
import {isOpenInNewWindowChord, shortcutChords, shortcutHint} from '../shortcuts';
import type {NoteMeta} from '../storage/types';

import {FONT_OPTIONS_WS, WIDTH_OPTIONS_WS} from './appearanceControls';
import {THEME_OPTIONS, type ThemePref} from './theme';

import './TopBar.css';

/** How many workspaces the orb menu lists inline; the ⌃R switcher lists them all. */
const MAX_RECENT_MENU = 6;

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
    /** Show / hide the folders (⌘⇧\), and the whole left panel (⌘\). */
    onToggleRail: () => void;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    /** Autosave status, carried by the orb. */
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

    /** The open note, or null — the ⋯ menu acts on it. */
    note: NoteMeta | null;
    /** Open state of the note menu (Workspace-owned, so ⌘⇧I can toggle it too). */
    noteMenuOpen: boolean;
    onNoteMenuOpenChange: (open: boolean) => void;
    /** Per-note appearance overrides for the open note (the menu's two strips). */
    noteAppearance: NoteAppearance;
    onSetNoteAppearance: <K extends keyof NoteAppearance>(key: K, value: NoteAppearance[K]) => void;
    onResetNoteAppearance: () => void;
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
    /** Copy the note's `[[Title]]` wiki link to the clipboard. */
    onCopyNoteLink: () => void;
    onDeleteNote: () => void;
}

const STATUS_TEXT: Record<SaveState, string> = {
    idle: 'All changes saved',
    saving: 'Saving…',
    saved: 'All changes saved',
    error: "Save failed — changes aren't on disk",
    conflict: 'This note changed on disk',
};

function workspaceIcon(ws: WorkspaceInfo, active: boolean): ReactNode {
    if (active) return <span className="topbar__ws-dot topbar__ws-dot_active" />;
    if (ws.backend === 'indexeddb') return <Database size={16} />;
    return <span className="topbar__ws-dot" />;
}

function MenuHint({children}: {children: ReactNode}) {
    return <span className="topbar__menu-hint">{children}</span>;
}

/**
 * The 40px title bar. The orb on the left holds everything app-wide and carries the save state; the
 * ⋯ on the right is the open note's own menu (appearance + file actions). The search field sits
 * centred on the WINDOW. This component owns the search keyboard model; the list lives in `NoteList`.
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
    onResetNoteAppearance,
    previewMode,
    onTogglePreview,
    onToggleSource,
    notePinned,
    onTogglePin,
    onRenameNote,
    onMoveNote,
    onDuplicateNote,
    onRevealNote,
    onCopyNoteLink,
    onDeleteNote,
}: TopBarProps) {
    // Touch-sized controls only for a finger: the narrow layout also serves a narrow desktop window,
    // where they made the bar 8px taller for no reason.
    const controlSize = mobile && window.matchMedia?.('(pointer: coarse)').matches ? 'l' : 'm';

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

    const needsAttention = saveState === 'error' || saveState === 'conflict';
    // Drives the keyboard-only menu entries below (see the "Keyboard shortcuts" item).
    const hasHover = useHasHover();
    const themeLabel =
        THEME_OPTIONS.find((option) => option.value === themePref)?.label ?? 'System';
    // On mobile the ⋯ belongs to the editor pane; while browsing the list it is laid out but inert.
    const noteMenuActive = note !== null && mobilePane !== 'list';

    // The uikit action gets a React mouse event on click but a NATIVE KeyboardEvent on Enter — both
    // carry the modifier flags the shared chord reads (⌘ on macOS, Ctrl elsewhere).
    type MenuEvent = ReactMouseEvent<HTMLElement> | KeyboardEvent;

    const orbMenu = [
        ...(needsAttention
            ? [
                  [
                      {
                          text: STATUS_TEXT[saveState],
                          iconStart: <span className="topbar__ws-dot topbar__ws-dot_danger" />,
                          theme: 'danger' as const,
                          disabled: true,
                          action: () => {},
                      },
                  ],
              ]
            : []),
        [
            ...workspaces.slice(0, MAX_RECENT_MENU).map((ws) => ({
                text: ws.name,
                iconStart: workspaceIcon(ws, ws.id === activeWorkspaceId),
                className: 'topbar__menu-workspace',
                action: (event: MenuEvent) => {
                    if (ws.id === activeWorkspaceId) return;
                    if (isDesktop && isOpenInNewWindowChord(event)) {
                        onOpenWorkspaceInNewWindow(ws.id);
                    } else {
                        onOpenWorkspace(ws.id);
                    }
                },
            })),
            ...(supportsFolders
                ? [
                      {
                          text: 'Open Folder…',
                          iconStart: <FolderOpen size={16} />,
                          action: (event: MenuEvent) => {
                              if (
                                  isDesktop &&
                                  isOpenInNewWindowChord(event) &&
                                  onOpenFolderInNewWindow
                              ) {
                                  onOpenFolderInNewWindow();
                              } else {
                                  onOpenFolder();
                              }
                          },
                      },
                  ]
                : []),
            {
                text: 'Workspaces…',
                iconStart: <NewWindow size={16} />,
                iconEnd: <MenuHint>{shortcutHint('ctrl+r')}</MenuHint>,
                action: onOpenSwitcher,
            },
        ],
        [
            {text: 'Export all notes…', iconStart: <Export size={16} />, action: onExport},
            {text: 'Import .md files…', iconStart: <Import size={16} />, action: onImport},
            {
                text: 'Manage attachments…',
                iconStart: <Paperclip size={16} />,
                action: onManageAttachments,
            },
            {
                text: 'Trash',
                iconStart: <Trash size={16} />,
                iconEnd: trashCount > 0 ? <MenuHint>{trashCount}</MenuHint> : undefined,
                action: onOpenTrash,
            },
            {text: 'Reload notes', iconStart: <Refresh size={16} />, action: onReload},
        ],
        [
            // The mobile layout is a single pane that pushes list↔editor: no panel to hide there.
            ...(mobile
                ? []
                : [
                      {
                          text: 'Show / hide left panel',
                          iconStart: <PaneLeft size={16} />,
                          iconEnd: <MenuHint>{shortcutHint('mod+\\')}</MenuHint>,
                          action: onToggleCollapsed,
                      },
                  ]),
            // On a phone the folders are the list pane's drawer: from the editor there is no list.
            ...(mobile && mobilePane === 'editor'
                ? []
                : [
                      {
                          text: 'Show / hide folders',
                          iconStart: <Folder size={16} />,
                          iconEnd: <MenuHint>{shortcutHint('mod+shift+\\')}</MenuHint>,
                          action: onToggleRail,
                      },
                  ]),
            {
                text: (
                    <span className="topbar__menu-row">
                        Theme
                        <MenuHint>{themeLabel}</MenuHint>
                    </span>
                ),
                iconStart: <Contrast size={16} />,
                items: THEME_OPTIONS.map((option) => ({
                    text: option.label,
                    iconStart:
                        themePref === option.value ? (
                            <Check size={16} />
                        ) : (
                            <span className="topbar__menu-blank" />
                        ),
                    action: () => onChangeThemePref(option.value),
                })),
            },
            {
                text: 'Settings…',
                iconStart: <Gear size={16} />,
                iconEnd: <MenuHint>{shortcutHint('mod+,')}</MenuHint>,
                action: onOpenSettings,
            },
            // Gated on the POINTER, not the width: a narrow desktop window still has a keyboard.
            ...(hasHover
                ? [
                      {
                          text: 'Keyboard shortcuts',
                          iconStart: <Keyboard size={16} />,
                          iconEnd: <MenuHint>{shortcutHint('mod+/')}</MenuHint>,
                          action: onOpenHelp,
                      },
                  ]
                : []),
        ],
        [
            ...(onCheckForUpdates
                ? [
                      {
                          text: updateAvailable ? 'Install update…' : 'Check for Updates…',
                          iconStart: updateAvailable ? (
                              <CircleArrowUp size={16} />
                          ) : (
                              <Refresh size={16} />
                          ),
                          action: onCheckForUpdates,
                      },
                  ]
                : []),
            {text: 'About Gravity Notes', iconStart: <House size={16} />, action: onOpenAbout},
        ],
    ];

    return (
        // `data-tauri-drag-region` makes the empty strip a window-drag handle — a macOS-desktop
        // concept (iOS has no draggable windows). Omitted on iOS so the shell's drag-region pointer
        // handling can't sit between a tap and the controls inside this bar (Back, ⋯, the orb).
        <header
            className={`topbar${mobile ? ' topbar_mobile' : ''}`}
            data-tauri-drag-region={isDesktopTauri ? true : undefined}
        >
            {/* ONE bar in both mobile panes. On the LIST pane the Back button (and the ⋯ below) is
                laid out but hidden (`_placeholder`), so the orb and search keep the same geometry in
                both panes. */}
            {mobile ? (
                <Button
                    view="flat"
                    size={controlSize}
                    className={`topbar__back${mobilePane === 'editor' ? '' : ' topbar__back_placeholder'}`}
                    onClick={onMobileBack}
                    aria-label="Back to notes"
                    aria-hidden={mobilePane !== 'editor'}
                    tabIndex={mobilePane === 'editor' ? undefined : -1}
                >
                    <Button.Icon>
                        <ChevronLeft size={19} />
                    </Button.Icon>
                </Button>
            ) : (
                <div className="topbar__panes">
                    <Button
                        view="flat"
                        size="m"
                        className="topbar__pane-toggle"
                        selected={!collapsed}
                        aria-label="Left panel"
                        title={collapsed ? 'Show left panel (⌘\\)' : 'Hide left panel (⌘\\)'}
                        onClick={onToggleCollapsed}
                    >
                        <Button.Icon>
                            <PaneLeft size={15} />
                        </Button.Icon>
                    </Button>
                </div>
            )}

            <DropdownMenu
                switcherWrapperClassName="topbar__orb-slot"
                onOpenToggle={(open) => {
                    if (open) onMenuOpen?.();
                }}
                menuProps={{className: 'topbar__orb-menu'}}
                renderSwitcher={(props) => (
                    <button
                        {...props}
                        type="button"
                        className={`topbar__orb topbar__orb_${saveState}`}
                        aria-label="Menu"
                        aria-haspopup="true"
                        title={STATUS_TEXT[saveState]}
                    >
                        <span className="topbar__orb-disc" />
                    </button>
                )}
                items={orbMenu}
            />

            <TextInput
                className="topbar__search"
                size={controlSize}
                controlRef={searchInputRef}
                value={displayValue}
                onUpdate={onSearchUpdate}
                placeholder="Search or create a note…"
                // Placeholders aren't a reliable accessible name; name the field explicitly.
                controlProps={{'aria-label': 'Search or create a note'}}
                hasClear
                startContent={
                    <span className="topbar__search-icon">
                        <Search size={12} />
                    </span>
                }
                endContent={
                    mobile ? undefined : (
                        <kbd className="topbar__kbd">
                            {shortcutChords('mod+l')[0].map((key) => (
                                <span key={key}>{key}</span>
                            ))}
                        </kbd>
                    )
                }
                onKeyDown={onSearchKeyDown}
            />

            <div className="topbar__right">
                {/* `aria-live="off"` on purpose: it flips on every debounced autosave, and the two
                    states that need announcing have their own (the conflict banner, the error toast). */}
                <div
                    className={`topbar__sync topbar__sync_${saveState}`}
                    role="status"
                    aria-live="off"
                >
                    {STATUS_TEXT[saveState]}
                </div>

                {mobile || noteMenuActive ? (
                    <NoteMenu
                        active={noteMenuActive}
                        open={noteMenuOpen && noteMenuActive}
                        onOpenChange={onNoteMenuOpenChange}
                        noteAppearance={noteAppearance}
                        onSetNoteAppearance={onSetNoteAppearance}
                        onResetNoteAppearance={onResetNoteAppearance}
                        previewMode={previewMode}
                        onTogglePreview={onTogglePreview}
                        onToggleSource={onToggleSource}
                        notePinned={notePinned}
                        onTogglePin={onTogglePin}
                        onRenameNote={onRenameNote}
                        onMoveNote={onMoveNote}
                        onDuplicateNote={onDuplicateNote}
                        onRevealNote={onRevealNote}
                        onCopyNoteLink={onCopyNoteLink}
                        onDeleteNote={onDeleteNote}
                    />
                ) : null}
            </div>
        </header>
    );
}

type NoteMenuProps = Pick<
    TopBarProps,
    | 'noteAppearance'
    | 'onSetNoteAppearance'
    | 'onResetNoteAppearance'
    | 'previewMode'
    | 'onTogglePreview'
    | 'onToggleSource'
    | 'notePinned'
    | 'onTogglePin'
    | 'onRenameNote'
    | 'onMoveNote'
    | 'onDuplicateNote'
    | 'onRevealNote'
    | 'onCopyNoteLink'
    | 'onDeleteNote'
> & {
    /** False keeps the ⋯ as an inert placeholder (mobile list pane). */
    active: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

/**
 * The open note's ⋯ menu: the per-note appearance strips (live, `Default` inherits the workspace or
 * app value) above the note's own actions. A Popup rather than a DropdownMenu because a
 * DropdownMenu can't hold anything but rows.
 */
function NoteMenu({
    active,
    open,
    onOpenChange,
    noteAppearance,
    onSetNoteAppearance,
    onResetNoteAppearance,
    previewMode,
    onTogglePreview,
    onToggleSource,
    notePinned,
    onTogglePin,
    onRenameNote,
    onMoveNote,
    onDuplicateNote,
    onRevealNote,
    onCopyNoteLink,
    onDeleteNote,
}: NoteMenuProps) {
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    // Set by the items that move focus somewhere of their own (the title field, a dialog): handing
    // it back to the ⋯ after the close transition would take it straight back out.
    const [handOff, setHandOff] = useState(false);

    useEffect(() => {
        if (!open) return undefined;
        setHandOff(false);
        const frame = requestAnimationFrame(() => {
            contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [open]);

    const run = (action: () => void, handsOffFocus = false) => {
        setHandOff(handsOffFocus);
        onOpenChange(false);
        action();
    };

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const items = Array.from(
            contentRef.current?.querySelectorAll<HTMLElement>(
                '[role="menuitem"]:not([aria-disabled="true"])',
            ) ?? [],
        );
        const index = items.indexOf(document.activeElement as HTMLElement);
        // The strips are radio groups: their own arrows change the value.
        if (index === -1) return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + step + items.length) % items.length]?.focus();
    };

    const hint = (keys: string) => <MenuHint>{shortcutHint(keys)}</MenuHint>;

    return (
        <>
            <Button
                ref={setAnchor}
                view="flat"
                size="m"
                selected={open}
                className={`topbar__note-actions${active ? '' : ' topbar__note-actions_placeholder'}`}
                aria-label="Note actions"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-hidden={!active}
                tabIndex={active ? undefined : -1}
                onClick={() => onOpenChange(!open)}
            >
                <Button.Icon>
                    <Ellipsis size={15} />
                </Button.Icon>
            </Button>
            {active ? (
                <Popup
                    open={open}
                    anchorElement={anchor}
                    placement="bottom-end"
                    returnFocus={!handOff}
                    onOpenChange={(isOpen) => {
                        if (!isOpen) onOpenChange(false);
                    }}
                >
                    {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- arrow-key roving between the menu's own items */}
                    <div ref={contentRef} className="note-menu" onKeyDown={onKeyDown}>
                        <div className="note-menu__panel">
                            <div className="note-menu__panel-head">
                                <span className="note-menu__panel-label">Font</span>
                                {isNoteAppearanceOverridden(noteAppearance) ? (
                                    <button
                                        type="button"
                                        className="note-menu__reset"
                                        onClick={onResetNoteAppearance}
                                    >
                                        Reset
                                    </button>
                                ) : null}
                            </div>
                            <SegmentedRadioGroup
                                size="s"
                                width="max"
                                aria-label="Note font"
                                options={FONT_OPTIONS_WS}
                                value={noteAppearance.editorFont}
                                onUpdate={(value) => onSetNoteAppearance('editorFont', value)}
                            />
                        </div>
                        <div className="note-menu__panel">
                            <div className="note-menu__panel-head">
                                <span className="note-menu__panel-label">Text width</span>
                            </div>
                            <SegmentedRadioGroup
                                size="s"
                                width="max"
                                aria-label="Note text width"
                                options={WIDTH_OPTIONS_WS}
                                value={noteAppearance.textWidth}
                                onUpdate={(value) => onSetNoteAppearance('textWidth', value)}
                            />
                        </div>
                        <div className="note-menu__separator" />
                        <Menu size="m" className="note-menu__items" aria-label="Note actions">
                            <Menu.Group>
                                <Menu.Item
                                    iconStart={
                                        previewMode ? <Check size={16} /> : <Eye size={16} />
                                    }
                                    iconEnd={hint('mod+shift+p')}
                                    onClick={() => run(onTogglePreview)}
                                >
                                    Read-only preview
                                </Menu.Item>
                                <Menu.Item
                                    iconStart={<Code size={16} />}
                                    iconEnd={hint('mod+shift+;')}
                                    onClick={() => run(onToggleSource)}
                                >
                                    Markup instead of blocks
                                </Menu.Item>
                            </Menu.Group>
                            <Menu.Group>
                                <Menu.Item
                                    iconStart={
                                        notePinned ? <PinSlash size={16} /> : <Pin size={16} />
                                    }
                                    onClick={() => run(onTogglePin)}
                                >
                                    {notePinned ? 'Unpin' : 'Pin to top'}
                                </Menu.Item>
                                <Menu.Item
                                    iconStart={<Pencil size={16} />}
                                    iconEnd={hint('f2')}
                                    onClick={() => run(onRenameNote, true)}
                                >
                                    Rename
                                </Menu.Item>
                                <Menu.Item
                                    iconStart={<ArrowRight size={16} />}
                                    iconEnd={hint('mod+shift+m')}
                                    onClick={() => run(onMoveNote, true)}
                                >
                                    Move to…
                                </Menu.Item>
                                <Menu.Item
                                    iconStart={<Copy size={16} />}
                                    iconEnd={hint('mod+d')}
                                    onClick={() => run(onDuplicateNote)}
                                >
                                    Duplicate
                                </Menu.Item>
                                {onRevealNote ? (
                                    <Menu.Item
                                        iconStart={<Folder size={16} />}
                                        onClick={() => run(onRevealNote)}
                                    >
                                        Reveal in Finder
                                    </Menu.Item>
                                ) : null}
                            </Menu.Group>
                            <Menu.Group>
                                <Menu.Item
                                    iconStart={<Link size={16} />}
                                    onClick={() => run(onCopyNoteLink)}
                                >
                                    Copy link to note
                                </Menu.Item>
                            </Menu.Group>
                            <Menu.Group>
                                <Menu.Item
                                    theme="danger"
                                    iconStart={<Trash size={16} />}
                                    iconEnd={hint('mod+shift+backspace')}
                                    onClick={() => run(onDeleteNote, true)}
                                >
                                    Delete
                                </Menu.Item>
                            </Menu.Group>
                        </Menu>
                    </div>
                </Popup>
            ) : null}
        </>
    );
}
