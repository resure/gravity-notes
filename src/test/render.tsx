import type {ReactElement, ReactNode} from 'react';

import {MobileProvider, ThemeProvider, Toaster, ToasterProvider} from '@gravity-ui/uikit';
import {type RenderOptions, type RenderResult, render} from '@testing-library/react';

const toaster = new Toaster();

function Providers({children}: {children: ReactNode}) {
    return (
        <ThemeProvider theme="light">
            <MobileProvider>
                <ToasterProvider toaster={toaster}>{children}</ToasterProvider>
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
