import {useEffect, useMemo, useRef, useState} from 'react';

import {domIdPart, useListboxNav} from '../hooks/useListboxNav';
import type {WorkspaceInfo} from '../hooks/useNotesStorage';
import {isOpenInNewWindowChord} from '../shortcuts';
import {Button} from '../ui/Button';
import {Dialog} from '../ui/Dialog';
import {Input} from '../ui/Input';
import {Database, Folder, FolderPlus, Xmark} from '../ui/icons';

import {highlightMatch} from './highlightMatch';

import './WorkspaceSwitcherDialog.css';

export interface WorkspaceSwitcherDialogProps {
    open: boolean;
    /** Known workspaces, most recently opened first (includes the current one). */
    workspaces: WorkspaceInfo[];
    /** The workspace this window is showing (badged, not pickable). */
    currentId: string | null;
    /** Desktop shell: enables ⌘↵ open-in-new-window; hides the offered in-browser storage. */
    isDesktop: boolean;
    /** Whether folder workspaces are available at all (shows the "Open Folder…" action row). */
    supportsFolders: boolean;
    /** Open in this window. */
    onOpen: (id: string) => void;
    /** Open in its own window (desktop only). */
    onOpenInNewWindow: (id: string) => void;
    /** Pick a brand-new folder (opens in this window). */
    onOpenFolder: () => void;
    /** Desktop only: pick a folder and open it as its own window (⌘↵/⌘-click on the action row). */
    onOpenFolderInNewWindow?: () => void;
    /** Drop from the recents list (notes on disk are untouched). */
    onRemove: (id: string) => void;
    onClose: () => void;
}

/** One keyboard-navigable row of the switcher. */
interface Row {
    id: string;
    name: string;
    path?: string;
    isBrowser: boolean;
    /** The current workspace: shown for orientation, not pickable. */
    disabled: boolean;
    /**
     * The in-browser storage offered before it exists in the registry — opening it creates it.
     * Not removable, and "new window" would find nothing to assign, so it always opens in place.
     */
    synthesized: boolean;
    /** The pinned "Open Folder…" action row (not a workspace; outside the filter). */
    openFolder: boolean;
}

const OPEN_FOLDER_ID = 'open-folder';

export function WorkspaceSwitcherDialog({
    open,
    workspaces,
    currentId,
    isDesktop,
    supportsFolders,
    onOpen,
    onOpenInNewWindow,
    onOpenFolder,
    onOpenFolderInNewWindow,
    onRemove,
    onClose,
}: WorkspaceSwitcherDialogProps) {
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const ql = query.trim().toLowerCase();

    const entries = useMemo<Row[]>(() => {
        const toRow = (ws: WorkspaceInfo): Row => ({
            id: ws.id,
            name: ws.name,
            path: ws.path,
            isBrowser: ws.backend === 'indexeddb',
            disabled: ws.id === currentId,
            synthesized: false,
            openFolder: false,
        });
        // OTHER workspaces first, by recency — so the top row is both the pre-highlighted ↵
        // target and the most recently used elsewhere, and ⌃R↵ ⌃R↵ ping-pongs between the two
        // most recent workspaces. The current one sits at the bottom, badged, for orientation.
        const rows = workspaces.filter((ws) => ws.id !== currentId).map(toRow);
        // On the WEB, in-browser storage stays offered even before it exists in the registry.
        // The desktop app is folder-first, so nothing is offered there — though an in-app
        // workspace that already exists (someone actually stored notes in it) still lists, so
        // no data is ever stranded.
        if (!isDesktop && !workspaces.some((ws) => ws.backend === 'indexeddb')) {
            rows.push({
                id: 'indexeddb',
                name: 'In this browser',
                isBrowser: true,
                disabled: currentId === 'indexeddb',
                synthesized: true,
                openFolder: false,
            });
        }
        rows.push(...workspaces.filter((ws) => ws.id === currentId).map(toRow));
        const filtered = ql
            ? rows.filter(
                  (row) =>
                      row.name.toLowerCase().includes(ql) ||
                      (row.path ? row.path.toLowerCase().includes(ql) : false),
              )
            : rows;
        // A pinned action row, deliberately OUTSIDE the filter: a new folder is always one
        // ↓/↵ away, whatever was typed.
        if (supportsFolders) {
            filtered.push({
                id: OPEN_FOLDER_ID,
                name: 'Open Folder…',
                isBrowser: false,
                disabled: false,
                synthesized: false,
                openFolder: true,
            });
        }
        return filtered;
    }, [workspaces, currentId, isDesktop, supportsFolders, ql]);

    const commit = (row: Row | undefined, newWindow: boolean) => {
        if (!row || row.disabled) return;
        if (row.openFolder) {
            // ⌘↵/⌘-click means "in a new window" for this row too — the picked folder opens in
            // its own window and the current workspace stays put.
            if (newWindow && isDesktop && onOpenFolderInNewWindow) onOpenFolderInNewWindow();
            else onOpenFolder();
            return;
        }
        // A synthesized row exists nowhere yet, so a new window couldn't be assigned to it —
        // open it in place (which registers it).
        if (newWindow && isDesktop && !row.synthesized) onOpenInNewWindow(row.id);
        else onOpen(row.id);
    };

    // Shared filter-list keyboard model (↑/↓ skip-disabled, ↵ commit, ⌘⌫ remove, Esc close) on a
    // document listener — see useListboxNav for why it can't be input-scoped.
    const {activeIndex, setActiveIndex, registerRow} = useListboxNav<Row>({
        open,
        items: entries,
        getKey: (row) => row.id,
        isDisabled: (row) => row.disabled,
        onEnter: (index, event) => commit(entries[index], isOpenInNewWindowChord(event)),
        onRemove: (index) => {
            const row = entries[index];
            if (row && !row.disabled && !row.synthesized && !row.openFolder) onRemove(row.id);
        },
        onClose,
    });

    // Reset the filter when the dialog opens, and focus it so you can type-to-narrow immediately.
    useEffect(() => {
        if (open) {
            setQuery('');
            inputRef.current?.focus();
        }
    }, [open]);

    // Keyboard-first highlight: the first selectable row is pre-highlighted — on open that's the
    // most recent OTHER workspace (or the "Open Folder…" action when there's nothing else), so
    // ⌃R → ↵ hops to the previous workspace without touching the mouse; while filtering it's the
    // first match. Reads entries through a ref so this re-runs on open/filter changes only: a
    // mid-session removal must not yank the highlight back to the top (the hook's clamp handles it).
    const entriesRef = useRef(entries);
    entriesRef.current = entries;
    useEffect(() => {
        if (!open) return;
        setActiveIndex(entriesRef.current.findIndex((row) => !row.disabled));
    }, [open, ql, setActiveIndex]);

    const activeId = entries[activeIndex]?.id;

    const renderRow = (row: Row, index: number) => {
        const active = index === activeIndex;
        let Glyph = Folder;
        if (row.isBrowser) Glyph = Database;
        if (row.openFolder) Glyph = FolderPlus;
        return (
            // Combobox pattern: keyboard runs through the filter input (aria-activedescendant points
            // at the active option), so options are mouse targets and aren't individually focusable.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
            <div
                key={row.id}
                id={`ws-switch-opt-${domIdPart(row.id)}`}
                ref={(el) => registerRow(row.id, el)}
                className={
                    'ws-switch__row' +
                    (active ? ' ws-switch__row_active' : '') +
                    (row.disabled ? ' ws-switch__row_disabled' : '') +
                    (row.openFolder ? ' ws-switch__row_open-folder' : '')
                }
                role="option"
                aria-selected={active}
                aria-disabled={row.disabled || undefined}
                onClick={(event) => commit(row, isOpenInNewWindowChord(event))}
                onMouseMove={() => {
                    if (!row.disabled && !active) setActiveIndex(index);
                }}
            >
                <Glyph size={15} className="ws-switch__icon" />
                <span className="ws-switch__text">
                    <span className="ws-switch__name">
                        {highlightMatch(row.name, ql, 'ws-switch__match')}
                    </span>
                    {row.path ? <span className="ws-switch__path">{row.path}</span> : null}
                </span>
                {row.disabled ? <span className="ws-switch__hint">current</span> : null}
                {!row.disabled && !row.synthesized && !row.openFolder ? (
                    <button
                        type="button"
                        className="ws-switch__remove"
                        aria-label={`Remove ${row.name} from recents`}
                        tabIndex={-1}
                        onClick={(event) => {
                            event.stopPropagation();
                            onRemove(row.id);
                        }}
                    >
                        <Xmark size={12} />
                    </button>
                ) : null}
            </div>
        );
    };

    return (
        // initialFocus hands the filter input straight to the Dialog's focus manager — otherwise
        // it focuses the popup container itself, racing (and beating) our own focus effect.
        <Dialog
            open={open}
            onClose={onClose}
            title="Switch workspace"
            width={440}
            initialFocus={inputRef}
            footer={
                <>
                    <span className="ws-switch__keys">
                        {isDesktop ? '↵ open · ⌘↵ new window · ⌘⌫ remove' : '↵ open · ⌘⌫ remove'}
                    </span>
                    <Button onClick={onClose}>Cancel</Button>
                </>
            }
        >
            <Input
                ref={inputRef}
                placeholder="Filter workspaces…"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                role="combobox"
                aria-expanded
                aria-controls="ws-switch-listbox"
                aria-activedescendant={
                    activeId ? `ws-switch-opt-${domIdPart(activeId)}` : undefined
                }
                aria-label="Filter workspaces"
            />
            <div className="ws-switch__list" id="ws-switch-listbox" role="listbox">
                {/* The action row sits outside the filter, so "no matches" is judged on the
                    workspace rows alone and the hint renders above the still-present action. */}
                {ql && !entries.some((row) => !row.openFolder) ? (
                    <div className="ws-switch__empty">No workspaces match “{query.trim()}”</div>
                ) : null}
                {entries.map(renderRow)}
            </div>
        </Dialog>
    );
}
