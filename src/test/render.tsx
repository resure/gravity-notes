import type {ReactElement, ReactNode} from 'react';

import {type RenderOptions, type RenderResult, render} from '@testing-library/react';

import {TooltipProvider} from '../ui/Tooltip';
import {ToastRegion} from '../ui/toast';

/**
 * The same two providers `App` mounts, and for the same reason: `toast()` needs a region to render
 * into, and tooltips need the shared delay. Theme is an attribute on `<html>`, so nothing wraps it.
 */
function Providers({children}: {children: ReactNode}) {
    return (
        <ToastRegion>
            <TooltipProvider>{children}</TooltipProvider>
        </ToastRegion>
    );
}

export function renderWithProviders(
    ui: ReactElement,
    options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
    return render(ui, {wrapper: Providers, ...options});
}
