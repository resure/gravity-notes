import {useEffect, useState} from 'react';

import {useAttachmentCache} from '../../attachments';

import type {Block as BlockData} from './types';

/**
 * An image block. The note's Markdown always carries the root-relative `Attachments/…` reference;
 * the bytes are turned into a `blob:` URL only here, at display time, by the workspace's shared
 * cache. Subscribing pins the URL for as long as the image is on screen, so the cache's byte-budget
 * eviction can never yank a visible image.
 */
export default function AttachmentImage({block, onSelect}: {block: BlockData; onSelect(): void}) {
    const cache = useAttachmentCache();
    const src = block.image?.src ?? '';
    const [url, setUrl] = useState<string | undefined>(() => cache?.peek(src));
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!cache || !src) return undefined;
        // An absolute URL needs no resolution — only in-vault refs go through the cache.
        if (!src.startsWith('Attachments/')) {
            setUrl(src);
            return undefined;
        }
        const unsubscribe = cache.subscribe(src, () => setUrl(cache.peek(src)));
        cache
            .resolve(src)
            .then(setUrl)
            .catch(() => setFailed(true));
        return unsubscribe;
    }, [cache, src]);

    return (
        <figure className="image-wrap" contentEditable={false} onClick={onSelect}>
            {failed || !url ? (
                <div className="image-broken">
                    {failed ? `Missing image: ${src}` : 'Loading image…'}
                </div>
            ) : (
                <img
                    src={url}
                    alt={block.image?.alt ?? ''}
                    style={block.image?.width ? {width: block.image.width} : undefined}
                />
            )}
            {block.image?.alt && <figcaption>{block.image.alt}</figcaption>}
        </figure>
    );
}
