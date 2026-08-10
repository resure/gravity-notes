import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties} from 'react';

import {OverlayPortal} from './OverlayPortal';
import type {MenuItemDef} from './blockConfig';

export interface MenuAnchor {
    /** VIEWPORT coordinates of the caret's line (the menu is `position: fixed`). */
    x: number;
    top: number;
    bottom: number;
}

interface SlashMenuProps {
    anchor: MenuAnchor;
    items: MenuItemDef[];
    activeIndex: number;
    onHover: (index: number) => void;
    onSelect: (item: MenuItemDef) => void;
    onClose: () => void;
}

export default function SlashMenu({
    anchor,
    items,
    activeIndex,
    onHover,
    onSelect,
    onClose,
}: SlashMenuProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<CSSProperties>({
        left: anchor.x,
        top: anchor.bottom + 5,
        visibility: 'hidden',
    });

    // Flip above the caret when the menu would run off the bottom, and slide it left when it would
    // run off the right. Both are plain viewport comparisons now that the menu is fixed-positioned.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        let top = anchor.bottom + 5;
        if (top + el.offsetHeight > window.innerHeight - 12) {
            top = Math.max(12, anchor.top - el.offsetHeight - 5);
        }
        const left = Math.max(12, Math.min(anchor.x, window.innerWidth - el.offsetWidth - 12));
        setStyle({left, top, visibility: 'visible'});
    }, [anchor, items.length]);

    useEffect(() => {
        const onMouseDown = (e: globalThis.MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, [onClose]);

    useEffect(() => {
        ref.current?.querySelector('.menu-item.active')?.scrollIntoView({block: 'nearest'});
    }, [activeIndex]);

    // Portaled to <body>: `position: fixed` is resolved against the nearest TRANSFORMED ancestor,
    // and the host's editor pane carries a `transform` (a WebKit repaint fix) — so rendering in
    // place would silently re-anchor the menu to the pane instead of the viewport, and the pane's
    // `overflow` would clip it. Out here, the viewport coordinates mean what they say.
    return (
        <OverlayPortal>
            <div
                ref={ref}
                className="overlay-menu slash-menu"
                style={style}
                role="listbox"
                aria-label="Block types"
            >
                {items.length > 0 ? (
                    <>
                        <div className="menu-section">Basic blocks</div>
                        {items.map((item, i) => (
                            <div
                                key={item.type}
                                id={`slash-option-${item.type}`}
                                className={`menu-item${i === activeIndex ? ' active' : ''}`}
                                role="option"
                                aria-selected={i === activeIndex}
                                onMouseDown={(e) => e.preventDefault()}
                                onMouseEnter={() => onHover(i)}
                                onClick={() => onSelect(item)}
                            >
                                <div className="menu-item-icon">{item.icon}</div>
                                <div className="menu-item-label">{item.label}</div>
                                {item.hint && <div className="menu-item-hint">{item.hint}</div>}
                            </div>
                        ))}
                    </>
                ) : (
                    <div className="menu-empty">No results</div>
                )}
            </div>
        </OverlayPortal>
    );
}
