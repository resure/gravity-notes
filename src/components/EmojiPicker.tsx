import {memo, useEffect, useId, useMemo, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent} from 'react';

import {defaultRangeExtractor, useVirtualizer} from '@tanstack/react-virtual';

import {type EmojiItem, emojiIcon, filterEmojis, loadEmojis} from '../emoji';
import {useDebouncedValue} from '../hooks/useDebouncedValue';
import {Button} from '../ui/Button';
import {Input} from '../ui/Input';
import {Popover} from '../ui/Popover';
import {Search} from '../ui/icons';

import './EmojiPicker.css';

/** Grid geometry: 8 columns of 30px cells. Kept in step with EmojiPicker.css. */
const COLUMNS = 8;
const ROW_HEIGHT = 32;

export interface EmojiPickerButtonProps {
    /** The stored icon value; only an emoji is shown. */
    value?: string;
    disabled?: boolean;
    className?: string;
    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

/**
 * The note's emoji, as a button that opens the picker. With no emoji set it is an "Add icon"
 * placeholder that the host shows only on hover, so a note without one stays bare.
 */
export function EmojiPickerButton({value, disabled, className, onClick}: EmojiPickerButtonProps) {
    const emoji = emojiIcon(value);
    return (
        <button
            type="button"
            className={`emoji-picker__button${emoji ? '' : ' emoji-picker__button_empty'}${
                className ? ` ${className}` : ''
            }`}
            disabled={disabled}
            aria-label={emoji ? 'Change note icon' : 'Set note icon'}
            onClick={onClick}
        >
            {emoji ?? (
                <>
                    <span aria-hidden>☺</span> Add icon
                </>
            )}
        </button>
    );
}

export interface EmojiPickerPopupProps {
    /** The element the popup attaches to; null = closed. */
    anchor: Element | {getBoundingClientRect: () => DOMRect} | null;
    /** The current value — marks the matching cell and offers "Remove icon". */
    value?: string;
    /** The picked emoji, or '' to remove the icon. */
    onChange: (value: string) => void;
    onClose: () => void;
}

/**
 * The picker itself — controlled by its anchor, so the note list keeps ONE instance for every row
 * (the same shared-instance pattern as its row menu). The catalog loads the first time it opens.
 */
export const EmojiPickerPopup = memo(function EmojiPickerPopup({
    anchor,
    value,
    onChange,
    onClose,
}: EmojiPickerPopupProps) {
    const open = anchor !== null;
    const [query, setQuery] = useState('');
    const debouncedQuery = useDebouncedValue(query, 100);
    const [emojis, setEmojis] = useState<EmojiItem[] | null>(null);
    const [activeIndex, setActiveIndex] = useState(-1);
    const searchRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const listId = useId();
    const optionId = (index: number) => `${listId}-opt-${index}`;

    useEffect(() => {
        if (!open || emojis) return undefined;
        let cancelled = false;
        void loadEmojis().then((loaded) => {
            if (!cancelled) setEmojis(loaded);
        });
        return () => {
            cancelled = true;
        };
    }, [open, emojis]);

    // One instance serves every row, so a closed picker must not carry one note's search into the
    // next note's.
    useEffect(() => {
        if (!open) {
            setQuery('');
            setActiveIndex(-1);
        }
    }, [open]);

    const entries = useMemo(
        () => (open && emojis ? filterEmojis(debouncedQuery, emojis) : []),
        [open, emojis, debouncedQuery],
    );
    useEffect(() => setActiveIndex(-1), [entries]);

    const rowCount = Math.ceil(entries.length / COLUMNS);
    const activeRow = activeIndex >= 0 ? Math.floor(activeIndex / COLUMNS) : -1;
    const rowVirtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 4,
        // Keep the highlighted row mounted, so `aria-activedescendant` never names a torn-down id.
        rangeExtractor: (range) => {
            const indexes = defaultRangeExtractor(range);
            if (activeRow >= 0 && activeRow < rowCount && !indexes.includes(activeRow)) {
                indexes.push(activeRow);
            }
            return indexes.sort((a, b) => a - b);
        },
    });

    // The popup unmounts its content while closed; re-measure the fresh scroll element on open.
    useEffect(() => {
        if (!open) return undefined;
        const id = requestAnimationFrame(() => rowVirtualizer.measure());
        return () => cancelAnimationFrame(id);
    }, [open, rowVirtualizer, emojis]);

    const pick = (next: string) => {
        onChange(next);
        onClose();
    };

    // Focus stays in the search field; ↓ steps into the grid, then the arrows rove and ↵ picks.
    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const count = entries.length;
        if (!count) return;
        const move = (to: number) => {
            event.preventDefault();
            const next = Math.max(0, Math.min(to, count - 1));
            setActiveIndex(next);
            rowVirtualizer.scrollToIndex(Math.floor(next / COLUMNS));
        };
        if (event.key === 'ArrowDown') move(activeIndex < 0 ? 0 : activeIndex + COLUMNS);
        else if (event.key === 'ArrowUp' && activeIndex >= 0) move(activeIndex - COLUMNS);
        else if (event.key === 'ArrowRight' && activeIndex >= 0) move(activeIndex + 1);
        else if (event.key === 'ArrowLeft' && activeIndex > 0) move(activeIndex - 1);
        else if (event.key === 'Enter' && activeIndex >= 0 && entries[activeIndex]) {
            event.preventDefault();
            pick(entries[activeIndex].char);
        }
    };

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            anchor={anchor}
            align="start"
            initialFocus={searchRef}
            aria-label="Note icon"
            className="emoji-picker"
        >
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the grid's keys
                arrive here from the focused search field (a combobox). */}
            <div className="emoji-picker__body" onKeyDown={onKeyDown}>
                <Input
                    ref={searchRef}
                    icon={<Search size={12} />}
                    placeholder="Search emoji…"
                    aria-label="Search emoji"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    role="combobox"
                    aria-expanded
                    aria-controls={listId}
                    aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                    aria-autocomplete="list"
                />
                <div
                    ref={scrollRef}
                    id={listId}
                    className="emoji-picker__grid virtual-scroll"
                    role="listbox"
                    aria-label="Emoji"
                >
                    {emojis && entries.length === 0 ? (
                        <p className="emoji-picker__empty">No emoji match.</p>
                    ) : null}
                    <div
                        className="emoji-picker__grid-inner"
                        style={{height: rowVirtualizer.getTotalSize()}}
                    >
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
                            <div
                                key={virtualRow.key}
                                className="emoji-picker__row"
                                style={{transform: `translateY(${virtualRow.start}px)`}}
                            >
                                {entries
                                    .slice(
                                        virtualRow.index * COLUMNS,
                                        virtualRow.index * COLUMNS + COLUMNS,
                                    )
                                    .map((entry, column) => {
                                        const index = virtualRow.index * COLUMNS + column;
                                        return (
                                            <button
                                                key={entry.char}
                                                id={optionId(index)}
                                                type="button"
                                                role="option"
                                                aria-selected={value === entry.char}
                                                title={entry.name}
                                                className={`emoji-picker__cell${
                                                    value === entry.char
                                                        ? ' emoji-picker__cell_current'
                                                        : ''
                                                }${index === activeIndex ? ' emoji-picker__cell_active' : ''}`}
                                                onClick={() => pick(entry.char)}
                                            >
                                                {entry.char}
                                            </button>
                                        );
                                    })}
                            </div>
                        ))}
                    </div>
                </div>
                {emojiIcon(value) ? (
                    <Button className="emoji-picker__remove" onClick={() => pick('')}>
                        Remove icon
                    </Button>
                ) : null}
            </div>
        </Popover>
    );
});

/** Button + its own picker, for one-off spots like the note title. */
export function EmojiPicker({
    value,
    onChange,
    disabled,
    className,
}: {
    value?: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    className?: string;
}) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    // Read-only preview disables the button; an already-open picker must close with it.
    useEffect(() => {
        if (disabled) setAnchor(null);
    }, [disabled]);
    return (
        <>
            <EmojiPickerButton
                value={value}
                disabled={disabled}
                className={className}
                onClick={(event) => {
                    const button = event.currentTarget;
                    setAnchor((current) => (current ? null : button));
                }}
            />
            <EmojiPickerPopup
                anchor={anchor}
                value={value}
                onChange={(next) => {
                    if (!disabled) onChange(next);
                }}
                onClose={() => setAnchor(null)}
            />
        </>
    );
}
