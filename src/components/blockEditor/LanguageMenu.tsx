import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties} from 'react';

import {OverlayPortal} from './OverlayPortal';
import {filterLanguages} from './languages';

interface LanguageMenuProps {
    /** VIEWPORT coordinates of the button that opened it (the menu is `position: fixed`). */
    x: number;
    y: number;
    current: string | undefined;
    onPick: (token: string) => void;
    onClose: () => void;
}

/**
 * The code block's language picker. Filter box on top, because the list is long enough that arrowing
 * to Rust is worse than typing "ru" — which is also how the slash menu and the `[[` picker behave,
 * so the muscle memory carries.
 */
export default function LanguageMenu({x, y, current, onPick, onClose}: LanguageMenuProps) {
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [style, setStyle] = useState<CSSProperties>({left: x, top: y, visibility: 'hidden'});
    const items = filterLanguages(query);

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        // Same clamping as the block menu: flip above when it would run off the bottom, slide in
        // from the right edge.
        let top = y;
        if (top + element.offsetHeight > window.innerHeight - 12) {
            top = Math.max(12, top - element.offsetHeight - 24);
        }
        const left = Math.max(12, Math.min(x, window.innerWidth - element.offsetWidth - 12));
        setStyle({left, top, visibility: 'visible'});
        inputRef.current?.focus();
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

    return (
        <OverlayPortal>
            <div
                ref={ref}
                className="overlay-menu lang-menu"
                style={style}
                role="menu"
                aria-label="Code language"
            >
                <input
                    ref={inputRef}
                    className="lang-filter"
                    placeholder="Search languages"
                    aria-label="Search languages"
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setActive(0);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            // Handled, so EditorPane's Esc ladder doesn't also walk out of the body.
                            event.preventDefault();
                            onClose();
                        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault();
                            const step = event.key === 'ArrowDown' ? 1 : -1;
                            setActive((index) =>
                                items.length === 0
                                    ? 0
                                    : (index + step + items.length) % items.length,
                            );
                        } else if (event.key === 'Enter' && items[active]) {
                            event.preventDefault();
                            onPick(items[active].token);
                        }
                    }}
                />
                <div className="lang-list">
                    {items.map((item, index) => (
                        <button
                            type="button"
                            key={item.token || 'plain'}
                            className={`menu-item${index === active ? ' active' : ''}${
                                item.token === (current ?? '') ? ' checked' : ''
                            }`}
                            role="menuitemradio"
                            aria-checked={item.token === (current ?? '')}
                            // The filter box keeps focus; hovering only moves the highlight, so the
                            // keyboard and the mouse can't disagree about which row Enter takes.
                            onMouseEnter={() => setActive(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onPick(item.token)}
                        >
                            <span className="menu-item-label">{item.label}</span>
                            {item.token === (current ?? '') && (
                                <span className="menu-item-hint">✓</span>
                            )}
                        </button>
                    ))}
                    {items.length === 0 && <div className="menu-section">No match</div>}
                </div>
            </div>
        </OverlayPortal>
    );
}
