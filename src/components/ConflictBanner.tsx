import {Alert} from '@gravity-ui/uikit';

interface ConflictBannerProps {
    deleted: boolean;
    onReload: () => void;
    onKeepMine: () => void;
    onSaveAsCopy: () => void;
    onDiscard: () => void;
}

/**
 * Non-blocking banner shown when the open note changed (or was deleted) on disk
 * outside the app. Autosave is paused until the user picks a resolution.
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
            <Alert
                theme="warning"
                title="Deleted on disk"
                message="This note was deleted outside the app. Save your version as a copy, or discard it."
                actions={[
                    {text: 'Save as copy', handler: onSaveAsCopy},
                    {text: 'Discard', handler: onDiscard},
                ]}
            />
        );
    }
    return (
        <Alert
            theme="warning"
            title="Changed on disk"
            message="This note was modified outside the app. Reload the disk version, keep yours (overwrite), or save yours as a copy."
            actions={[
                {text: 'Reload', handler: onReload},
                {text: 'Keep mine', handler: onKeepMine},
                {text: 'Save as copy', handler: onSaveAsCopy},
            ]}
        />
    );
}
