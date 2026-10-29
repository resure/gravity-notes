import type {ReactNode} from 'react';

import {Button} from '@gravity-ui/uikit';

import './ConflictBanner.css';

interface ConflictBannerProps {
    deleted: boolean;
    onReload: () => void;
    onKeepMine: () => void;
    onSaveAsCopy: () => void;
    onDiscard: () => void;
}

/**
 * Non-blocking banner shown when the open note changed (or was deleted) on disk outside the app.
 * Autosave is paused until the user picks a resolution, which is also why it has no dismiss of its
 * own: it describes the state of the file, so only resolving that state closes it.
 */
export function ConflictBanner({
    deleted,
    onReload,
    onKeepMine,
    onSaveAsCopy,
    onDiscard,
}: ConflictBannerProps) {
    if (deleted) {
        return (
            <Banner
                title="Deleted on disk"
                actions={[
                    ['Save as copy', onSaveAsCopy],
                    ['Discard', onDiscard],
                ]}
            >
                This note was deleted outside the app. Save your version as a copy, or discard it.
            </Banner>
        );
    }
    return (
        <Banner
            title="Changed on disk"
            actions={[
                ['Reload', onReload],
                ['Keep mine', onKeepMine],
                ['Save as copy', onSaveAsCopy],
            ]}
        >
            This note was modified outside the app. Reload the disk version, keep yours (overwrite),
            or save yours as a copy.
        </Banner>
    );
}

function Banner({
    title,
    actions,
    children,
}: {
    title: string;
    actions: [string, () => void][];
    children: ReactNode;
}) {
    return (
        <div className="conflict-banner" role="alert">
            <div className="conflict-banner__text">
                <div className="conflict-banner__title">{title}</div>
                <div className="conflict-banner__body">{children}</div>
            </div>
            <div className="conflict-banner__actions">
                {actions.map(([label, onClick]) => (
                    <Button key={label} view="flat" size="m" onClick={onClick}>
                        {label}
                    </Button>
                ))}
            </div>
        </div>
    );
}
