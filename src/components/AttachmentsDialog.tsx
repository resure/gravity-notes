import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {FolderOpen, TrashBin} from '@gravity-ui/icons';
import {Button, Dialog, Icon, Label, Select, Spin, Text} from '@gravity-ui/uikit';
import {useVirtualizer} from '@tanstack/react-virtual';

import {type AttachmentUrlCache} from '../attachments';
import {attachmentRefsIn} from '../storage/noteText';
import type {AttachmentMeta, NoteStore} from '../storage/types';

import {Lightbox} from './Lightbox';

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

/** Display order for the attachment list. */
type AttachmentSort = 'recent' | 'size' | 'name';

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
    const [sort, setSort] = useState<AttachmentSort>('recent');
    // The attachment being viewed full-size (null = none), resolved to an object URL.
    const [viewing, setViewing] = useState<{url: string; name: string} | null>(null);
    // "Reveal in Finder" is desktop-only — present only when the backend can do it (Tauri folder).
    const reveal = store.reveal;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [attachments, notes, trash] = await Promise.all([
                store.listAttachments(),
                store.getAll(),
                store.listTrash(),
            ]);
            // Trashed notes still reference their attachments — counting them keeps a still-needed
            // file out of "Unused" (and off the bulk-delete list), so restoring a trashed note never
            // finds its image already purged. `getAll()` excludes `.trash/`, so read those bodies
            // here (trash is small). Each read is fail-soft: a single unreadable trashed note must not
            // blank the whole manager, so we skip it (its refs just aren't counted).
            const trashBodies = await Promise.all(
                trash.map((t) =>
                    store
                        .get(t.id)
                        .then((n) => n.content)
                        .catch(() => ''),
                ),
            );
            const usage = new Map<string, number>();
            const bodies = [...notes.map((n) => n.content), ...trashBodies];
            for (const body of bodies) {
                for (const ref of attachmentRefsIn(body)) {
                    usage.set(ref, (usage.get(ref) ?? 0) + 1);
                }
            }
            setItems(attachments.map((a) => ({...a, usedBy: usage.get(a.ref) ?? 0})));
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to load attachments');
        } finally {
            setLoading(false);
        }
    }, [store, onError]);

    useEffect(() => {
        if (open) {
            void load();
        } else {
            setPending(null);
            setViewing(null);
        }
    }, [open, load]);

    const orphans = items.filter((i) => i.usedBy === 0);

    // Display order (the underlying `items` stay load-order; usage/orphan checks are order-agnostic).
    const sortedItems = useMemo(() => {
        const arr = [...items];
        if (sort === 'size') arr.sort((a, b) => b.size - a.size);
        else if (sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name));
        else arr.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        return arr;
    }, [items, sort]);

    // Virtualize the list: a media-heavy vault has dozens–hundreds of attachments, and each row's
    // <Thumb> reads + decodes a full-size image on mount. Rendering only the visible rows means only
    // the on-screen thumbnails ever load (the rest stream in as you scroll) — the dominant cost of
    // opening this dialog. The scroll container is `.attachments__list`.
    const listRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
        count: sortedItems.length,
        getScrollElement: () => listRef.current,
        estimateSize: () => 56,
        overscan: 6,
        getItemKey: (index) => sortedItems[index].ref,
    });

    // Open an attachment full-size: reuse its already-resolved object URL when the thumbnail has one.
    const openView = useCallback(
        (item: AttachmentRow) => {
            void (async () => {
                try {
                    const url = cache.peek(item.ref) ?? (await cache.resolve(item.ref));
                    // resolve() yields '' if the ref was forgotten/disposed mid-flight — never open
                    // the Lightbox on an empty src.
                    if (!url) {
                        onError('Failed to open attachment');
                        return;
                    }
                    setViewing({url, name: item.name});
                } catch {
                    onError('Failed to open attachment');
                }
            })();
        },
        [cache, onError],
    );

    const onReveal = useCallback(
        (ref: string) => {
            // Call through `store` (not the captured `reveal`) so `this` stays bound — TauriNoteStore
            // .reveal reads `this.dir`; the optional-call form `store.reveal?.(…)` keeps the receiver.
            store
                .reveal?.(ref)
                .catch((err) =>
                    onError(err instanceof Error ? err.message : 'Failed to reveal in Finder'),
                );
        },
        [store, onError],
    );

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
            return `Delete ${n} unused file${n === 1 ? '' : 's'}? No note (including trashed ones) references them.`;
        }
        if (pending.usedBy > 0) {
            const n = pending.usedBy;
            return `“${pending.label}” is used by ${n} note${n === 1 ? '' : 's'}. Deleting it will leave broken image links there.`;
        }
        return `Delete “${pending.label}”? No note (including trashed ones) references it.`;
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
                        <>
                            <div className="attachments__toolbar">
                                <Text color="secondary" variant="caption-2">
                                    {items.length} file{items.length === 1 ? '' : 's'}
                                </Text>
                                <Select
                                    className="attachments__sort"
                                    size="s"
                                    aria-label="Sort attachments"
                                    value={[sort]}
                                    onUpdate={([next]) => {
                                        if (next) setSort(next as AttachmentSort);
                                    }}
                                    options={[
                                        {value: 'recent', content: 'Recent'},
                                        {value: 'size', content: 'Largest'},
                                        {value: 'name', content: 'Name'},
                                    ]}
                                />
                            </div>
                            <div ref={listRef} className="attachments__list virtual-scroll">
                                <div
                                    style={{
                                        height: rowVirtualizer.getTotalSize(),
                                        position: 'relative',
                                    }}
                                >
                                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                                        const item = sortedItems[virtualRow.index];
                                        return (
                                            <div
                                                key={virtualRow.key}
                                                data-index={virtualRow.index}
                                                ref={rowVirtualizer.measureElement}
                                                style={{
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: 0,
                                                    width: '100%',
                                                    paddingBottom: 4,
                                                    transform: `translateY(${virtualRow.start}px)`,
                                                }}
                                            >
                                                <div className="attachments__row">
                                                    <button
                                                        type="button"
                                                        className="attachments__thumb-btn"
                                                        aria-label={`View ${item.name}`}
                                                        onClick={() => openView(item)}
                                                    >
                                                        <Thumb
                                                            cache={cache}
                                                            refPath={item.ref}
                                                            alt={item.name}
                                                        />
                                                    </button>
                                                    <div className="attachments__meta">
                                                        <Text
                                                            className="attachments__name"
                                                            ellipsis
                                                            title={item.name}
                                                        >
                                                            {item.name}
                                                        </Text>
                                                        <div className="attachments__sub">
                                                            <Text
                                                                color="secondary"
                                                                variant="caption-2"
                                                            >
                                                                {formatBytes(item.size)}
                                                            </Text>
                                                            {item.usedBy === 0 ? (
                                                                <Label theme="warning" size="xs">
                                                                    Unused
                                                                </Label>
                                                            ) : (
                                                                <Text
                                                                    color="secondary"
                                                                    variant="caption-2"
                                                                >
                                                                    · Used by {item.usedBy} note
                                                                    {item.usedBy === 1 ? '' : 's'}
                                                                </Text>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {reveal ? (
                                                        <Button
                                                            view="flat"
                                                            size="m"
                                                            aria-label={`Reveal ${item.name} in Finder`}
                                                            onClick={() => onReveal(item.ref)}
                                                        >
                                                            <Icon data={FolderOpen} />
                                                        </Button>
                                                    ) : null}
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
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </>
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

            {viewing ? (
                <Lightbox src={viewing.url} alt={viewing.name} onClose={() => setViewing(null)} />
            ) : null}
        </>
    );
}
