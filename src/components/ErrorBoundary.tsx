import {Component, type ErrorInfo, type ReactNode} from 'react';

import {Button} from '@gravity-ui/uikit';

import './ErrorBoundary.css';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    error: Error | null;
    componentStack: string | null;
}

/**
 * Catches render-time crashes so an unexpected component error degrades to a recoverable screen
 * instead of a blank page. Storage errors already surface via the toaster; this is the net for
 * everything else (e.g. a malformed note that breaks the editor). "Copy details" exists so a bug
 * report doesn't depend on retyping a stack from a screenshot.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return {error};
    }

    state: ErrorBoundaryState = {error: null, componentStack: null};

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error('Gravity Notes crashed:', error, info.componentStack);
        this.setState({componentStack: info.componentStack ?? null});
    }

    render(): ReactNode {
        const {error} = this.state;
        if (!error) return this.props.children;
        return (
            <div className="error-boundary">
                <div className="error-boundary__card">
                    <h1 className="error-boundary__title">Something broke while rendering</h1>
                    <p className="error-boundary__body">
                        Your notes are plain files on disk and are safe. Try again, or reload to
                        continue.
                    </p>
                    {error.message ? (
                        <pre className="error-boundary__detail">{error.message}</pre>
                    ) : null}
                    <div className="error-boundary__actions">
                        {/* Clear the caught error and re-render the tree: a transient crash can
                            recover without a full reload (losing in-flight state). */}
                        <Button
                            view="raised"
                            size="l"
                            onClick={() => this.setState({error: null, componentStack: null})}
                        >
                            Try again
                        </Button>
                        <Button view="flat" size="l" onClick={() => window.location.reload()}>
                            Reload
                        </Button>
                        <Button view="flat" size="l" onClick={this.copyDetails}>
                            Copy details
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    private copyDetails = () => {
        const {error, componentStack} = this.state;
        const text = [error?.stack ?? error?.message ?? 'Unknown error', componentStack]
            .filter(Boolean)
            .join('\n\n');
        void navigator.clipboard?.writeText(text).catch(() => {});
    };
}
