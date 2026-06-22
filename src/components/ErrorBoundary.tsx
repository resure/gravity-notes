import {Component, type ErrorInfo, type ReactNode} from 'react';

import {Button, Text} from '@gravity-ui/uikit';

import './ErrorBoundary.css';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    error: Error | null;
}

/**
 * Catches render-time crashes so an unexpected component error degrades to a recoverable screen
 * instead of a blank page. Storage errors already surface via the toaster; this is the net for
 * everything else (e.g. a malformed note that breaks the editor).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return {error};
    }

    state: ErrorBoundaryState = {error: null};

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error('Gravity Notes crashed:', error, info.componentStack);
    }

    render(): ReactNode {
        const {error} = this.state;
        if (!error) return this.props.children;
        return (
            <div className="error-boundary">
                <div className="error-boundary__card">
                    <Text variant="header-1">Something broke</Text>
                    <Text color="secondary">
                        Gravity Notes hit an unexpected error. Your notes are plain files on disk
                        and are safe. Reload to continue.
                    </Text>
                    {error.message ? (
                        <Text color="danger" className="error-boundary__detail">
                            {error.message}
                        </Text>
                    ) : null}
                    <div className="error-boundary__actions">
                        <Button view="action" size="l" onClick={() => window.location.reload()}>
                            Reload
                        </Button>
                    </div>
                </div>
            </div>
        );
    }
}
