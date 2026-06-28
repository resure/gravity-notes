import {
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
    useEffect,
    useRef,
    useState,
} from 'react';

import {ChevronsExpandUpRight, Pencil, Xmark} from '@gravity-ui/icons';
import type {ReactNodeViewProps} from '@gravity-ui/markdown-editor';
import {Icon} from '@gravity-ui/uikit';

import {useAttachmentCache} from '../../attachments';
import {basename, isAttachmentRef} from '../../storage/noteText';
import {Lightbox} from '../Lightbox';

import './attachmentImageView.css';

/** Smallest width (px) a resize drag will allow. */
const MIN_WIDTH = 48;

/**
 * Whether `alt` is meaningful enough to surface as a caption. On paste the editor seeds alt with the
 * exact file name (e.g. `diagram.png`); that's not a caption, so suppress it. Any other non-empty alt
 * — including one the user deliberately wrote to end in `.png` — is a real caption.
 */
function isCaption(alt: string, src: string): boolean {
    return alt.length > 0 && alt !== basename(src);
}

/**
 * Custom WYSIWYG NodeView for image nodes. Beyond resolving `Attachments/…` srcs to displayable
 * `blob:` URLs (keeping the stored Markdown clean), it adds the in-editor affordances the package's
 * default view would otherwise give us: drag-to-resize (persisted as `{width=…}`), an alt-text editor
 * (rendered as a caption when set), click-to-zoom (a full-size overlay), a selection ring (pure CSS
 * via ProseMirror's `.ProseMirror-selectednode`), and an explicit "image not found" state.
 */
export function AttachmentImageView({node, view, updateAttributes}: ReactNodeViewProps) {
    const cache = useAttachmentCache();
    const src = (node.attrs.src as string | undefined) ?? '';
    const alt = (node.attrs.alt as string | undefined) ?? '';
    const widthAttr = node.attrs.width as string | null | undefined;
    const attachment = isAttachmentRef(src);

    // External srcs display verbatim; attachment refs resolve to an object URL.
    const [resolved, setResolved] = useState<string | undefined>(() =>
        attachment ? cache?.peek(src) : src,
    );
    const [status, setStatus] = useState<'loading' | 'ok' | 'error'>(() =>
        !attachment || cache?.peek(src) ? 'ok' : 'loading',
    );

    useEffect(() => {
        if (!attachment) {
            setResolved(src);
            setStatus('ok');
            return undefined;
        }
        // No cache (e.g. rendered outside the provider): we can't resolve the ref, so show broken
        // rather than spinning on 'loading' forever.
        if (!cache) {
            setStatus('error');
            return undefined;
        }
        let alive = true;

        // (Re)resolve the ref to an object URL; flip to broken on an empty result (the ref was
        // forgotten/disposed) or a read failure (the bytes are gone).
        const load = () => {
            const seeded = cache.peek(src);
            if (seeded) {
                setResolved(seeded);
                setStatus('ok');
                return;
            }
            setStatus('loading');
            cache
                .resolve(src)
                .then((url) => {
                    if (!alive) return;
                    if (url) {
                        setResolved(url);
                        setStatus('ok');
                    } else {
                        // resolve() yields '' once the ref is forgotten/disposed — never render <img src="">.
                        setStatus('error');
                    }
                })
                .catch(() => {
                    if (alive) setStatus('error');
                });
        };
        load();

        // Re-resolve when this exact attachment is deleted from the manager — its object URL was just
        // revoked, so peek/resolve now yield nothing and the image flips to its broken state at once.
        const unsubscribe = cache.subscribe(src, load);
        return () => {
            alive = false;
            unsubscribe();
        };
    }, [attachment, src, cache]);

    // Live width during a resize drag; cleared once the committed attr catches up (avoids a flash).
    const [dragWidth, setDragWidth] = useState<number | null>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const dragRef = useRef<{startX: number; startW: number; max: number} | null>(null);
    /** Detach the active resize-drag's window listeners — set on pointerdown, cleared on pointerup. */
    const dragCleanupRef = useRef<(() => void) | null>(null);
    useEffect(() => {
        if (dragWidth !== null && widthAttr === String(dragWidth)) setDragWidth(null);
    }, [widthAttr, dragWidth]);
    // If the NodeView unmounts mid-resize (the image deleted while a drag is in progress), the
    // pointerup that would normally remove these listeners never fires — detach them on unmount so
    // they can't leak onto window with a stale dragRef.
    useEffect(() => () => dragCleanupRef.current?.(), []);

    const onResizeDown = (event: ReactPointerEvent) => {
        event.preventDefault();
        const startW = imgRef.current?.getBoundingClientRect().width ?? 0;
        dragRef.current = {startX: event.clientX, startW, max: view.dom.clientWidth || 2000};
        // Hoisted declarations so the three handlers can reference each other freely (onUp detaches,
        // detach removes onUp) without a use-before-define hazard.
        function onMove(e: PointerEvent) {
            const d = dragRef.current;
            if (!d) return;
            const next = Math.round(
                Math.min(Math.max(d.startW + (e.clientX - d.startX), MIN_WIDTH), d.max),
            );
            setDragWidth(next);
        }
        function detach() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        }
        function onUp() {
            detach();
            dragCleanupRef.current = null;
            const d = dragRef.current;
            dragRef.current = null;
            if (d && imgRef.current) {
                updateAttributes({
                    width: String(Math.round(imgRef.current.getBoundingClientRect().width)),
                });
            }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        dragCleanupRef.current = detach;
    };

    // Alt editing.
    const [editingAlt, setEditingAlt] = useState(false);
    const [altDraft, setAltDraft] = useState(alt);
    const altInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (editingAlt) altInputRef.current?.focus();
    }, [editingAlt]);
    const commitAlt = () => {
        updateAttributes({alt: altDraft.trim()});
        setEditingAlt(false);
    };

    const [zoom, setZoom] = useState(false);

    const displayWidth = dragWidth ?? (widthAttr ? Number(widthAttr) : undefined);
    const imgStyle: CSSProperties | undefined =
        displayWidth === undefined ? undefined : {width: `${displayWidth}px`};

    if (attachment && status === 'error') {
        return (
            <span className="attachment-image attachment-image_broken" title={src}>
                <Icon data={Xmark} size={14} /> image not found: {basename(src)}
            </span>
        );
    }
    if (attachment && status === 'loading') {
        return <span className="attachment-image attachment-image_loading" style={imgStyle} />;
    }

    return (
        <span className="attachment-figure">
            <span className="attachment-figure__frame">
                <img
                    ref={imgRef}
                    className="attachment-image"
                    src={resolved}
                    alt={alt}
                    style={imgStyle}
                />
                <span className="attachment-figure__controls" contentEditable={false}>
                    <button
                        type="button"
                        className="attachment-figure__btn"
                        aria-label="View full size"
                        onClick={() => setZoom(true)}
                    >
                        <Icon data={ChevronsExpandUpRight} size={14} />
                    </button>
                    <button
                        type="button"
                        className="attachment-figure__btn"
                        aria-label="Edit alt text"
                        onClick={() => {
                            setAltDraft(isCaption(alt, src) ? alt : '');
                            setEditingAlt(true);
                        }}
                    >
                        <Icon data={Pencil} size={14} />
                    </button>
                </span>
                <span
                    className="attachment-figure__handle"
                    onPointerDown={onResizeDown}
                    role="presentation"
                    aria-hidden
                />
            </span>
            {editingAlt ? (
                <span className="attachment-figure__altedit" contentEditable={false}>
                    <input
                        ref={altInputRef}
                        className="attachment-figure__altinput"
                        value={altDraft}
                        placeholder="Describe this image (alt text)…"
                        onChange={(e) => setAltDraft(e.target.value)}
                        onBlur={commitAlt}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                commitAlt();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingAlt(false);
                            }
                        }}
                    />
                </span>
            ) : isCaption(alt, src) ? (
                <span className="attachment-figure__caption">{alt}</span>
            ) : null}
            {zoom && resolved ? (
                <Lightbox
                    src={resolved}
                    alt={alt}
                    onClose={() => {
                        setZoom(false);
                        view.focus(); // return focus to the editor (it was moved to the overlay)
                    }}
                />
            ) : null}
        </span>
    );
}
