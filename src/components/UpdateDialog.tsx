import {useMemo} from 'react';

import transform from '@diplodoc/transform';

import type {AppUpdater, UpdaterStatus} from '../hooks/useAppUpdater';
import {Button} from '../ui/Button';
import {Dialog} from '../ui/Dialog';
import {Progress} from '../ui/Progress';

import './UpdateDialog.css';

export interface UpdateDialogProps {
    open: boolean;
    /** The shared updater handle (owned by Workspace). */
    updater: AppUpdater;
    onClose: () => void;
}

/** Compact size label for the download line, e.g. "12.3 MB". */
function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(1)} ${units[unit]}`;
}

/** Dialog title by phase. A failed check reads gently; only a failed install is an "Update failed". */
function captionFor(status: UpdaterStatus, errorContext: AppUpdater['errorContext']): string {
    if (status === 'available') return 'Update available';
    if (status === 'downloading') return 'Updating Sol';
    if (status === 'installed' || status === 'restart-required') return 'Update installed';
    if (status === 'error') return errorContext === 'check' ? 'Check for updates' : 'Update failed';
    return 'Software update';
}

/**
 * The state-specific dialog body — checking, an available version (with release notes), download
 * progress, the post-install restart, "you're up to date", and errors. Split out of
 * {@link UpdateDialog} so each piece stays simple; reads everything from the {@link AppUpdater} handle.
 */
function UpdateBody({updater}: {updater: AppUpdater}) {
    const {status, info, progress, error, upToDate, currentVersion} = updater;
    const downloading = status === 'downloading';
    const installed = status === 'installed';
    const showVersion = info && (status === 'available' || downloading || installed);

    return (
        <div className="update-dialog">
            {status === 'checking' ? <Waiting label="Checking for updates…" /> : null}

            {status === 'idle' && upToDate ? (
                <p className="update-dialog__line">
                    You’re up to date{currentVersion ? ` (v${currentVersion})` : ''}.
                </p>
            ) : null}

            {showVersion ? (
                <>
                    <p className="update-dialog__version">Sol v{info.version}</p>
                    <p className="update-dialog__sub">You have v{info.currentVersion}.</p>
                    {info.notes ? <ReleaseNotes notes={info.notes} /> : null}
                </>
            ) : null}

            {downloading ? <DownloadProgress progress={progress} /> : null}

            {installed ? <Waiting label="Installed — restarting…" /> : null}

            {status === 'restart-required' ? (
                <p className="update-dialog__line">
                    Update installed. Quit and reopen Sol to finish.
                </p>
            ) : null}

            {status === 'error' && error ? <p className="update-dialog__error">{error}</p> : null}
        </div>
    );
}

/**
 * Render the release's Markdown notes as HTML (GitHub release body / changelog), via the same
 * `@diplodoc/transform` the note preview uses — so a bulleted changelog reads as a list, not raw
 * `- ` text. The transform escapes raw HTML and sanitizes by default; the `.yfm` class picks up the
 * globally-loaded YFM typography. Falls back to plain pre-wrapped text if the transform throws.
 */
function ReleaseNotes({notes}: {notes: string}) {
    const html = useMemo(() => {
        try {
            return transform(notes).result.html;
        } catch {
            return null;
        }
    }, [notes]);
    if (html === null) {
        return <div className="update-dialog__notes update-dialog__notes_plain">{notes}</div>;
    }
    return <div className="update-dialog__notes yfm" dangerouslySetInnerHTML={{__html: html}} />;
}

/** An indeterminate wait: a sweeping bar with a line under it, in place of §09's banished spinner. */
function Waiting({label}: {label: string}) {
    return (
        <div className="update-dialog__progress">
            <Progress value={null} aria-label={label} />
            <p className="update-dialog__sub">{label}</p>
        </div>
    );
}

/** Download line: a determinate bar with byte counts, or an indeterminate one if size is unknown. */
function DownloadProgress({progress}: {progress: AppUpdater['progress']}) {
    if (progress && progress.total !== null && progress.total > 0) {
        const percent = Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
        return (
            <div className="update-dialog__progress">
                <Progress value={percent} aria-label="Download progress" />
                <p className="update-dialog__sub">
                    {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
                </p>
            </div>
        );
    }
    return (
        <Waiting label={`Downloading${progress ? ` ${formatBytes(progress.downloaded)}` : ''}…`} />
    );
}

/**
 * The software-update sheet. Opening + closing is owned by `Workspace` (`open`/`onClose`); the
 * underlying updater state persists in the hook, so content stays put through the close animation
 * without a held copy. "Install & Relaunch" is offered only while an update is available.
 */
export function UpdateDialog({open, updater, onClose}: UpdateDialogProps) {
    const {status, errorContext, check, install} = updater;
    // Downloading/installing can't be cancelled (the bundle swap + relaunch run to completion), so the
    // dialog is non-dismissible then — a "Close" that didn't actually stop the restart would mislead.
    // It returns to dismissible once done (restart-required / error / up-to-date).
    const busy = status === 'downloading' || status === 'installed';
    const isError = status === 'error';

    // Apply button: install when available, or retry the failed step on error — a failed install
    // keeps the Update handle so retry re-installs; a failed check re-checks.
    let applyLabel: string | undefined;
    if (status === 'available') applyLabel = 'Install & Relaunch';
    else if (isError) applyLabel = 'Try again';

    let cancelLabel: string | undefined = 'Close';
    if (busy) cancelLabel = undefined;
    else if (status === 'available') cancelLabel = 'Later';

    const onApply = () => {
        if (status === 'available') void install();
        else if (isError) void (errorContext === 'install' ? install() : check());
    };

    return (
        <Dialog
            open={open}
            // No-op the close request while busy so Esc / the backdrop can't dismiss it.
            onClose={busy ? () => {} : onClose}
            title={captionFor(status, errorContext)}
            width={480}
            footer={
                <>
                    {cancelLabel ? <Button onClick={onClose}>{cancelLabel}</Button> : null}
                    {applyLabel ? (
                        <Button variant="raised" onClick={onApply}>
                            {applyLabel}
                        </Button>
                    ) : null}
                </>
            }
        >
            <UpdateBody updater={updater} />
        </Dialog>
    );
}
