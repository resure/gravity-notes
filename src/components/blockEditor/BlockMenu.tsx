import {useMemo, useState} from 'react';
import type {KeyboardEvent} from 'react';

import {OverlayPortal} from './OverlayPortal';
import {COLOR_OPTIONS, ColorPalette} from './blockColors';
import {MENU_ITEMS} from './blockConfig';
import {ChevronLeftIcon, ChevronRightIcon, DuplicateIcon, TickIcon, TrashIcon} from './icons';
import type {BlockColor, BlockType} from './types';
import {useAnchoredOverlay} from './useAnchoredOverlay';

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
    const [view, setView] = useState<MenuView>('main');
    const {ref, style} = useAnchoredOverlay({
        x,
        y,
        flipGap: 32,
        // A page swap changes the menu's height, so it has to be placed again.
        remeasureKey: view,
        onClose,
        onPlaced: (element) =>
            window.requestAnimationFrame(() =>
                element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(),
            ),
    });
    const currentItem = useMemo(
        () => MENU_ITEMS.find((item) => item.type === currentType),
        [currentType],
    );
    const currentColorItem =
        COLOR_OPTIONS.find((item) => item.value === currentColor) ?? COLOR_OPTIONS[0];

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape' || (event.key === 'ArrowLeft' && view !== 'main')) {
            // Marks it handled for EditorPane's Esc ladder, which skips a handled Escape. The
            // editor's block-selection listener — which captures on `document`, ahead of React —
            // yields to anything inside an overlay (see `ownsDocumentEvent`), so this keystroke is
            // the menu's alone: closing a submenu no longer steps the selection out to the note
            // list on the way.
            event.preventDefault();
            if (view === 'main') onClose();
            else setView('main');
            return;
        }
        // The rows print `Del` and `⌘D`, and while this menu is open it is the one that has to make
        // them work: the editor's block-selection listener yields to overlays now (it was eating
        // the arrows below). Only on the main page, where those rows are the ones on screen.
        if (view === 'main' && event.key === 'Delete') {
            event.preventDefault();
            onDelete();
            return;
        }
        if (
            view === 'main' &&
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === 'd'
        ) {
            event.preventDefault();
            onDuplicate();
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        // The pane reads a bubbled ArrowUp as "caret left the top of the body" and jumps to the note
        // title; stop it so the arrows stay with the menu they are driving.
        event.stopPropagation();
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
        hint?: React.ReactNode,
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
                            <ChevronRightIcon />,
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
                            <ChevronRightIcon />,
                        )}
                    </>
                )}

                {view === 'turn' && (
                    <>
                        {itemButton('Turn into', <ChevronLeftIcon />, () => setView('main'))}
                        <div className="menu-divider" />
                        {MENU_ITEMS.map((item) => (
                            <span key={item.type}>
                                {itemButton(
                                    item.label,
                                    item.icon,
                                    () => onTurnInto(item.type),
                                    item.type === currentType ? <TickIcon /> : undefined,
                                    item.type === currentType,
                                )}
                            </span>
                        ))}
                    </>
                )}

                {view === 'color' && (
                    <>
                        {itemButton('Color', <ChevronLeftIcon />, () => setView('main'))}
                        <div className="menu-divider" />
                        <ColorPalette current={currentColor} onPick={onColor} />
                    </>
                )}
            </div>
        </OverlayPortal>
    );
}
