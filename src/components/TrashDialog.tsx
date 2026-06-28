import {useEffect, useState} from 'react';

import {ArrowRotateLeft, Folder, TrashBin} from '@gravity-ui/icons';
import {Button, Dialog, Icon, Spin, Text} from '@gravity-ui/uikit';

import {formatCrumb} from '../storage/noteText';
import type {TrashedNote} from '../storage/types';

import './TrashDialog.css';

export interface TrashDialogProps {
    open: boolean;
    /** The trashed-notes display list (from useNotes), newest-deleted first. */
    notes: TrashedNote[];
    /** Reload the list from the store (called when the dialog opens). Resolves once loaded. */
    onRefresh: () => Promise<void>;
    /** Restore a trashed note to its original folder. */
    onRestore: (trashId: string) => void;
    /** Permanently delete one trashed note. */
    onPurge: (trashId: string) => void;
    /** Permanently delete every trashed note. */
    onEmpty: () => void;
    onClose: () => void;
}

/** A queued irreversible action awaiting confirmation. */
type Pending = {kind: 'purge'; id: string; title: string} | {kind: 'empty'} | null;

/**
 * Compact "deleted X ago" relative time. A non-positive/unknown stamp (orphan, no recorded time)
 * reads as "recently" rather than the bogus ~56-years-ago that epoch-0 would otherwise produce.
 */
function formatAgo(ts: number): string {
    if (!ts || ts <= 0) return 'recently';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
    const mo = Math.floor(day / 30);
    if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
    const yr = Math.floor(mo / 12);
    return `${yr} year${yr === 1 ? '' : 's'} ago`;
}

/**
 * The Trash bin: lists soft-deleted notes (title, the folder they came from, and how long ago they
 * were deleted) and lets the user Restore one to its original folder, permanently delete one, or
 * empty the whole Trash. Deletes are irreversible, so both Delete and Empty are confirmed; Restore
 * isn't (it's safe). The list + actions live in `useNotes`; this is presentation only.
 */
export function TrashDialog({
    open,
    notes,
    onRefresh,
    onRestore,
    onPurge,
    onEmpty,
    onClose,
}: TrashDialogProps) {
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState<Pending>(null);

    useEffect(() => {
        if (!open) {
            setPending(null);
            return undefined;
        }
        let alive = true;
        setLoading(true);
        void onRefresh().finally(() => {
            if (alive) setLoading(false);
        });
        return () => {
            alive = false;
        };
    }, [open, onRefresh]);

    const confirmPending = () => {
        if (pending?.kind === 'purge') onPurge(pending.id);
        else if (pending?.kind === 'empty') onEmpty();
        setPending(null);
    };

    return (
        <>
            <Dialog open={open} onClose={onClose} size="m" disableBodyScrollLock>
                <Dialog.Header caption="Trash" />
                <Dialog.Body>
                    {loading ? (
                        <div className="trash__center">
                            <Spin />
                        </div>
                    ) : notes.length === 0 ? (
                        <div className="trash__center">
                            <Text color="secondary">
                                Trash is empty. Deleted notes land here, ready to restore.
                            </Text>
                        </div>
                    ) : (
                        <>
                            <div className="trash__toolbar">
                                <Text color="secondary" variant="caption-2">
                                    {notes.length} note{notes.length === 1 ? '' : 's'} · restore to
                                    recover, or delete permanently
                                </Text>
                            </div>
                            <div className="trash__list">
                                {notes.map((note) => {
                                    const crumb = formatCrumb(note.originalPath);
                                    return (
                                        <div className="trash__row" key={note.id}>
                                            <div className="trash__meta">
                                                <Text
                                                    className="trash__name"
                                                    ellipsis
                                                    title={note.title}
                                                >
                                                    {note.title || 'Untitled'}
                                                </Text>
                                                <div className="trash__sub">
                                                    {crumb ? (
                                                        <span className="trash__folder">
                                                            <Icon
                                                                data={Folder}
                                                                size={12}
                                                                aria-hidden
                                                            />
                                                            <Text
                                                                color="secondary"
                                                                variant="caption-2"
                                                            >
                                                                {crumb}
                                                            </Text>
                                                        </span>
                                                    ) : null}
                                                    <Text color="secondary" variant="caption-2">
                                                        {crumb ? '· ' : ''}deleted{' '}
                                                        {formatAgo(note.trashedAt)}
                                                    </Text>
                                                </div>
                                            </div>
                                            <Button
                                                view="flat"
                                                size="m"
                                                aria-label={`Restore ${note.title}`}
                                                onClick={() => onRestore(note.id)}
                                            >
                                                <Icon data={ArrowRotateLeft} />
                                                Restore
                                            </Button>
                                            <Button
                                                view="flat"
                                                size="m"
                                                aria-label={`Delete ${note.title} permanently`}
                                                onClick={() =>
                                                    setPending({
                                                        kind: 'purge',
                                                        id: note.id,
                                                        title: note.title,
                                                    })
                                                }
                                            >
                                                <Icon data={TrashBin} />
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </Dialog.Body>
                <Dialog.Footer
                    textButtonCancel="Close"
                    onClickButtonCancel={onClose}
                    textButtonApply={notes.length > 0 ? `Empty Trash (${notes.length})` : undefined}
                    propsButtonApply={{view: 'outlined-danger'}}
                    onClickButtonApply={
                        notes.length > 0 ? () => setPending({kind: 'empty'}) : undefined
                    }
                />
            </Dialog>

            <Dialog
                open={pending !== null}
                onClose={() => setPending(null)}
                onEnterKeyDown={confirmPending}
                size="s"
                disableBodyScrollLock
            >
                <Dialog.Header
                    caption={pending?.kind === 'empty' ? 'Empty Trash' : 'Delete permanently'}
                />
                <Dialog.Body>
                    <Text>
                        {pending?.kind === 'empty'
                            ? `Permanently delete all ${notes.length} note${notes.length === 1 ? '' : 's'} in the Trash? This can't be undone.`
                            : pending?.kind === 'purge'
                              ? `Permanently delete “${pending.title || 'Untitled'}”? This can't be undone.`
                              : ''}
                    </Text>
                </Dialog.Body>
                <Dialog.Footer
                    textButtonApply="Delete"
                    textButtonCancel="Cancel"
                    propsButtonApply={{view: 'outlined-danger'}}
                    onClickButtonApply={confirmPending}
                    onClickButtonCancel={() => setPending(null)}
                />
            </Dialog>
        </>
    );
}
