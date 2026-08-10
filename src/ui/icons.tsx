import {icon} from './Icon';

/**
 * The app's own icon set — one stroke each, drawn on a 16×16 box, rendered through `Glyph` (see
 * `Icon.tsx` for the box/stroke rules). These are the spec's §07/§04 drawings, normalised onto one
 * box so a menu row, a rail row and a title-bar button can share a glyph and only differ in size.
 *
 * Two things are deliberately NOT here:
 *
 * • **Letterforms.** B, I, S, H1, H2 and `<>` are type, not icons — always 600 weight at 0.8× the
 *   icon box beside them. They live in the block editor's own toolbar, as text.
 * • **Fills.** Pins and dots are the only filled glyphs in the app; each cancels the inherited
 *   stroke on its own element rather than the set having a "filled" mode.
 */

export const ChevronRight = icon(<path d="M6.4 4l4 4-4 4" />);
export const ChevronDown = icon(<path d="M4 6.4l4 4 4-4" />);
export const ChevronLeft = icon(<path d="M9.6 4l-4 4 4 4" />);

/** Pane toggles: a window with its left (or right) column ruled off. */
export const PaneLeft = icon(
    <>
        <rect x="1.9" y="3" width="12.2" height="10" rx="2.1" />
        <path d="M6.4 3v10" />
    </>,
);
export const PaneRight = icon(
    <>
        <rect x="1.9" y="3" width="12.2" height="10" rx="2.1" />
        <path d="M9.6 3v10" />
    </>,
);

export const Search = icon(
    <>
        <circle cx="7" cy="7" r="4.6" />
        <path d="M10.5 10.5l3 3" />
    </>,
);

/** The overflow target, everywhere. Filled — dots have no stroke reading at this size. */
export const Ellipsis = icon(
    <g fill="currentColor" stroke="none">
        <circle cx="3.6" cy="8" r="1.15" />
        <circle cx="8" cy="8" r="1.15" />
        <circle cx="12.4" cy="8" r="1.15" />
    </g>,
);

export const Plus = icon(<path d="M8 3.2v9.6M3.2 8h9.6" />);
export const Check = icon(<path d="M3.4 8.4l3 3 6.2-6.6" />);
export const Xmark = icon(<path d="M4 4l8 8M12 4l-8 8" />);

export const Folder = icon(
    <path d="M2.2 4.6a1.4 1.4 0 011.4-1.4h2.7l1.5 1.6h5.2a1.4 1.4 0 011.4 1.4v5.2a1.4 1.4 0 01-1.4 1.4H3.6a1.4 1.4 0 01-1.4-1.4z" />,
);

export const FolderPlus = icon(
    <>
        <path d="M2.2 4.6a1.4 1.4 0 011.4-1.4h2.7l1.5 1.6h5.2a1.4 1.4 0 011.4 1.4v5.2a1.4 1.4 0 01-1.4 1.4H3.6a1.4 1.4 0 01-1.4-1.4z" />
        <path d="M8 7.3v3.2M6.4 8.9h3.2" />
    </>,
);

/** "Reveal in Finder" reads as an open folder — the same body, lid lifted. */
export const FolderOpen = icon(
    <>
        <path d="M2.2 12V4.6a1.4 1.4 0 011.4-1.4h2.7l1.5 1.6h5.2a1.4 1.4 0 011.4 1.4v.9" />
        <path d="M2.2 12l1.6-4.6h11L13.1 12a1.3 1.3 0 01-1.2.8H3.6A1.4 1.4 0 012.2 12z" />
    </>,
);

/** All Notes: a stack of sheets seen edge-on. */
export const Layers = icon(
    <>
        <path d="M8 2.1l5.7 3-5.7 3-5.7-3z" />
        <path d="M2.7 8.4L8 11.2l5.3-2.8M2.7 11.5L8 14.3l5.3-2.8" />
    </>,
);

export const Trash = icon(
    <>
        <path d="M3 4.4h10" />
        <path d="M6.4 4.4V3.5a.9.9 0 01.9-.9h1.4a.9.9 0 01.9.9v.9" />
        <path d="M4.3 4.4l.6 8.1a1.1 1.1 0 001.1 1h4a1.1 1.1 0 001.1-1l.6-8.1" />
    </>,
);

/** Pin — a filled head on a stroked shaft, per §07's note menu. */
export const Pin = icon(
    <>
        <circle cx="8" cy="5.6" r="2.9" />
        <path d="M8 8.5V13" />
    </>,
);
export const PinFill = icon(
    <>
        <circle cx="8" cy="5.6" r="2.9" fill="currentColor" stroke="none" />
        <path d="M8 8.2V13.4" />
    </>,
);
export const PinSlash = icon(
    <>
        <circle cx="8" cy="5.6" r="2.9" />
        <path d="M8 8.5V13" />
        <path d="M2.6 2.6l10.8 10.8" />
    </>,
);

export const Pencil = icon(<path d="M9.6 3.4l3 3-6.2 6.2-3.6.6.6-3.6z" />);

/** Move to… — an arrow leaving for somewhere else. */
export const ArrowRight = icon(<path d="M3 8h9.4M9 4.6L12.6 8 9 11.4" />);

export const Copy = icon(
    <>
        <rect x="2.6" y="2.6" width="8" height="8" rx="1.6" />
        <path d="M5.4 13.4h6a2 2 0 002-2v-6" />
    </>,
);

/** A second window: the frame with its title bar ruled off. */
export const NewWindow = icon(
    <>
        <rect x="2.2" y="3" width="11.6" height="10" rx="2" />
        <path d="M2.2 6h11.6" />
    </>,
);

export const Export = icon(
    <>
        <path d="M8 10.6V2.8M5.2 5.6L8 2.8l2.8 2.8" />
        <path d="M2.8 10v2.2a1 1 0 001 1h8.4a1 1 0 001-1V10" />
    </>,
);

export const Import = icon(
    <>
        <path d="M8 2.8v7.8M5.2 7.8L8 10.6l2.8-2.8" />
        <path d="M2.8 10v2.2a1 1 0 001 1h8.4a1 1 0 001-1V10" />
    </>,
);

/** Attachments — a paperclip. */
export const Paperclip = icon(
    <path d="M10.6 5.4L6.2 9.8a1.7 1.7 0 002.4 2.4l4.6-4.6a3.1 3.1 0 00-4.4-4.4L4.2 7.8a4.5 4.5 0 006.4 6.4" />,
);

/** "Copy link to note" — two links of a chain. */
export const Link = icon(
    <>
        <path d="M6.6 9.4a2.7 2.7 0 003.8 0l2.2-2.2a2.7 2.7 0 00-3.8-3.8l-.7.7" />
        <path d="M9.4 6.6a2.7 2.7 0 00-3.8 0L3.4 8.8a2.7 2.7 0 003.8 3.8l.7-.7" />
    </>,
);

export const Refresh = icon(
    <>
        <path d="M13 8a5 5 0 11-1.6-3.7" />
        <path d="M13.2 2.6v3h-3" />
    </>,
);

export const Gear = icon(
    <>
        <circle cx="8" cy="8" r="2.1" />
        <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6" />
    </>,
);

export const Keyboard = icon(
    <>
        <rect x="1.8" y="4.4" width="12.4" height="7.2" rx="1.6" />
        <path d="M5.4 9.4h5.2" />
    </>,
);

export const Eye = icon(
    <>
        <path d="M1.6 8s2.4-4 6.4-4 6.4 4 6.4 4-2.4 4-6.4 4-6.4-4-6.4-4z" />
        <circle cx="8" cy="8" r="1.7" />
    </>,
);

/** "Markup instead of blocks" — the angle brackets. */
export const Code = icon(<path d="M5.8 4.6L2.4 8l3.4 3.4M10.2 4.6L13.6 8l-3.4 3.4" />);

export const Clock = icon(
    <>
        <circle cx="8" cy="8" r="5.4" />
        <path d="M8 4.8V8l2.3 1.5" />
    </>,
);

export const Database = icon(
    <>
        <ellipse cx="8" cy="4.2" rx="4.9" ry="1.9" />
        <path d="M3.1 4.2v7.6c0 1.05 2.2 1.9 4.9 1.9s4.9-.85 4.9-1.9V4.2" />
        <path d="M3.1 8c0 1.05 2.2 1.9 4.9 1.9s4.9-.85 4.9-1.9" />
    </>,
);

export const Sun = icon(
    <>
        <circle cx="8" cy="8" r="2.9" />
        <path d="M8 1.6v1.5M8 12.9v1.5M14.4 8h-1.5M3.1 8H1.6M12.5 3.5l-1 1M4.5 11.5l-1 1M12.5 12.5l-1-1M4.5 4.5l-1-1" />
    </>,
);

export const Moon = icon(<path d="M13 9.4A5.6 5.6 0 016.6 3a5.6 5.6 0 106.4 6.4z" />);

/** System theme — a display. */
export const Display = icon(
    <>
        <rect x="2" y="3.2" width="12" height="8" rx="1.5" />
        <path d="M6 13.4h4" />
    </>,
);

/** Theme, as the Orb menu's own row glyph: a disc split light/dark. */
export const Contrast = icon(
    <>
        <circle cx="8" cy="8" r="4.6" />
        <path d="M8 3.4v9.2" />
    </>,
);

export const CircleQuestion = icon(
    <>
        <circle cx="8" cy="8" r="5.6" />
        <path d="M6.4 6.3a1.7 1.7 0 113 1.2c-.6.5-1.4.8-1.4 1.7" />
        <circle cx="8" cy="11.4" r="0.55" fill="currentColor" stroke="none" />
    </>,
);

export const CircleArrowUp = icon(
    <>
        <circle cx="8" cy="8" r="5.6" />
        <path d="M8 11V5.4M5.8 7.6L8 5.4l2.2 2.2" />
    </>,
);

export const Picture = icon(
    <>
        <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.8" />
        <path d="M2.4 10.9l3.1-2.7 2.6 2.2 2.3-2 3.4 3" />
        <circle cx="6" cy="6.2" r="0.9" />
    </>,
);

export const House = icon(
    <>
        <path d="M2.6 7.2L8 2.6l5.4 4.6" />
        <path d="M3.9 8.3v4.1a.9.9 0 00.9.9h6.4a.9.9 0 00.9-.9V8.3" />
    </>,
);

export const FileText = icon(
    <>
        <path d="M4 2.6h4.6L12 6v7.4a.9.9 0 01-.9.9H4a.9.9 0 01-.9-.9V3.5a.9.9 0 01.9-.9z" />
        <path d="M8.4 2.7V6H12M5.4 9h5.2M5.4 11.3h3.6" />
    </>,
);
