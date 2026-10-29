import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties, ReactNode} from 'react';

interface WikiLinkTipProps {
    x: number;
    y: number;
    anchorTop: number;
    label: string;
    layoutKey: string;
    activeIndex?: number;
    children: ReactNode;
}

export default function WikiLinkTip({
    x,
    y,
    anchorTop,
    label,
    layoutKey,
    activeIndex,
    children,
}: WikiLinkTipProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<CSSProperties>({left: x, top: y, visibility: 'hidden'});

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        const previousMaxHeight = element.style.maxHeight;
        element.style.maxHeight = '';
        const height = element.offsetHeight;
        element.style.maxHeight = previousMaxHeight;
        const below = Math.max(0, window.innerHeight - y - 12);
        const above = Math.max(0, anchorTop - 6 - 12);
        const flip = height > below && above > below;
        const maxHeight = Math.min(height, flip ? above : below);
        const top = flip ? Math.max(12, anchorTop - 6 - maxHeight) : Math.max(12, y);
        const left = Math.max(12, Math.min(x, window.innerWidth - element.offsetWidth - 12));
        setStyle({left, top, maxHeight, visibility: 'visible'});
    }, [x, y, anchorTop, layoutKey]);

    useEffect(() => {
        ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block: 'nearest'});
    }, [activeIndex]);

    return (
        <div
            ref={ref}
            className="overlay-menu wiki-tip"
            style={style}
            role="toolbar"
            aria-label={label}
            onMouseDown={(event) => {
                if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
            }}
        >
            {children}
        </div>
    );
}
