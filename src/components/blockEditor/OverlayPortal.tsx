import type {ReactNode} from 'react';

import {createPortal} from 'react-dom';

/**
 * Render a floating overlay (slash menu, block menu, selection toolbar) at the end of `<body>`.
 *
 * Two host constraints force this, and they pull in opposite directions:
 *
 *  - The overlays are `position: fixed` in viewport coordinates, but `fixed` is resolved against the
 *    nearest *transformed* ancestor — and Sol's editor pane carries a `transform` (a WebKit
 *    repaint fix) and clips its overflow. Rendered in place, an overlay is silently re-anchored to
 *    the pane and cut off at its edge. So it has to leave the pane.
 *  - But `editor.css` is scoped under `.gn-block-editor` (its class names are generic enough to
 *    style the rest of the app), so an overlay that leaves the subtree loses all of its styling.
 *
 * The host div satisfies both: it carries the scope class, so the scoped rules still match, and
 * `display: contents` means it generates no box of its own. `<body>` is also where Gravity puts its
 * theme class, so the dark-theme overrides keep applying.
 */
export function OverlayPortal({children}: {children: ReactNode}) {
    return createPortal(
        <div className="gn-block-editor gn-block-editor_portal">{children}</div>,
        document.body,
    );
}
