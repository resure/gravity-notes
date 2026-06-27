import {type ExtensionBuilder, reactNodeViewFactory} from '@gravity-ui/markdown-editor';
import {Plugin} from 'prosemirror-state';

import {AttachmentImageView} from './attachmentImageView';

/** ProseMirror node name for images in the markdown-editor schema (stable across the package). */
const IMAGE_NODE = 'image';

/**
 * Wysiwyg extension that replaces the image NodeView with {@link AttachmentImageView}, which resolves
 * `Attachments/…` srcs to displayable object URLs. Added at `Priority.VeryHigh` so its `nodeViews`
 * entry is found before the package's built-in image view (ProseMirror's `someProp` takes the first
 * match, and the builder orders plugins by descending priority).
 *
 * Passed to `useMarkdownEditor` via `wysiwygConfig.extensions`; the bundle applies it with
 * `builder.use(...)`, so the extra options arg is ignored here.
 */
export function attachmentImageExtension(builder: ExtensionBuilder): void {
    builder.addPlugin(
        (deps) =>
            new Plugin({
                props: {
                    nodeViews: {
                        [IMAGE_NODE]: reactNodeViewFactory(AttachmentImageView, {isInline: true})(
                            deps,
                        ),
                    },
                },
            }),
        builder.Priority.VeryHigh,
    );
}
