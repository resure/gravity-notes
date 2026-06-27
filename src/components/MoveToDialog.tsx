import {useEffect, useMemo, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent, ReactNode} from 'react';

import {ChevronDown, ChevronRight, Folder, House} from '@gravity-ui/icons';
import {Dialog, Icon, Text, TextInput} from '@gravity-ui/uikit';

import {dirname} from '../storage/noteText';
import type {NoteMeta, NotesMetadata} from '../storage/types';
import {type MoveTargetRow, buildMoveTargets} from '../tree';

import './MoveToDialog.css';

export interface MoveToDialogProps {
    open: boolean;
    /** The note being moved (null = nothing to move). */
    note: {id: string; title: string} | null;
    /** Every folder path (`''` root excluded), for the destination tree. */
    folders: string[];
    /** All notes — feeds the tree's synthesized ancestors (note counts are not shown here). */
    notes: NoteMeta[];
    /** Folder metadata, for pinned-first ordering (mirrors the rail). */
    metadata: NotesMetadata;
    /** Move into `destFolder` (`''` = root). */
    onMove: (destFolder: string) => void;
    onClose: () => void;
}

/** One keyboard-navigable row: the special Root entry, then the filtered folder tree. */
interface Entry extends MoveTargetRow {
    /** Stable row key (`' root'` for Root; folder paths are always non-empty). */
    key: string;
    isRoot: boolean;
}

const ROOT_KEY = ' root';
/** Left padding (px) for a row at the given tree depth. Mirrors the rail's indent ramp. */
function indentFor(depth: number): number {
    return 12 + depth * 16;
}

/** Wrap the first case-insensitive occurrence of `q` in `name` with a highlight `<mark>`. */
function highlight(name: string, q: string): ReactNode {
    if (!q) return name;
    const idx = name.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return name;
    return (
        <>
            {name.slice(0, idx)}
            <mark className="move-to__match">{name.slice(idx, idx + q.length)}</mark>
            {name.slice(idx + q.length)}
        </>
    );
}

export function MoveToDialog({
    open,
    note,
    folders,
    notes,
    metadata,
    onMove,
    onClose,
}: MoveToDialogProps) {
    const currentFolder = note ? dirname(note.id) : '';
    const [query, setQuery] = useState('');
    // The picker keeps its own collapse state — opening it must not touch the rail's.
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const q = query.trim();
    const ql = q.toLowerCase();

    const folderRows = useMemo(
        () => buildMoveTargets(folders, notes, metadata, currentFolder, collapsed, query),
        [folders, notes, metadata, currentFolder, collapsed, query],
    );

    // Root is a folder named "Root": it filters uniformly (shown on an empty query, or one that
    // matches "root"), and is disabled when the note already lives at the root.
    const entries = useMemo<Entry[]>(() => {
        const rootShown = !ql || 'root'.includes(ql);
        const root: Entry = {
            key: ROOT_KEY,
            path: '',
            name: 'Root',
            depth: 0,
            hasChildren: false,
            collapsed: false,
            disabled: currentFolder === '',
            matched: Boolean(ql) && 'root'.includes(ql),
            isRoot: true,
        };
        const tail = folderRows.map<Entry>((row) => ({...row, key: row.path, isRoot: false}));
        return rootShown ? [root, ...tail] : tail;
    }, [folderRows, currentFolder, ql]);

    // Reset everything when the dialog opens (or the target note changes).
    useEffect(() => {
        if (open) {
            setQuery('');
            setCollapsed(new Set());
        }
    }, [open, note?.id]);

    // Typeahead focus: while filtering, highlight the first matching selectable row (else the first
    // selectable one) so Enter moves there. With an empty filter, highlight *nothing* — Enter is a
    // move, so opening the picker and hitting Enter must not silently yank the note to a folder.
    useEffect(() => {
        if (!open) return;
        if (!ql) {
            setActiveIndex(-1);
            return;
        }
        const firstMatched = entries.findIndex((e) => e.matched && !e.disabled);
        const firstSelectable = entries.findIndex((e) => !e.disabled);
        setActiveIndex(firstMatched >= 0 ? firstMatched : firstSelectable);
    }, [entries, open, ql]);

    // Keep the active row in view as it moves.
    useEffect(() => {
        if (!open) return;
        const active = entries[activeIndex];
        if (active) rowRefs.current.get(active.key)?.scrollIntoView?.({block: 'nearest'});
    }, [activeIndex, entries, open]);

    // Focus the filter field on open, so you can type-to-narrow immediately.
    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    const toggleCollapse = (path: string) => {
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    };

    // Step the highlight to the next selectable row in `delta` direction (clamped, skips disabled).
    // From "nothing highlighted" (-1), ArrowDown lands on the first selectable row, ArrowUp the last.
    const firstSelectable = () => entries.findIndex((e) => !e.disabled);
    const lastSelectable = () => {
        for (let i = entries.length - 1; i >= 0; i--) if (!entries[i].disabled) return i;
        return -1;
    };
    const moveActive = (delta: number) => {
        setActiveIndex((cur) => {
            if (cur < 0) return delta > 0 ? firstSelectable() : lastSelectable();
            for (let i = cur + delta; i >= 0 && i < entries.length; i += delta) {
                if (!entries[i].disabled) return i;
            }
            return cur;
        });
    };

    const commit = (entry: Entry | undefined) => {
        if (!entry || entry.disabled) return;
        onMove(entry.path);
    };

    const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                moveActive(1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                moveActive(-1);
                break;
            case 'Enter':
                event.preventDefault();
                commit(entries[activeIndex]);
                break;
            case 'Escape':
                event.preventDefault();
                onClose();
                break;
        }
    };

    const activeKey = entries[activeIndex]?.key;

    const renderEntry = (entry: Entry, index: number) => {
        const active = index === activeIndex;
        return (
            // Combobox pattern: keyboard runs through the filter input (aria-activedescendant points
            // at the active option), so options are mouse targets and aren't individually focusable.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
            <div
                key={entry.key}
                id={`move-to-opt-${entry.key}`}
                ref={(el) => {
                    if (el) rowRefs.current.set(entry.key, el);
                    else rowRefs.current.delete(entry.key);
                }}
                className={
                    'move-to__row' +
                    (active ? ' move-to__row_active' : '') +
                    (entry.disabled ? ' move-to__row_disabled' : '')
                }
                style={{paddingInlineStart: indentFor(entry.depth)}}
                role="option"
                aria-selected={active}
                aria-disabled={entry.disabled || undefined}
                onClick={() => commit(entry)}
                onMouseMove={() => {
                    if (!entry.disabled && !active) setActiveIndex(index);
                }}
            >
                {entry.hasChildren ? (
                    <button
                        type="button"
                        className="move-to__caret move-to__caret_button"
                        aria-label={`${entry.collapsed ? 'Expand' : 'Collapse'} ${entry.name}`}
                        tabIndex={-1}
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleCollapse(entry.path);
                        }}
                    >
                        <Icon data={entry.collapsed ? ChevronRight : ChevronDown} size={14} />
                    </button>
                ) : (
                    <span className="move-to__caret" />
                )}
                <Icon
                    className="move-to__icon"
                    data={entry.isRoot ? House : Folder}
                    size={16}
                    aria-hidden
                />
                <Text className="move-to__name" ellipsis>
                    {highlight(entry.name, ql)}
                </Text>
                {entry.disabled ? <span className="move-to__hint">current</span> : null}
            </div>
        );
    };

    return (
        <Dialog open={open} onClose={onClose} size="s">
            <Dialog.Header caption={note ? `Move “${note.title}” to…` : 'Move'} />
            <Dialog.Body>
                <TextInput
                    controlRef={inputRef}
                    autoComplete={false}
                    placeholder="Filter folders…"
                    value={query}
                    onUpdate={setQuery}
                    onKeyDown={onInputKeyDown}
                    controlProps={{
                        role: 'combobox',
                        'aria-expanded': true,
                        'aria-controls': 'move-to-listbox',
                        'aria-activedescendant': activeKey ? `move-to-opt-${activeKey}` : undefined,
                        'aria-label': 'Filter folders',
                    }}
                />
                <div className="move-to__list" id="move-to-listbox" role="listbox">
                    {entries.length === 0 ? (
                        <div className="move-to__empty">
                            <Text color="secondary">No folders match “{q}”</Text>
                        </div>
                    ) : (
                        entries.map(renderEntry)
                    )}
                </div>
            </Dialog.Body>
            <Dialog.Footer textButtonCancel="Cancel" onClickButtonCancel={onClose} />
        </Dialog>
    );
}
