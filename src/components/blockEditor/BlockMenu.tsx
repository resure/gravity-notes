import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent} from 'react';

import {OverlayPortal} from './OverlayPortal';
import {MENU_ITEMS} from './blockConfig';
import {DuplicateIcon, TrashIcon} from './icons';
import type {BlockColor, BlockType} from './types';

interface BlockMenuProps {
    /** VIEWPORT coordinates of the handle (the menu is `position: fixed`). */
    x: number;
    y: number;
    currentType: BlockType;
    currentColor?: BlockColor;
    onDelete: () => void;
    onDuplicate: () => void;
    onTurnInto: (type: BlockType) => void;
    onColor: (color: BlockColor) => void;
    onClose: () => void;
}

type MenuView = 'main' | 'turn' | 'color';

const COLOR_OPTIONS: Array<{value: BlockColor; label: string; swatch: string}> = [
    {value: 'default', label: 'Default', swatch: '#ffffff'},
    {value: 'gray', label: 'Gray text', swatch: '#787774'},
    {value: 'brown', label: 'Brown text', swatch: '#976d57'},
    {value: 'orange', label: 'Orange text', swatch: '#cc782f'},
    {value: 'yellow', label: 'Yellow text', swatch: '#c29343'},
    {value: 'green', label: 'Green text', swatch: '#548164'},
    {value: 'blue', label: 'Blue text', swatch: '#487ca5'},
    {value: 'purple', label: 'Purple text', swatch: '#8a67ab'},
    {value: 'pink', label: 'Pink text', swatch: '#b35488'},
    {value: 'red', label: 'Red text', swatch: '#c4554d'},
    {value: 'gray_background', label: 'Gray background', swatch: '#e7e5e4'},
    {value: 'brown_background', label: 'Brown background', swatch: '#eee0da'},
    {value: 'orange_background', label: 'Orange background', swatch: '#fadec9'},
    {value: 'yellow_background', label: 'Yellow background', swatch: '#fdecc8'},
    {value: 'green_background', label: 'Green background', swatch: '#dbeddb'},
    {value: 'blue_background', label: 'Blue background', swatch: '#d3e5ef'},
    {value: 'purple_background', label: 'Purple background', swatch: '#e8deee'},
    {value: 'pink_background', label: 'Pink background', swatch: '#f5e0e9'},
    {value: 'red_background', label: 'Red background', swatch: '#ffe2dd'},
];

export default function BlockMenu({
    x,
    y,
    currentType,
    currentColor = 'default',
    onDelete,
    onDuplicate,
    onTurnInto,
    onColor,
    onClose,
}: BlockMenuProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [view, setView] = useState<MenuView>('main');
    const [style, setStyle] = useState<CSSProperties>({left: x, top: y, visibility: 'hidden'});
    const currentItem = useMemo(
        () => MENU_ITEMS.find((item) => item.type === currentType),
        [currentType],
    );
    const currentColorItem =
        COLOR_OPTIONS.find((item) => item.value === currentColor) ?? COLOR_OPTIONS[0];

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        // Plain viewport clamping: flip above the handle when it would run off the bottom, slide
        // left when it would run off the right (see openSlashMenu in Editor.tsx for why fixed).
        let top = y;
        if (top + element.offsetHeight > window.innerHeight - 12) {
            top = Math.max(12, top - element.offsetHeight - 32);
        }
        const left = Math.max(12, Math.min(x, window.innerWidth - element.offsetWidth - 12));
        setStyle({left, top, visibility: 'visible'});
        window.requestAnimationFrame(() =>
            element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(),
        );
    }, [x, y, view]);

    useEffect(() => {
        const onMouseDown = (event: globalThis.MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) onClose();
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, [onClose]);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape' || (event.key === 'ArrowLeft' && view !== 'main')) {
            event.preventDefault();
            if (view === 'main') onClose();
            else setView('main');
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const buttons = [
            ...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
        ];
        const index = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
        const next =
            event.key === 'ArrowDown'
                ? (index + 1) % buttons.length
                : (index - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
    };

    const itemButton = (
        label: string,
        icon: React.ReactNode,
        action: () => void,
        hint?: string,
        selected = false,
    ) => (
        <button
            type="button"
            className={`menu-item${selected ? ' checked' : ''}`}
            role={selected ? 'menuitemradio' : 'menuitem'}
            aria-checked={selected || undefined}
            onClick={action}
        >
            <span className="menu-item-icon">{icon}</span>
            <span className="menu-item-label">{label}</span>
            {hint && <span className="menu-item-hint">{hint}</span>}
        </button>
    );

    // Portaled to <body> — see SlashMenu for why (a transformed ancestor captures
    // `position: fixed`, and the pane clips its overflow).
    return (
        <OverlayPortal>
            <div
                ref={ref}
                className="overlay-menu block-menu"
                style={style}
                role="menu"
                aria-label="Block actions"
                onKeyDown={onKeyDown}
            >
                {view === 'main' && (
                    <>
                        {itemButton('Delete', <TrashIcon />, onDelete, 'Del')}
                        {itemButton('Duplicate', <DuplicateIcon />, onDuplicate, '⌘D')}
                        <div className="menu-divider" />
                        {itemButton(
                            currentItem?.label ?? 'Turn into',
                            currentItem?.icon ?? <span>T</span>,
                            () => setView('turn'),
                            '›',
                        )}
                        {itemButton(
                            currentColorItem.label,
                            <span
                                className="menu-color-icon"
                                style={{background: currentColorItem.swatch}}
                            >
                                A
                            </span>,
                            () => setView('color'),
                            '›',
                        )}
                    </>
                )}

                {view === 'turn' && (
                    <>
                        {itemButton('Turn into', <span className="menu-back">‹</span>, () =>
                            setView('main'),
                        )}
                        <div className="menu-divider" />
                        {MENU_ITEMS.map((item) => (
                            <span key={item.type}>
                                {itemButton(
                                    item.label,
                                    item.icon,
                                    () => onTurnInto(item.type),
                                    item.type === currentType ? '✓' : undefined,
                                    item.type === currentType,
                                )}
                            </span>
                        ))}
                    </>
                )}

                {view === 'color' && (
                    <>
                        {itemButton('Color', <span className="menu-back">‹</span>, () =>
                            setView('main'),
                        )}
                        <div className="menu-divider" />
                        <div className="menu-section">Text color</div>
                        <div className="color-grid">
                            {COLOR_OPTIONS.slice(0, 10).map((color) => (
                                <button
                                    type="button"
                                    key={color.value}
                                    className={`color-swatch${currentColor === color.value ? ' selected' : ''}`}
                                    title={color.label}
                                    aria-label={color.label}
                                    aria-pressed={currentColor === color.value}
                                    onClick={() => onColor(color.value)}
                                >
                                    <span style={{color: color.swatch}}>A</span>
                                </button>
                            ))}
                        </div>
                        <div className="menu-section">Background color</div>
                        <div className="color-grid">
                            {COLOR_OPTIONS.slice(10).map((color) => (
                                <button
                                    type="button"
                                    key={color.value}
                                    className={`color-swatch${currentColor === color.value ? ' selected' : ''}`}
                                    title={color.label}
                                    aria-label={color.label}
                                    aria-pressed={currentColor === color.value}
                                    onClick={() => onColor(color.value)}
                                >
                                    <span style={{background: color.swatch}}>A</span>
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </OverlayPortal>
    );
}
