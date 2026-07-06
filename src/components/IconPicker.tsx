import {
    memo,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent} from 'react';

import {Button, Icon, Popup, SegmentedRadioGroup, TextInput} from '@gravity-ui/uikit';
import type {ButtonProps} from '@gravity-ui/uikit';
import {defaultRangeExtractor, useVirtualizer} from '@tanstack/react-virtual';

import {useDebouncedValue} from '../hooks/useDebouncedValue';
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

type IconPickerType = 'all' | 'icons' | 'emoji';

/** Grid geometry: 8 columns, each row a 28px item + 6px gap. Kept in sync with IconPicker.css. */
const COLUMNS = 8;
const ROW_HEIGHT = 34;

/** A grid entry: a Gravity icon (keyed by component name) or an emoji (keyed/valued by its char). */
type Entry =
    | {kind: 'icon'; key: string; value: string; title: string}
    | {kind: 'emoji'; key: string; value: string; title: string; char: string};

export interface IconPickerButtonProps {
    /** The stored icon value this button displays (component name or emoji char). */
    value?: string;
    size?: ButtonProps['size'];
    disabled?: boolean;
    className?: string;
    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

/**
 * The glyph half of the picker: a flat button showing the resolved icon (File placeholder until the
 * catalog arrives). Standalone so a virtualized list can render one per row while sharing a single
 * {@link IconPickerPopup} — mounting a whole picker (popup + its own virtualizer) per row was a large
 * per-row render cost, and an open per-row popup died when its row left the virtual window.
 */
export function IconPickerButton({
    value,
    size = 'm',
    disabled,
    className,
    onClick,
}: IconPickerButtonProps) {
    const resolved = useIcon(value);
    const iconSize = size === 'l' ? 20 : size === 'm' ? 16 : 14;

    return (
        <Button
            view="flat"
            size={size}
            disabled={disabled}
            className={className ? `${className} icon-picker__button` : 'icon-picker__button'}
            aria-label={value ? 'Change note icon' : 'Set note icon'}
            onClick={onClick}
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
    );
}

export interface IconPickerPopupProps {
    /** The element the popup attaches to (the glyph button that opened it); null = closed. */
    anchorElement: HTMLElement | null;
    /** The current value — highlights the matching option and offers "Remove icon". */
    value?: string;
    onChange: (name: string) => void;
    /** Fired with `false` on every close path (pick, outside click, Escape). */
    onOpenChange: (open: boolean) => void;
}

/**
 * The popup half of the picker — controlled, so one instance can serve many
 * {@link IconPickerButton}s (the note list anchors it to whichever row's button opened it, the same
 * shared-instance pattern as its row action menu). Memoized: the note list re-renders on every
 * scroll of the virtual window, and with stable handlers the closed popup then costs nothing.
 */
export const IconPickerPopup = memo(function IconPickerPopup({
    anchorElement,
    value,
    onChange,
    onOpenChange,
}: IconPickerPopupProps) {
    // Open is the anchor's presence — one prop, so no caller can render an anchorless open popup.
    const open = anchorElement !== null;
    const [query, setQuery] = useState('');
    // Debounce the query that DRIVES filtering — the catalog is thousands of icons + emoji, so
    // re-filtering and re-virtualizing on every keystroke is wasteful. The input stays bound to the
    // live `query` for responsive typing; only the grid reads the settled value.
    const debouncedQuery = useDebouncedValue(query, 100);
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
        // Only an open picker builds its grid — while closed this shared instance costs nothing.
        if (!open) return [];
        const out: Entry[] = [];
        // In the "All" view, emoji come first, then the Gravity symbols.
        if (type !== 'icons' && emojis) {
            for (const emoji of filterEmojis(debouncedQuery, emojis)) {
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
            for (const icon of filterIcons(debouncedQuery, icons)) {
                out.push({
                    kind: 'icon',
                    key: icon.name,
                    value: icon.name,
                    title: icon.meta?.name ?? icon.name,
                });
            }
        }
        return out;
    }, [open, debouncedQuery, type, emojis, icons]);

    // Chunk the flat entry list into fixed 8-wide rows so we can virtualize by row: the catalog runs
    // to thousands of icons/emoji and mounting them all was what made the popup lag.
    const rows = useMemo<Entry[][]>(() => {
        const out: Entry[][] = [];
        for (let i = 0; i < entries.length; i += COLUMNS) out.push(entries.slice(i, i + COLUMNS));
        return out;
    }, [entries]);

    // The grid row holding the keyboard highlight. Forced to stay mounted below so the search box's
    // `aria-activedescendant` always points at a real element — a highlighted option scrolled out of
    // the virtual window would otherwise leave the attribute dangling at a torn-down id.
    const activeRow = activeIndex >= 0 ? Math.floor(activeIndex / COLUMNS) : -1;
    const scrollRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 4,
        // A fresh closure per render keeps `activeRow` current (matches NoteList's row list). The
        // window is a few sorted indexes, so the extra push + sort is free.
        rangeExtractor: (range) => {
            const indexes = defaultRangeExtractor(range);
            // Guard `< rows.length`: a query can shrink the grid a render before the roving
            // highlight resets (that reset is a post-commit effect), leaving `activeRow` past the
            // new list — pushing it would hand the virtualizer an out-of-range index and crash the
            // render (`measurements[i]` is undefined → `virtualRow.key` deref).
            if (activeRow >= 0 && activeRow < rows.length && !indexes.includes(activeRow)) {
                indexes.push(activeRow);
            }
            return indexes.sort((a, b) => a - b);
        },
    });

    // The Popup unmounts its content on close, so on reopen the virtualizer is left measuring a stale
    // (torn-down) scroll element and renders nothing. Re-measure the fresh element once it's laid out.
    useEffect(() => {
        if (!open) return undefined;
        const id = requestAnimationFrame(() => rowVirtualizer.measure());
        return () => cancelAnimationFrame(id);
    }, [open, rowVirtualizer]);

    // Plain scrollTop (not scrollTo) — jsdom implements only the property, and instant is wanted.
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [type]);

    // Reset the transient state on ANY close (outside click, Escape, pick, anchor-button toggle) so
    // the next open starts clean — one shared instance serves every note-list row, so a leftover
    // query, tab, grid scroll, or highlight would leak one note's picker state into another's. An
    // effect on `open` — not the change handler — so no close path (e.g. the anchor toggle, which
    // floating-ui excludes from outside-click dismissal) can skip it.
    useEffect(() => {
        if (!open) {
            setQuery('');
            setType('all');
            setActiveIndex(-1);
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
        }
    }, [open]);

    // Drop the highlight whenever the result set changes (new query/tab/catalog), so the index can't
    // dangle past the new `entries`.
    useEffect(() => {
        setActiveIndex(-1);
    }, [entries]);

    /** Commit a value (or '' = remove) and close — every pick path funnels through here. */
    const pick = (next: string) => {
        onChange(next);
        onOpenChange(false);
    };

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
                    pick(entries[activeIndex].value);
                }
                break;
            default:
                break;
        }
    };

    return (
        <Popup
            open={open}
            anchorElement={anchorElement}
            placement="bottom-start"
            onOpenChange={onOpenChange}
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
                    className="icon-picker__grid virtual-scroll"
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
                                            onClick={() => pick(entry.value)}
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
                    <Button view="flat" size="s" width="max" onClick={() => pick('')}>
                        Remove icon
                    </Button>
                ) : null}
            </div>
        </Popup>
    );
});

interface IconPickerProps {
    value?: string;
    onChange: (name: string) => void;
    size?: ButtonProps['size'];
    disabled?: boolean;
    className?: string;
}

/** The self-contained picker (button + its own popup) — for one-off spots like the note title. */
export function IconPicker({value, onChange, size = 'm', disabled, className}: IconPickerProps) {
    // The open popup's anchor (the glyph button, captured from the click event); null = closed.
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const onOpenChange = useCallback((next: boolean) => {
        if (!next) setAnchor(null);
    }, []);
    // Close the popup if the picker becomes disabled while it's open — e.g. toggling the note into
    // read-only preview mode (⌘⇧P) with the popup up. The disabled BUTTON only blocks opening; an
    // already-open popup would otherwise stay pickable and commit a change preview should forbid.
    useEffect(() => {
        if (disabled) setAnchor(null);
    }, [disabled]);
    return (
        <>
            <IconPickerButton
                value={value}
                size={size}
                disabled={disabled}
                className={className}
                onClick={(event) => {
                    event.stopPropagation();
                    // Toggle here because floating-ui excludes the anchor from outside-click
                    // dismissal — a click on the open picker's own button reaches this handler
                    // instead of onOpenChange. The popup resets its query/highlight on close.
                    const button = event.currentTarget;
                    setAnchor((current) => (current ? null : button));
                }}
            />
            <IconPickerPopup
                anchorElement={anchor}
                value={value}
                onChange={onChange}
                onOpenChange={onOpenChange}
            />
        </>
    );
}
