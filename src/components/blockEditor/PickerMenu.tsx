import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent, ReactNode} from 'react';

import {OverlayPortal} from './OverlayPortal';
import {TickIcon} from './icons';

export interface PickerItem {
    /** What gets stored — a fence's info string, a callout's kind. */
    value: string;
    label: string;
    icon?: ReactNode;
}

interface PickerMenuProps {
    /** VIEWPORT coordinates of the button that opened it (the menu is `position: fixed`). */
    x: number;
    y: number;
    current: string | undefined;
    items: PickerItem[];
    /** Names the menu for assistive tech, and its filter box when it has one. */
    label: string;
    /** Add a filter box, for a list long enough that typing "ru" beats arrowing to Rust. */
    filterable?: boolean;
    onPick: (value: string) => void;
    onClose: () => void;
}

/**
 * The small "pick one of these" overlay a block's own controls open — a code block's language, a
 * callout's kind. Shared rather than written per control: the fiddly parts (viewport clamping,
 * dismissal on outside-click/scroll/resize, the keyboard) are identical each time, and they are
 * where the bugs live.
 */
export default function PickerMenu({
    x,
    y,
    current,
    items: allItems,
    label,
    filterable = false,
    onPick,
    onClose,
}: PickerMenuProps) {
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [style, setStyle] = useState<CSSProperties>({left: x, top: y, visibility: 'hidden'});

    const needle = query.trim().toLowerCase();
    const items = needle
        ? allItems.filter(
              (item) =>
                  item.label.toLowerCase().includes(needle) ||
                  item.value.toLowerCase().includes(needle),
          )
        : allItems;

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        // Same clamping as the block menu: flip above the button when it would run off the bottom,
        // slide in from the right edge.
        let top = y;
        if (top + element.offsetHeight > window.innerHeight - 12) {
            top = Math.max(12, top - element.offsetHeight - 24);
        }
        const left = Math.max(12, Math.min(x, window.innerWidth - element.offsetWidth - 12));
        setStyle({left, top, visibility: 'visible'});
        // Whatever carries the keyboard takes focus: the filter box, or the menu itself.
        (inputRef.current ?? element).focus();
    }, [x, y]);

    useEffect(() => {
        const onMouseDown = (event: globalThis.MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) onClose();
        };
        // Anchored to a button measured once, with nothing to follow — scrolling IS a dismissal,
        // exactly as for the block menu. Its own list is exempt.
        const onScroll = (event: Event) => {
            const target = event.target;
            if (target instanceof Node && ref.current?.contains(target)) return;
            onClose();
        };
        document.addEventListener('mousedown', onMouseDown);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onClose);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onClose);
        };
    }, [onClose]);

    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Escape') {
            // Marked handled, so EditorPane's Esc ladder doesn't also walk out of the body.
            event.preventDefault();
            onClose();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((index) =>
                items.length === 0 ? 0 : (index + step + items.length) % items.length,
            );
        } else if (event.key === 'Enter' && items[active]) {
            event.preventDefault();
            onPick(items[active].value);
        }
    };

    return (
        <OverlayPortal>
            <div
                ref={ref}
                className="overlay-menu picker-menu"
                style={style}
                role="menu"
                aria-label={label}
                tabIndex={filterable ? undefined : -1}
                onKeyDown={filterable ? undefined : onKeyDown}
            >
                {filterable && (
                    <input
                        ref={inputRef}
                        className="picker-filter"
                        placeholder={`Search ${label.toLowerCase()}`}
                        aria-label={`Search ${label.toLowerCase()}`}
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setActive(0);
                        }}
                        onKeyDown={onKeyDown}
                    />
                )}
                <div className="picker-list">
                    {items.map((item, index) => (
                        <button
                            type="button"
                            key={item.value || 'default'}
                            className={`menu-item${index === active ? ' active' : ''}`}
                            role="menuitemradio"
                            aria-checked={item.value === (current ?? '')}
                            // Focus stays where the keys are; hovering only moves the highlight, so
                            // the mouse and the keyboard can't disagree about what Enter takes.
                            onMouseEnter={() => setActive(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onPick(item.value)}
                        >
                            {item.icon !== undefined && (
                                <span className="menu-item-icon">{item.icon}</span>
                            )}
                            <span className="menu-item-label">{item.label}</span>
                            {item.value === (current ?? '') && (
                                <span className="menu-item-hint">
                                    <TickIcon />
                                </span>
                            )}
                        </button>
                    ))}
                    {items.length === 0 && <div className="menu-section">No match</div>}
                </div>
            </div>
        </OverlayPortal>
    );
}
