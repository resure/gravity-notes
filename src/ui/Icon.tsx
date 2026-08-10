import type {ReactNode} from 'react';

/**
 * The icon frame. Every glyph in `icons.tsx` is drawn on a 16×16 box and rendered through this
 * wrapper, which owns the two things §11 makes rules about:
 *
 * • **The box.** Five sizes, each with a job: 12 for chevrons and inline marks, 15 for pane chrome
 *   and list rows, 16 for menu items, 19 for iOS nav/toolbar, and one 26 for empty-state glyphs.
 *
 * • **The stroke.** A single stroke per glyph, and its weight is a function of the box — a path
 *   drawn once and merely scaled goes spindly at 12 and heavy at 26. The table below is the spec's;
 *   anything off it falls back to the same curve (≈20/size), so an odd size still reads right.
 *
 * Stroke and colour are set on the `<svg>` and INHERITED by the paths, so a glyph is a bare `<path>`
 * with no attributes of its own. The two exceptions — pins and dots, the only filled glyphs — say
 * `fill="currentColor"` on their own elements and cancel the inherited stroke.
 */
const STROKE_BY_SIZE: Record<number, number> = {12: 1.4, 15: 1.2, 16: 1.25, 19: 1.4, 26: 1.3};

export function strokeFor(size: number): number {
    return STROKE_BY_SIZE[size] ?? Math.round((20 / size) * 100) / 100;
}

export interface IconProps {
    /** Box size in px — 12 / 15 / 16 / 19 / 26 (see the table above). */
    size?: number;
    className?: string;
    /** Icons are decoration by default; pass a title only when the glyph is the sole label. */
    title?: string;
}

interface GlyphProps extends IconProps {
    children: ReactNode;
    /** Override the inherited stroke width (letterform-ish glyphs occasionally need it). */
    strokeWidth?: number;
}

export function Glyph({size = 16, className, title, strokeWidth, children}: GlyphProps) {
    return (
        <svg
            className={className}
            width={size}
            height={size}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth ?? strokeFor(size)}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden={title ? undefined : true}
            role={title ? 'img' : undefined}
            focusable="false"
        >
            {title ? <title>{title}</title> : null}
            {children}
        </svg>
    );
}

/** Build a glyph component from its paths. Keeps `icons.tsx` a list of drawings, not of boilerplate. */
export function icon(paths: ReactNode, defaults?: {strokeWidth?: number}) {
    return function IconComponent(props: IconProps) {
        return (
            <Glyph {...props} strokeWidth={defaults?.strokeWidth}>
                {paths}
            </Glyph>
        );
    };
}
