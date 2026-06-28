import {useLayoutEffect, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent, RefObject} from 'react';

import {
    ArrowDownToLine,
    ArrowUpFromLine,
    CircleQuestion,
    Folder,
    LayoutSideContent,
    Picture,
} from '@gravity-ui/icons';
import {DropdownMenu, Icon, TextInput} from '@gravity-ui/uikit';

import type {SaveState} from '../hooks/useNotes';
import type {NoteMeta} from '../storage/types';

import {THEME_OPTIONS, type ThemePref} from './theme';

import './TopBar.css';

export interface TopBarProps {
    /** Active storage label (folder name, or "In this browser"); shown in the menu. */
    storageLabel: string | null;
    /** Switch backend (returns to the choice screen). */
    onChangeStorage: () => void;
    /** Export all notes as a .md zip. */
    onExport: () => void;
    /** Import .md files / a zip into the current store. */
    onImport: () => void;
    /** Open the media-attachments manager. */
    onManageAttachments: () => void;
    onOpenHelp: () => void;
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
    selectedId: string | null;
    onCommit: (id: string) => void;
    onCreate: (title?: string) => void;
    /** Final Esc in the (empty) search box: close the open note and clear the cursor. */
    onClose: () => void;
    /** Enter the list at a row: preview it and move DOM focus onto it (↓/↑ from search). */
    onEnterList: (id: string) => void;
    /** Enter on an empty box: move focus onto the previously selected note's row. */
    onFocusList: () => void;
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
    onChangeStorage,
    onExport,
    onImport,
    onManageAttachments,
    onOpenHelp,
    themePref,
    onChangeThemePref,
    onToggleCollapsed,
    saveState,
    query,
    onQueryChange,
    searchInputRef,
    notes,
    searchLoading,
    selectedId,
    onCommit,
    onCreate,
    onClose,
    onEnterList,
    onFocusList,
}: TopBarProps) {
    const inList = (id: string | null): id is string =>
        Boolean(id) && notes.some((n) => n.id === id);

    // nvALT inline autocomplete: as the user types *forward*, the top match's title fills the box
    // with the un-typed suffix selected; Tab (or →) accepts it, Backspace removes it. `query` stays
    // the real typed text driving the search — `completion` is only what the box displays.
    const [completing, setCompleting] = useState(false);
    const topTitle = notes[0]?.title ?? '';
    const completion =
        completing &&
        query.length > 0 &&
        topTitle.length > query.length &&
        topTitle.toLowerCase().startsWith(query.toLowerCase())
            ? topTitle
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
                text: 'Change storage…',
                iconStart: <Icon data={Folder} />,
                action: onChangeStorage,
            },
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
                text: 'Keyboard shortcuts',
                iconStart: <Icon data={CircleQuestion} />,
                iconEnd: <span className="topbar__menu-kbd">⌘/</span>,
                action: onOpenHelp,
            },
        ],
    ];

    return (
        <header className="topbar">
            <DropdownMenu
                switcherWrapperClassName="topbar__menu-anchor"
                renderSwitcher={(props) => (
                    <button
                        {...props}
                        type="button"
                        className={`topbar__menu-orb topbar__menu-orb_${saveState}`}
                        aria-label="Menu"
                        aria-haspopup="true"
                        title={STATUS_TEXT[saveState]}
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
        </header>
    );
}
