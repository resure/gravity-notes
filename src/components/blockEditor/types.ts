/**
 * Every block kind, as a runtime array with the type DERIVED from it. Declaring the union by hand
 * and repeating it as a Set elsewhere is how `'image'` went missing from the paste allowlist — the
 * image was silently dropped from a copied selection and nothing failed to compile.
 */
export const BLOCK_TYPES = [
    'text',
    'heading1',
    'heading2',
    'heading3',
    'todo',
    'bulleted',
    'numbered',
    'toggle',
    'table',
    'quote',
    'callout',
    'divider',
    'code',
    'image',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

/** Every block colour, runtime-first for the same reason as {@link BLOCK_TYPES}. */
export const BLOCK_COLORS = [
    'default',
    'gray',
    'brown',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'pink',
    'red',
    'gray_background',
    'brown_background',
    'orange_background',
    'yellow_background',
    'green_background',
    'blue_background',
    'purple_background',
    'pink_background',
    'red_background',
] as const;

export type BlockColor = (typeof BLOCK_COLORS)[number];

export interface Block {
    id: string;
    type: BlockType;
    html: string;
    checked?: boolean;
    /** Visual nesting level. A flat model keeps serialization and reordering simple. */
    depth?: number;
    /** Toggle blocks hide the contiguous, more deeply nested blocks below them. */
    collapsed?: boolean;
    /** Structured data for simple table blocks. Cell values use the inline HTML format. */
    table?: TableData;
    /** Notion-style block text or background color token. */
    color?: BlockColor;
    /** Media for image blocks: a root-relative `Attachments/…` ref plus its alt text. */
    image?: ImageData;
    /**
     * A fenced code block's info string — the `rust` in ```` ```rust ````. Carried so the fence
     * round-trips: without it every highlighted snippet was rewritten to a bare ``` on the first
     * edit, which meant the note failed the round-trip check and opened as raw source instead.
     */
    language?: string;
    /** The fence character a code block was written with, so `~~~` is not rewritten to ```` ``` ````. */
    fence?: '`' | '~';
    /**
     * How many blank lines stood between this block and the one above it in the source. Markdown
     * treats one and two the same, so the serializer used to impose its own rule — which rewrote a
     * list written directly under its heading (the commonest real-world shape), dropped the blank
     * line inside a loose list, and collapsed a deliberate double gap. Recording the count lets all
     * three round-trip. Absent on blocks the editor itself created, which take the default spacing.
     */
    blankBefore?: number;
}

export interface ImageData {
    /** Root-relative attachment reference (`Attachments/photo.png`), or an absolute URL. */
    src: string;
    alt?: string;
    /** Rendered width in pixels; unset means the natural/default width. */
    width?: number;
    /**
     * Rendered height in pixels. Never written by the editor (a drag-resize sets width and clears
     * this, letting the aspect ratio follow), but parsed and re-serialized so a `=WxH` written by
     * another tool survives a save untouched.
     */
    height?: number;
}

export interface TableData {
    cells: string[][];
    headerRow?: boolean;
    headerColumn?: boolean;
    /** Per-column GFM alignment from the separator row (`:--`, `:-:`, `--:`); absent = default. */
    align?: (ColumnAlign | null)[];
    /**
     * Column widths as the source WROTE them — the column-aligned style Prettier, Obsidian's
     * formatter and most editors emit. Without it every aligned table was rewritten to its compact
     * form on the first edit, so the note failed the round-trip check and opened as raw source.
     *
     * Widths rather than a "padded" flag because real tables drift: a cell edited shorter leaves the
     * column wider than its content, and recomputing from the content would silently reflow the
     * whole table. A column always renders at least as wide as its content, so growing a cell
     * widens the column as you would expect.
     */
    widths?: number[];
    /**
     * Spaces either side of a cell's content, as the source wrote them: 1 for the usual
     * `| a | b |`, 0 for the compact `|a|b|`. Recorded alongside {@link widths} because a table
     * written without padding was otherwise rewritten to the spaced form on the first edit.
     */
    pad?: number;
}

export type ColumnAlign = 'left' | 'center' | 'right';

let counter = 0;

export function uid(): string {
    counter += 1;
    return `b${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newBlock(type: BlockType = 'text', html = ''): Block {
    return {
        id: uid(),
        type,
        html,
        depth: 0,
        table: type === 'table' ? newTableData(html) : undefined,
    };
}

export function newTableData(firstCell = ''): TableData {
    return {
        cells: [
            [firstCell, '', ''],
            ['', '', ''],
        ],
        headerRow: false,
        headerColumn: false,
    };
}

/** Block types whose content is editable text. */
export function isEditableType(type: BlockType): boolean {
    return type !== 'divider' && type !== 'table' && type !== 'image';
}

/**
 * Pointer travel (px) before a press counts as a DRAG rather than a click. Shared so the two
 * gestures agree: the block marquee (Editor.tsx) and the image resize grip (AttachmentImage.tsx).
 * Below it, a press that never moved must not commit anything — a bare click on the resize grip
 * used to write the image's current width into the note.
 */
export const DRAG_SLOP = 4;

/**
 * The widest row in a grid.
 *
 * A plain `Math.max(...rows.map(r => r.length))` passes ONE ARGUMENT PER ROW, which throws a
 * RangeError once a table gets long (a pasted TSV export easily does). Every table-sizing site goes
 * through here so none of them can reintroduce the spread.
 */
export function widestRow(rows: readonly {length: number}[]): number {
    return rows.reduce((max, row) => Math.max(max, row.length), 0);
}
