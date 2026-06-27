import {type CSSProperties, useEffect, useState} from 'react';

import type {ReactNodeViewProps} from '@gravity-ui/markdown-editor';

import {useAttachmentCache} from '../../attachments';
import {isAttachmentRef} from '../../storage/noteText';

import './attachmentImageView.css';

/**
 * Custom WYSIWYG NodeView for image nodes. The doc/Markdown keeps the stable `src` (`Attachments/…`);
 * for display we resolve that to a `blob:` object URL via the shared {@link useAttachmentCache}, so
 * the rendered `<img>` loads while `editor.getValue()` and Markup mode still show the clean path —
 * no `blob:` URL ever leaks into a saved note. External `src`s (http/data) render unchanged.
 *
 * Registered with `Priority.VeryHigh` (see `attachmentImageExtension`), so this view wins over the
 * package's built-in image NodeView. Resize handles / the settings popover are intentionally not
 * carried over for this MVP (see TODO.md).
 */
export function AttachmentImageView({node}: ReactNodeViewProps) {
    const cache = useAttachmentCache();
    const src = (node.attrs.src as string | undefined) ?? '';
    const alt = (node.attrs.alt as string | undefined) ?? '';
    const width = node.attrs.width as string | null | undefined;
    const height = node.attrs.height as string | null | undefined;
    const attachment = isAttachmentRef(src);

    // External srcs display verbatim; attachment refs resolve to an object URL (seeded synchronously
    // right after an upload, otherwise read asynchronously).
    const [resolved, setResolved] = useState<string | undefined>(() =>
        attachment ? cache?.peek(src) : src,
    );
    useEffect(() => {
        if (!attachment) {
            setResolved(src);
            return undefined;
        }
        const seeded = cache?.peek(src);
        if (seeded) {
            setResolved(seeded);
            return undefined;
        }
        let alive = true;
        cache
            ?.resolve(src)
            .then((url) => {
                if (alive) setResolved(url);
            })
            .catch(() => {
                // Leave the placeholder in place if the attachment can't be read.
            });
        return () => {
            alive = false;
        };
    }, [attachment, src, cache]);

    const style: CSSProperties = {};
    if (width) style.width = `${width}px`;
    if (height) style.height = `${height}px`;

    // Hold a placeholder box (sized if dimensions are known) while an attachment URL resolves, so the
    // layout doesn't jump when the image appears.
    if (attachment && !resolved) {
        return (
            <span className="attachment-image attachment-image_loading" style={style} title={alt} />
        );
    }
    return <img className="attachment-image" src={resolved} alt={alt} style={style} />;
}
