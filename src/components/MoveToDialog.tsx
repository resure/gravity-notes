import {useEffect, useMemo, useRef, useState} from 'react';

import {useHeldValue} from '../hooks/useHeldValue';
import {useListboxNav} from '../hooks/useListboxNav';
import {dirname} from '../storage/noteText';
import type {NoteMeta, NotesMetadata} from '../storage/types';
import {type MoveTargetRow, buildMoveTargets} from '../tree';
import {Button} from '../ui/Button';
import {Dialog} from '../ui/Dialog';
import {Input} from '../ui/Input';
import {ChevronDown, ChevronRight, Folder, House} from '../ui/icons';

import {highlightMatch} from './highlightMatch';

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

export function MoveToDialog({
    open,
    note,
    folders,
    notes,
    metadata,
    onMove,
    onClose,
}: MoveToDialogProps) {
    // Keep the header + tree rendered through the Dialog's ~150ms close animation: the parent clears
    // `note` on move/cancel, so reading off it directly would blank the header and reshape the tree
    // mid-close. Display-only — the actual move reads live state.
    const noteView = useHeldValue(note);
    const currentFolder = noteView ? dirname(noteView.id) : '';
    const [query, setQuery] = useState('');
    // The picker keeps its own collapse state — opening it must not touch the rail's.
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
    const inputRef = useRef<HTMLInputElement>(null);

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

    const commit = (entry: Entry | undefined) => {
        if (!entry || entry.disabled) return;
        onMove(entry.path);
    };

    // Shared filter-list keyboard model (↑/↓ skip-disabled, ↵ commit, Esc close) on a document
    // listener — see useListboxNav for why it can't be input-scoped (a dialog's focus manager can
    // park focus on the popup container, silencing an onKeyDown handler).
    const {activeIndex, setActiveIndex, registerRow} = useListboxNav<Entry>({
        open,
        items: entries,
        getKey: (entry) => entry.key,
        isDisabled: (entry) => entry.disabled,
        onEnter: (index) => commit(entries[index]),
        onClose,
    });

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
    }, [entries, open, ql, setActiveIndex]);

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
                ref={(el) => registerRow(entry.key, el)}
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
                        {entry.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                ) : (
                    <span className="move-to__caret" />
                )}
                {entry.isRoot ? (
                    <House size={15} className="move-to__icon" />
                ) : (
                    <Folder size={15} className="move-to__icon" />
                )}
                <span className="move-to__name">
                    {highlightMatch(entry.name, ql, 'move-to__match')}
                </span>
                {entry.disabled ? <span className="move-to__hint">current</span> : null}
            </div>
        );
    };

    return (
        // initialFocus hands the filter input to the Dialog's focus manager; otherwise it focuses
        // the popup container, where the document-level key handler (useListboxNav) still works
        // but type-to-filter wouldn't land in the input.
        <Dialog
            open={open}
            onClose={onClose}
            title={noteView ? `Move “${noteView.title}” to…` : 'Move'}
            width={420}
            initialFocus={inputRef}
            className="move-to-dialog"
            footer={<Button onClick={onClose}>Cancel</Button>}
        >
            <Input
                ref={inputRef}
                placeholder="Filter folders…"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                role="combobox"
                aria-expanded
                aria-controls="move-to-listbox"
                aria-activedescendant={activeKey ? `move-to-opt-${activeKey}` : undefined}
                aria-label="Filter folders"
            />
            <div className="move-to__list" id="move-to-listbox" role="listbox">
                {entries.length === 0 ? (
                    <div className="move-to__empty">No folders match “{q}”</div>
                ) : (
                    entries.map(renderEntry)
                )}
            </div>
        </Dialog>
    );
}
