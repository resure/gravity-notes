import {forwardRef} from 'react';
import type {
    HTMLAttributes,
    ReactElement,
    MouseEvent as ReactMouseEvent,
    ReactNode,
    RefObject,
} from 'react';

import {Menu as BaseMenu} from '@base-ui/react/menu';

import {ChevronRight} from './icons';

import './popup.css';

/**
 * The app's menus: Base UI's behaviour, the §07 material, one wrapper.
 *
 * Two things about the shape of this API are deliberate.
 *
 * **Anchoring, not triggering.** A menu can be driven either by a `trigger` element (the Orb, the
 * note ⋯) or by an `anchor` — a DOM element OR a zero-size rect at the cursor. The note list and the
 * folder rail use the second form for a reason that outlives the redesign: at three thousand rows,
 * mounting a menu per row (and rebuilding its item array) is real work, so both panes keep ONE menu
 * instance and move its anchor. A right-click sets the anchor to the pointer, which is what
 * "ContextMenu at the cursor" means here — and, per §05, it must NOT move the selection, which a
 * trigger-per-row would make easy to get wrong.
 *
 * **Focus goes back where it came from.** §12 calls this out: every menu returns focus to the row
 * that opened it, never to the body. With a `trigger` Base UI does that for us; with a bare `anchor`
 * there is nothing to return to, so callers pass `finalFocus`.
 */

export interface MenuProps {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** The element that opens the menu (Base UI wires press/keyboard/aria onto it). */
    trigger?: ReactElement;
    /** Position against this element or virtual rect instead of a trigger. */
    anchor?: Element | {getBoundingClientRect: () => DOMRect} | null;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
    alignOffset?: number;
    /** Fixed popup width; menus otherwise size to their longest row. */
    width?: number;
    /** Where focus lands on close — required when the menu is anchored rather than triggered. */
    finalFocus?: RefObject<HTMLElement | null> | boolean;
    className?: string;
    children: ReactNode;
}

export function Menu({
    open,
    defaultOpen,
    onOpenChange,
    trigger,
    anchor,
    side = 'bottom',
    align = 'start',
    sideOffset = 6,
    alignOffset = 0,
    width,
    finalFocus,
    className,
    children,
}: MenuProps) {
    return (
        <BaseMenu.Root
            open={open}
            defaultOpen={defaultOpen}
            onOpenChange={(next) => onOpenChange?.(next)}
            // Non-modal: the app is a three-pane shell with a live editor behind every menu, and a
            // modal menu locks document scroll — a menu opened over the note list would freeze it.
            modal={false}
        >
            {trigger ? <BaseMenu.Trigger render={trigger} /> : null}
            <BaseMenu.Portal>
                <BaseMenu.Positioner
                    className="ui-pop-positioner"
                    anchor={anchor ?? undefined}
                    side={side}
                    align={align}
                    sideOffset={sideOffset}
                    alignOffset={alignOffset}
                    collisionPadding={8}
                >
                    <BaseMenu.Popup
                        className={`ui-pop ui-pop_menu${className ? ` ${className}` : ''}`}
                        style={width ? {width} : undefined}
                        finalFocus={finalFocus}
                    >
                        {children}
                    </BaseMenu.Popup>
                </BaseMenu.Positioner>
            </BaseMenu.Portal>
        </BaseMenu.Root>
    );
}

export interface MenuItemProps extends Omit<
    HTMLAttributes<HTMLDivElement>,
    'onClick' | 'children'
> {
    /** 16px glyph. Omit to leave the icon column empty — it is always reserved. */
    icon?: ReactNode;
    children: ReactNode;
    /** Right-aligned keyboard hint (or any trailing note, e.g. the Theme row's current value). */
    hint?: ReactNode;
    /** The single destructive item, below an inset divider. */
    danger?: boolean;
    disabled?: boolean;
    /** Keep the menu open after activation (used by items that toggle state in place). */
    keepOpen?: boolean;
    /**
     * Click handler. The event carries the modifier flags for chords like ⌘-click "open in a new
     * window" — Base UI activates an item with a real click for both pointer and Enter, so one
     * handler covers mouse and keyboard.
     */
    onClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
    className?: string;
    /** Accessible label when `children` is not plain text. */
    label?: string;
}

export const MenuItem = forwardRef<HTMLDivElement, MenuItemProps>(function MenuItem(
    {icon, children, hint, danger, disabled, keepOpen, onClick, className, label, ...rest},
    ref,
) {
    return (
        <BaseMenu.Item
            {...rest}
            ref={ref}
            className={`ui-pop__item${danger ? ' ui-pop__item_danger' : ''}${
                className ? ` ${className}` : ''
            }`}
            disabled={disabled}
            closeOnClick={!keepOpen}
            label={label}
            onClick={onClick}
        >
            <span className="ui-pop__icon ui-pop__icon_empty">{icon}</span>
            <span className="ui-pop__label">{children}</span>
            {hint ? <span className="ui-pop__hint">{hint}</span> : null}
        </BaseMenu.Item>
    );
});

export function MenuSeparator() {
    return <BaseMenu.Separator className="ui-pop__separator" />;
}

export function MenuGroupLabel({children}: {children: ReactNode}) {
    return <BaseMenu.GroupLabel className="ui-pop__group-label">{children}</BaseMenu.GroupLabel>;
}

export function MenuGroup({children}: {children: ReactNode}) {
    return <BaseMenu.Group>{children}</BaseMenu.Group>;
}

/**
 * Arbitrary content inside a menu — the note menu's Font / Width strips. `inert`-by-focus: the
 * wrapper is not a menu item, so the arrow keys walk straight past it (§07: "wrap the strips in a
 * non-focusable group so they stay out of the arrow-key ring"). The controls inside are still
 * reachable by Tab and by pointer, and commit live behind the open menu.
 */
export function MenuPanel({label, children}: {label?: string; children: ReactNode}) {
    return (
        <div className="ui-pop__panel">
            {label ? <div className="ui-pop__panel-label">{label}</div> : null}
            {children}
        </div>
    );
}

export interface MenuSubProps {
    icon?: ReactNode;
    label: ReactNode;
    /** Trailing value shown on the parent row (e.g. Theme → "System"). */
    hint?: ReactNode;
    children: ReactNode;
    width?: number;
}

/** A submenu: same row material, same popup material, opened by hover / → / Enter. */
export function MenuSub({icon, label, hint, children, width}: MenuSubProps) {
    return (
        <BaseMenu.SubmenuRoot>
            <BaseMenu.SubmenuTrigger className="ui-pop__item">
                <span className="ui-pop__icon ui-pop__icon_empty">{icon}</span>
                <span className="ui-pop__label">{label}</span>
                {hint ? <span className="ui-pop__hint">{hint}</span> : null}
                <ChevronRight size={12} className="ui-pop__chevron" />
            </BaseMenu.SubmenuTrigger>
            <BaseMenu.Portal>
                <BaseMenu.Positioner
                    className="ui-pop-positioner"
                    side="right"
                    align="start"
                    sideOffset={4}
                    collisionPadding={8}
                >
                    <BaseMenu.Popup
                        className="ui-pop ui-pop_menu"
                        style={width ? {width} : undefined}
                    >
                        {children}
                    </BaseMenu.Popup>
                </BaseMenu.Positioner>
            </BaseMenu.Portal>
        </BaseMenu.SubmenuRoot>
    );
}
