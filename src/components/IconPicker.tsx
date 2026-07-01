import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {Button, Icon, Popup, SegmentedRadioGroup, TextInput} from '@gravity-ui/uikit';
import type {ButtonProps} from '@gravity-ui/uikit';
import {useVirtualizer} from '@tanstack/react-virtual';

import {
    type EmojiItem,
    allIcons,
    filterEmojis,
    filterIcons,
    iconByName,
    loadEmojis,
    resolveIcon,
} from '../icons';

import './IconPicker.css';

interface IconPickerProps {
    value?: string;
    onChange: (name: string) => void;
    size?: ButtonProps['size'];
    disabled?: boolean;
    className?: string;
}

type IconPickerType = 'all' | 'icons' | 'emoji';

/** Grid geometry: 8 columns, each row a 28px item + 6px gap. Kept in sync with IconPicker.css. */
const COLUMNS = 8;
const ROW_HEIGHT = 34;

/** A grid entry: a Gravity icon (keyed by component name) or an emoji (keyed/valued by its char). */
type Entry =
    | {kind: 'icon'; key: string; value: string; title: string}
    | {kind: 'emoji'; key: string; value: string; title: string; char: string};

export function IconPicker({value, onChange, size = 'm', disabled, className}: IconPickerProps) {
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const [query, setQuery] = useState('');
    const [type, setType] = useState<IconPickerType>('all');
    const [emojis, setEmojis] = useState<EmojiItem[] | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    // Lazily load the emoji catalog the first time the picker opens (keeps it out of the main bundle).
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

    const entries = useMemo<Entry[]>(() => {
        const out: Entry[] = [];
        if (type !== 'emoji') {
            const icons = query.trim() ? filterIcons(query) : allIcons;
            for (const icon of icons) {
                out.push({
                    kind: 'icon',
                    key: icon.name,
                    value: icon.name,
                    title: icon.meta?.name ?? icon.name,
                });
            }
        }
        if (type !== 'icons' && emojis) {
            for (const emoji of filterEmojis(query, emojis)) {
                out.push({
                    kind: 'emoji',
                    key: `emoji:${emoji.char}`,
                    value: emoji.char,
                    title: emoji.name,
                    char: emoji.char,
                });
            }
        }
        return out;
    }, [query, type, emojis]);

    // Chunk the flat entry list into fixed 8-wide rows so we can virtualize by row: the catalog runs
    // to thousands of icons/emoji and mounting them all was what made the popup lag.
    const rows = useMemo<Entry[][]>(() => {
        const out: Entry[][] = [];
        for (let i = 0; i < entries.length; i += COLUMNS) out.push(entries.slice(i, i + COLUMNS));
        return out;
    }, [entries]);

    const scrollRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 4,
    });

    // The Popup unmounts its content on close, so on reopen the virtualizer is left measuring a stale
    // (torn-down) scroll element and renders nothing. Re-measure the fresh element once it's laid out.
    useEffect(() => {
        if (!open) return undefined;
        const id = requestAnimationFrame(() => rowVirtualizer.measure());
        return () => cancelAnimationFrame(id);
    }, [open, rowVirtualizer]);

    useEffect(() => {
        scrollRef.current?.scrollTo({top: 0});
    }, [type]);

    const handleOpenChange = useCallback((next: boolean) => {
        setOpen(next);
        if (!next) setQuery('');
    }, []);

    const iconSize = useMemo(() => {
        switch (size) {
            case 'l':
                return 20;
            case 'm':
                return 16;
            default:
                return 14;
        }
    }, [size]);

    const resolved = resolveIcon(value);

    return (
        <>
            <Button
                ref={setAnchor}
                view="flat"
                size={size}
                disabled={disabled}
                className={`${className} icon-picker__button`}
                aria-label={value ? 'Change note icon' : 'Set note icon'}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((o) => !o);
                }}
            >
                {resolved.kind === 'emoji' ? (
                    <span className="icon-picker__emoji-container">
                        <span className="icon-picker__emoji" style={{fontSize: iconSize}}>
                            {resolved.char}
                        </span>
                    </span>
                ) : (
                    <Icon size={iconSize} data={resolved.data} />
                )}
            </Button>

            <Popup
                open={open}
                anchorElement={anchor}
                placement="bottom-start"
                onOpenChange={handleOpenChange}
                initialFocus={searchRef}
            >
                <div
                    className="icon-picker__popup"
                    role="presentation"
                    onClick={(e) => e.stopPropagation()}
                >
                    <TextInput
                        controlRef={searchRef}
                        placeholder="Search icons…"
                        value={query}
                        onUpdate={setQuery}
                        size="s"
                    />
                    <SegmentedRadioGroup
                        className="icon-picker__types"
                        value={type}
                        size="s"
                        onUpdate={(t: IconPickerType) => setType(t)}
                    >
                        <SegmentedRadioGroup.Option value="all">All</SegmentedRadioGroup.Option>
                        <SegmentedRadioGroup.Option value="icons">Icons</SegmentedRadioGroup.Option>
                        <SegmentedRadioGroup.Option value="emoji">Emoji</SegmentedRadioGroup.Option>
                    </SegmentedRadioGroup>
                    <div
                        ref={scrollRef}
                        className="icon-picker__grid"
                        role="listbox"
                        aria-label="Pick an icon"
                    >
                        <div
                            className="icon-picker__grid-inner"
                            style={{height: rowVirtualizer.getTotalSize()}}
                        >
                            {rowVirtualizer.getVirtualItems().map((virtualRow) => (
                                <div
                                    key={virtualRow.key}
                                    className="icon-picker__row"
                                    style={{transform: `translateY(${virtualRow.start}px)`}}
                                >
                                    {rows[virtualRow.index].map((entry) => (
                                        <Button
                                            key={entry.key}
                                            view={value === entry.value ? 'normal' : 'flat'}
                                            size="m"
                                            role="option"
                                            aria-selected={value === entry.value}
                                            title={entry.title}
                                            className="icon-picker__item"
                                            onClick={() => {
                                                onChange(entry.value);
                                                handleOpenChange(false);
                                            }}
                                        >
                                            {entry.kind === 'emoji' ? (
                                                <span className="icon-picker__emoji-container">
                                                    <span className="icon-picker__emoji">
                                                        {entry.char}
                                                    </span>
                                                </span>
                                            ) : (
                                                <Icon data={iconByName(entry.value)} size={16} />
                                            )}
                                        </Button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                    {value ? (
                        <Button
                            view="flat"
                            size="s"
                            width="max"
                            onClick={() => {
                                onChange('');
                                handleOpenChange(false);
                            }}
                        >
                            Remove icon
                        </Button>
                    ) : null}
                </div>
            </Popup>
        </>
    );
}
