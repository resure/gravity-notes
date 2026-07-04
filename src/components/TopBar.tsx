import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {
    KeyboardEvent as ReactKeyboardEvent,
    MouseEvent as ReactMouseEvent,
    RefObject,
} from 'react';

import {
    ArrowDownToLine,
    ArrowUpFromLine,
    ArrowsRotateRight,
    CircleArrowUp,
    CircleQuestion,
    ClockArrowRotateLeft,
    Database,
    Ellipsis,
    Folder,
    FolderOpen,
    Gear,
    LayoutSideContent,
    Picture,
    TrashBin,
} from '@gravity-ui/icons';
import {Button, DropdownMenu, Icon, TextInput} from '@gravity-ui/uikit';

import type {SaveState} from '../hooks/useNotes';
import type {WorkspaceInfo} from '../hooks/useNotesStorage';
import type {NoteAppearance} from '../hooks/useSettings';
import type {NoteMeta} from '../storage/types';

import {NoteAppearancePopover} from './NoteAppearancePopover';
import {THEME_OPTIONS, type ThemePref} from './theme';

import './TopBar.css';

/** How many recents the "Open Recent" submenu shows; the ⌃R switcher lists them all. */
const MAX_RECENT_MENU = 8;

export interface TopBarProps {
    /** Active storage label (folder name, or "In this browser"); shown in the menu. */
    storageLabel: string | null;
    /** Known workspaces, most recently opened first — feeds the "Open Recent" submenu. */
    workspaces: WorkspaceInfo[];
    activeWorkspaceId: string | null;
    /** Desktop shell: ⌘-click on a recent opens it in a new window. */
    isDesktop: boolean;
    /** Whether folder-on-disk workspaces are available (shows "Open Folder…"). */
    supportsFolders: boolean;
    /** Switch this window to a recent workspace. */
    onOpenWorkspace: (id: string) => void;
    /** Desktop only: open a recent workspace in its own window (⌘-click). */
    onOpenWorkspaceInNewWindow: (id: string) => void;
    /** Open the folder picker (adds/opens a workspace in this window). */
    onOpenFolder: () => void;
    /** Open the ⌃R workspace switcher dialog. */
    onOpenSwitcher: () => void;
    /** The orb menu just opened — a chance to refresh the recents it shows. */
    onMenuOpen?: () => void;
    /** Export all notes as a .md zip. */
    onExport: () => void;
    /** Import .md files / a zip into the current store. */
    onImport: () => void;
    /** Open the media-attachments manager. */
    onManageAttachments: () => void;
    /** Open the Trash (soft-deleted notes). */
    onOpenTrash: () => void;
    /** Number of notes currently in the Trash, for the menu-item badge. */
    trashCount: number;
    onOpenHelp: () => void;
    /** Open the app settings dialog (⌘,). */
    onOpenSettings: () => void;
    /** Open the software-update dialog + kick off a check. Native shell only; omit to hide the item. */
    onCheckForUpdates?: () => void;
    /** Whether an update is already known to be available — turns the item into a call to action. */
    updateAvailable?: boolean;
    themePref: ThemePref;
    onChangeThemePref: (pref: ThemePref) => void;
    /** Toggle the sidebar collapsed/docked. */
    onToggleCollapsed: () => void;
    /** Autosave status, surfaced as the orb's pulse + a read-only line in the menu. */
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
    /** Whether a note is open — shows the ⋯ "Note appearance" button at the bar's right edge. */
    noteOpen: boolean;
    /** Open state of the note-appearance popover (Workspace-owned, so ⌘⇧I can toggle it too). */
    appearanceOpen: boolean;
    /** Toggle the note-appearance popover (the ⋯ button + the ⌘⇧I shortcut). */
    onToggleAppearance: () => void;
    /** Close the note-appearance popover (Esc / outside-click). */
    onCloseAppearance: () => void;
    /** Per-note appearance overrides for the open note (drives the popover). */
    noteAppearance: NoteAppearance;
    onSetNoteAppearance: <K extends keyof NoteAppearance>(key: K, value: NoteAppearance[K]) => void;
    onResetNoteAppearance: () => void;
    /** True when the open note overrides at least one appearance field — shows the popover's Reset. */
    noteAppearanceOverridden: boolean;
}

/** Status line text for the menu, by autosave state. */
const STATUS_TEXT: Record<SaveState, string> = {
    idle: 'All changes saved',
    saving: 'Saving…',
    saved: 'All changes saved',
    error: "Save failed — changes aren't on disk",
    conflict: 'This note changed on disk',
};

/**
 * The slim nvALT top bar: an orange orb (the app mark) on the left opens the one menu that holds
 * storage, sidebar, theme, help, and a read-only save-status line; the orb itself doubles as the
 * autosave indicator (it pulses while saving). The rest of the bar is the full-width "search or
 * create" box. This component owns the search keyboard model; the list lives in `NoteList`.
 */
export function TopBar({
    storageLabel,
    workspaces,
    activeWorkspaceId,
    isDesktop,
    supportsFolders,
    onOpenWorkspace,
    onOpenWorkspaceInNewWindow,
    onOpenFolder,
    onOpenSwitcher,
    onMenuOpen,
    onExport,
    onImport,
    onManageAttachments,
    onOpenTrash,
    trashCount,
    onOpenHelp,
    onOpenSettings,
    onCheckForUpdates,
    updateAvailable,
    themePref,
    onChangeThemePref,
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
    noteOpen,
    appearanceOpen,
    onToggleAppearance,
    onCloseAppearance,
    noteAppearance,
    onSetNoteAppearance,
    onResetNoteAppearance,
    noteAppearanceOverridden,
}: TopBarProps) {
    // The ⋯ "Note appearance" button (right edge) that the popover anchors to; null until it mounts.
    const [appearanceAnchor, setAppearanceAnchor] = useState<HTMLElement | null>(null);

    // The orb's save-pulse: a `_pulsing` class (see TopBar.css) applied while saving, and — so a quick
    // save doesn't cut the breath off mid-dip — held until the pulse reaches a cycle boundary after
    // saving ends. We ride the CSS `animationiteration` event for that boundary instead of timing it by
    // hand: saving-ended arms `pendingStop`, and the next iteration (opacity back at 1) drops the class.
    // (Under prefers-reduced-motion the animation is `none`, so no iteration fires and the class lingers
    // harmlessly — there's no pulse to stop, and `_pulsing` has no other effect.)
    const [orbPulsing, setOrbPulsing] = useState(false);
    const pulsePendingStopRef = useRef(false);
    useEffect(() => {
        if (saveState === 'saving') {
            pulsePendingStopRef.current = false; // a fresh save cancels any pending stop
            setOrbPulsing(true);
        } else {
            pulsePendingStopRef.current = true; // let the breath finish, then stop (see the orb below)
        }
    }, [saveState]);

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

    const themeIcon = (THEME_OPTIONS.find((o) => o.value === themePref) ?? THEME_OPTIONS[2]).icon;
    const needsAttention = saveState === 'error' || saveState === 'conflict';

    // One menu, in groups (dividers between): read-only status · storage · sidebar / theme / help.
    const menuItems = [
        [
            {
                text: STATUS_TEXT[saveState],
                iconStart: (
                    <span
                        className={`topbar__menu-status-dot topbar__menu-status-dot_${saveState}`}
                    />
                ),
                theme: needsAttention ? ('danger' as const) : undefined,
                disabled: true,
                action: () => {},
            },
        ],
        [
            {
                text: storageLabel ?? 'Storage',
                iconStart: <Icon data={Folder} />,
                className: 'topbar__menu-storage',
                disabled: true,
                action: () => {},
            },
            {
                text: 'Export all notes…',
                iconStart: <Icon data={ArrowDownToLine} />,
                action: onExport,
            },
            {
                text: 'Import .md files…',
                iconStart: <Icon data={ArrowUpFromLine} />,
                action: onImport,
            },
            {
                text: 'Manage attachments…',
                iconStart: <Icon data={Picture} />,
                action: onManageAttachments,
            },
            {
                text: trashCount > 0 ? `Trash (${trashCount})` : 'Trash',
                iconStart: <Icon data={TrashBin} />,
                action: onOpenTrash,
            },
            {
                text: 'Open Recent',
                iconStart: <Icon data={ClockArrowRotateLeft} />,
                items: [
                    // Recents (most recent first, the current one check-marked). Plain click
                    // switches this window; ⌘-click (desktop) opens a new window.
                    workspaces.slice(0, MAX_RECENT_MENU).map((ws) => ({
                        text: ws.name,
                        iconStart: <Icon data={ws.backend === 'indexeddb' ? Database : Folder} />,
                        selected: ws.id === activeWorkspaceId,
                        // The uikit action gets a React mouse event on click but a NATIVE
                        // KeyboardEvent on Enter — both carry metaKey, which is all we need.
                        action: (event: ReactMouseEvent<HTMLElement> | KeyboardEvent) => {
                            if (ws.id === activeWorkspaceId) return;
                            if (isDesktop && event.metaKey) onOpenWorkspaceInNewWindow(ws.id);
                            else onOpenWorkspace(ws.id);
                        },
                    })),
                    [
                        {
                            text: 'Workspaces…',
                            iconEnd: <span className="topbar__menu-kbd">⌃R</span>,
                            action: onOpenSwitcher,
                        },
                    ],
                ],
            },
            ...(supportsFolders
                ? [
                      {
                          text: 'Open Folder…',
                          iconStart: <Icon data={FolderOpen} />,
                          action: onOpenFolder,
                      },
                  ]
                : []),
        ],
        [
            {
                text: 'Toggle sidebar',
                iconStart: <Icon data={LayoutSideContent} />,
                iconEnd: <span className="topbar__menu-kbd">{'⌘\\'}</span>,
                action: onToggleCollapsed,
            },
            {
                text: 'Theme',
                iconStart: <Icon data={themeIcon} />,
                items: THEME_OPTIONS.map((o) => ({
                    text: o.label,
                    iconStart: <Icon data={o.icon} />,
                    selected: themePref === o.value,
                    action: () => onChangeThemePref(o.value),
                })),
            },
            {
                text: 'Settings…',
                iconStart: <Icon data={Gear} />,
                iconEnd: <span className="topbar__menu-kbd">⌘,</span>,
                action: onOpenSettings,
            },
            {
                text: 'Keyboard shortcuts',
                iconStart: <Icon data={CircleQuestion} />,
                iconEnd: <span className="topbar__menu-kbd">⌘/</span>,
                action: onOpenHelp,
            },
        ],
        // The native shell can self-update; the web build omits the handler, hiding this group.
        ...(onCheckForUpdates
            ? [
                  [
                      {
                          text: updateAvailable ? 'Install update…' : 'Check for Updates…',
                          iconStart: (
                              <Icon data={updateAvailable ? CircleArrowUp : ArrowsRotateRight} />
                          ),
                          action: onCheckForUpdates,
                      },
                  ],
              ]
            : []),
    ];

    return (
        <header className="topbar" data-tauri-drag-region>
            <DropdownMenu
                switcherWrapperClassName="topbar__menu-anchor"
                onOpenToggle={(open) => {
                    if (open) onMenuOpen?.();
                }}
                renderSwitcher={(props) => (
                    <button
                        {...props}
                        type="button"
                        className={`topbar__menu-orb topbar__menu-orb_${saveState}${
                            orbPulsing ? ' topbar__menu-orb_pulsing' : ''
                        }`}
                        aria-label="Menu"
                        aria-haspopup="true"
                        title={STATUS_TEXT[saveState]}
                        // Stop the pulse only at a cycle boundary, so it never cuts off mid-breath.
                        onAnimationIteration={() => {
                            if (pulsePendingStopRef.current) {
                                pulsePendingStopRef.current = false;
                                setOrbPulsing(false);
                            }
                        }}
                    />
                )}
                items={menuItems}
            />
            <TextInput
                className="topbar__search"
                controlRef={searchInputRef}
                value={displayValue}
                onUpdate={onSearchUpdate}
                placeholder="Search or create a note…"
                // Placeholders aren't a reliable accessible name; name the field explicitly.
                controlProps={{'aria-label': 'Search or create a note'}}
                hasClear
                onKeyDown={onSearchKeyDown}
            />
            {/* The open note's "⋯" appearance menu, pinned at the bar's right edge (always visible, so
                no scroll-position juggling). Only present when a note is open. */}
            {noteOpen ? (
                <>
                    <Button
                        ref={setAppearanceAnchor}
                        view="flat"
                        size="m"
                        className="topbar__note-actions"
                        aria-label="Note appearance"
                        aria-haspopup="dialog"
                        aria-expanded={appearanceOpen}
                        onClick={onToggleAppearance}
                    >
                        <Icon data={Ellipsis} />
                    </Button>
                    <NoteAppearancePopover
                        open={appearanceOpen}
                        anchor={appearanceAnchor}
                        onClose={onCloseAppearance}
                        noteAppearance={noteAppearance}
                        onSet={onSetNoteAppearance}
                        onReset={onResetNoteAppearance}
                        overridden={noteAppearanceOverridden}
                        workspaceLabel={storageLabel}
                    />
                </>
            ) : null}
        </header>
    );
}
