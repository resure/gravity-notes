import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties} from 'react';

import {dirname} from '../../storage/noteText';
import type {NoteMeta} from '../../storage/types';

import {OverlayPortal} from './OverlayPortal';
import type {MenuAnchor} from './SlashMenu';

export const WIKI_MENU_ID = 'gn-wiki-menu';
export const wikiOptionId = (index: number) => `wiki-option-${index}`;

/**
 * One row of the `[[` picker. A note, or the trailing "Create …" row the spec puts at the bottom
 * whenever the query doesn't already name an existing note.
 */
export type WikiSuggestItem = {kind: 'note'; note: NoteMeta} | {kind: 'create'; title: string};

/**
 * React key for the "Create …" row. A note's key is its rel-path, and no note id can be this, so the
 * two can never collide. Spelled as a named constant rather than a sentinel character: it was once a
 * literal NUL, which is legal in a string but makes git classify this whole file as BINARY — no diff,
 * no blame, invisible to grep and to code review.
 */
const CREATE_KEY = 'create-row';

interface WikiSuggestMenuProps {
    anchor: MenuAnchor;
    items: WikiSuggestItem[];
    activeIndex: number;
    onHover: (index: number) => void;
    onSelect: (item: WikiSuggestItem) => void;
    onClose: () => void;
}

/**
 * The `[[` note picker. Pure presentation: the editor owns the trigger, the ranked items
 * (`suggestWikiTargets`) and the keyboard; this renders the list at the caret and reports mouse
 * picks / outside clicks back.
 *
 * Positioned and portaled exactly like {@link SlashMenu} — VIEWPORT coordinates through
 * `OverlayPortal`, because the host pane scrolls, clips its overflow, and carries a `transform`
 * (which would otherwise re-anchor a `position: fixed` overlay to the pane and cut it off).
 */
export default function WikiSuggestMenu({
    anchor,
    items,
    activeIndex,
    onHover,
    onSelect,
    onClose,
}: WikiSuggestMenuProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<CSSProperties>({
        left: anchor.x,
        top: anchor.bottom + 5,
        visibility: 'hidden',
    });

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

    return (
        <OverlayPortal>
            <div
                ref={ref}
                id={WIKI_MENU_ID}
                className="overlay-menu wiki-suggest-menu"
                style={style}
                role="listbox"
                aria-label="Link to a note"
            >
                {items.map((item, i) => (
                    <div
                        key={item.kind === 'note' ? item.note.id : CREATE_KEY}
                        id={wikiOptionId(i)}
                        className={`menu-item${i === activeIndex ? ' active' : ''}`}
                        role="option"
                        aria-selected={i === activeIndex}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => onHover(i)}
                        onClick={() => onSelect(item)}
                    >
                        <div className="menu-item-copy">
                            <div className="menu-item-label">
                                {item.kind === 'note' ? item.note.title : `Create “${item.title}”`}
                            </div>
                            {item.kind === 'note' && dirname(item.note.id) ? (
                                <div className="menu-item-description">{dirname(item.note.id)}</div>
                            ) : null}
                        </div>
                    </div>
                ))}
            </div>
        </OverlayPortal>
    );
}
