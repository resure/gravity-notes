import {Button} from '../ui/Button';
import {Banner} from '../ui/bits';

interface ConflictBannerProps {
    deleted: boolean;
    onReload: () => void;
    onKeepMine: () => void;
    onSaveAsCopy: () => void;
    onDiscard: () => void;
}

/**
 * Non-blocking banner shown when the open note changed (or was deleted) on disk outside the app.
 * Autosave is paused until the user picks a resolution — which is also why the banner has no
 * dismiss of its own (§09): it describes the state of the file, so the only way to close it is to
 * resolve that state.
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
                tone="warning"
                title="Deleted on disk"
                actions={
                    <>
                        <Button onClick={onSaveAsCopy}>Save as copy</Button>
                        <Button onClick={onDiscard}>Discard</Button>
                    </>
                }
            >
                This note was deleted outside the app. Save your version as a copy, or discard it.
            </Banner>
        );
    }
    return (
        <Banner
            tone="warning"
            title="Changed on disk"
            actions={
                <>
                    <Button onClick={onReload}>Reload</Button>
                    <Button onClick={onKeepMine}>Keep mine</Button>
                    <Button onClick={onSaveAsCopy}>Save as copy</Button>
                </>
            }
        >
            This note was modified outside the app. Reload the disk version, keep yours (overwrite),
            or save yours as a copy.
        </Banner>
    );
}
