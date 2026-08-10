import type {ReactElement, ReactNode} from 'react';

import {MobileProvider, ThemeProvider, Toaster, ToasterProvider} from '@gravity-ui/uikit';
import {type RenderOptions, type RenderResult, render} from '@testing-library/react';

import {TooltipProvider} from '../ui/Tooltip';
import {ToastRegion} from '../ui/toast';

const toaster = new Toaster();

/**
 * The new providers are ADDED alongside the Gravity ones rather than replacing them: components
 * under test are mid-migration, and uikit's `useToaster` THROWS outside `ToasterProvider` while its
 * popups need `ThemeProvider` to portal. The three Gravity providers leave in Pass 5, with the last
 * uikit import.
 */
function Providers({children}: {children: ReactNode}) {
    return (
        <ThemeProvider theme="light">
            <MobileProvider>
                <ToasterProvider toaster={toaster}>
                    <ToastRegion>
                        <TooltipProvider>{children}</TooltipProvider>
                    </ToastRegion>
                </ToasterProvider>
            </MobileProvider>
        </ThemeProvider>
    );
}

export function renderWithProviders(
    ui: ReactElement,
    options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
    return render(ui, {wrapper: Providers, ...options});
}
