import {useCallback, useEffect, useState} from 'react';

import {TrashBin} from '@gravity-ui/icons';
import {Button, Dialog, Icon, Label, Spin, Text} from '@gravity-ui/uikit';

import {type AttachmentUrlCache} from '../attachments';
import {attachmentRefsIn} from '../storage/noteText';
import type {AttachmentMeta, NoteStore} from '../storage/types';

import './AttachmentsDialog.css';

export interface AttachmentsDialogProps {
    open: boolean;
    store: NoteStore;
    /** Shared cache, for thumbnails and for invalidating a deleted attachment's object URL. */
    cache: AttachmentUrlCache;
    onClose: () => void;
    onError: (message: string) => void;
}

/** An attachment plus how many notes reference it (0 = orphan / unused). */
interface AttachmentRow extends AttachmentMeta {
    usedBy: number;
}

/** A queued deletion awaiting confirmation. */
interface PendingDelete {
    refs: string[];
    /** Notes referencing the (single) target; 0 for orphans / bulk. */
    usedBy: number;
    /** Display name for the single-file case. */
    label: string;
    /** True for the bulk "delete unused" action. */
    bulk: boolean;
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A small image thumbnail that resolves its attachment ref to an object URL on demand. */
function Thumb({cache, refPath, alt}: {cache: AttachmentUrlCache; refPath: string; alt: string}) {
    const [url, setUrl] = useState<string | undefined>(() => cache.peek(refPath));
    useEffect(() => {
        if (url) return undefined;
        let alive = true;
        cache
            .resolve(refPath)
            .then((resolved) => {
                if (alive) setUrl(resolved);
            })
            .catch(() => {
                // Leave the placeholder if it can't be read.
            });
        return () => {
            alive = false;
        };
    }, [cache, refPath, url]);
    return url ? (
        <img className="attachments__thumb" src={url} alt={alt} />
    ) : (
        <span className="attachments__thumb attachments__thumb_loading" />
    );
}

/**
 * Media-attachment manager: lists every stored attachment with a thumbnail, size, and a "used by N
 * notes" / "Unused" badge (computed by scanning note bodies for `Attachments/…` refs), and lets the
 * user delete individual files or bulk-remove the unused ones. Deletes are confirmed — emphatically
 * so for a still-referenced file, since removing it leaves broken image links.
 */
export function AttachmentsDialog({open, store, cache, onClose, onError}: AttachmentsDialogProps) {
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<AttachmentRow[]>([]);
    const [pending, setPending] = useState<PendingDelete | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [attachments, notes] = await Promise.all([
                store.listAttachments(),
                store.getAll(),
            ]);
            const usage = new Map<string, number>();
            for (const note of notes) {
                for (const ref of attachmentRefsIn(note.content)) {
                    usage.set(ref, (usage.get(ref) ?? 0) + 1);
                }
            }
            const rows = attachments
                .map((a) => ({...a, usedBy: usage.get(a.ref) ?? 0}))
                .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
            setItems(rows);
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to load attachments');
        } finally {
            setLoading(false);
        }
    }, [store, onError]);

    useEffect(() => {
        if (open) void load();
        else setPending(null);
    }, [open, load]);

    const orphans = items.filter((i) => i.usedBy === 0);

    const runDelete = useCallback(async () => {
        if (!pending) return;
        setBusy(true);
        try {
            for (const ref of pending.refs) {
                await store.removeAttachment(ref);
                cache.forget(ref);
            }
            const removed = new Set(pending.refs);
            setItems((prev) => prev.filter((i) => !removed.has(i.ref)));
            setPending(null);
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to delete attachment');
            await load(); // resync after a partial failure
            setPending(null);
        } finally {
            setBusy(false);
        }
    }, [pending, store, cache, onError, load]);

    const confirmMessage = (): string => {
        if (!pending) return '';
        if (pending.bulk) {
            const n = pending.refs.length;
            return `Delete ${n} unused file${n === 1 ? '' : 's'}? They aren't referenced by any note.`;
        }
        if (pending.usedBy > 0) {
            const n = pending.usedBy;
            return `“${pending.label}” is used by ${n} note${n === 1 ? '' : 's'}. Deleting it will leave broken image links there.`;
        }
        return `Delete “${pending.label}”? It isn't referenced by any note.`;
    };

    return (
        <>
            <Dialog open={open} onClose={onClose} size="m" disableBodyScrollLock>
                <Dialog.Header caption="Attachments" />
                <Dialog.Body>
                    {loading ? (
                        <div className="attachments__center">
                            <Spin />
                        </div>
                    ) : items.length === 0 ? (
                        <div className="attachments__center">
                            <Text color="secondary">
                                No attachments yet. Drop or paste an image into a note to add one.
                            </Text>
                        </div>
                    ) : (
                        <div className="attachments__list">
                            {items.map((item) => (
                                <div className="attachments__row" key={item.ref}>
                                    <Thumb cache={cache} refPath={item.ref} alt={item.name} />
                                    <div className="attachments__meta">
                                        <Text
                                            className="attachments__name"
                                            ellipsis
                                            title={item.name}
                                        >
                                            {item.name}
                                        </Text>
                                        <div className="attachments__sub">
                                            <Text color="secondary" variant="caption-2">
                                                {formatBytes(item.size)}
                                            </Text>
                                            {item.usedBy === 0 ? (
                                                <Label theme="warning" size="xs">
                                                    Unused
                                                </Label>
                                            ) : (
                                                <Text color="secondary" variant="caption-2">
                                                    · Used by {item.usedBy} note
                                                    {item.usedBy === 1 ? '' : 's'}
                                                </Text>
                                            )}
                                        </div>
                                    </div>
                                    <Button
                                        view="flat"
                                        size="m"
                                        aria-label={`Delete ${item.name}`}
                                        onClick={() =>
                                            setPending({
                                                refs: [item.ref],
                                                usedBy: item.usedBy,
                                                label: item.name,
                                                bulk: false,
                                            })
                                        }
                                    >
                                        <Icon data={TrashBin} />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </Dialog.Body>
                <Dialog.Footer
                    textButtonCancel="Close"
                    onClickButtonCancel={onClose}
                    textButtonApply={
                        orphans.length > 0 ? `Delete unused (${orphans.length})` : undefined
                    }
                    propsButtonApply={{view: 'outlined-danger'}}
                    onClickButtonApply={
                        orphans.length > 0
                            ? () =>
                                  setPending({
                                      refs: orphans.map((o) => o.ref),
                                      usedBy: 0,
                                      label: '',
                                      bulk: true,
                                  })
                            : undefined
                    }
                />
            </Dialog>

            <Dialog
                open={pending !== null}
                onClose={() => !busy && setPending(null)}
                onEnterKeyDown={runDelete}
                size="s"
                disableBodyScrollLock
            >
                <Dialog.Header caption="Delete attachment" />
                <Dialog.Body>
                    <Text>{confirmMessage()}</Text>
                </Dialog.Body>
                <Dialog.Footer
                    textButtonApply="Delete"
                    textButtonCancel="Cancel"
                    propsButtonApply={{view: 'outlined-danger', loading: busy}}
                    onClickButtonApply={runDelete}
                    onClickButtonCancel={() => setPending(null)}
                />
            </Dialog>
        </>
    );
}
