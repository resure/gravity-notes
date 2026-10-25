import type {ReactElement, ReactNode, RefObject} from 'react';

import {Popover as BasePopover} from '@base-ui/react/popover';

import './popup.css';

export interface PopoverProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    trigger?: ReactElement;
    anchor?: Element | {getBoundingClientRect: () => DOMRect} | null;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
    width?: number;
    initialFocus?: RefObject<HTMLElement | null> | boolean;
    className?: string;
    children: ReactNode;
    /** Names the popup for assistive tech — it is a dialog, so it needs one. */
    'aria-label'?: string;
}

/**
 * A popover: the same floating material as a menu, but the content is arbitrary and the arrow keys
 * belong to whatever is inside it rather than to a row list.
 *
 * Note that Base UI gives the popup `role="dialog"`, which `useShortcuts` reads as "a modal owns the
 * keyboard" — global chords go quiet while one is open. That is the right behaviour for the pickers
 * this hosts, and it is why a popover is not the way to render a hover card.
 */
export function Popover({
    open,
    onOpenChange,
    trigger,
    anchor,
    side = 'bottom',
    align = 'end',
    sideOffset = 6,
    width,
    initialFocus,
    className,
    children,
    ...aria
}: PopoverProps) {
    return (
        <BasePopover.Root open={open} onOpenChange={onOpenChange}>
            {trigger ? <BasePopover.Trigger render={trigger} /> : null}
            <BasePopover.Portal>
                <BasePopover.Positioner
                    className="ui-pop-positioner"
                    anchor={anchor ?? undefined}
                    side={side}
                    align={align}
                    sideOffset={sideOffset}
                    collisionPadding={8}
                >
                    <BasePopover.Popup
                        {...aria}
                        className={`ui-pop${className ? ` ${className}` : ''}`}
                        style={width ? {width} : undefined}
                        initialFocus={initialFocus}
                    >
                        {children}
                    </BasePopover.Popup>
                </BasePopover.Positioner>
            </BasePopover.Portal>
        </BasePopover.Root>
    );
}
