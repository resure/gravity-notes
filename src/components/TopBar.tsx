import type {KeyboardEvent as ReactKeyboardEvent, RefObject} from 'react';

import {ChevronDown, CircleQuestion, Folder, Plus} from '@gravity-ui/icons';
import {Button, DropdownMenu, Icon, Select, Text, TextInput} from '@gravity-ui/uikit';

import type {NoteMeta, SortMode} from '../storage/types';

import {type ThemePref, ThemeSwitcher} from './ThemeSwitcher';

import './TopBar.css';

export interface TopBarProps {
    /** Folder menu (the folder name doubles as the app menu). */
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
    onEscapeList: () => void;
    /** Enter the list at a row: preview it and move DOM focus onto it (↓/↑ from search). */
    onEnterList: (id: string) => void;
    sortMode: SortMode;
    onSortChange: (mode: SortMode) => void;
}

/**
 * The slim nvALT top bar: a wide search box that finds-or-creates, flanked by the folder
 * menu (left) and sort + New (right). Owns the search keyboard model; the list itself lives
 * in `NoteList`, reached through the callbacks (`onEnterList` previews + focuses a row).
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
    onEscapeList,
    onEnterList,
    sortMode,
    onSortChange,
}: TopBarProps) {
    const inList = (id: string | null): id is string =>
        Boolean(id) && notes.some((n) => n.id === id);

    const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            if (notes.length > 0) {
                event.preventDefault();
                // With no active query, re-open the previously selected note (e.g. after Esc-Esc
                // back to search); with a query, open the top match (nvALT).
                const target = !query.trim() && inList(selectedId) ? selectedId : notes[0].id;
                onCommit(target);
            } else if (query.trim()) {
                // nvALT: no note matches the query → create one titled with it, then clear the
                // search so the new note is visible and the box is ready for the next find.
                event.preventDefault();
                onCreate(query.trim());
                onQueryChange('');
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            if (query) onQueryChange('');
            else onEscapeList();
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
            <DropdownMenu
                renderSwitcher={(props) => (
                    <Button {...props} view="flat" size="l" className="topbar__folder">
                        <Icon data={Folder} size={16} />
                        <span className="topbar__folder-name">{folderName ?? 'Folder'}</span>
                        <Icon data={ChevronDown} size={16} />
                    </Button>
                )}
                items={[
                    {
                        text: 'Change folder',
                        iconStart: <Icon data={Folder} />,
                        action: onChangeFolder,
                    },
                    {
                        text: 'Keyboard shortcuts',
                        iconStart: <Icon data={CircleQuestion} />,
                        action: onOpenHelp,
                    },
                ]}
            />

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
            <ThemeSwitcher pref={themePref} onChange={onChangeThemePref} />
            <Select
                className="topbar__sort"
                aria-label="Sort notes"
                size="m"
                width={132}
                value={[sortMode]}
                onUpdate={([next]) => {
                    if (next) onSortChange(next as SortMode);
                }}
                options={[
                    {value: 'updated', content: 'Updated'},
                    {value: 'title', content: 'Title (A→Z)'},
                    {value: 'created', content: 'Created'},
                ]}
            />
            <Button view="action" size="m" onClick={() => onCreate()}>
                <Icon data={Plus} />
                New
            </Button>
        </header>
    );
}
