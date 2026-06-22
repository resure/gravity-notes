import type {KeyboardEvent as ReactKeyboardEvent, RefObject} from 'react';

import {
    ArrowDownToLine,
    ArrowUpFromLine,
    CircleQuestion,
    Folder,
    LayoutSideContent,
} from '@gravity-ui/icons';
import {Button, DropdownMenu, Icon, TextInput, Tooltip} from '@gravity-ui/uikit';

import type {SaveState} from '../hooks/useNotes';
import type {NoteMeta} from '../storage/types';

import {type ThemePref, ThemeSwitcher} from './ThemeSwitcher';

import './TopBar.css';

export interface TopBarProps {
    /** Active storage label (folder name, or "In this browser"); opens the storage menu. */
    storageLabel: string | null;
    /** Switch backend (returns to the choice screen). */
    onChangeStorage: () => void;
    /** Export all notes as a .md zip. */
    onExport: () => void;
    /** Import .md files / a zip into the current store. */
    onImport: () => void;
    onOpenHelp: () => void;
    themePref: ThemePref;
    onChangeThemePref: (pref: ThemePref) => void;
    /** Toggle the sidebar collapsed/docked. */
    onToggleCollapsed: () => void;
    /** Autosave status, surfaced as a small dot beside the folder button. */
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

/** Hover text for the autosave status dot, by state. */
const STATUS_TEXT: Record<SaveState, string> = {
    idle: 'All changes saved',
    saving: 'Saving…',
    saved: 'All changes saved',
    error: "Save failed — changes aren't on disk",
    conflict: 'This note changed on disk',
};

/**
 * The slim nvALT top bar: a full-width "search or create" box fills from the left, with the
 * folder button, theme switcher, and help on the right. Owns the search keyboard model; the
 * list lives in `NoteList` (sort + New now sit above it).
 */
export function TopBar({
    storageLabel,
    onChangeStorage,
    onExport,
    onImport,
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

    const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
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

    return (
        <header className="topbar">
            <TextInput
                className="topbar__search"
                controlRef={searchInputRef}
                value={query}
                onUpdate={onQueryChange}
                placeholder="Search or create a note…"
                // Placeholders aren't a reliable accessible name; name the field explicitly.
                controlProps={{'aria-label': 'Search or create a note'}}
                hasClear
                onKeyDown={onSearchKeyDown}
            />
            <DropdownMenu
                renderSwitcher={(props) => (
                    <Button
                        {...props}
                        view="flat"
                        size="m"
                        width="auto"
                        className="topbar__folder"
                        aria-label="Storage options"
                    >
                        <Icon data={Folder} size={16} />
                        <span className="topbar__folder-name">{storageLabel ?? 'Storage'}</span>
                    </Button>
                )}
                items={[
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
                        text: 'Change storage…',
                        iconStart: <Icon data={Folder} />,
                        action: onChangeStorage,
                    },
                ]}
            />
            <Tooltip content={STATUS_TEXT[saveState]} placement="bottom">
                <div
                    className={`topbar__status-dot topbar__status-dot_${saveState}`}
                    role="status"
                    aria-label={STATUS_TEXT[saveState]}
                />
            </Tooltip>
            {/* aria-label "Toggle sidebar" (not "…notes…") so it doesn't match the folder
                button's /notes/i query in Workspace.test. */}
            <Tooltip
                content={
                    <>
                        <div>{'Toggle sidebar — ⌘\\'}</div>
                        <div>{"Peek / focus list — ⌘'"}</div>
                    </>
                }
                placement="bottom"
            >
                <Button
                    view="flat"
                    size="m"
                    className="topbar__sidebar-toggle"
                    onClick={onToggleCollapsed}
                    aria-label="Toggle sidebar"
                >
                    <Icon data={LayoutSideContent} />
                </Button>
            </Tooltip>
            <ThemeSwitcher pref={themePref} onChange={onChangeThemePref} />
            <Button
                view="flat"
                size="m"
                onClick={onOpenHelp}
                title="Keyboard shortcuts (⌘/)"
                aria-label="Keyboard shortcuts"
            >
                <Icon data={CircleQuestion} />
            </Button>
        </header>
    );
}
