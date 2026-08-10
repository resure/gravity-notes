import type {ReactElement, ReactNode} from 'react';

import {Tooltip as BaseTooltip} from '@base-ui/react/tooltip';

import './Tooltip.css';

/**
 * Tooltips: 26px tall, solid `--text-1`, 420ms before the first one and 0ms once a neighbour has
 * already shown one (§07). That second number is the whole point — a row of icon buttons should
 * explain itself as the pointer sweeps across it, not make you wait at each stop.
 *
 * Mount `TooltipProvider` once, at the app root; the shared delay lives there.
 */
export function TooltipProvider({children}: {children: ReactNode}) {
    return (
        <BaseTooltip.Provider delay={420} closeDelay={0}>
            {children}
        </BaseTooltip.Provider>
    );
}

export interface TooltipProps {
    /** The tooltip text, plus an optional keyboard hint rendered dimmer beside it. */
    label: ReactNode;
    hint?: ReactNode;
    children: ReactElement;
    side?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({label, hint, children, side = 'bottom'}: TooltipProps) {
    return (
        <BaseTooltip.Root>
            <BaseTooltip.Trigger render={children} />
            <BaseTooltip.Portal>
                <BaseTooltip.Positioner side={side} sideOffset={6} collisionPadding={8}>
                    <BaseTooltip.Popup className="ui-tooltip">
                        {label}
                        {hint ? <span className="ui-tooltip__hint">{hint}</span> : null}
                    </BaseTooltip.Popup>
                </BaseTooltip.Positioner>
            </BaseTooltip.Portal>
        </BaseTooltip.Root>
    );
}
