import {
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
    useEffect,
    useRef,
    useState,
} from 'react';

import {useAttachmentCache} from '../../attachments';
import {basename, isAttachmentRef} from '../../storage/noteText';
import {Lightbox} from '../Lightbox';

import {ExpandIcon, PencilIcon} from './icons';
import type {Block as BlockData, ImageData} from './types';

/** Smallest width (px) a resize drag will allow. */
const MIN_WIDTH = 48;

/**
 * Whether `alt` is meaningful enough to surface as a caption. On paste the editor seeds alt with the
 * file's base name (e.g. `diagram`); that's not a caption, so suppress it. Any other non-empty alt is
 * a real caption.
 */
function isCaption(alt: string, src: string): boolean {
    return alt.length > 0 && alt !== basename(src) && alt !== basename(src).replace(/\.[^.]+$/, '');
}

/**
 * An image block. The note's Markdown always carries the root-relative `Attachments/…` reference;
 * the bytes are turned into a `blob:` URL only here, at display time, by the workspace's shared
 * cache. Subscribing pins the URL for as long as the image is on screen, so the cache's byte-budget
 * eviction can never yank a visible image.
 *
 * Beyond resolving the ref it carries the in-editor affordances the Markdown engine's image NodeView
 * had: drag-to-resize (persisted as the YFM ` =600x` suffix), an alt-text editor rendered as a
 * caption, click-to-zoom into the shared {@link Lightbox}, and explicit loading / broken states.
 */
export default function AttachmentImage({
    block,
    onSelect,
    onUpdate,
}: {
    block: BlockData;
    onSelect(): void;
    onUpdate(image: Partial<ImageData>): void;
}) {
    const cache = useAttachmentCache();
    const src = block.image?.src ?? '';
    const alt = block.image?.alt ?? '';
    const attachment = isAttachmentRef(src);
    const [url, setUrl] = useState<string | undefined>(() => (attachment ? cache?.peek(src) : src));
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!src) return undefined;
        // An absolute URL needs no resolution — only in-vault refs go through the cache.
        if (!attachment) {
            setUrl(src);
            setFailed(false);
            return undefined;
        }
        if (!cache) {
            setFailed(true);
            return undefined;
        }
        // Re-resolve when this exact attachment is deleted from the manager: its object URL has just
        // been revoked, so the image flips to its broken state at once rather than showing a dead src.
        const unsubscribe = cache.subscribe(src, () => setUrl(cache.peek(src)));
        cache
            .resolve(src)
            .then((resolved) => {
                if (resolved) setUrl(resolved);
                else setFailed(true);
            })
            .catch(() => setFailed(true));
        return unsubscribe;
    }, [cache, src, attachment]);

    // Live width during a resize drag; cleared once the committed value catches up (avoids a flash).
    const [dragWidth, setDragWidth] = useState<number | null>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const dragRef = useRef<{startX: number; startW: number; max: number} | null>(null);
    /** Detach the active drag's window listeners — set on pointerdown, cleared on pointerup. */
    const dragCleanupRef = useRef<(() => void) | null>(null);
    useEffect(() => {
        if (dragWidth !== null && block.image?.width === dragWidth) setDragWidth(null);
    }, [block.image?.width, dragWidth]);
    // If the block unmounts mid-resize (the image deleted while a drag is in progress) the pointerup
    // that would normally remove these listeners never fires — detach on unmount instead.
    useEffect(() => () => dragCleanupRef.current?.(), []);

    const onResizeDown = (event: ReactPointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const startW = imgRef.current?.getBoundingClientRect().width ?? 0;
        const max = imgRef.current?.parentElement?.clientWidth || 2000;
        dragRef.current = {startX: event.clientX, startW, max};
        function onMove(e: PointerEvent) {
            const drag = dragRef.current;
            if (!drag) return;
            setDragWidth(
                Math.round(
                    Math.min(
                        Math.max(drag.startW + (e.clientX - drag.startX), MIN_WIDTH),
                        drag.max,
                    ),
                ),
            );
        }
        function detach() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        }
        function onUp() {
            detach();
            dragCleanupRef.current = null;
            const drag = dragRef.current;
            dragRef.current = null;
            if (drag && imgRef.current) {
                // Height is cleared with the same edit: the browser keeps the aspect ratio from the
                // width alone, and leaving a stale height behind would letterbox the image on reload.
                onUpdate({
                    width: Math.round(imgRef.current.getBoundingClientRect().width),
                    height: undefined,
                });
            }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        dragCleanupRef.current = detach;
    };

    const [editingAlt, setEditingAlt] = useState(false);
    const [altDraft, setAltDraft] = useState(alt);
    const altInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (editingAlt) altInputRef.current?.focus();
    }, [editingAlt]);
    const commitAlt = () => {
        onUpdate({alt: altDraft.trim() || undefined});
        setEditingAlt(false);
    };

    const [zoom, setZoom] = useState(false);

    const width = dragWidth ?? block.image?.width;
    const imgStyle: CSSProperties | undefined = width ? {width: `${width}px`} : undefined;

    if (failed || !url) {
        return (
            <figure className="image-wrap" contentEditable={false} onClick={onSelect}>
                <div className="image-broken">
                    {failed ? `Missing image: ${src}` : 'Loading image…'}
                </div>
            </figure>
        );
    }

    return (
        <figure className="image-wrap" contentEditable={false} onClick={onSelect}>
            <span className="image-frame">
                <img ref={imgRef} src={url} alt={alt} style={imgStyle} />
                <span className="image-controls">
                    <button
                        type="button"
                        className="image-btn"
                        aria-label="View full size"
                        onClick={(event) => {
                            event.stopPropagation();
                            setZoom(true);
                        }}
                    >
                        <ExpandIcon />
                    </button>
                    <button
                        type="button"
                        className="image-btn"
                        aria-label="Edit alt text"
                        onClick={(event) => {
                            event.stopPropagation();
                            setAltDraft(isCaption(alt, src) ? alt : '');
                            setEditingAlt(true);
                        }}
                    >
                        <PencilIcon />
                    </button>
                </span>
                <span
                    className="image-resize"
                    onPointerDown={onResizeDown}
                    role="presentation"
                    aria-hidden
                />
            </span>
            {editingAlt ? (
                <input
                    ref={altInputRef}
                    className="image-alt-input"
                    value={altDraft}
                    placeholder="Describe this image (alt text)…"
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setAltDraft(event.target.value)}
                    onBlur={commitAlt}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            commitAlt();
                        } else if (event.key === 'Escape') {
                            event.preventDefault();
                            setEditingAlt(false);
                        }
                    }}
                />
            ) : isCaption(alt, src) ? (
                <figcaption>{alt}</figcaption>
            ) : null}
            {zoom ? <Lightbox src={url} alt={alt} onClose={() => setZoom(false)} /> : null}
        </figure>
    );
}
