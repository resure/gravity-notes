import {useEffect, useState} from 'react';

import {Button, Dialog, Skeleton} from '@gravity-ui/uikit';

import {Folder, Refresh, Trash} from '../icons/icons';
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
            <Dialog
                open={open}
                onClose={onClose}
                className="trash-dialog"
                hasCloseButton={false}
                disableBodyScrollLock
            >
                <Dialog.Header caption="Trash" />
                <Dialog.Body>
                    {loading ? (
                        <div className="trash__list">
                            {[0, 1, 2].map((i) => (
                                <div className="trash__row" key={i}>
                                    <div className="trash__meta">
                                        <Skeleton className="trash__skeleton" width={160} />
                                        <Skeleton
                                            className="trash__skeleton trash__skeleton_sub"
                                            width={96}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : notes.length === 0 ? (
                        <div className="trash__empty">
                            <Trash size={26} className="trash__empty-glyph" />
                            <p className="trash__empty-line">Trash is empty</p>
                            <p className="trash__empty-hint">
                                Deleted notes land here, ready to restore.
                            </p>
                        </div>
                    ) : (
                        <>
                            <p className="trash__count">
                                {notes.length} note{notes.length === 1 ? '' : 's'} · restore to
                                recover, or delete permanently
                            </p>
                            <div className="trash__list">
                                {notes.map((note) => {
                                    const crumb = formatCrumb(note.originalPath);
                                    return (
                                        <div className="trash__row" key={note.id}>
                                            <div className="trash__meta">
                                                <span className="trash__name" title={note.title}>
                                                    {note.title || 'Untitled'}
                                                </span>
                                                <span className="trash__sub">
                                                    {crumb ? (
                                                        <span className="trash__folder">
                                                            <Folder size={12} />
                                                            {crumb}
                                                        </span>
                                                    ) : null}
                                                    <span>
                                                        {crumb ? '· ' : ''}deleted{' '}
                                                        {formatAgo(note.trashedAt)}
                                                    </span>
                                                </span>
                                            </div>
                                            <Button
                                                view="flat"
                                                aria-label={`Restore ${note.title}`}
                                                onClick={() => onRestore(note.id)}
                                            >
                                                <Button.Icon>
                                                    <Refresh size={15} />
                                                </Button.Icon>
                                                Restore
                                            </Button>
                                            <Button
                                                view="flat"
                                                aria-label={`Delete ${note.title} permanently`}
                                                onClick={() =>
                                                    setPending({
                                                        kind: 'purge',
                                                        id: note.id,
                                                        title: note.title,
                                                    })
                                                }
                                            >
                                                <Button.Icon>
                                                    <Trash size={15} />
                                                </Button.Icon>
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
                    propsButtonCancel={{view: 'outlined'}}
                    textButtonApply={notes.length > 0 ? `Empty Trash (${notes.length})` : undefined}
                    propsButtonApply={{view: 'outlined-danger'}}
                    onClickButtonApply={
                        notes.length > 0 ? () => setPending({kind: 'empty'}) : undefined
                    }
                    renderButtons={(apply, cancel) => (
                        <>
                            {notes.length > 0 ? apply : null}
                            {cancel}
                        </>
                    )}
                />
            </Dialog>

            <Dialog
                open={pending !== null}
                onClose={() => setPending(null)}
                onEnterKeyDown={confirmPending}
                className="trash-dialog trash-dialog_confirm"
                hasCloseButton={false}
                disableBodyScrollLock
            >
                <Dialog.Header
                    caption={pending?.kind === 'empty' ? 'Empty Trash' : 'Delete permanently'}
                />
                <Dialog.Body>
                    <p className="trash__confirm">
                        {pending?.kind === 'empty'
                            ? `Permanently delete all ${notes.length} note${notes.length === 1 ? '' : 's'} in the Trash? This can’t be undone.`
                            : pending?.kind === 'purge'
                              ? `Permanently delete “${pending.title || 'Untitled'}”? This can’t be undone.`
                              : ''}
                    </p>
                </Dialog.Body>
                <Dialog.Footer
                    preset="danger"
                    textButtonApply="Delete"
                    textButtonCancel="Cancel"
                    propsButtonCancel={{view: 'outlined'}}
                    onClickButtonApply={confirmPending}
                    onClickButtonCancel={() => setPending(null)}
                />
            </Dialog>
        </>
    );
}
