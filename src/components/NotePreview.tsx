import {forwardRef, useMemo} from 'react';

import transform from '@diplodoc/transform';

import './NotePreview.css';

interface NotePreviewProps {
    /** The Markdown to render (captured from the editor when preview is toggled on). */
    markup: string;
}

/**
 * Read-only rendered view of a note's Markdown, for preview mode. Renders YFM HTML via the
 * editor's own transformer so it matches the WYSIWYG output, into a `.yfm` container that
 * picks up the globally-loaded YFM styles. The root is programmatically focusable so an
 * Escape over it bubbles to the editor-pane wrapper.
 */
export const NotePreview = forwardRef<HTMLDivElement, NotePreviewProps>(function NotePreview(
    {markup},
    ref,
) {
    const html = useMemo(() => {
        try {
            return transform(markup).result.html;
        } catch {
            return '';
        }
    }, [markup]);

    return (
        <div ref={ref} className="note-preview" tabIndex={-1}>
            {/* Rendered from the user's own local Markdown; the editor disallows raw HTML. */}
            <div className="note-preview__body yfm" dangerouslySetInnerHTML={{__html: html}} />
        </div>
    );
});
