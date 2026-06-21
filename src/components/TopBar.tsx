import type {KeyboardEvent as ReactKeyboardEvent, RefObject} from 'react';

import {CircleQuestion, Folder} from '@gravity-ui/icons';
import {Button, Icon, Text, TextInput} from '@gravity-ui/uikit';

import type {NoteMeta} from '../storage/types';

import {type ThemePref, ThemeSwitcher} from './ThemeSwitcher';

import './TopBar.css';

export interface TopBarProps {
    /** Folder name doubles as the "change folder" button (in the top bar's right controls). */
    folderName: string | null;
    onChangeFolder: () => void;
    onOpenHelp: () => void;
    themePref: ThemePref;
    onChangeThemePref: (pref: ThemePref) => void;
    /** Transient save-status label (empty when idle). */
    saveLabel: string;
    /** Search box (nvALT find-or-create) and its keyboard coordination with the list. */
    query: string;
    onQueryChange: (query: string) => void;
    searchInputRef: RefObject<HTMLInputElement>;
    /** The filtered, ordered notes — used to target Enter/Arrow from the search box. */
    notes: NoteMeta[];
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

/**
 * The slim nvALT top bar: a full-width "search or create" box fills from the left, with the
 * folder button, theme switcher, and help on the right. Owns the search keyboard model; the
 * list lives in `NoteList` (sort + New now sit above it).
 */
export function TopBar({
    folderName,
    onChangeFolder,
    onOpenHelp,
    themePref,
    onChangeThemePref,
    saveLabel,
    query,
    onQueryChange,
    searchInputRef,
    notes,
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
                hasClear
                onKeyDown={onSearchKeyDown}
            />
            <Text color="secondary" className="topbar__save">
                {saveLabel}
            </Text>
            <Button
                view="flat"
                size="m"
                width="auto"
                className="topbar__folder"
                onClick={onChangeFolder}
                title="Change folder"
            >
                <Icon data={Folder} size={16} />
                <span className="topbar__folder-name">{folderName ?? 'Folder'}</span>
            </Button>
            <ThemeSwitcher pref={themePref} onChange={onChangeThemePref} />
            <Button view="flat" size="m" onClick={onOpenHelp} title="Keyboard shortcuts (?)">
                <Icon data={CircleQuestion} />
            </Button>
        </header>
    );
}
