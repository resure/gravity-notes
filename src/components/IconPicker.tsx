import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent} from 'react';

import {Button, Icon, Popup, SegmentedRadioGroup, TextInput} from '@gravity-ui/uikit';
import type {ButtonProps} from '@gravity-ui/uikit';
import {useVirtualizer} from '@tanstack/react-virtual';

import {
    type EmojiItem,
    type IconItem,
    type ResolvedIcon,
    filterEmojis,
    filterIcons,
    getIconCatalog,
    getIconCatalogVersion,
    iconByName,
    isComponentName,
    loadEmojis,
    loadIconCatalog,
    resolveIcon,
    subscribeIconCatalog,
} from '../icons';

import './IconPicker.css';

/**
 * Resolve a stored icon value for display, re-rendering once the lazily-loaded icon catalog arrives so a
 * component-name icon swaps its File placeholder → the real glyph. Emojis need no catalog (they render
 * immediately); a component-name value triggers the one-time catalog load.
 */
function useIcon(value?: string): ResolvedIcon {
    useSyncExternalStore(subscribeIconCatalog, getIconCatalogVersion, getIconCatalogVersion);
    const needsCatalog = Boolean(value && !getIconCatalog() && isComponentName(value));
    useEffect(() => {
        if (needsCatalog) void loadIconCatalog();
    }, [needsCatalog]);
    return resolveIcon(value);
}

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
    const [icons, setIcons] = useState<IconItem[] | null>(() => getIconCatalog()?.all ?? null);
    // Roving keyboard focus: index into `entries` of the highlighted grid item (-1 = none, focus in
    // search). Focus stays in the search box; arrows move this highlight (aria-activedescendant), Enter
    // picks it. Reset whenever the list changes so a stale index can't point past the new results.
    const [activeIndex, setActiveIndex] = useState(-1);
    const searchRef = useRef<HTMLInputElement>(null);
    const listId = useId();
    const optionId = (index: number) => `${listId}-opt-${index}`;

    // Lazily load the emoji + icon catalogs the first time the picker opens (keeps both out of the main
    // bundle). Each is memoized, so reopening is free.
    useEffect(() => {
        if (!open) return undefined;
        let cancelled = false;
        if (!emojis) {
            void loadEmojis().then((loaded) => {
                if (!cancelled) setEmojis(loaded);
            });
        }
        if (!icons) {
            void loadIconCatalog().then((catalog) => {
                if (!cancelled) setIcons(catalog.all);
            });
        }
        return () => {
            cancelled = true;
        };
    }, [open, emojis, icons]);

    const entries = useMemo<Entry[]>(() => {
        // Only the open picker's grid is built — a closed picker (e.g. one per note-list row) shouldn't
        // pay to assemble the ~1500-icon list.
        if (!open) return [];
        const out: Entry[] = [];
        // In the "All" view, emoji come first, then the Gravity symbols.
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
        if (type !== 'emoji' && icons) {
            for (const icon of filterIcons(query, icons)) {
                out.push({
                    kind: 'icon',
                    key: icon.name,
                    value: icon.name,
                    title: icon.meta?.name ?? icon.name,
                });
            }
        }
        return out;
    }, [open, query, type, emojis, icons]);

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

    // Drop the highlight whenever the result set changes (new query/tab/catalog), so the index can't
    // dangle past the new `entries`.
    useEffect(() => {
        setActiveIndex(-1);
    }, [entries]);

    const handleOpenChange = useCallback((next: boolean) => {
        setOpen(next);
        if (!next) {
            setQuery('');
            setActiveIndex(-1);
        }
    }, []);

    // Grid keyboard navigation, handled on the popup so it works while the search box keeps DOM focus.
    // Left/Right/Up stay as normal text editing until the user steps into the grid with ↓; from then on
    // the arrows rove the highlight and Enter commits it. Typing resets the list (and the highlight).
    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const count = entries.length;
        if (!count) return;
        const move = (to: number) => {
            event.preventDefault();
            const next = Math.max(0, Math.min(to, count - 1));
            setActiveIndex(next);
            rowVirtualizer.scrollToIndex(Math.floor(next / COLUMNS));
        };
        switch (event.key) {
            case 'ArrowDown':
                move(activeIndex < 0 ? 0 : activeIndex + COLUMNS);
                break;
            case 'ArrowRight':
                if (activeIndex >= 0) move(activeIndex + 1);
                break;
            case 'ArrowUp':
                if (activeIndex >= 0) move(activeIndex - COLUMNS);
                break;
            case 'ArrowLeft':
                if (activeIndex > 0) move(activeIndex - 1);
                break;
            case 'Enter':
                if (activeIndex >= 0 && entries[activeIndex]) {
                    event.preventDefault();
                    onChange(entries[activeIndex].value);
                    handleOpenChange(false);
                }
                break;
            default:
                break;
        }
    };

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

    const resolved = useIcon(value);

    return (
        <>
            <Button
                ref={setAnchor}
                view="flat"
                size={size}
                disabled={disabled}
                className={className ? `${className} icon-picker__button` : 'icon-picker__button'}
                aria-label={value ? 'Change note icon' : 'Set note icon'}
                onClick={(e) => {
                    e.stopPropagation();
                    // Toggle through handleOpenChange (not setOpen) so closing via the button also
                    // resets the query/highlight — floating-ui excludes the anchor from outside-click
                    // dismissal, so onOpenChange doesn't fire on this path and the search would persist.
                    handleOpenChange(!open);
                }}
            >
                {/* Button.Icon makes the button square + centers the glyph (Gravity's own icon-only
                    sizing), so we don't reach into its private CSS vars. */}
                <Button.Icon>
                    {resolved.kind === 'emoji' ? (
                        <span className="icon-picker__emoji" style={{fontSize: iconSize}}>
                            {resolved.char}
                        </span>
                    ) : (
                        <Icon size={iconSize} data={resolved.data} />
                    )}
                </Button.Icon>
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
                    // Grid navigation catches keys bubbling up from the focused search box (a combobox).
                    onKeyDown={onKeyDown}
                >
                    {/* Combobox pattern: focus stays in the search box, which owns the roving
                        aria-activedescendant over the listbox below. */}
                    <TextInput
                        controlRef={searchRef}
                        placeholder="Search icons…"
                        value={query}
                        onUpdate={setQuery}
                        size="s"
                        controlProps={{
                            role: 'combobox',
                            'aria-expanded': true,
                            'aria-controls': listId,
                            'aria-activedescendant':
                                activeIndex >= 0 ? optionId(activeIndex) : undefined,
                            'aria-autocomplete': 'list',
                        }}
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
                        id={listId}
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
                                    {rows[virtualRow.index].map((entry, colIndex) => {
                                        const index = virtualRow.index * COLUMNS + colIndex;
                                        return (
                                            <Button
                                                key={entry.key}
                                                id={optionId(index)}
                                                view={value === entry.value ? 'normal' : 'flat'}
                                                size="m"
                                                role="option"
                                                aria-selected={value === entry.value}
                                                title={entry.title}
                                                className={`icon-picker__item${index === activeIndex ? ' icon-picker__item_active' : ''}`}
                                                onClick={() => {
                                                    onChange(entry.value);
                                                    handleOpenChange(false);
                                                }}
                                            >
                                                <Button.Icon>
                                                    {entry.kind === 'emoji' ? (
                                                        <span className="icon-picker__emoji">
                                                            {entry.char}
                                                        </span>
                                                    ) : (
                                                        <Icon
                                                            data={iconByName(entry.value)}
                                                            size={16}
                                                        />
                                                    )}
                                                </Button.Icon>
                                            </Button>
                                        );
                                    })}
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
