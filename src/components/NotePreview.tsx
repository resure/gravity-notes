import {forwardRef, useEffect, useState} from 'react';

import transform from '@diplodoc/transform';
import {Text} from '@gravity-ui/uikit';

import {type AttachmentUrlCache, useAttachmentCache} from '../attachments';
import {isAttachmentRef} from '../storage/noteText';

import './NotePreview.css';

interface NotePreviewProps {
    /** The Markdown to render (captured from the editor when preview is toggled on). */
    markup: string;
}

/** Every distinct `Attachments/…` image src referenced in the Markdown (for pre-resolution). */
function attachmentRefs(markup: string): string[] {
    const refs = new Set<string>();
    for (const match of markup.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g)) {
        if (isAttachmentRef(match[1])) refs.add(match[1]);
    }
    return [...refs];
}

/**
 * Rewrite every attachment `<img src>` in the rendered HTML to its resolved `blob:` object URL.
 * `@diplodoc/transform` leaves image srcs verbatim (its `images` plugin isn't in the default set),
 * so we swap them after the fact — only when the cache already holds the URL (else leave the path,
 * and a re-render follows once it resolves). `decodeURI` covers any %-encoding markdown-it applied.
 */
function withResolvedImages(html: string, cache: AttachmentUrlCache): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let changed = false;
    doc.querySelectorAll('img[src]').forEach((img) => {
        const raw = img.getAttribute('src') ?? '';
        let ref = raw;
        try {
            ref = decodeURI(raw);
        } catch {
            // Malformed escape — match against the raw value instead.
        }
        if (!isAttachmentRef(ref)) return;
        const url = cache.peek(ref);
        if (url) {
            img.setAttribute('src', url);
            changed = true;
        }
    });
    return changed ? doc.body.innerHTML : html;
}

/**
 * Read-only rendered view of a note's Markdown, for preview mode. Renders YFM HTML via the
 * editor's own transformer so it matches the WYSIWYG output, into a `.yfm` container that
 * picks up the globally-loaded YFM styles. The root is programmatically focusable so an
 * Escape over it bubbles to the editor-pane wrapper.
 *
 * Attachment image srcs (`Attachments/…`) are rewritten to their `blob:` object URLs after the
 * transform. Resolution is async, so referenced attachments are first read into the shared cache,
 * then the HTML is re-rendered reading the now-cached URLs.
 */
export const NotePreview = forwardRef<HTMLDivElement, NotePreviewProps>(function NotePreview(
    {markup},
    ref,
) {
    const cache = useAttachmentCache();
    const [rendered, setRendered] = useState<{html: string; error: boolean}>({
        html: '',
        error: false,
    });

    useEffect(() => {
        const render = (): {html: string; error: boolean} => {
            try {
                // @diplodoc/transform escapes raw HTML and sanitizes its output by default, matching
                // the editor's no-raw-HTML policy; we only swap attachment img srcs afterward.
                let html = transform(markup).result.html;
                if (cache) html = withResolvedImages(html, cache);
                return {html, error: false};
            } catch {
                return {html: '', error: true};
            }
        };

        // Render right away (correct for note text and any already-cached/seeded images)…
        setRendered(render());
        // …then, once any not-yet-read attachments resolve, re-render so their <img>s point at blobs.
        const refs = attachmentRefs(markup);
        if (refs.length === 0 || !cache) return undefined;
        let alive = true;
        Promise.all(refs.map((r) => cache.resolve(r).catch(() => undefined))).then(() => {
            if (alive) setRendered(render());
        });
        return () => {
            alive = false;
        };
    }, [markup, cache]);

    return (
        <div ref={ref} className="note-preview" tabIndex={-1}>
            {rendered.error ? (
                // Surface a transform failure instead of a silent blank pane; the editor body keeps
                // the actual content, so the user can switch back and keep working.
                <Text color="danger" className="note-preview__error">
                    Couldn’t render a preview of this note. Switch back to the editor to keep
                    editing.
                </Text>
            ) : (
                <div
                    className="note-preview__body yfm"
                    dangerouslySetInnerHTML={{__html: rendered.html}}
                />
            )}
        </div>
    );
});
