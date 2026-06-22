import {forwardRef, useMemo} from 'react';

import transform from '@diplodoc/transform';
import {Text} from '@gravity-ui/uikit';

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
    const rendered = useMemo<{html: string; error: boolean}>(() => {
        try {
            return {html: transform(markup).result.html, error: false};
        } catch {
            return {html: '', error: true};
        }
    }, [markup]);

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
                // @diplodoc/transform escapes raw HTML (allowHTML:false) and sanitizes its output
                // (needToSanitizeHtml:true) by default, so this matches the editor's no-raw-HTML policy.
                <div
                    className="note-preview__body yfm"
                    dangerouslySetInnerHTML={{__html: rendered.html}}
                />
            )}
        </div>
    );
});
