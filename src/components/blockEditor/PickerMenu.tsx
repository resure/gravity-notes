import {useRef, useState} from 'react';
import type {KeyboardEvent, ReactNode} from 'react';

import {OverlayPortal} from './OverlayPortal';
import {TickIcon} from './icons';
import {useAnchoredOverlay} from './useAnchoredOverlay';

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
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const {ref, style} = useAnchoredOverlay({
        x,
        y,
        onClose,
        // Whatever carries the keyboard takes focus: the filter box, or the menu itself.
        onPlaced: (element) => (inputRef.current ?? element).focus(),
    });

    const needle = query.trim().toLowerCase();
    const items = needle
        ? allItems.filter(
              (item) =>
                  item.label.toLowerCase().includes(needle) ||
                  item.value.toLowerCase().includes(needle),
          )
        : allItems;

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
                // The keys are handled here whether they start at the filter box or at the menu
                // itself — they bubble either way, so there is one handler rather than two wired by
                // a ternary that could disagree.
                tabIndex={-1}
                onKeyDown={onKeyDown}
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
                    />
                )}
                <div className="picker-list">
                    {items.map((item, index) => {
                        const isCurrent = item.value === (current ?? '');
                        return (
                            <button
                                type="button"
                                key={item.value || 'default'}
                                className={`menu-item${index === active ? ' active' : ''}`}
                                role="menuitemradio"
                                aria-checked={isCurrent}
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
                                {isCurrent && (
                                    <span className="menu-item-hint">
                                        <TickIcon />
                                    </span>
                                )}
                            </button>
                        );
                    })}
                    {items.length === 0 && <div className="menu-section">No match</div>}
                </div>
            </div>
        </OverlayPortal>
    );
}
